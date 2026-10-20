import assert from 'node:assert/strict';
import test from 'node:test';

const { parseVersion, formatVersion, compareVersions, isNewerVersion } =
  await import('../../dist-electron/updater/version.cjs');

test('parseVersion accepts canonical and prefixed versions', () => {
  assert.deepEqual(parseVersion('1.2.3'), { major: 1, minor: 2, patch: 3 });
  assert.deepEqual(parseVersion('v10.0.99'), { major: 10, minor: 0, patch: 99 });
  assert.deepEqual(parseVersion(' 2.0.1 '), { major: 2, minor: 0, patch: 1 });
});

test('parseVersion rejects malformed versions', () => {
  for (const value of [
    '',
    '1',
    '1.2',
    '1.2.3.4',
    '1.2.3-beta',
    'v1.2.x',
    '123456.1.1',
    'vv1.2.3',
  ]) {
    assert.equal(parseVersion(value), null, value);
  }
});

test('formatVersion renders the parsed triple', () => {
  assert.equal(formatVersion({ major: 1, minor: 2, patch: 3 }), '1.2.3');
});

test('compareVersions orders numerically, not lexically', () => {
  const version = value => parseVersion(value);
  assert.equal(compareVersions(version('1.2.3'), version('1.2.3')), 0);
  assert.ok(compareVersions(version('1.10.0'), version('1.9.9')) > 0);
  assert.ok(compareVersions(version('2.0.0'), version('1.99.99')) > 0);
  assert.ok(compareVersions(version('1.2.3'), version('1.2.4')) < 0);
});

test('isNewerVersion fails closed on unparsable input', () => {
  assert.equal(isNewerVersion('1.2.4', '1.2.3'), true);
  assert.equal(isNewerVersion('1.2.3', '1.2.3'), false);
  assert.equal(isNewerVersion('bogus', '1.2.3'), false);
  assert.equal(isNewerVersion('1.2.4', 'bogus'), false);
});
