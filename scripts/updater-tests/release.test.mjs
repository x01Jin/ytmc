import assert from 'node:assert/strict';
import test from 'node:test';

const { fetchReleaseNotes, scanForRelease } =
  await import('../../dist-electron/updater/release.cjs');

const digest = `sha256:${'a'.repeat(64)}`;

function asset(name, overrides = {}) {
  return {
    name,
    size: 1024,
    state: 'uploaded',
    digest,
    browser_download_url: `https://example.test/${name}`,
    ...overrides,
  };
}

function release(tag, assets = [], overrides = {}) {
  return {
    tag_name: tag,
    draft: false,
    prerelease: false,
    body: 'Release notes',
    published_at: '2026-10-01T00:00:00Z',
    assets,
    ...overrides,
  };
}

function validRelease(tag = 'v1.3.0') {
  const version = tag.replace(/^v/, '');
  return release(tag, [asset(`ytmc-${version}-win.zip`), asset(`ytmc-${version}-win.zip.sig`)]);
}

function fetcher(pages) {
  return async url => {
    const page = Number(new URL(url).searchParams.get('page'));
    return { status: 200, headers: {}, body: JSON.stringify(pages[page - 1] ?? []) };
  };
}

test('returns available for the highest newer release with both assets', async () => {
  const result = await scanForRelease({
    fetchJson: fetcher([[validRelease()]]),
    currentVersion: '1.2.0',
  });
  assert.equal(result.status, 'available');
  assert.equal(result.release.version, '1.3.0');
  assert.equal(result.release.archive.digestHex, 'a'.repeat(64));
  assert.equal(result.release.archive.downloadUrl, 'https://example.test/ytmc-1.3.0-win.zip');
  assert.equal(result.release.signature.downloadUrl, 'https://example.test/ytmc-1.3.0-win.zip.sig');
});

test('returns up-to-date when the newest release matches the running version', async () => {
  const result = await scanForRelease({
    fetchJson: fetcher([[validRelease('v1.2.0')]]),
    currentVersion: '1.2.0',
  });
  assert.deepEqual(result, { status: 'up-to-date', version: '1.2.0' });
});

test('ignores drafts, prereleases, and non-semver tags', async () => {
  const pages = [
    [
      release('v2.0.0', [], { draft: true }),
      release('v2.1.0', [], { prerelease: true }),
      release('nightly', [asset('ytmc-nightly-win.zip')]),
      validRelease('v1.3.0'),
    ],
  ];
  const result = await scanForRelease({ fetchJson: fetcher(pages), currentVersion: '1.2.0' });
  assert.equal(result.status, 'available');
  assert.equal(result.release.version, '1.3.0');
});

test('scans past a full first page', async () => {
  const fillers = Array.from({ length: 100 }, (_, index) => release(`v0.0.${index + 1}`));
  const result = await scanForRelease({
    fetchJson: fetcher([fillers, [validRelease('v1.4.0')]]),
    currentVersion: '1.2.0',
  });
  assert.equal(result.status, 'available');
  assert.equal(result.release.version, '1.4.0');
});

test('selects the highest semver regardless of list order', async () => {
  const result = await scanForRelease({
    fetchJson: fetcher([[validRelease('v1.9.0'), validRelease('v1.10.0'), validRelease('v1.8.0')]]),
    currentVersion: '1.2.0',
  });
  assert.equal(result.status, 'available');
  assert.equal(result.release.version, '1.10.0');
});

test('fails closed when the archive asset is missing', async () => {
  const result = await scanForRelease({
    fetchJson: fetcher([[release('v1.3.0', [asset('ytmc-1.3.0-win.zip.sig')])]]),
    currentVersion: '1.2.0',
  });
  assert.deepEqual(result, {
    status: 'invalid-release',
    version: '1.3.0',
    reason: 'archive-asset-missing',
  });
});

test('fails closed when the archive state is not uploaded', async () => {
  const result = await scanForRelease({
    fetchJson: fetcher([
      [
        release('v1.3.0', [
          asset('ytmc-1.3.0-win.zip', { state: 'starter' }),
          asset('ytmc-1.3.0-win.zip.sig'),
        ]),
      ],
    ]),
    currentVersion: '1.2.0',
  });
  assert.deepEqual(result, {
    status: 'invalid-release',
    version: '1.3.0',
    reason: 'archive-asset-not-uploaded',
  });
});

test('fails closed when the archive has no digest', async () => {
  const result = await scanForRelease({
    fetchJson: fetcher([
      [
        release('v1.3.0', [
          asset('ytmc-1.3.0-win.zip', { digest: null }),
          asset('ytmc-1.3.0-win.zip.sig'),
        ]),
      ],
    ]),
    currentVersion: '1.2.0',
  });
  assert.deepEqual(result, {
    status: 'invalid-release',
    version: '1.3.0',
    reason: 'archive-digest-missing',
  });
});

