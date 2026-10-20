import fs from 'fs';
import path from 'path';
import { hashFileHex, verifyDigestSignature } from '../electron/updater/signature.cts';

interface GithubAsset {
  name: string;
  size: number;
  digest: string | null;
  browser_download_url: string;
}

interface GithubRelease {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  assets: GithubAsset[];
}

const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
  version: string;
};

const version = process.argv[2] ?? pkg.version;
const archivePath = path.resolve(path.join('release', `ytmc-${version}-win.zip`));
const signaturePath = `${archivePath}.sig`;
const names = {
  archive: `ytmc-${version}-win.zip`,
  signature: `ytmc-${version}-win.zip.sig`,
};

let failures = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ` ${JSON.stringify(detail)}`}`);
  if (!cond) failures++;
};

if (!fs.existsSync(archivePath) || !fs.existsSync(signaturePath)) {
  console.error(`Run release:sign first. Missing ${archivePath} or ${signaturePath}`);
  process.exit(1);
}

const localDigest = await hashFileHex(archivePath);
const localSignature = fs.readFileSync(signaturePath, 'utf8').trim();

check('local signature verifies', verifyDigestSignature(localDigest, localSignature).ok);

const headers = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'ytmc-updater',
};

const fetchRelease = async (tag: string): Promise<GithubRelease | null> => {
  const response = await fetch(
    `https://api.github.com/repos/x01Jin/ytmc/releases/tags/${encodeURIComponent(tag)}`,
    { headers }
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    console.error(`GitHub responded ${response.status} for tag ${tag}`);
    process.exit(1);
  }
  return (await response.json()) as GithubRelease;
};

const release = (await fetchRelease(`v${version}`)) ?? (await fetchRelease(version));
check('release exists', !!release, { version });
if (!release) {
  console.log(`${failures} FAILURES`);
  process.exit(1);
}

check('release is published', !release.draft && !release.prerelease, {
  draft: release.draft,
  prerelease: release.prerelease,
});

const archive = release.assets.find(asset => asset.name === names.archive);
check('archive asset exists', !!archive, { assets: release.assets.map(a => a.name) });
check('archive digest matches local', archive?.digest === `sha256:${localDigest}`, {
  api: archive?.digest,
  local: `sha256:${localDigest}`,
});

const signature = release.assets.find(asset => asset.name === names.signature);
check('signature asset exists', !!signature, { assets: release.assets.map(a => a.name) });

if (archive && signature) {
  const response = await fetch(signature.browser_download_url, {
    headers: { 'User-Agent': 'ytmc-updater' },
  });
  const remoteSignature = response.ok ? (await response.text()).trim() : '';
  check('published signature matches local', remoteSignature === localSignature, {
    status: response.status,
  });
  check('published signature verifies', verifyDigestSignature(localDigest, remoteSignature).ok);
}

check('published size matches local', archive?.size === fs.statSync(archivePath).size, {
  api: archive?.size,
  local: fs.statSync(archivePath).size,
});

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
