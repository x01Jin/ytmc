import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { FFMPEG_PATH } from '../server/config.js';
import { readAudioMetadata } from '../server/services/audioMetadata.js';
import { writeAudioTags } from '../server/services/audioWrite.js';

const ff = (args: string[]) => execFileSync(FFMPEG_PATH, args, { stdio: 'pipe' });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tag-roundtrip-'));
ff([
  '-y',
  '-f',
  'lavfi',
  '-i',
  'color=c=red:s=320x320:d=1',
  '-frames:v',
  '1',
  path.join(dir, 'a.jpg'),
]);
ff([
  '-y',
  '-f',
  'lavfi',
  '-i',
  'color=c=blue:s=320x320:d=1',
  '-frames:v',
  '1',
  path.join(dir, 'b.png'),
]);
const dataUrl = (f: string, mime: string) =>
  `data:${mime};base64,${fs.readFileSync(path.join(dir, f)).toString('base64')}`;

const codecs: Record<string, string[]> = {
  mp3: ['-c:a', 'libmp3lame'],
  m4a: ['-c:a', 'aac'],
  flac: ['-c:a', 'flac'],
  opus: ['-c:a', 'libopus'],
};

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ` ${JSON.stringify(detail)}`}`);
  if (!cond) failures++;
};

for (const [ext, codec] of Object.entries(codecs)) {
  const file = path.join(dir, `t.${ext}`);
  ff(['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', ...codec, file]);
  await writeAudioTags(file, {
    title: 'T',
    artist: 'A',
    coverData: dataUrl('a.jpg', 'image/jpeg'),
  } as never);
  const s0 = await readAudioMetadata(file);
  check(`${ext} seed cover`, !!s0.cover);
  check(`${ext} no albumArtist fallback`, (s0.tags.albumArtist ?? '') === '', s0.tags);

  const r1 = await writeAudioTags(file, { title: 'T2' } as never);
  const s1 = await readAudioMetadata(file);
  check(`${ext} sparse title update`, s1.tags.title === 'T2', s1.tags);
  check(`${ext} sparse keeps artist`, s1.tags.artist === 'A', s1.tags);
  check(`${ext} sparse keeps cover`, !!s1.cover && !r1.coverDropped, r1);

  await writeAudioTags(file, { genre: 'Rock' } as never);
  await writeAudioTags(file, { genre: '' } as never);
  const s2 = await readAudioMetadata(file);
  check(`${ext} explicit clear`, (s2.tags.genre ?? '') === '', s2.tags);

  const r3 = await writeAudioTags(file, { coverData: dataUrl('b.png', 'image/png') } as never);
  const s3 = await readAudioMetadata(file);
  check(`${ext} cover replace`, !!s3.cover && !r3.coverDropped, r3);

  const r4 = await writeAudioTags(file, { coverUrl: 'blob:http://localhost/fake' } as never);
  const s4 = await readAudioMetadata(file);
  check(`${ext} stale url keeps cover`, !!s4.cover && !r4.coverDropped, r4);

  await writeAudioTags(file, { removeCover: true } as never);
  const s5 = await readAudioMetadata(file);
  check(`${ext} cover remove`, !s5.cover, { cover: !!s5.cover });

  const r6 = await writeAudioTags(file, { title: 'T3' } as never);
  check(`${ext} result tags`, r6.tags.title === 'T3', r6.tags);
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
