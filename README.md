# YouTube to Music Converter

A clean, full-stack web application to convert YouTube videos to music files (MP3, M4A, FLAC, WAV, and Opus) and download them with embedded album cover art and ID3 metadata.

---

## Features

- **Multi-Source Music Autotagger**: Automatically detects and fetches official track metadata, album names, release years, genres, track numbers, and high-resolution cover artwork from iTunes, Deezer, and MusicBrainz as you type in the track name field.
- **Pre- & Post-Conversion Tag Editing**: Edit metadata before converting or update tags and artwork in-place on already converted files without re-downloading from YouTube.
- **Native Dark Theme**: Responsive dark and light theme toggle with persistent preferences in local storage and system color scheme auto-detection.
- **Multi-Format Audio Extraction**: Export in MP3 (up to 320 kbps), M4A (Apple AAC), FLAC (Lossless Master), WAV (Raw PCM), or Opus.
- **Audio Bitrate Control**: Select from 320 kbps (Extreme), 256 kbps (High Quality), 192 kbps (Standard), or 128 kbps (Compact).
- **Audio Segment Trimming**: Cut start and end times to download just a song segment or ringtone.
- **Loudness Normalization & Gain Boost**: Balance audio levels using EBU R128 (`loudnorm`) or apply volume gain boost.
- **Embedded Cover Art & ID3 Tags**: Encodes ID3v2.3, Vorbis comments, MP4 metadata atoms, and RIFF metadata with attached picture streams.
- **In-Browser Audio Player**: Preview converted audio with play, pause, seek, volume control, and looping before downloading.
- **Direct Attachment Downloads**: 1-click downloads directly to your device with sanitized filenames.
- **Automatic Session Provisioning & Challenge Solver**: Built-in edge session fetcher and Node.js challenge solver with PO Token support to bypass YouTube bot detection automatically without requiring browser extensions.
- **Session Cookie Authentication & Verification**: Integrated session manager with live connection testing and support for importing user account cookies for private or age-restricted tracks.
- **Conversion History**: Keeps track of recent conversions in your session for quick replay or re-download.

---

## Documentation Index

Comprehensive technical documentation is maintained in **[Documentation Index](docs/index.md)**

---

## Quick Start

```bash
# Install dependencies
npm install

# Start development server (http://127.0.0.1:3000 by default;
# override with PORT / HOST env vars or a local `.env` file)
npm run dev

# Build for production
npm run build

# Start production server (serves static `dist/` on a random free port
# by default; set PORT=3000 npm run start for a fixed port)
npm run start
```
