import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const { downloadUpdate } = await import('../../dist-electron/updater/download.cjs');
const { sha256Hex, signDigest } = await import('../../dist-electron/updater/signature.cjs');

const keyPath = path.join(os.homedir(), '.ytmc-release-signing.key');
const keyPem = fs.existsSync(keyPath) ? fs.readFileSync(keyPath, 'utf8') : null;
const skip = keyPem ? false : 'local signing key is missing';

function fakeResponse(status, headers, chunks) {
  return {
    status,
    headers,
    stream: (async function* () {
      for (const chunk of chunks) yield Buffer.from(chunk);
    })(),
    abort() {},
  };
}

function withRoot(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ytmc-download-'));
  return Promise.resolve(run(root)).finally(() =>
    fs.rmSync(root, { recursive: true, force: true })
  );
}

function planFor(root, body, overrides = {}) {
  const digest = sha256Hex(body);
  return {
    url: 'https://example.test/ytmc-win.zip',
    destination: path.join(root, 'package.zip'),
    expectedSize: body.length,
    expectedDigestHex: digest,
    signatureBase64: signDigest(digest, keyPem),
    ...overrides,
  };
}

test('downloads a complete response and verifies digest and signature', { skip }, () =>
  withRoot(async root => {
    const body = Buffer.from('complete payload');
    const calls = [];
    const openStream = async (url, options) => {
      calls.push({ url, options });
      return fakeResponse(200, { etag: '"one"' }, [body]);
    };
    const outcome = await downloadUpdate({ openStream, plan: planFor(root, body) });
    assert.deepEqual(outcome, { status: 'ok', bytes: body.length, etag: '"one"' });
    assert.equal(fs.readFileSync(path.join(root, 'package.zip'), 'utf8'), 'complete payload');
    assert.equal(fs.existsSync(path.join(root, 'package.zip.part')), false);
    assert.equal(calls[0].options.headers.Range, undefined);
  })
);

test('resumes a partial file with a range request', { skip }, () =>
  withRoot(async root => {
    const body = Buffer.from('resumable payload content');
    fs.writeFileSync(path.join(root, 'package.zip.part'), body.subarray(0, 10));
    let rangeHeader = null;
    const openStream = async (url, options) => {
      rangeHeader = options.headers.Range;
      return fakeResponse(206, { 'content-range': `bytes 10-${body.length - 1}/${body.length}` }, [
        body.subarray(10),
      ]);
    };
    const outcome = await downloadUpdate({ openStream, plan: planFor(root, body) });
    assert.equal(outcome.status, 'ok');
    assert.equal(rangeHeader, 'bytes=10-');
    assert.equal(fs.readFileSync(path.join(root, 'package.zip'), 'utf8'), body.toString());
  })
);

test('restarts when a server ignores the range', { skip }, () =>
  withRoot(async root => {
    const body = Buffer.from('restart payload');
    fs.writeFileSync(path.join(root, 'package.zip.part'), body.subarray(0, 4));
    const openStream = async () => fakeResponse(200, {}, [body]);
    const outcome = await downloadUpdate({ openStream, plan: planFor(root, body) });
    assert.equal(outcome.status, 'ok');
    assert.equal(fs.readFileSync(path.join(root, 'package.zip'), 'utf8'), body.toString());
  })
);

test('restarts after a 416 response', { skip }, () =>
  withRoot(async root => {
    const body = Buffer.from('range gone');
    fs.writeFileSync(path.join(root, 'package.zip.part'), Buffer.from('stale'));
    let attempt = 0;
    const openStream = async () => {
      attempt += 1;
      return attempt === 1 ? fakeResponse(416, {}, []) : fakeResponse(200, {}, [body]);
    };
    const outcome = await downloadUpdate({ openStream, plan: planFor(root, body) });
    assert.equal(outcome.status, 'ok');
    assert.equal(attempt, 2);
  })
);

test('reports a stale signed url', async () =>
  withRoot(async root => {
    const body = Buffer.from('payload');
    const openStream = async () => fakeResponse(401, {}, []);
    const outcome = await downloadUpdate({ openStream, plan: planFor(root, body) });
    assert.deepEqual(outcome, { status: 'stale-url', bytes: 0 });
  }));

test('rejects a digest mismatch and removes the partial file', { skip }, () =>
  withRoot(async root => {
    const body = Buffer.from('payload');
    const plan = planFor(root, body, { expectedDigestHex: 'b'.repeat(64) });
    const openStream = async () => fakeResponse(200, {}, [body]);
    const outcome = await downloadUpdate({ openStream, plan });
    assert.deepEqual(outcome, { status: 'failed', reason: 'digest-mismatch', bytes: 0 });
    assert.equal(fs.existsSync(path.join(root, 'package.zip.part')), false);
  })
);

test('rejects a signature that does not match the pinned key', { skip }, () =>
  withRoot(async root => {
    const body = Buffer.from('payload');
    const digest = sha256Hex(body);
    const { privateKey } = generateKeyPairSync('ed25519');
    const foreign = sign(null, Buffer.from(digest, 'hex'), privateKey).toString('base64');
    const plan = planFor(root, body, { signatureBase64: foreign });
    const openStream = async () => fakeResponse(200, {}, [body]);
    const outcome = await downloadUpdate({ openStream, plan });
    assert.deepEqual(outcome, {
      status: 'failed',
      reason: 'signature-signature-mismatch',
      bytes: 0,
    });
  })
);

test('rejects a short body', { skip }, () =>
  withRoot(async root => {
    const body = Buffer.from('full payload');
    const plan = planFor(root, body, { expectedSize: body.length + 5 });
    const openStream = async () => fakeResponse(200, {}, [body]);
    const outcome = await downloadUpdate({ openStream, plan });
    assert.deepEqual(outcome, { status: 'failed', reason: 'size-mismatch', bytes: 0 });
  })
);

test('rejects an oversized body', { skip }, () =>
  withRoot(async root => {
    const body = Buffer.from('full payload');
    const plan = planFor(root, body, { expectedSize: body.length - 2 });
    const openStream = async () => fakeResponse(200, {}, [body]);
    const outcome = await downloadUpdate({ openStream, plan });
    assert.deepEqual(outcome, { status: 'failed', reason: 'size-mismatch', bytes: 0 });
  })
);

test('maps http and network failures', async () =>
  withRoot(async root => {
    const body = Buffer.from('payload');
    const plan = planFor(root, body);
    assert.deepEqual(
      await downloadUpdate({ openStream: async () => fakeResponse(500, {}, []), plan }),
      { status: 'failed', reason: 'http-500', bytes: 0 }
    );
    assert.deepEqual(
      await downloadUpdate({
        openStream: async () => {
          throw new Error('offline');
        },
        plan,
      }),
      { status: 'failed', reason: 'network', bytes: 0 }
    );
  }));

test('honors a pre-aborted signal', async () =>
  withRoot(async root => {
    const body = Buffer.from('payload');
    const controller = new AbortController();
    controller.abort();
    const outcome = await downloadUpdate({
      openStream: async () => fakeResponse(200, {}, [body]),
      plan: planFor(root, body),
      signal: controller.signal,
    });
    assert.deepEqual(outcome, { status: 'aborted', bytes: 0 });
  }));

test('rejects an invalid expected size', async () =>
  withRoot(async root => {
    const body = Buffer.from('payload');
    const outcome = await downloadUpdate({
      openStream: async () => fakeResponse(200, {}, [body]),
      plan: planFor(root, body, { expectedSize: 0 }),
    });
    assert.deepEqual(outcome, { status: 'failed', reason: 'size-invalid', bytes: 0 });
  }));
