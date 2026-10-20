# Desktop Updates

How the portable Windows build checks for, verifies, installs, and rolls back updates.

The updater targets the `x01Jin/ytmc` GitHub repository. Releases carry `ytmc-<version>-win.zip` and a detached `ytmc-<version>-win.zip.sig` signature. The app installs only from that zip; there is no installer, no checksum-only path, and no Authenticode fallback. Version 1.2.0 is the first release that contains the updater, so 1.1.0 and older do a one-time manual replacement.

---

## User flow

Updates surface in two places:

- **Settings > Updates panel** (`src/components/UpdatePanel.tsx`): installed version, check button, release notes, download progress with cancel, "Restart and Update", "View Release", and "Update Log".
- **Notice banner** (`src/components/UpdateNotice.tsx`): appears on any route when a version is available or ready, with Download / Restart and Update, a Details link to Settings, and Dismiss (remembered per version in `localStorage`).

The main process drives a single state machine (`electron/updater/index.cts`):

| Phase         | Meaning                                                      |
| ------------- | ------------------------------------------------------------ |
| `unsupported` | Not the packaged build; updates do not apply.                |
| `blocked`     | The install layout fails a safety gate; the reason is shown. |
| `idle`        | No check has run yet in this state.                          |
| `checking`    | A release scan is in flight.                                 |
| `up-to-date`  | The newest published release is not newer.                   |
| `available`   | A newer release exists and can be downloaded.                |
| `downloading` | Archive download in progress; cancellable.                   |
| `ready`       | Archive verified on disk; waiting for the user to restart.   |
| `applying`    | Helper spawned, app is exiting, install swap underway.       |
| `error`       | Check, download, or apply failed with a code and message.    |

A check runs automatically 15 seconds after startup and then at most every 6 hours. "Check for Updates" bypasses the interval with a 60-second manual cooldown. Downloads start only from a user action; cancelled or interrupted transfers resume from the `.part` file. Restarting to update is blocked while a conversion job is active (queued, downloading, or converting), and the UI explains why.

---

## Update workspace

Everything lives under `%LOCALAPPDATA%\YT Music Converter\updater\<installId>\`, where `installId` is the first 16 hex characters of `sha256(lowercased install path)`. The workspace never sits inside the install tree, so the swap never has to move it.

| File                 | Purpose                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| `state.json`         | Last check time, latest release, last apply result, cleanup list.                              |
| `pending.json`       | Apply intent written immediately before the helper is spawned.                                 |
| `journal.json`       | Helper-written phase log: `start`, `pre-swap`, `launched`, `boot-ok`, `rolled-back`, `failed`. |
| `apply.lock`         | App PID and update id; removed by the helper when it finishes.                                 |
| `boot-ok.json`       | Boot confirmation written by the relaunched app.                                               |
| `package.zip`        | Verified archive, kept until the update is installed or fails.                                 |
| `package.zip.sig`    | Release signature (base64) fetched alongside the archive.                                      |
| `updater-helper.cjs` | Bundled copy of the helper, refreshed before each apply.                                       |
| `updater.log`        | Append-only log of checks, downloads, applies, and rollbacks.                                  |

---

## Release lookup and verification

`electron/updater/release.cts` pages `GET /repos/x01Jin/ytmc/releases?per_page=100` up to 3 pages, keeps only published (non-draft, non-prerelease) releases with numeric tags, and sorts by semver. It considers only the highest version and fails closed if that release is not installable: the zip asset must exist exactly once with `state: uploaded`, a safe integer size, a `sha256:` digest from the GitHub API, and an `https://` URL; the `.sig` asset must exist exactly once the same way. There is no walk-down to older releases. Release notes are trimmed to 4000 characters.

The archive is trusted only after all three checks pass:

1. **Size** — the finished file must equal the asset size.
2. **Digest** — a streaming sha256 must equal the GitHub `sha256:` digest.
3. **Signature** — the base64 Ed25519 signature must verify over the sha256 hex against the public key pinned in `electron/updater/signing-key.cts` (fingerprint `61a98db08e42441d37de47e9c9d908591becd06ad18cfd3916ce3b49108eaab6`).

Failed digest and signature checks delete both the archive and its signature. The archive is verified again before the app hands off to the helper, and the helper re-verifies the digest and signature itself before unpacking. Downloads use `Range` with `If-Range` to resume; a server that ignores the range or answers `416` restarts the transfer, and a `401`/`403` triggers one retry after a short delay because GitHub signed URLs expire.

Unpacking uses `yauzl` with strict names, size validation, a 20,000-entry cap, a 4 GiB uncompressed cap, and an own CRC32 check. Traversal, absolute, backslash, reserved-device, alternate-stream, trailing-dot/space, symlink, and case-insensitive duplicate entries abort the update before anything on disk is touched.

