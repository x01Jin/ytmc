import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildZip } from './zip-fixture.mjs';

const require = createRequire(import.meta.url);
let electronBinary = null;
try {
  electronBinary = require('electron');
} catch {}

const keyPath = path.join(os.homedir(), '.ytmc-release-signing.key');
const keyPem = fs.existsSync(keyPath) ? fs.readFileSync(keyPath, 'utf8') : null;
const skip = !keyPem
  ? 'local signing key is missing'
  : !electronBinary
    ? 'electron binary is missing'
    : false;

const { hashFileHex, signDigest } = await import('../../dist-electron/updater/signature.cjs');

const EXE = 'YT Music Converter.exe';
const UPDATE_ID = '1.2.1-electron';

test('applies an archive containing resources/app.asar under Electron', { skip }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ytmc-electron-'));
  try {
    const install = path.join(root, 'app');
    fs.mkdirSync(path.join(install, 'resources', 'bin'), { recursive: true });
    fs.mkdirSync(path.join(install, 'data'), { recursive: true });
    fs.writeFileSync(path.join(install, EXE), 'old-exe');
    fs.writeFileSync(path.join(install, 'resources', 'app.asar'), 'old-asar');
    fs.writeFileSync(path.join(install, 'resources', 'server.cjs'), 'old-server');
    fs.writeFileSync(path.join(install, 'resources', 'bin', 'ffmpeg.exe'), 'old-ffmpeg');
    fs.writeFileSync(path.join(install, 'resources', 'bin', 'yt-dlp.exe'), 'old-ytdlp');
    fs.writeFileSync(path.join(install, 'data', 'settings.json'), '{"keep":true}');

    const archive = path.join(root, 'archive.zip');
    fs.writeFileSync(
      archive,
      buildZip([
        { name: EXE, data: 'new-exe' },
        { name: 'resources/app.asar', data: 'new-asar' },
        { name: 'resources/server.cjs', data: 'new-server' },
        { name: 'resources/bin/ffmpeg.exe', data: 'new-ffmpeg' },
        { name: 'resources/bin/yt-dlp.exe', data: 'new-ytdlp' },
      ])
    );

    const workspace = path.join(root, 'workspace');
    fs.mkdirSync(workspace);
    const resultPath = path.join(root, 'result.json');
    const digestHex = await hashFileHex(archive);
    const child = spawnSync(
      electronBinary,
      [path.join(import.meta.dirname, 'electron-apply-child.mjs')],
      {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
          YTMC_WORKSPACE: workspace,
          YTMC_INSTALL: install,
          YTMC_ARCHIVE: archive,
          YTMC_DIGEST: digestHex,
          YTMC_SIGNATURE: signDigest(digestHex, keyPem),
          YTMC_UPDATE_ID: UPDATE_ID,
          YTMC_EXE: EXE,
          YTMC_RESULT: resultPath,
        },
        encoding: 'utf8',
        timeout: 180_000,
      }
    );

    assert.equal(child.status, 0, child.stderr || child.stdout);
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    assert.deepEqual(result, { outcome: 'applied', pid: 999999 });
    assert.equal(fs.readFileSync(path.join(install, EXE), 'utf8'), 'new-exe');
    assert.equal(fs.readFileSync(path.join(install, 'resources', 'app.asar'), 'utf8'), 'new-asar');
    assert.equal(
      fs.readFileSync(path.join(install, 'data', 'settings.json'), 'utf8'),
      '{"keep":true}'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
