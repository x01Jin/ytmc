import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

const VERSION = '2026.08.19';
const SHA256 = '66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a';
const DOWNLOAD_URL = `https://github.com/yt-dlp/yt-dlp/releases/download/${VERSION}/yt-dlp.exe`;

const destination = path.resolve('bin', 'yt-dlp.exe');
const temporary = `${destination}.part`;

function sha256(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

try {
  fs.mkdirSync(path.dirname(destination), { recursive: true });

  if (fs.existsSync(destination) && sha256(destination) === SHA256) {
    console.log(`yt-dlp.exe ${VERSION} already present`);
    process.exit(0);
  }

  console.log(`Fetching yt-dlp.exe ${VERSION}`);
  const response = await fetch(DOWNLOAD_URL, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} from ${DOWNLOAD_URL}`);
  }

  fs.writeFileSync(temporary, Buffer.from(await response.arrayBuffer()));
  const actual = sha256(temporary);
  if (actual !== SHA256) {
    throw new Error(`Hash mismatch for ${DOWNLOAD_URL}: expected ${SHA256}, received ${actual}`);
  }

  fs.renameSync(temporary, destination);
  console.log(`yt-dlp.exe ${VERSION} ready (${fs.statSync(destination).size} bytes)`);
} catch (err: unknown) {
  fs.rmSync(temporary, { force: true });
  console.error(`Failed to prepare yt-dlp.exe: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
