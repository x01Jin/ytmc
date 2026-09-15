# Architecture Overview

The YouTube to Music Converter is a Windows desktop app: an Electron shell around the proven Node.js Express + React 19 + Vite core. The same `npm run dev` web build runs in the browser during development; `npm run electron:build` ships it as an NSIS/portable `.exe`.

## Tech Stack

- **Desktop shell**: Electron 44 (Windows-only NSIS + portable), secure `contextBridge` preload, Express sidecar child process
- **Frontend**: React 19, TypeScript, Vite 6, Tailwind CSS 4 (dark-only pixel theme), Lucide Icons
- **Backend**: Node.js, Express 4, `yt-dlp`, FFmpeg
- **Persistence**: In-memory job state machine, `data/settings.json`, `data/library.json`, `data/history.json`, on-disk audio library

```
┌────────────────────────────────────────────────────────┐
│              Electron Main (`electron/main.cts`)        │
│  single-instance lock · sidecar spawn · taskkill tree   │
│  default library: %USERPROFILE%\\Downloads\\YT Music        │
└──────────────────────────┬─────────────────────────────┘
                           │ spawn + waitForServer (/api/health)
                           ▼
┌────────────────────────────────────────────────────────┐
│              React 19 Frontend (AppShell)              │
│  Convert / Library / History / Queue / Settings (hash routes)    │
│  Jobs + Library + Settings + Session providers         │
└──────────────────────────┬─────────────────────────────┘
                           │ HTTP / JSON / Range Streams
                           ▼
┌────────────────────────────────────────────────────────┐
│                   React 18 Frontend                    │
│   (Vite + Tailwind CSS + Lucide Icons + HTML5 Audio)   │
└──────────────────────────┬─────────────────────────────┘
                           │ HTTP / JSON / Range Streams
                           ▼
┌────────────────────────────────────────────────────────┐
│                   Express API Server                   │
│                    (server.ts:3000)                    │
├────────────────────────────────────────────────────────┤
│  /api/info        - Metadata extraction & oEmbed       │
│  /api/convert     - Audio extraction & FFmpeg queue    │
│  /api/status/:id  - Real-time job polling & progress   │
│  /api/stream/:id  - Partial Content (HTTP 206) audio   │
│  /api/download/:id- Attachment file streaming          │
│  /api/cookies     - Netscape session cookie storage    │
│  /api/history     - Persistent conversion log + delete │
└──────────────────────────┬─────────────────────────────┘
                           │ Child Process Execution
                           ▼
┌────────────────────────────────────────────────────────┐
│             Audio Engine & Extraction Layer            │
├────────────────────────────────────────────────────────┤
│  - yt-dlp (audio stream extractor & section slicer)    │
│  - ffmpeg (codec conversion, loudnorm, ID3 tagging)    │
│  - bgutil-pot (local PO token sidecar service)         │
└────────────────────────────────────────────────────────┘
```

---

## Modularity & Single-Purpose Scripting

The backend codebase adheres strictly to the single-purpose pattern:

| File                                   | Purpose                                                                                                              |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `server/config.ts`                     | Centralized constants, binary paths, output directories, and supported formats.                                      |
| `server/services/urlService.ts`        | Pure URL and ID parsing, extraction, and canonicalization.                                                           |
| `server/services/metadataService.ts`   | Video metadata retrieval combining YouTube oEmbed and yt-dlp inspection.                                             |
| `server/services/tagFetcherService.ts` | Multi-source music autotagging querying iTunes, Deezer, and MusicBrainz.                                             |
| `server/services/audioTagService.ts`   | ID3, Vorbis, MP4 atom, and RIFF metadata injection with cover artwork using FFmpeg.                                  |
| `server/services/conversionService.ts` | Audio extraction pipeline orchestrating `yt-dlp` and `ffmpeg`.                                                       |
| `server/services/jobManager.ts`        | In-memory job state machine, progress tracking, and file lifecycle cleanup.                                          |
| `server/services/cookieService.ts`     | Netscape/JSON cookie parsing, verification, and file persistence.                                                    |
| `server/services/settingsService.ts`   | Library-folder settings in `data/settings.json` with Windows path validation.                                        |
| `server/services/fileService.ts`       | Library dir resolution, on-disk scan, `.part` sweep.                                                                 |
| `server/services/previewService.ts`    | Cached 320 kbps MP3 previews for Opus/M4A playback; on-demand transcode, mtime validation, invalidation.           |
| `server/services/libraryStore.ts`      | Persistent `data/library.json` index for converted and imported library files; one row per file on disk, boot-time reconcile. |
| `server/services/historyStore.ts`      | Append-only `data/history.json` log of finished conversions with frozen original title, channel, thumbnail, and canonical URL. |
| `server/utils/filename.ts`             | Windows-safe filename sanitizer, display names, dedupe.                                                              |
| `server/utils/mime.ts`                 | Fast audio MIME-type resolution for streaming and downloads.                                                         |
| `server/routes/api.ts`                 | Express router exposing the public REST API surface.                                                                 |
| `server.ts`                            | Application entry point exporting `startServer()`; loopback-only + token guard.                                      |

