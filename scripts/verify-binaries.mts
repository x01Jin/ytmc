import fs from 'fs';
import path from 'path';

if (process.platform !== 'win32') {
  console.log('Binary verification skipped outside Windows.');
  process.exit(0);
}

const required = ['ffmpeg.exe', 'ffprobe.exe', 'yt-dlp.exe'];
const missing = required.filter(name => !fs.existsSync(path.join('bin', name)));

if (missing.length > 0) {
  console.error(`Missing required Windows binaries in bin/: ${missing.join(', ')}`);
  process.exit(1);
}

console.log(`Verified Windows binaries: ${required.join(', ')}`);