test('fails closed when the signature asset is missing', async () => {
  const result = await scanForRelease({
    fetchJson: fetcher([[release('v1.3.0', [asset('ytmc-1.3.0-win.zip')])]]),
    currentVersion: '1.2.0',
  });
  assert.deepEqual(result, {
    status: 'invalid-release',
    version: '1.3.0',
    reason: 'signature-asset-missing',
  });
});

test('maps transport failures to error reasons', async () => {
  assert.deepEqual(
    await scanForRelease({
      fetchJson: async () => ({ status: 500, headers: {}, body: '' }),
      currentVersion: '1.2.0',
    }),
    { status: 'error', reason: 'http-500', message: 'Release lookup failed.' }
  );
  assert.equal(
    (
      await scanForRelease({
        fetchJson: async () => ({ status: 200, headers: {}, body: 'nope' }),
        currentVersion: '1.2.0',
      })
    ).reason,
    'invalid-json'
  );
  assert.equal(
    (await scanForRelease({ fetchJson: fetcher([[]]), currentVersion: '1.2.0' })).reason,
    'no-releases'
  );
});

function notesFetcher(releases) {
  return async url => {
    const tag = new URL(url).pathname.split('/').pop() ?? '';
    const found = releases[tag];
    if (!found) return { status: 404, headers: {}, body: '' };
    return { status: 200, headers: {}, body: JSON.stringify(found) };
  };
}

test('fetches release notes for the installed version', async () => {
  const result = await fetchReleaseNotes({
    fetchJson: notesFetcher({ 'v1.2.4': release('v1.2.4') }),
    currentVersion: '1.2.4',
  });
  assert.deepEqual(result, { status: 'ok', version: '1.2.4', notes: 'Release notes' });
});

test('falls back to the unprefixed tag for release notes', async () => {
  const requested = [];
  const result = await fetchReleaseNotes({
    fetchJson: async url => {
      const tag = new URL(url).pathname.split('/').pop();
      requested.push(tag);
      if (tag === 'v1.2.4') return { status: 404, headers: {}, body: '' };
      return { status: 200, headers: {}, body: JSON.stringify(release('1.2.4')) };
    },
    currentVersion: '1.2.4',
  });
  assert.deepEqual(requested, ['v1.2.4', '1.2.4']);
  assert.deepEqual(result, { status: 'ok', version: '1.2.4', notes: 'Release notes' });
});

test('returns missing when neither tag has release notes', async () => {
  const result = await fetchReleaseNotes({
    fetchJson: notesFetcher({}),
    currentVersion: '1.2.4',
  });
  assert.deepEqual(result, { status: 'missing', version: '1.2.4' });
});

test('returns missing for unpublished or mismatched tags', async () => {
  for (const candidate of [
    release('v1.2.4', [], { draft: true }),
    release('v1.2.4', [], { prerelease: true }),
    release('v1.2.5'),
  ]) {
    const result = await fetchReleaseNotes({
      fetchJson: async () => ({
        status: 200,
        headers: {},
        body: JSON.stringify(candidate),
      }),
      currentVersion: '1.2.4',
    });
    assert.deepEqual(result, { status: 'missing', version: '1.2.4' });
  }
});

test('maps release notes failures to error reasons', async () => {
  assert.deepEqual(
    await fetchReleaseNotes({
      fetchJson: async () => ({ status: 500, headers: {}, body: '' }),
      currentVersion: '1.2.4',
    }),
    { status: 'error', reason: 'http-500', message: 'Release notes lookup failed.' }
  );
  assert.deepEqual(
    await fetchReleaseNotes({
      fetchJson: async () => ({ status: 200, headers: {}, body: 'nope' }),
      currentVersion: '1.2.4',
    }),
    {
      status: 'error',
      reason: 'invalid-json',
      message: 'Release notes lookup returned invalid data.',
    }
  );
  assert.deepEqual(
    await fetchReleaseNotes({
      fetchJson: async () => {
        throw new Error('offline');
      },
      currentVersion: '1.2.4',
    }),
    { status: 'error', reason: 'network', message: 'offline' }
  );
});

test('caps release notes at the preview limit', async () => {
  const result = await fetchReleaseNotes({
    fetchJson: notesFetcher({
      'v1.2.4': release('v1.2.4', [], { body: `${'x'.repeat(20_000)}y` }),
    }),
    currentVersion: '1.2.4',
  });
  assert.equal(result.status, 'ok');
  assert.equal(result.notes.length, 20_001);
  assert.ok(result.notes.endsWith('…'));
});
