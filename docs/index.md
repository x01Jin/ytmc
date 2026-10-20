# YouTube to Music Converter Documentation

Technical documentation for **YouTube to Music Converter**, a Windows desktop app that searches YouTube and extracts audio into MP3, M4A, FLAC, WAV, or Opus files with volume gain, library trimming, autotagging, and cover art.

## Documentation modules

1. **[Architecture Overview](architecture.md)**  
   The Electron shell, Express backend, React frontend, backend modules, and process lifecycle.

2. **[API Reference](api-reference.md)**
   REST endpoints (`/api/info`, `/api/youtube/search`, `/api/convert`, `/api/status`, `/api/cancel`, `/api/jobs`, `/api/stream`, `/api/download`, `/api/cookies`, `/api/library`, `/api/tags`, `/api/settings`, `/api/files/reveal`, `/api/history`).

3. **[Audio Conversion Engine](audio-engine.md)**  
   How the pipeline processes streams, invokes FFmpeg, applies trims and gain, and writes tags and cover art.

4. **[Music Tagging & Autotagger](music-tagging.md)**  
   ID3 and audio metadata editing, multi-source autotagging (iTunes, Deezer, MusicBrainz), and the dark theme.

5. **[Session Authentication & Cookie Management](session-authentication.md)**  
   How the app manages YouTube session cookies and PO tokens.

6. **[Conversion History](history.md)**  
   How finished conversions are recorded with cover art and source links, and how re-convert works.

7. **[YouTube Search & Preview](youtube-search.md)**  
   In-app search, embed preview, link copy, Convert handoff, and open-in-browser.

8. **[Startup & Performance](startup-performance.md)**
   Splash behavior, backend readiness, lazy routes, and deferred provider fetches.

9. **[Job Lifecycle](job-lifecycle.md)**
   Conversion job states, polling, cancellation, and retention.

10. **[Library Management](library-management.md)**
    The on-disk library index, import, trim, edit, artwork, and reveal flows.

11. **[Desktop Updates](app-updates.md)**
    How the portable Windows build checks GitHub releases, verifies signed archives, swaps the install folder, and rolls back on failure.