---

## Install protocol

Applying an update is a rename swap performed by `electron/updater/helper.cts`, a standalone CJS bundle shipped with the app and launched through the app's own executable with `ELECTRON_RUN_AS_NODE=1`, detached, so the helper survives the app exiting.

1. The app refreshes the safety gates, confirms no conversion is active, re-verifies the archive, writes `pending.json` and `apply.lock`, and spawns the helper with the install path, archive path, digest, signature, update id, nonce, app PID, and backend PID.
2. The helper waits up to 60 seconds for the app to exit, then kills the app process if it is still running (without `/T`) and kills the backend tree with `/T`.
3. Digest and signature are re-verified. The archive is extracted to `<install>.new-<updateId>` next to the install folder. The helper disables Electron's asar layer (`process.noAsar`) so `resources/app.asar` is written and validated as a normal file.
4. The tree must contain the app executable, `resources/app.asar`, `resources/server.cjs`, `resources/bin/ffmpeg.exe`, and `resources/bin/yt-dlp.exe`, all non-empty.
5. The live `data` folder is copied into the new tree, so settings, cookies, and the local database survive.
6. `<install>` is renamed to `<install>.old-<updateId>`, then the new tree is renamed to `<install>`. If either rename fails, the helper restores the previous layout.
7. The new executable is launched with `--ytmc-update-id`, `--ytmc-update-version`, `--ytmc-update-nonce`, and `--ytmc-update-report` arguments. `ELECTRON_RUN_AS_NODE` is stripped from the child environment.

The relaunched app writes `boot-ok.json` only when all of the following hold: the update id, version, and nonce match; the renderer signaled ready; `/api/health` reported readiness (yt-dlp, FFmpeg, library); and no window load or render-process failure occurred. The helper waits up to 5 minutes for that report, then confirms the new process is still alive after 10 seconds. On success the journal records `boot-ok` and the old tree is deleted after a 60-second delay. Any other result rolls back: the new app is killed, `<install>` becomes `<install>.failed-<updateId>`, the old tree is renamed back, and the previous version is relaunched. Rollback reasons include `app-still-running`, `archive-digest-mismatch`, `archive-signature-invalid`, `extract-*`, `tree-invalid-*`, `swap-failed`, `boot-report-mismatch`, `boot-version-mismatch`, `boot-nonce-mismatch`, `app-exited`, `app-died-after-boot`, `boot-timeout`, and `rollback-failed`.

The install path is missing only during the two renames. If the helper or machine dies in that window, the `journal.json` record plus the `.old-` and `.new-` folder names identify which tree was which, and the string `running-from-stale-copy` blocks updater activity from a renamed folder.

Builds up to 1.2.1 shipped a helper that failed while writing `resources/app.asar`, so they cannot install updates automatically. Those installs need one manual replacement with 1.2.2 or newer; keep the existing `data` folder.

---

## Safety gates

`electron/updater/preflight.cts` blocks updates with a stable code and a user-facing message when the install cannot be swapped safely:

- Not the packaged Windows build, or an unparsable version.
- Install folder missing, longer than 200 characters, a drive root, a UNC path, inside `%TEMP%`, a reparse point/junction, or inside OneDrive/Dropbox.
- `%LOCALAPPDATA%` unavailable.
- `userDataDir` is not `<install>\data` (portable data next to the executable is required).
- The library folder is inside the install folder.
- The helper bundle is missing, the install folder or its parent is not writable (256 KiB probe), or they are on different volumes.
- Less than two times the install size plus 256 MiB free for the unpack, or less than three times the archive size plus 256 MiB free for the workspace.

---

## Release process

1. **Key pair (once).** `npm run release:keygen` creates `%USERPROFILE%\.ytmc-release-signing.key` (never commit it; `.gitignore` covers `*.key`) and prints the fingerprint of the public key that must be pinned in `electron/updater/signing-key.cts`.
2. **Build.** Bump `version` in `package.json`, then `npm run electron:build`. The zip is written to `release/ytmc-<version>-win.zip` (`artifactName` in `package.json`).
3. **Sign.** `npm run release:sign` writes `release/ytmc-<version>-win.zip.sig`. `YTMC_SIGNING_KEY` can point at a different key file.
4. **Publish.** Create the GitHub release with tag `v<version>` (or `<version>`) and upload both the zip and the `.sig`. The GitHub `sha256:` digest is recorded on upload and is what the app compares.
5. **Verify.** `npm run release:verify` checks the local signature, the published release state, the remote digest and size, and that the published signature matches and verifies.

A release is installable only after the zip and the signature are both uploaded and the GitHub digest is populated.
