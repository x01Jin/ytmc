# Desktop Updates

How the portable Windows build checks for, verifies, installs, and recovers updates.

The updater targets the `x01Jin/ytmc` GitHub repository. Releases carry `ytmc-<version>-win.zip` and a detached `ytmc-<version>-win.zip.sig` signature. The app installs only from that zip; there is no installer, no checksum-only path, and no Authenticode fallback.

Versions 1.2.4 and 1.3.0 ship the same broken helper: it runs from the install executable, which holds the install folder open, and it relaunches the app hidden. Both cannot install an update automatically. Install 1.3.3 manually once. From 1.3.1 onward the helper runs from a hardlinked runtime outside the install folder and relaunches the app visibly, so 1.3.1, 1.3.2, and later install newer releases automatically.

---

## User flow

Updates surface in two places:

- **Settings > Updates panel** (`src/components/UpdatePanel.tsx`): installed version, a "Release Notes" button that opens a Markdown preview of the installed release's notes, check button, download progress with cancel, "Restart and Update", and "View Release". During an install it shows the current phase and progress; after a failure it shows the error detail and whether the previous version was restored.
- **Notice banner** (`src/components/UpdateNotice.tsx`): appears on any route when a version is available or ready, with Download / Restart and Update, a Details link to Settings, and Dismiss (remembered per version in `localStorage`). While an update is applying, a global progress banner replaces it and cannot be dismissed.

The main process drives a single state machine (`electron/updater/index.cts`):

| Phase         | Meaning                                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------- |
| `unsupported` | Not the packaged build; updates do not apply.                                                                    |
| `blocked`     | The install layout fails a safety gate; the reason is shown.                                                     |
| `idle`        | No check has run yet in this state.                                                                              |
| `checking`    | A release scan is in flight.                                                                                     |
| `up-to-date`  | The newest published release is not newer.                                                                       |
| `available`   | A newer release exists and can be downloaded.                                                                    |
| `downloading` | Archive download in progress; cancellable.                                                                       |
| `ready`       | Archive verified on disk; waiting for the user to restart.                                                       |
| `applying`    | Helper is verifying and unpacking while the app stays open, then the app quits at pre-swap for the install swap. |
| `error`       | Check, download, or apply failed with a code and message.                                                        |

A check runs automatically 15 seconds after startup and then at most every 6 hours. "Check for Updates" bypasses the interval with a 60-second manual cooldown. Downloads start only from a user action; cancelled or interrupted transfers resume from the `.part` file. Restarting to update is blocked while a conversion job is active (queued, downloading, or converting), and the UI explains why. The conversion check runs again when the helper reaches pre-swap; if a job became active, the helper cancels the install and the app stays open.

---

## Update workspace

The workspace lives under `%LOCALAPPDATA%\YT Music Converter\updater\<installId>\`, where `installId` is the first 16 hex characters of `sha256(lowercased install path)`. If `%LOCALAPPDATA%` is unavailable or unwritable, the app falls back to `<install parent>\.ytmc-updater\<installId>\`. The workspace never sits inside the install tree, so the swap never has to move it.

| File                 | Purpose                                                                                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state.json`         | Last check time, latest release, install path, last apply result, cleanup list.                                                                                                        |
| `journal.json`       | Helper-written phase and progress: `start`, `verifying`, `extracting`, `validating`, `pre-swap`, `copying`, `installing`, `launched`, `boot-ok`, `cancelled`, `rolled-back`, `failed`. |
| `apply.lock`         | Helper PID, update id, and write time; removed by the helper when it finishes.                                                                                                         |
| `apply.cancel`       | Written by the app when a conversion becomes active at pre-swap.                                                                                                                       |
| `boot-ok.json`       | Boot confirmation written by the relaunched app.                                                                                                                                       |
| `package.zip`        | Verified archive. Removed after a successful install; kept after a failure so a retry does not download it again.                                                                      |
| `package.zip.sig`    | Release signature (base64) fetched alongside the archive.                                                                                                                              |
| `updater-helper.cjs` | Bundled copy of the helper, refreshed before each apply.                                                                                                                               |
| `recover-update.ps1` | Watchdog script used to restore an interrupted swap.                                                                                                                                   |
| `updater.log`        | Append-only log of checks, downloads, applies, and rollbacks. Kept for diagnostics.                                                                                                    |

The journal also carries extraction totals and byte progress, which the app polls every 200 milliseconds and mirrors to the banner and the Windows taskbar.

After a successful boot the app removes the archive, signature, helper bundle, watchdog script, journal, boot confirmation, cancel marker, and update marker. It also removes workspaces whose recorded install path no longer exists. Legacy workspaces without a recorded install path have only their cache files removed, and only after 24 hours. A workspace with a live apply lock is never removed.

The helper also writes `<install parent>\.ytmc-updating-<installId>.json` before the swap. A manual app launch while that marker is live is refused with an "Update in progress" dialog, so the user cannot start a second process that locks the install folder. Stale markers are removed at startup.

---

## Release lookup and verification

