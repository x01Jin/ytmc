import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const { sha256Hex, signDigest, verifyDigestSignature } =
  await import('../../dist-electron/updater/signature.cjs');

const keyPath = path.join(os.homedir(), '.ytmc-release-signing.key');
const keyPem = fs.existsSync(keyPath) ? fs.readFileSync(keyPath, 'utf8') : null;
const skip = keyPem ? false : 'local signing key is missing';

test('sha256Hex matches the known vector', () => {
  assert.equal(
    sha256Hex(Buffer.from('abc')),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
});

test('verifyDigestSignature rejects a malformed digest', () => {
  assert.deepEqual(verifyDigestSignature('xyz', `${'A'.repeat(86)}==`), {
    ok: false,
    reason: 'digest-malformed',
  });
});

test('verifyDigestSignature rejects a malformed signature', () => {
  assert.deepEqual(verifyDigestSignature('0'.repeat(64), 'short'), {
    ok: false,
    reason: 'signature-malformed',
  });
});

test('verifyDigestSignature rejects a well-formed foreign signature', () => {
  assert.deepEqual(verifyDigestSignature('0'.repeat(64), `${'A'.repeat(86)}==`), {
    ok: false,
    reason: 'signature-mismatch',
  });
});

test('pinned key verifies a digest signed with the local private key', { skip }, () => {
  const digest = sha256Hex(Buffer.from('payload'));
  const signature = signDigest(digest, keyPem);
  assert.deepEqual(verifyDigestSignature(digest, signature), { ok: true });
});

test('pinned key rejects a signature over a different digest', { skip }, () => {
  const signature = signDigest(sha256Hex(Buffer.from('payload')), keyPem);
  assert.deepEqual(verifyDigestSignature(sha256Hex(Buffer.from('other')), signature), {
    ok: false,
    reason: 'signature-mismatch',
  });
});
