import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildZip } from './zip-fixture.mjs';

const { runApply, parseHelperArgs } = await import('../../dist-electron/updater/helper.cjs');
const { hashFileHex, signDigest } = await import('../../dist-electron/updater/signature.cjs');

const keyPath = path.join(os.homedir(), '.ytmc-release-signing.key');
const keyPem = fs.existsSync(keyPath) ? fs.readFileSync(keyPath, 'utf8') : null;
const skip = keyPem ? false : 'local signing key is missing';

const FAKE_PID = 999999;
const EXE = 'YT Music Converter.exe';
const UPDATE_ID = '2.0.0-abcdef12';

function withRoot(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ytmc-helper-'));
  return Promise.resolve(run(root)).finally(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });
}

function makeInstall(root) {
  const install = path.join(root, 'app');
  fs.mkdirSync(path.join(install, 'resources', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(install, 'data'), { recursive: true });
  fs.writeFileSync(path.join(install, EXE), 'old-exe');
  fs.writeFileSync(path.join(install, 'resources', 'app.asar'), 'old-asar');
  fs.writeFileSync(path.join(install, 'resources', 'server.cjs'), 'old-server');
  fs.writeFileSync(path.join(install, 'resources', 'bin', 'ffmpeg.exe'), 'old-ffmpeg');
  fs.writeFileSync(path.join(install, 'resources', 'bin', 'yt-dlp.exe'), 'old-ytdlp');
  fs.writeFileSync(path.join(install, 'data', 'settings.json'), '{"keep":true}');
  return install;
}

function makeArchive(root, includeFfmpeg = true, includeYtDlp = true) {
  const entries = [
    { name: EXE, data: 'new-exe' },
    { name: 'resources/app.asar', data: 'new-asar' },
    { name: 'resources/server.cjs', data: 'new-server' },
  ];
  if (includeFfmpeg) entries.push({ name: 'resources/bin/ffmpeg.exe', data: 'new-ffmpeg' });
  if (includeYtDlp) entries.push({ name: 'resources/bin/yt-dlp.exe', data: 'new-ytdlp' });
  const archive = path.join(root, 'archive.zip');
  fs.writeFileSync(archive, buildZip(entries));
  return archive;
}

function fakeLaunch({ report = true, reportVersion = null } = {}) {
  const calls = [];
  return {
    calls,
    launch(executable, args, cwd) {
      calls.push({ executable, args, cwd });
      if (report) {
        const value = prefix => args.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
        const reportPath = value('--ytmc-update-report=');
        if (reportPath) {
          const payload = {
            schema: 1,
            updateId: value('--ytmc-update-id='),
            version: reportVersion ?? value('--ytmc-update-version='),
            nonce: value('--ytmc-update-nonce='),
            at: Date.now(),
          };
          setTimeout(() => {
            fs.mkdirSync(path.dirname(reportPath), { recursive: true });
            fs.writeFileSync(reportPath, JSON.stringify(payload));
          }, 20);
        }
      }
      return FAKE_PID;
    },
    isAlive() {
      return true;
    },
  };
}

async function baseOptions(root, overrides = {}) {
  const install = makeInstall(root);
  const archive = makeArchive(
    root,
    overrides.includeFfmpeg !== false,
    overrides.includeYtDlp !== false
  );
  const digestHex = await hashFileHex(archive);
  return {
    workspace: path.join(root, 'workspace'),
    installDir: install,
    archivePath: archive,
    digestHex,
    signatureBase64: signDigest(digestHex, keyPem),
    updateId: UPDATE_ID,
    fromVersion: '1.2.0',
    toVersion: '2.0.0',
    exeName: EXE,
    appPid: FAKE_PID,
    backendPid: 0,
    nonce: 'nonce-1',
    bootTimeoutMs: 5000,
    livenessMs: 0,
    launch: fakeLaunch(),
    ...overrides,
  };
}

test('applies the update, copies data, and keeps the old tree', { skip }, () =>
  withRoot(async root => {
    const launch = fakeLaunch();
    const options = await baseOptions(root, { launch });
    const outcome = await runApply(options);
    assert.deepEqual(outcome, { outcome: 'applied', pid: FAKE_PID });
    assert.equal(fs.readFileSync(path.join(root, 'app', EXE), 'utf8'), 'new-exe');
    assert.equal(
      fs.readFileSync(path.join(root, 'app', 'resources', 'bin', 'ffmpeg.exe'), 'utf8'),
      'new-ffmpeg'
    );
    assert.equal(
      fs.readFileSync(path.join(root, 'app', 'resources', 'bin', 'yt-dlp.exe'), 'utf8'),
      'new-ytdlp'
    );
    assert.equal(
      fs.readFileSync(path.join(root, 'app', 'data', 'settings.json'), 'utf8'),
      '{"keep":true}'
    );
    assert.equal(fs.readFileSync(path.join(root, `app.old-${UPDATE_ID}`, EXE), 'utf8'), 'old-exe');
    const journal = JSON.parse(
      fs.readFileSync(path.join(options.workspace, 'journal.json'), 'utf8')
    );
    assert.equal(journal.phase, 'boot-ok');
    assert.equal(fs.existsSync(path.join(options.workspace, 'apply.lock')), false);
    assert.equal(launch.calls.length, 1);
    assert.ok(launch.calls[0].args.includes('--ytmc-update-version=2.0.0'));
  })
);

test('rolls back and relaunches the old build when boot times out', { skip }, () =>
  withRoot(async root => {
    const launch = fakeLaunch({ report: false });
    const options = await baseOptions(root, { launch, bootTimeoutMs: 300 });
    const outcome = await runApply(options);
    assert.deepEqual(outcome, { outcome: 'rolled-back', reason: 'boot-timeout' });
    assert.equal(fs.readFileSync(path.join(root, 'app', EXE), 'utf8'), 'old-exe');
    assert.equal(
      fs.readFileSync(path.join(root, 'app', 'data', 'settings.json'), 'utf8'),
      '{"keep":true}'
    );
    assert.equal(
      fs.readFileSync(path.join(root, `app.failed-${UPDATE_ID}`, EXE), 'utf8'),
      'new-exe'
    );
    assert.equal(fs.existsSync(path.join(root, `app.old-${UPDATE_ID}`)), false);
    const journal = JSON.parse(
      fs.readFileSync(path.join(options.workspace, 'journal.json'), 'utf8')
    );
    assert.equal(journal.phase, 'rolled-back');
    assert.equal(journal.reason, 'boot-timeout');
    assert.equal(fs.existsSync(path.join(options.workspace, 'apply.lock')), false);
    assert.equal(launch.calls.length, 2);
    assert.deepEqual(launch.calls[1].args, []);
  })
);

test('rolls back when the boot report names a different version', { skip }, () =>
  withRoot(async root => {
    const launch = fakeLaunch({ report: true, reportVersion: '1.2.0' });
    const options = await baseOptions(root, { launch });
    const outcome = await runApply(options);
    assert.deepEqual(outcome, { outcome: 'rolled-back', reason: 'boot-version-mismatch' });
    assert.equal(fs.readFileSync(path.join(root, 'app', EXE), 'utf8'), 'old-exe');
  })
);

test('aborts before touching the install when the archive digest changed', { skip }, () =>
  withRoot(async root => {
    const options = await baseOptions(root, { digestHex: 'c'.repeat(64) });
    const outcome = await runApply(options);
    assert.deepEqual(outcome, { outcome: 'aborted', reason: 'archive-digest-mismatch' });
    assert.equal(fs.readFileSync(path.join(root, 'app', EXE), 'utf8'), 'old-exe');
    assert.equal(fs.existsSync(path.join(root, `app.new-${UPDATE_ID}`)), false);
  })
);

test('aborts when the extracted tree is missing ffmpeg', { skip }, () =>
  withRoot(async root => {
    const options = await baseOptions(root, { includeFfmpeg: false });
    const outcome = await runApply(options);
    assert.deepEqual(outcome, {
      outcome: 'aborted',
      reason: 'tree-invalid-resources/bin/ffmpeg.exe',
    });
    assert.equal(fs.readFileSync(path.join(root, 'app', EXE), 'utf8'), 'old-exe');
    assert.equal(fs.existsSync(path.join(root, `app.new-${UPDATE_ID}`)), false);
  })
);

test('aborts when the extracted tree is missing yt-dlp', { skip }, () =>
  withRoot(async root => {
    const options = await baseOptions(root, { includeYtDlp: false });
    const outcome = await runApply(options);
    assert.deepEqual(outcome, {
      outcome: 'aborted',
      reason: 'tree-invalid-resources/bin/yt-dlp.exe',
    });
    assert.equal(fs.readFileSync(path.join(root, 'app', EXE), 'utf8'), 'old-exe');
    assert.equal(fs.existsSync(path.join(root, `app.new-${UPDATE_ID}`)), false);
  })
);

test('parseHelperArgs reads every required flag', () => {
  const parsed = parseHelperArgs([
    '--install',
    'C:\\app',
    '--workspace',
    'C:\\ws',
    '--archive',
    'C:\\ws\\p.zip',
    '--digest',
    'a'.repeat(64),
    '--signature',
    `${'A'.repeat(86)}==`,
    '--update-id',
    UPDATE_ID,
    '--from',
    '1.2.0',
    '--to',
    '2.0.0',
    '--exe',
    EXE,
    '--nonce',
    'n',
    '--app-pid',
    '42',
    '--backend-pid',
    '43',
  ]);
  assert.equal(parsed.installDir, 'C:\\app');
  assert.equal(parsed.appPid, 42);
  assert.equal(parsed.backendPid, 43);
  assert.equal(parsed.bootTimeoutMs, undefined);
  assert.equal(parseHelperArgs(['--install', 'C:\\app']), null);
});