`electron/updater/release.cts` pages `GET /repos/x01Jin/ytmc/releases?per_page=100` up to 3 pages, keeps only published (non-draft, non-prerelease) releases with numeric tags, and sorts by semver. It considers only the highest version and fails closed if that release is not installable: the zip asset must exist exactly once with `state: uploaded`, a safe integer size, a `sha256:` digest from the GitHub API, and an `https://` URL; the `.sig` asset must exist exactly once the same way. There is no walk-down to older releases.

Release notes are not part of the scan. The installed version's notes are fetched on demand from `GET /repos/x01Jin/ytmc/releases/tags/v<version>`, falling back to the unprefixed tag on a 404, and rendered in the Settings preview. A successful fetch is cached in `release-notes.json` in the updater workspace, keyed by installed version; later opens use the cache without a network request. A new installed version replaces the cached entry on its first successful fetch. Only a published release whose tag matches the installed version is shown, and notes are capped at 20,000 characters for display.

The archive is trusted only after all three checks pass:

1. **Size** — the finished file must equal the asset size.
2. **Digest** — a streaming sha256 must equal the GitHub `sha256:` digest.
3. **Signature** — the base64 Ed25519 signature must verify over the sha256 hex against the public key pinned in `electron/updater/signing-key.cts` (fingerprint `61a98db08e42441d37de47e9c9d908591becd06ad18cfd3916ce3b49108eaab6`).

Failed digest and signature checks delete both the archive and its signature. The archive is verified again before the app hands off to the helper, and the helper re-verifies the digest and signature itself before unpacking. Downloads use `Range` with `If-Range` to resume; a server that ignores the range or answers `416` restarts the transfer, and a `401`/`403` triggers one retry after a short delay because GitHub signed URLs expire.

Unpacking uses `yauzl` with strict names, size validation, a 20,000-entry cap, a 4 GiB uncompressed cap, and native `zlib.crc32` checks. Archive totals are read first so the UI can report progress. Traversal, absolute, backslash, reserved-device, alternate-stream, trailing-dot/space, symlink, and case-insensitive duplicate entries abort the update before anything on disk is touched.

---

## Install protocol

Applying an update is a rename swap performed by `electron/updater/helper.cts`, a standalone CJS bundle shipped with the app. The app stays open until the install is ready to swap.

1. The app confirms no conversion is active, re-verifies the archive, reads its unpacked totals, runs the safety gates with the real unpack and data-copy space, and checks that no other live helper holds the lock.
2. The app creates `<install>.helper-<updateId>` beside the install folder. Every runtime file except `data` and `resources` is hardlinked from the install; if the volume does not support hardlinks, the files are copied and the space gate accounts for the copy. The helper is then spawned as `helperDir\<app exe>` with `ELECTRON_RUN_AS_NODE=1`, detached, with the install path, workspace, helper directory, archive, digest, signature, update id, nonce, app PID, and backend PID.
3. The helper removes stale `<install>.new-*`, `<install>.old-*`, `<install>.failed-*`, and `<install>.helper-*` siblings left by earlier attempts, re-verifies the digest and signature, and extracts the archive to `<install>.new-<updateId>`. Electron's asar layer is disabled (`process.noAsar`) so `resources/app.asar` is written and validated as a normal file.
4. The tree must contain the app executable, `resources/app.asar`, `resources/server.cjs`, `resources/bin/ffmpeg.exe`, and `resources/bin/yt-dlp.exe`, all non-empty. Only then does the helper write `pre-swap`.
5. At pre-swap the app checks for an active conversion one last time. If one exists, it writes `apply.cancel`; the helper removes the new tree, writes `cancelled`, and the app returns to `ready` without restarting.
6. Otherwise the app quits. The helper waits up to 60 seconds for the app to exit, kills the app process tree if it is still running, then kills the backend tree. A backend that survives 15 seconds aborts the install with `backend-still-running`.
7. The helper enumerates every process whose executable lives under the install folder and stops them, retrying for 15 seconds. This catches a manual launch that raced the update marker and any stray process still running from the folder. The same sweep runs again immediately before the swap.
8. The live `data` folder is copied into the new tree, so settings, cookies, library data, local storage, and session storage survive. Chromium cache folders (`Cache`, `Code Cache`, `GPUCache`, `DawnCache`, `DawnGraphiteCache`, `DawnWebGPUCache`, `ShaderCache`, `GrShaderCache`, `Crashpad`) are skipped to cut copy time and disk use. Directory junctions are recreated; file symlinks copy their target contents.
9. As soon as the app commits to restarting, the helper writes the update marker and starts a PowerShell watchdog through WMI process creation, so it survives the helper process, plus a `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` entry that runs the same script at the next logon. The watchdog waits for the helper PID, then repairs the install if the helper died. The entry is removed after a successful repair or a confirmed healthy install; a failed repair leaves it in place so the next logon retries.
10. `<install>` is renamed to `<install>.old-<updateId>`, then the new tree is renamed to `<install>`. Both renames retry `EPERM`, `EBUSY`, and `EACCES` for 60 seconds and log each retry. If either fails, the helper restores the previous layout, records `restored` and the error detail, removes the new tree, and relaunches the old build if the app is no longer running.
11. The new executable is launched visibly from the install parent folder with `--ytmc-update-id`, `--ytmc-update-version`, `--ytmc-update-nonce`, and `--ytmc-update-report` arguments. `ELECTRON_RUN_AS_NODE` is stripped from the child environment.

