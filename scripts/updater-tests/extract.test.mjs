import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildZip } from './zip-fixture.mjs';

const { extractArchive, archiveUncompressedBytes } =
  await import('../../dist-electron/updater/extract.cjs');

function withRoot(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ytmc-extract-'));
  return Promise.resolve(run(root)).finally(() =>
    fs.rmSync(root, { recursive: true, force: true })
  );
}

async function runCase(entries) {
  return withRoot(async root => {
    const archive = path.join(root, 'fixture.zip');
    fs.writeFileSync(archive, buildZip(entries));
    return extractArchive(archive, path.join(root, 'out'));
  });
}

test('extracts a nested tree and reports bytes', () =>
  withRoot(async root => {
    const archive = path.join(root, 'tree.zip');
    fs.writeFileSync(
      archive,
      buildZip([
        { name: 'dir/', data: '' },
        { name: 'dir/a.txt', data: 'hello' },
        { name: 'b.bin', data: Buffer.from([1, 2, 3, 4]) },
      ])
    );
    const outcome = await extractArchive(archive, path.join(root, 'out'));
    assert.deepEqual(outcome, { ok: true, entries: 3, bytes: 9 });
    assert.equal(fs.readFileSync(path.join(root, 'out', 'dir', 'a.txt'), 'utf8'), 'hello');
    assert.deepEqual(fs.readFileSync(path.join(root, 'out', 'b.bin')), Buffer.from([1, 2, 3, 4]));
    assert.equal(await archiveUncompressedBytes(archive), 9);
  }));

test('rejects traversal, absolute, and backslash entry names', async () => {
  for (const name of ['../evil.txt', '/evil.txt', 'dir\\a.txt', 'C:/evil.txt']) {
    assert.deepEqual(
      await runCase([{ name, data: 'x' }]),
      { ok: false, reason: 'unsafe-entry' },
      name
    );
  }
});

test('rejects reserved, alternate-stream, and trailing-dot names', async () => {
  for (const name of ['con.txt', 'a.txt:stream', 'a. ']) {
    assert.deepEqual(
      await runCase([{ name, data: 'x' }]),
      { ok: false, reason: 'unsafe-entry' },
      name
    );
  }
});

test('rejects duplicate normalized names', async () => {
  assert.deepEqual(
    await runCase([
      { name: 'a.txt', data: '1' },
      { name: 'A.TXT', data: '2' },
    ]),
    { ok: false, reason: 'duplicate-entry' }
  );
});

test('rejects symlink entries', async () => {
  assert.deepEqual(await runCase([{ name: 'link', data: 'target', mode: 0o120777 }]), {
    ok: false,
    reason: 'symlink-entry',
  });
});

test('rejects a CRC mismatch', async () => {
  assert.deepEqual(await runCase([{ name: 'a.txt', data: 'hello', crc: 1 }]), {
    ok: false,
    reason: 'entry-crc-mismatch',
  });
});

test('reports an unreadable archive', async () => {
  return withRoot(async root => {
    const archive = path.join(root, 'broken.zip');
    fs.writeFileSync(archive, Buffer.from('not a zip'));
    assert.deepEqual(await extractArchive(archive, path.join(root, 'out')), {
      ok: false,
      reason: 'open-failed',
    });
    assert.equal(await archiveUncompressedBytes(archive), null);
  });
});

test('reports the entry and code when a write fails', () =>
  withRoot(async root => {
    const archive = path.join(root, 'write.zip');
    fs.writeFileSync(archive, buildZip([{ name: 'blocked.txt', data: 'hello' }]));
    const out = path.join(root, 'out');
    fs.mkdirSync(path.join(out, 'blocked.txt'), { recursive: true });
    const outcome = await extractArchive(archive, out);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.reason, 'entry-write-failed');
    assert.match(outcome.detail, /^blocked\.txt: /);
  }));
