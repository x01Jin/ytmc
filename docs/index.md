# YouTube to Music Converter Documentation

Welcome to the technical documentation for **YouTube to Music Converter**, an application designed to extract and convert YouTube audio into high-fidelity music formats (MP3, M4A, FLAC, WAV, and Opus) with custom bitrates, trimming, volume normalization, and ID3 tag embedding.

---

## Documentation Modules

Explore the documentation guides below:

1. **[Architecture Overview](architecture.md)**  
   Detailed breakdown of the full-stack architecture, modular service design, single-purpose scripting patterns, and lifecycle management.

2. **[API Reference](api-reference.md)**  
   Complete specifications for all REST API endpoints (`/api/info`, `/api/convert`, `/api/status`, `/api/stream`, `/api/download`, `/api/cookies`, `/api/demo-tracks`).

3. **[Audio Conversion Engine](audio-engine.md)**  
   How the audio pipeline processes streams, executes FFmpeg encoding, manages variable/constant bitrates, cuts segments, and injects ID3 tags and album cover art.

4. **[Music Tagging & Autotagger](music-tagging.md)**  
   Detailed guide to ID3/audio metadata editing, multi-source autotagging (iTunes, Deezer, MusicBrainz), and dark theme implementation.

5. **[Session Authentication & Cookie Management](session-authentication.md)**  
   How the application manages YouTube session cookies to bypass datacenter IP restrictions and ensure consistent audio downloads.
