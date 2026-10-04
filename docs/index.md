# YouTube to Music Converter Documentation

Welcome to the technical documentation for **YouTube to Music Converter**, an application designed to search YouTube in-app and extract and convert YouTube audio into high-fidelity music formats (MP3, M4A, FLAC, WAV, and Opus) with custom bitrates, trimming, volume normalization, and ID3 tag embedding.

---

## Documentation Modules

Explore the documentation guides below:

1. **[Architecture Overview](architecture.md)**  
   Detailed breakdown of the full-stack architecture, modular service design, single-purpose scripting patterns, and lifecycle management.

2. **[API Reference](api-reference.md)**
   Complete specifications for all REST API endpoints (`/api/info`, `/api/youtube/search`, `/api/convert`, `/api/status`, `/api/cancel`, `/api/jobs`, `/api/stream`, `/api/download`, `/api/cookies`, `/api/demo-tracks`, `/api/library`, `/api/tags`, `/api/settings`, `/api/files/reveal`, `/api/history`).

3. **[Audio Conversion Engine](audio-engine.md)**  
   How the audio pipeline processes streams, executes FFmpeg encoding, manages variable/constant bitrates, cuts segments, and injects ID3 tags and album cover art.

4. **[Music Tagging & Autotagger](music-tagging.md)**  
   Detailed guide to ID3/audio metadata editing, multi-source autotagging (iTunes, Deezer, MusicBrainz), and dark theme implementation.

5. **[Session Authentication & Cookie Management](session-authentication.md)**  
   How the application manages YouTube session cookies to bypass datacenter IP restrictions and ensure consistent audio downloads.

6. **[Conversion History](history.md)**  
   How finished conversions are recorded with cover art and source links, and how the one-click re-convert handoff to the Convert tab works.

7. **[YouTube Search & Preview](youtube-search.md)**  
   How in-app YouTube search, embed preview, link copy, Convert handoff, and open-in-browser work.

8. **[Startup & Performance](startup-performance.md)**
   How the instant splash window, listen-first backend boot, readiness flags, lazy routes, and deferred provider fetches keep cold start and runtime cost low.

9. **[Job Lifecycle & Queue](job-lifecycle.md)**
   How conversion jobs move through queued, downloading, converting, completed, and error states, with polling, cancellation, and retention.

10. **[Library Management](library-management.md)**
    How the on-disk library index, pagination, import, trim, edit, artwork, and reveal flows work.
