import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildZip } from './zip-fixture.mjs';

const { runApply, parseHelperArgs, startDetachedPowerShell } =
  await import('../../dist-electron/updater/helper.cjs');
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

function fakeLaunch({ report = true, reportVersion = null, visible = true } = {}) {
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
            visible,
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

function spawnLocker(cwd) {
  return spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
    cwd,
    stdio: 'ignore',
  });
}

function waitForChild(child) {
  return new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once('exit', resolve);
  });
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
    swapRetryMs: 400,
    watchdog: false,
    launch: fakeLaunch(),
    ...overrides,
  };
}

test('applies the update, removes older trees, and keeps the current old tree', { skip }, () =>
  withRoot(async root => {
    const launch = fakeLaunch();
    const options = await baseOptions(root, { launch });
    const staleTree = path.join(root, 'app.old-1.1.0-deadbeef');
    fs.mkdirSync(staleTree);
    fs.writeFileSync(path.join(staleTree, EXE), 'stale-exe');
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
    assert.equal(fs.existsSync(staleTree), false);
    const journal = JSON.parse(
      fs.readFileSync(path.join(options.workspace, 'journal.json'), 'utf8')
    );
    assert.equal(journal.phase, 'boot-ok');
    assert.equal(fs.existsSync(path.join(options.workspace, 'apply.lock')), false);
    assert.equal(launch.calls.length, 1);
    assert.ok(launch.calls[0].args.includes('--ytmc-update-version=2.0.0'));
    assert.equal(launch.calls[0].cwd, path.dirname(options.installDir));
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
    assert.equal(launch.calls[1].cwd, path.dirname(options.installDir));
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

test('rolls back when the boot report has no visible window', { skip }, () =>
  withRoot(async root => {
    const launch = fakeLaunch({ report: true, visible: false });
    const options = await baseOptions(root, { launch });
    const outcome = await runApply(options);
    assert.deepEqual(outcome, { outcome: 'rolled-back', reason: 'boot-window-hidden' });
    assert.equal(fs.readFileSync(path.join(root, 'app', EXE), 'utf8'), 'old-exe');
  })
);

test('restores the previous tree when the helper throws', { skip }, () =>
  withRoot(async root => {
    const options = await baseOptions(root, {
      archivePath: path.join(root, 'missing.zip'),
    });
    const outcome = await runApply(options);
    assert.deepEqual(outcome, { outcome: 'aborted', reason: 'helper-crashed' });
    assert.equal(fs.readFileSync(path.join(root, 'app', EXE), 'utf8'), 'old-exe');
    const journal = JSON.parse(
      fs.readFileSync(path.join(options.workspace, 'journal.json'), 'utf8')
    );
    assert.equal(journal.reason, 'helper-crashed');
    assert.equal(journal.restored, true);
    assert.equal(fs.existsSync(path.join(options.workspace, 'apply.lock')), false);
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

test('relaunches the old build when the apply aborts', { skip }, () =>
  withRoot(async root => {
    const launch = fakeLaunch();
    const options = await baseOptions(root, { launch, digestHex: 'c'.repeat(64) });
    const outcome = await runApply(options);
    assert.deepEqual(outcome, { outcome: 'aborted', reason: 'archive-digest-mismatch' });
    assert.equal(launch.calls.length, 1);
    assert.equal(launch.calls[0].executable, path.join(root, 'app', EXE));
    assert.deepEqual(launch.calls[0].args, []);
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

test('does not relaunch while the app is still running on a pre-swap failure', { skip }, () =>
  withRoot(async root => {
    const launch = fakeLaunch();
    const options = await baseOptions(root, {
      launch,
      appPid: process.pid,
      digestHex: 'c'.repeat(64),
    });
    const outcome = await runApply(options);
    assert.deepEqual(outcome, { outcome: 'aborted', reason: 'archive-digest-mismatch' });
    assert.equal(launch.calls.length, 0);
    assert.equal(fs.readFileSync(path.join(root, 'app', EXE), 'utf8'), 'old-exe');
  })
);

test('reports the swap error and succeeds after the locking process exits', { skip }, () =>
  withRoot(async root => {
    const options = await baseOptions(root, { swapRetryMs: 400 });
    const locker = spawnLocker(options.installDir);
    try {
      const first = await runApply(options);
      assert.deepEqual(first, { outcome: 'aborted', reason: 'swap-failed' });
      const journal = JSON.parse(
        fs.readFileSync(path.join(options.workspace, 'journal.json'), 'utf8')
      );
      assert.equal(journal.phase, 'failed');
      assert.equal(journal.reason, 'swap-failed');
      assert.equal(journal.restored, true);
      assert.ok(journal.detail);
      assert.equal(fs.readFileSync(path.join(root, 'app', EXE), 'utf8'), 'old-exe');
      assert.equal(fs.existsSync(path.join(root, `app.new-${UPDATE_ID}`)), false);
      locker.kill('SIGKILL');
      await waitForChild(locker);
      const second = await runApply(options);
      assert.deepEqual(second, { outcome: 'applied', pid: FAKE_PID });
      assert.equal(fs.readFileSync(path.join(root, 'app', EXE), 'utf8'), 'new-exe');
    } finally {
      if (locker.exitCode === null && locker.signalCode === null) {
        locker.kill('SIGKILL');
        await waitForChild(locker);
      }
    }
  })
);

test('cancels before the swap when a conversion becomes active', { skip }, () =>
  withRoot(async root => {
    const app = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
      stdio: 'ignore',
    });
    try {
      const launch = fakeLaunch();
      const options = await baseOptions(root, {
        launch,
        appPid: app.pid,
        appExitTimeoutMs: 5000,
      });
      const journalPath = path.join(options.workspace, 'journal.json');
      const cancelPath = path.join(options.workspace, 'apply.cancel');
      const watcher = setInterval(() => {
        try {
          const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
          if (journal.phase === 'pre-swap') {
            fs.writeFileSync(cancelPath, JSON.stringify({ reason: 'conversion-active' }));
          }
        } catch {}
      }, 10);
      const outcome = await runApply(options);
      clearInterval(watcher);
      assert.deepEqual(outcome, { outcome: 'aborted', reason: 'conversion-active' });
      assert.equal(launch.calls.length, 0);
      assert.equal(fs.readFileSync(path.join(root, 'app', EXE), 'utf8'), 'old-exe');
      assert.equal(fs.existsSync(path.join(root, `app.new-${UPDATE_ID}`)), false);
      assert.equal(fs.existsSync(path.join(options.workspace, 'apply.cancel')), false);
    } finally {
      app.kill('SIGKILL');
      await waitForChild(app);
    }
  })
);

test('skips Chromium caches while keeping app data', { skip }, () =>
  withRoot(async root => {
    const options = await baseOptions(root);
    for (const dir of ['Cache', 'Code Cache', 'GPUCache']) {
      fs.mkdirSync(path.join(options.installDir, 'data', dir), { recursive: true });
      fs.writeFileSync(path.join(options.installDir, 'data', dir, 'cached.bin'), 'cache');
    }
    fs.writeFileSync(path.join(options.installDir, 'data', 'library.json'), '{"keep":true}');
    const outcome = await runApply(options);
    assert.deepEqual(outcome, { outcome: 'applied', pid: FAKE_PID });
    const data = path.join(root, 'app', 'data');
    assert.equal(fs.readFileSync(path.join(data, 'settings.json'), 'utf8'), '{"keep":true}');
    assert.equal(fs.readFileSync(path.join(data, 'library.json'), 'utf8'), '{"keep":true}');
    for (const dir of ['Cache', 'Code Cache', 'GPUCache']) {
      assert.equal(fs.existsSync(path.join(data, dir)), false);
    }
  })
);

test('writes every install phase to the journal log', { skip }, () =>
  withRoot(async root => {
    const lines = [];
    const options = await baseOptions(root, { log: line => lines.push(line) });
    const outcome = await runApply(options);
    assert.deepEqual(outcome, { outcome: 'applied', pid: FAKE_PID });
    for (const phase of [
      'verifying',
      'extracting',
      'validating',
      'pre-swap',
      'copying',
      'installing',
      'launched',
      'boot-ok',
    ]) {
      assert.ok(lines.includes(`phase ${phase}`), phase);
    }
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

test(
  'starts a detached powershell process through WMI',
  { skip: process.platform !== 'win32' ? 'windows only' : false },
  () => {
    const quote = value => `"${value.replace(/"/g, '""')}"`;
    const commandLine = [
      'powershell.exe',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Start-Sleep -Seconds 30',
    ]
      .map(quote)
      .join(' ');
    const pid = startDetachedPowerShell(commandLine);
    try {
      assert.ok(pid > 0);
      assert.doesNotThrow(() => process.kill(pid, 0));
    } finally {
      try {
        execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
      } catch {}
    }
  }
);
