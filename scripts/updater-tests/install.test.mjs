import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const {
  createHelperRuntime,
  helperDirFor,
  helperRuntimeBytes,
  removePathWithRetries,
  staleSiblingTrees,
  supportsHardlinks,
  updateMarkerPath,
  workspaceDirectories,
} = await import('../../dist-electron/updater/install.cjs');

const require = createRequire(import.meta.url);
let electronBinary = null;
try {
  electronBinary = require('electron');
} catch {}

function withRoot(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ytmc-install-'));
  return Promise.resolve(run(root)).finally(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });
}

function makeInstall(root) {
  const install = path.join(root, 'app');
  fs.mkdirSync(path.join(install, 'resources', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(install, 'data'), { recursive: true });
  fs.mkdirSync(path.join(install, 'locales'), { recursive: true });
  fs.copyFileSync(process.execPath, path.join(install, 'runtime.exe'));
  fs.writeFileSync(path.join(install, 'icudtl.dat'), 'runtime');
  fs.writeFileSync(path.join(install, 'locales', 'en-US.pak'), 'locale');
  fs.writeFileSync(path.join(install, 'resources', 'app.asar'), 'asar');
  fs.writeFileSync(path.join(install, 'resources', 'bin', 'ffmpeg.exe'), 'ffmpeg');
  fs.writeFileSync(path.join(install, 'data', 'settings.json'), '{"keep":true}');
  return install;
}

test('builds a helper runtime outside the install without data or resources', () =>
  withRoot(async root => {
    const install = makeInstall(root);
    const helperDir = helperDirFor(install, '2.0.0-abcdef12');
    assert.ok(supportsHardlinks(install));
    await createHelperRuntime(install, helperDir);
    assert.ok(fs.existsSync(path.join(helperDir, 'runtime.exe')));
    assert.ok(fs.existsSync(path.join(helperDir, 'locales', 'en-US.pak')));
    assert.equal(fs.existsSync(path.join(helperDir, 'data')), false);
    assert.equal(fs.existsSync(path.join(helperDir, 'resources')), false);
    assert.ok(helperRuntimeBytes(install) > 0);
  }));

test('the install folder can be renamed while the helper runtime is running', () =>
  withRoot(async root => {
    const install = makeInstall(root);
    const helperDir = helperDirFor(install, '2.0.0-abcdef12');
    await createHelperRuntime(install, helperDir);
    const child = spawn(
      path.join(helperDir, 'runtime.exe'),
      ['-e', 'setTimeout(() => {}, 60000)'],
      {
        cwd: root,
        stdio: 'ignore',
      }
    );
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      const oldDir = `${install}.old-2.0.0-abcdef12`;
      fs.renameSync(install, oldDir);
      assert.ok(fs.existsSync(oldDir));
    } finally {
      child.kill('SIGKILL');
      if (child.exitCode === null && child.signalCode === null) {
        await new Promise(resolve => child.once('exit', resolve));
      }
    }
  }));

test('an Electron helper hardlinked outside the install does not lock it', async t => {
  if (!electronBinary) {
    t.skip('electron binary is missing');
    return;
  }
  await withRoot(async root => {
    const install = path.join(root, 'app');
    const dist = path.dirname(electronBinary);
    fs.mkdirSync(install);
    for (const entry of fs.readdirSync(dist, { withFileTypes: true })) {
      if (entry.isFile()) fs.linkSync(path.join(dist, entry.name), path.join(install, entry.name));
    }
    fs.mkdirSync(path.join(install, 'locales'));
    for (const entry of fs.readdirSync(path.join(dist, 'locales'), { withFileTypes: true })) {
      if (entry.isFile()) {
        fs.linkSync(
          path.join(dist, 'locales', entry.name),
          path.join(install, 'locales', entry.name)
        );
      }
    }
    const helperDir = helperDirFor(install, '2.0.0-abcdef12');
    await createHelperRuntime(install, helperDir);
    const child = spawn(
      path.join(helperDir, path.basename(electronBinary)),
      ['-e', 'console.log("READY"); setTimeout(() => {}, 60000)'],
      {
        cwd: root,
        stdio: ['ignore', 'pipe', 'ignore'],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      }
    );
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('helper did not start')), 20_000);
        child.stdout.once('data', () => {
          clearTimeout(timer);
          resolve();
        });
        child.once('error', reject);
        child.once('exit', () => reject(new Error('helper exited before it was ready')));
      });
      const oldDir = `${install}.old-2.0.0-abcdef12`;
      fs.renameSync(install, oldDir);
      assert.ok(fs.existsSync(oldDir));
    } finally {
      child.kill('SIGKILL');
      if (child.exitCode === null && child.signalCode === null) {
        await new Promise(resolve => child.once('exit', resolve));
      }
    }
  });
});

test('stale siblings include helper directories and ignore user folders', () =>
  withRoot(root => {
    const install = path.join(root, 'app');
    fs.mkdirSync(install);
    fs.mkdirSync(path.join(root, 'app.helper-2.0.0-abcdef12'));
    fs.mkdirSync(path.join(root, 'app.new-2.0.0-abcdef12'));
    fs.mkdirSync(path.join(root, 'app.old-2.0.0-abcdef12'));
    fs.mkdirSync(path.join(root, 'app.old-photos'));
    const names = staleSiblingTrees(install)
      .map(dir => path.basename(dir))
      .sort();
    assert.deepEqual(names, [
      'app.helper-2.0.0-abcdef12',
      'app.new-2.0.0-abcdef12',
      'app.old-2.0.0-abcdef12',
    ]);
    assert.equal(path.dirname(updateMarkerPath(install)), root);
  }));

test('lists every updater workspace and removes files with retries', () =>
  withRoot(async root => {
    const localAppData = path.join(root, 'local');
    const updaterRoot = path.join(localAppData, 'YT Music Converter', 'updater');
    fs.mkdirSync(path.join(updaterRoot, 'one'), { recursive: true });
    fs.mkdirSync(path.join(updaterRoot, 'two'), { recursive: true });
    fs.writeFileSync(path.join(updaterRoot, 'loose.txt'), 'x');
    assert.deepEqual(
      workspaceDirectories(localAppData)
        .map(dir => path.basename(dir))
        .sort(),
      ['one', 'two']
    );
    const archive = path.join(updaterRoot, 'one', 'package.zip');
    fs.writeFileSync(archive, 'x');
    assert.equal(await removePathWithRetries(archive), true);
    assert.equal(fs.existsSync(archive), false);
  }));
