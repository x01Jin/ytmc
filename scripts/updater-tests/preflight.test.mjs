import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const { runPreflight } = await import('../../dist-electron/updater/preflight.cjs');

const localAppData = process.env.LOCALAPPDATA;

function withRoot(run) {
  const root = fs.mkdtempSync(path.join(localAppData, 'ytmc-preflight-'));
  try {
    return run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function input(installDir, overrides = {}) {
  return {
    isPackaged: true,
    installDir,
    userDataDir: path.join(installDir, 'data'),
    libraryDir: null,
    localAppDataDir: localAppData,
    helperBundlePath: path.join(installDir, 'helper.cjs'),
    currentVersion: '1.2.0',
    installBytesRequired: 1,
    workspaceBytesRequired: 1,
    ...overrides,
  };
}

test('blocks when the app is not packaged', () => {
  assert.equal(runPreflight(input('C:\\app', { isPackaged: false })).code, 'not-packaged');
});

test('blocks an unparsable running version', () =>
  withRoot(root => {
    assert.equal(runPreflight(input(root, { currentVersion: 'x' })).code, 'version-unparsable');
  }));

test('blocks a missing install folder', () =>
  withRoot(root => {
    assert.equal(runPreflight(input(path.join(root, 'missing'))).code, 'install-missing');
  }));

test('blocks a stale sibling copy', () =>
  withRoot(root => {
    for (const suffix of ['old', 'helper']) {
      const stale = path.join(root, `app.${suffix}-1.2.0-abcdef12`);
      fs.mkdirSync(stale);
      assert.equal(runPreflight(input(stale)).code, 'running-from-stale-copy');
    }
  }));

test('blocks a drive root install', () => {
  assert.equal(runPreflight(input(path.parse(localAppData).root)).code, 'drive-root');
});

test('blocks an install under a temp folder', () =>
  withRoot(() => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ytmc-preflight-temp-'));
    try {
      assert.equal(runPreflight(input(temp)).code, 'temp-path');
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  }));

test('blocks data that lives outside the install folder', () =>
  withRoot(root => {
    assert.equal(
      runPreflight(input(root, { userDataDir: path.join(root, 'other') })).code,
      'data-outside-install'
    );
  }));

test('blocks a library folder inside the install folder', () =>
  withRoot(root => {
    fs.writeFileSync(path.join(root, 'helper.cjs'), 'x');
    assert.equal(
      runPreflight(input(root, { libraryDir: path.join(root, 'music') })).code,
      'library-inside-install'
    );
  }));

test('blocks a missing helper bundle', () =>
  withRoot(root => {
    assert.equal(runPreflight(input(root)).code, 'helper-missing');
  }));

test('blocks an impossible install space requirement', () =>
  withRoot(root => {
    fs.writeFileSync(path.join(root, 'helper.cjs'), 'x');
    assert.equal(
      runPreflight(input(root, { installBytesRequired: Number.MAX_SAFE_INTEGER })).code,
      'insufficient-space'
    );
  }));

test('accepts a writable install with a helper and headroom', () =>
  withRoot(root => {
    fs.writeFileSync(path.join(root, 'helper.cjs'), 'x');
    assert.deepEqual(runPreflight(input(root)), { ok: true });
  }));
