import fs from 'fs';
import os from 'os';
import path from 'path';
import { hashFileHex, signDigest, verifyDigestSignature } from '../electron/updater/signature.cts';

const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
  version: string;
};

const archivePath = path.resolve(
  process.argv[2] ?? path.join('release', `ytmc-${pkg.version}-win.zip`)
);
if (!fs.existsSync(archivePath)) {
  console.error(`Archive not found: ${archivePath}`);
  process.exit(1);
}

const keyPath =
  process.env.YTMC_SIGNING_KEY ?? path.join(os.homedir(), '.ytmc-release-signing.key');
if (!fs.existsSync(keyPath)) {
  console.error(`Signing key not found: ${keyPath}`);
  process.exit(1);
}

const digestHex = await hashFileHex(archivePath);
const signatureBase64 = signDigest(digestHex, fs.readFileSync(keyPath, 'utf8'));
const verification = verifyDigestSignature(digestHex, signatureBase64);
if (!verification.ok) {
  console.error(`Signature does not match the pinned key: ${verification.reason}`);
  process.exit(1);
}
const signaturePath = `${archivePath}.sig`;
fs.writeFileSync(signaturePath, `${signatureBase64}\n`, 'utf8');

console.log(`archive   ${archivePath}`);
console.log(`digest    sha256:${digestHex}`);
console.log(`signature ${signaturePath}`);
