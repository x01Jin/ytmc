import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const { WATCHDOG_SOURCE } = await import('../../dist-electron/updater/helper.cjs');

const skip = process.platform === 'win32' ? false : 'watchdog recovery is Windows-only';
const EXE = 'YT Music Converter.exe';

function withRoot(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ytmc-watchdog-'));
  return Promise.resolve(run(root)).finally(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });
}

function runRecovery(root, options) {
  const script = path.join(root, 'recover-update.ps1');
  fs.writeFileSync(script, WATCHDOG_SOURCE, 'utf8');
  const failed = path.join(root, 'app.failed-2.0.0-abcdef12');
  const bootOk = path.join(root, 'boot-ok.json');
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    script,
    '-Install',
    options.install,
    '-Old',
    options.old,
    '-New',
    options.new,
    '-HelperDir',
    options.helperDir,
    '-Exe',
    EXE,
    '-Marker',
    options.marker,
    '-Lock',
    options.lock,
    '-Log',
    options.log,
    '-Journal',
    options.journal,
    '-Failed',
    failed,
    '-BootOk',
    bootOk,
    '-BootWaitSeconds',
    String(options.bootWaitSeconds ?? 300),
    '-RecoverOnly',
  ];
  return spawnSync('powershell.exe', args, { encoding: 'utf8', windowsHide: true });
}

test('watchdog restores the previous tree when the install is missing', { skip }, () =>
  withRoot(root => {
    const install = path.join(root, 'app');
    const old = path.join(root, 'app.old-2.0.0-abcdef12');
    const next = path.join(root, 'app.new-2.0.0-abcdef12');
    const helperDir = path.join(root, 'app.helper-2.0.0-abcdef12');
    const marker = path.join(root, '.ytmc-updating-test.json');
    const lock = path.join(root, 'apply.lock');
    const log = path.join(root, 'updater.log');
    const journal = path.join(root, 'journal.json');
    fs.mkdirSync(old, { recursive: true });
    fs.writeFileSync(path.join(old, 'old-file'), 'old');
    fs.writeFileSync(path.join(old, EXE), 'old');
    fs.mkdirSync(helperDir, { recursive: true });
    fs.writeFileSync(marker, '{}');
    fs.writeFileSync(lock, '{}');
    fs.writeFileSync(journal, '{"phase":"installing"}');
    const result = runRecovery(root, {
      install,
      old,
      new: next,
      helperDir,
      marker,
      lock,
      log,
      journal,
    });
    assert.equal(result.status, 0);
    assert.equal(fs.readFileSync(path.join(install, 'old-file'), 'utf8'), 'old');
    assert.equal(fs.existsSync(old), false);
    assert.equal(fs.existsSync(helperDir), false);
    assert.equal(fs.existsSync(marker), false);
    assert.equal(fs.existsSync(lock), false);
  })
);

test('watchdog restores the old tree when the new build never confirms boot', { skip }, () =>
  withRoot(root => {
    const install = path.join(root, 'app');
    const old = path.join(root, 'app.old-2.0.0-abcdef12');
    const next = path.join(root, 'app.new-2.0.0-abcdef12');
    const helperDir = path.join(root, 'app.helper-2.0.0-abcdef12');
    const marker = path.join(root, '.ytmc-updating-test.json');
    const lock = path.join(root, 'apply.lock');
    const log = path.join(root, 'updater.log');
    const journal = path.join(root, 'journal.json');
    fs.mkdirSync(install, { recursive: true });
    fs.writeFileSync(path.join(install, EXE), 'new');
    fs.mkdirSync(old, { recursive: true });
    fs.writeFileSync(path.join(old, EXE), 'old');
    fs.writeFileSync(path.join(old, 'old-file'), 'old');
    fs.mkdirSync(helperDir, { recursive: true });
    fs.writeFileSync(marker, '{}');
    fs.writeFileSync(lock, '{}');
    fs.writeFileSync(journal, JSON.stringify({ phase: 'launched', updateId: '2.0.0-abcdef12' }));
    const result = runRecovery(root, {
      install,
      old,
      new: next,
      helperDir,
      marker,
      lock,
      log,
      journal,
      bootWaitSeconds: 0,
    });
    assert.equal(result.status, 0);
    assert.equal(fs.readFileSync(path.join(install, 'old-file'), 'utf8'), 'old');
    assert.equal(fs.existsSync(old), false);
    assert.equal(fs.existsSync(helperDir), false);
    assert.equal(fs.existsSync(marker), false);
  })
);

test('watchdog leaves recovery state alone while the helper is still alive', { skip }, () =>
  withRoot(root => {
    const install = path.join(root, 'app');
    const old = path.join(root, 'app.old-2.0.0-abcdef12');
    const next = path.join(root, 'app.new-2.0.0-abcdef12');
    const helperDir = path.join(root, 'app.helper-2.0.0-abcdef12');
    const marker = path.join(root, '.ytmc-updating-test.json');
    const lock = path.join(root, 'apply.lock');
    const log = path.join(root, 'updater.log');
    const journal = path.join(root, 'journal.json');
    fs.mkdirSync(install, { recursive: true });
    fs.writeFileSync(path.join(install, EXE), 'new');
    fs.mkdirSync(old, { recursive: true });
    fs.writeFileSync(path.join(old, EXE), 'old');
    fs.mkdirSync(helperDir, { recursive: true });
    fs.writeFileSync(marker, '{}');
    fs.writeFileSync(
      lock,
      JSON.stringify({ pid: process.pid, helperDir: path.dirname(process.execPath) })
    );
    fs.writeFileSync(journal, '{"phase":"pre-swap"}');
    const result = runRecovery(root, {
      install,
      old,
      new: next,
      helperDir,
      marker,
      lock,
      log,
      journal,
    });
    assert.equal(result.status, 0);
    assert.equal(fs.readFileSync(path.join(install, EXE), 'utf8'), 'new');
    assert.equal(fs.existsSync(helperDir), true);
    assert.equal(fs.existsSync(marker), true);
    assert.equal(fs.existsSync(lock), true);
  })
);

test('watchdog clears recovery files when the install is intact', { skip }, () =>
  withRoot(root => {
    const install = path.join(root, 'app');
    const old = path.join(root, 'app.old-2.0.0-abcdef12');
    const next = path.join(root, 'app.new-2.0.0-abcdef12');
    const helperDir = path.join(root, 'app.helper-2.0.0-abcdef12');
    const marker = path.join(root, '.ytmc-updating-test.json');
    const lock = path.join(root, 'apply.lock');
    const log = path.join(root, 'updater.log');
    const journal = path.join(root, 'journal.json');
    fs.mkdirSync(install, { recursive: true });
    fs.writeFileSync(path.join(install, EXE), 'old');
    fs.mkdirSync(helperDir, { recursive: true });
    fs.writeFileSync(marker, '{}');
    fs.writeFileSync(lock, '{}');
    fs.writeFileSync(journal, '{"phase":"boot-ok"}');
    const result = runRecovery(root, {
      install,
      old,
      new: next,
      helperDir,
      marker,
      lock,
      log,
      journal,
    });
    assert.equal(result.status, 0);
    assert.equal(fs.existsSync(path.join(install, EXE)), true);
    assert.equal(fs.existsSync(helperDir), false);
    assert.equal(fs.existsSync(marker), false);
    assert.equal(fs.existsSync(lock), false);
  })
);
