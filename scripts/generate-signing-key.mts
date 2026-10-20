import { createHash, generateKeyPairSync } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const target = process.argv[2] ?? path.join(os.homedir(), '.ytmc-release-signing.key');

if (fs.existsSync(target)) {
  console.error(`Refusing to overwrite the existing signing key at ${target}`);
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

fs.writeFileSync(target, privatePem, 'utf8');
fs.chmodSync(target, 0o600);

const fingerprint = createHash('sha256').update(publicPem).digest('hex');

console.log(`Private key: ${target}`);
console.log(`Fingerprint: ${fingerprint}`);
console.log('');
console.log(publicPem);
