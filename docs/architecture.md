# Architecture Overview

The YouTube to Music Converter is structured as a full-stack web application combining a Node.js Express server with a React 18 + Vite frontend.

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, Lucide Icons
- **Backend**: Node.js, Express, `yt-dlp`, FFmpeg
- **Persistence**: In-memory job state machine, local file streaming

```
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

| File                                   | Purpose                                                                             |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| `server/config.ts`                     | Centralized constants, binary paths, output directories, and supported formats.     |
| `server/services/urlService.ts`        | Pure URL and ID parsing, extraction, and canonicalization.                          |
| `server/services/metadataService.ts`   | Video metadata retrieval combining YouTube oEmbed and yt-dlp inspection.            |
| `server/services/tagFetcherService.ts` | Multi-source music autotagging querying iTunes, Deezer, and MusicBrainz.            |
| `server/services/audioTagService.ts`   | ID3, Vorbis, MP4 atom, and RIFF metadata injection with cover artwork using FFmpeg. |
| `server/services/conversionService.ts` | Audio extraction pipeline orchestrating `yt-dlp` and `ffmpeg`.                      |
| `server/services/jobManager.ts`        | In-memory job state machine, progress tracking, and file lifecycle cleanup.         |
| `server/services/cookieService.ts`     | Netscape/JSON cookie parsing, verification, and file persistence.                   |
| `server/utils/titleCleaner.ts`         | Heuristic cleaner stripping boilerplate tags and extracting artist/track names.     |
| `server/utils/mime.ts`                 | Fast audio MIME-type resolution for streaming and downloads.                        |
| `server/routes/api.ts`                 | Express router exposing the public REST API surface.                                |
| `server.ts`                            | Application entry point mounting Vite middleware and listening on `0.0.0.0:3000`.   |

---

## Frontend Architecture

The frontend is constructed with focused React components:

- **`Header.tsx`**: Displays application branding, theme switcher (dark/light), conversion engine indicators, and session cookie status.
- **`UrlInput.tsx`**: Input field for YouTube video URLs, clipboard paste action, and quick demo track buttons.
- **`VideoCard.tsx`**: Preview card displaying video thumbnail, creator information, view counts, and stream readiness.
- **`ConversionOptionsPanel.tsx`**: Tabbed configuration panel toggling between audio format settings (MP3, M4A, FLAC, WAV, Opus) and metadata tag editor.
- **`TagEditor.tsx`**: Music metadata editor and autotagger interface. Automatically searches online sources as the track name is typed, allowing one-click tag application and cover art selection.
- **`ConversionProgress.tsx`**: Real-time progress bar reflecting conversion steps (stream download, audio extraction, metadata embedding).
- **`AudioPlayer.tsx`**: Custom HTML5 audio player supporting play/pause, time scrubbing, volume adjustments, and loop repeat.
- **`DownloadSection.tsx`**: Direct download interface providing file metadata, file size, direct download links, and post-conversion tag editing.
- **`HistoryList.tsx`**: Session conversion library allowing instant re-playback and downloads.
- **`CookieModal.tsx`**: Configuration modal for YouTube session cookies to bypass bot detection.
