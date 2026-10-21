import { createHash, createPublicKey, sign, verify } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { RELEASE_PUBLIC_KEY_PEM } from './signing-key.cjs';

export type SignatureCheck = { ok: true } | { ok: false; reason: string };

const DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const SIGNATURE_PATTERN = /^[A-Za-z0-9+/]{86}==$/;

export function verifyDigestSignature(digestHex: string, signatureBase64: string): SignatureCheck {
  if (!DIGEST_PATTERN.test(digestHex)) return { ok: false, reason: 'digest-malformed' };
  if (!SIGNATURE_PATTERN.test(signatureBase64)) return { ok: false, reason: 'signature-malformed' };
  let key;
  try {
    key = createPublicKey(RELEASE_PUBLIC_KEY_PEM);
  } catch {
    return { ok: false, reason: 'key-unreadable' };
  }
  const valid = verify(
    null,
    Buffer.from(digestHex, 'hex'),
    key,
    Buffer.from(signatureBase64, 'base64')
  );
  return valid ? { ok: true } : { ok: false, reason: 'signature-mismatch' };
}

export function signDigest(digestHex: string, privateKeyPem: string): string {
  if (!DIGEST_PATTERN.test(digestHex)) throw new Error('Digest must be 32 bytes of hex.');
  return sign(null, Buffer.from(digestHex, 'hex'), privateKeyPem).toString('base64');
}

export function hashFileHex(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}
