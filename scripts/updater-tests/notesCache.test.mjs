import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const { readCachedReleaseNotes, writeCachedReleaseNotes } =
  await import('../../dist-electron/updater/notesCache.cjs');

function withCacheFile(run) {
  const dir = mkdtempSync(join(tmpdir(), 'ytmc-notes-cache-'));
  const file = join(dir, 'release-notes.json');
  try {
    run(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('reads notes written for the same version', () => {
  withCacheFile(file => {
    writeCachedReleaseNotes(file, '1.2.4', '### Added\n\n- Release notes');
    assert.equal(readCachedReleaseNotes(file, '1.2.4'), '### Added\n\n- Release notes');
  });
});

test('returns null for a different version', () => {
  withCacheFile(file => {
    writeCachedReleaseNotes(file, '1.2.4', 'Release notes');
    assert.equal(readCachedReleaseNotes(file, '1.2.5'), null);
  });
});

test('returns null for a missing file', () => {
  withCacheFile(file => {
    assert.equal(readCachedReleaseNotes(file, '1.2.4'), null);
  });
});

test('returns null for a corrupt file', () => {
  withCacheFile(file => {
    writeFileSync(file, '{not json', 'utf8');
    assert.equal(readCachedReleaseNotes(file, '1.2.4'), null);
  });
});

test('returns null for invalid cached data', () => {
  withCacheFile(file => {
    writeFileSync(file, JSON.stringify({ version: '1.2.4', notes: 42 }), 'utf8');
    assert.equal(readCachedReleaseNotes(file, '1.2.4'), null);
  });
});

test('preserves empty notes', () => {
  withCacheFile(file => {
    writeCachedReleaseNotes(file, '1.2.4', '');
    assert.equal(readCachedReleaseNotes(file, '1.2.4'), '');
  });
});

test('replaces the previous version entry', () => {
  withCacheFile(file => {
    writeCachedReleaseNotes(file, '1.2.4', 'Old notes');
    writeCachedReleaseNotes(file, '1.3.0', 'New notes');
    assert.equal(readCachedReleaseNotes(file, '1.3.0'), 'New notes');
    assert.equal(readCachedReleaseNotes(file, '1.2.4'), null);
  });
});