---

## Desktop Security Model

- The backend binds `127.0.0.1` only and rejects non-loopback `Host` headers (DNS-rebinding defense).
- Mutating `/api` calls must echo the per-process `x-loopback-token` published by `/api/health`.
- Renderer has no Node access (`contextIsolation`, `sandbox`); `preload.cjs` exposes only `window.desktop` (`pickFolder`, `revealInExplorer`, `openFile`, `getBackendPort`).
- Strict Content-Security-Policy set as a response header via `session.defaultSession.webRequest.onHeadersReceived` (`electron/main.cts`), scoped to loopback origins: `script-src 'self'` everywhere (no inline or remote scripts); `style-src` keeps `'unsafe-inline'` because React sets style attributes (progress-bar width); images/media open to `https:`/`data:`/`blob:` for thumbnails, autotagger covers, and same-origin streams.
- Quit kills the whole backend tree via `taskkill /T /F` so no `yt-dlp`/FFmpeg orphans linger.

## Frontend Architecture

Pixel-art dark-only UI (`src/index.css` `@theme` tokens, `Press Start 2P` + `IBM Plex Mono`):

- **`components/AppShell.tsx`**: TitleBar, SideNav, StatusBar + hash routing (`#/convert`, `#/library`, `#/history`, `#/queue`, `#/settings`).
- **`store/appStore.tsx`**: `JobsProvider` (owns `useJobPolling` with `startTransition` + backoff), `ConvertDraftProvider` (inspect state, options, and one-shot re-convert URLs), `LibraryProvider` (sequence-guarded refresh), `HistoryProvider` (persistent log with optimistic delete/clear), `SettingsProvider`, `SessionProvider`.
- **`routes/Convert.tsx`**: inspect → options → convert flow. When a job completes, the route refreshes history and the library, clears the active job and draft, and reports success through a floating bottom-right notification.
- **`routes/Library.tsx`**: searchable on-disk library with a docked bottom preview player, drag-and-drop/file-picker import, reveal-in-Explorer, edit panels, and delete-behind-confirm. Refreshes automatically when a conversion finishes. Per-track media versions cache-bust the player and trim preview after an edit.
- **`routes/History.tsx`**: finished conversions with frozen original cover art and title, YouTube link copy, one-click re-convert, per-row remove, and clear-all behind confirm.
- **`routes/Queue.tsx`**: live view of the in-progress conversion only; finished jobs clear out to Library + History.
- **`routes/Settings.tsx`**: library folder (Browse/Reset), reveal-after-convert, session cookies.

The frontend is constructed with focused React components:

- **`Header.tsx`**: Removed in the desktop rewrite; replaced by `AppShell` TitleBar + SideNav.
- **`UrlInput.tsx`**: Input field for YouTube video URLs, clipboard paste action, and quick demo track buttons.
- **`VideoCard.tsx`**: Preview card displaying video thumbnail, creator information, view counts, and stream readiness.
- **`ConversionOptionsPanel.tsx`**: Single-section conversion panel: format grid, audio enhancement controls (loudness normalization, volume gain), album-cover/ID3 embed toggle, and the convert action.
- **`TagEditor.tsx`**: Music metadata editor and autotagger interface. Automatically searches online sources as the track name is typed, allowing one-click tag application and cover art selection.
- **`ConversionProgress.tsx`**: Real-time progress bar reflecting conversion steps (stream download, audio extraction, metadata embedding).
- **`AudioPlayer.tsx`**: Custom HTML5 audio player supporting play/pause, time scrubbing, volume adjustments, and loop repeat. Opus and M4A tracks play via their cached 320 kbps MP3 preview stream (`?preview=mp3`); all other formats stream natively.
- **`CookieModal.tsx`**: Configuration modal for YouTube session cookies to bypass bot detection.