The relaunched app writes `boot-ok.json` only when all of the following hold: the update id, version, and nonce match; the window exists and is visible; `/api/health` reports yt-dlp and FFmpeg readiness; and no window load or render-process failure occurred. Library readiness is not required, so an offline library cannot roll back a healthy update. The app retries the boot report for up to 5 minutes. The helper waits for that report, then confirms the new process is still alive after 10 seconds. On success the journal records `boot-ok`, the marker and Run entry are removed, and the old tree is deleted 60 seconds later. If the app exits before that timer fires, the next startup removes the old tree.

Any post-swap failure rolls back: the new app is killed, `<install>` becomes `<install>.failed-<updateId>`, the old tree is renamed back, and the previous version is relaunched visibly. If the rollback itself fails, the marker and Run entry stay in place so the watchdog or the next logon can finish the repair. The watchdog also waits up to five minutes for a matching `boot-ok.json` when the journal says the new build was launched; if confirmation never arrives, it restores the old tree even though the install folder is present.

Failures before the swap keep the app open and write `failed` with a reason. These include `archive-digest-mismatch`, `archive-signature-*`, `archive-unreadable`, `extract-*`, `tree-invalid-*`, `new-tree-cleanup-failed`, `app-still-running`, `backend-still-running`, `data-copy-failed`, `old-tree-remove-failed`, and `swap-failed`. Post-swap rollback reasons include `launch-failed`, `boot-report-mismatch`, `boot-version-mismatch`, `boot-nonce-mismatch`, `boot-window-hidden`, `app-exited`, `app-died-after-boot`, `boot-timeout`, `boot-report-cleanup-failed`, and `rollback-failed`. The last failure reason, detail, and restore result are kept in `state.json` and shown in Settings.

The install path is missing only during the two renames. The journal, the `.old-`/`.new-` folder names, and the update marker identify which tree is which. If the app is started from a renamed folder, `running-from-stale-copy` blocks updater activity. At startup the app removes every validated stale sibling tree and stale marker from older attempts when the install executable is intact. It keeps the trees only when the install executable is missing and repair is still required.

---

## Why the previous updater failed

Two defects are fixed in 1.3.1:

- The helper was spawned from `<install>\YT Music Converter.exe` in Node mode. That process held the install folder open, so the `install` to `install.old-<id>` rename always failed with `EPERM`. Retrying could not help because the lock was the helper itself. The helper now runs from a hardlinked copy outside the install folder.
- The helper relaunched the app with `windowsHide: true`. Windows applies `SW_HIDE` to the first window, so the app booted, painted, and wrote its boot log with no visible window. Double-clicking the exe only sent a second-instance message to the hidden window. Relaunches now use a normal visible window, and `focusWindow` calls `show()` so a hidden window is restored.

---

## Safety gates

`electron/updater/preflight.cts` blocks updates with a stable code and a user-facing message when the install cannot be swapped safely:

- Not the packaged Windows build, or an unparsable version.
- Install folder missing, longer than 200 characters, a drive root, a UNC path, inside `%TEMP%`, a reparse point/junction, or inside OneDrive/Dropbox.
- The install drive is removable, network, optical, or RAM-backed.
- `%LOCALAPPDATA%` unavailable, or the selected workspace is not writable.
- `userDataDir` is not `<install>\data` (portable data next to the executable is required).
- The library folder is inside the install folder.
- The helper bundle is missing, the install folder or its parent is not writable (256 KiB probe), or they are on different volumes.
- Less than the current install size plus the unpacked archive size plus 256 MiB free on the install volume, or less than the archive size plus 256 MiB free on the workspace volume. When both live on the same volume, the two requirements are summed.
- When hardlinks are unavailable, the helper runtime copy size is added to the install requirement.

The app checks the gates at startup, before a download, and again with exact sizes before an apply. The exact check caps directory walks at 20,000 entries during startup checks so a large library cannot freeze the window.

---

## Release process

1. **Key pair (once).** `npm run release:keygen` creates `%USERPROFILE%\.ytmc-release-signing.key` (never commit it; `.gitignore` covers `*.key`) and prints the fingerprint of the public key that must be pinned in `electron/updater/signing-key.cts`.
2. **Build.** Bump `version` in `package.json`, then `npm run electron:build`. The zip is written to `release/ytmc-<version>-win.zip` (`artifactName` in `package.json`).
3. **Sign.** `npm run release:sign` writes `release/ytmc-<version>-win.zip.sig`. `YTMC_SIGNING_KEY` can point at a different key file.
4. **Publish.** Create the GitHub release with tag `v<version>` (or `<version>`) and upload both the zip and the `.sig`. The GitHub `sha256:` digest is recorded on upload and is what the app compares.
5. **Verify.** `npm run release:verify` checks the local signature, the published release state, the remote digest and size, and that the published signature matches and verifies.

A release is installable only after the zip and the signature are both uploaded and the GitHub digest is populated.
