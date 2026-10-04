# Audio Conversion & Stream Extraction Engine

You request a song. The engine downloads the native audio stream, re-encodes only when your filters or target format demand it, then tags the file.

---

## 1. YouTube Audio Sources

YouTube serves two audio streams:

- **Opus (format `251`)**: ~160 kbps at 48 kHz. Best available.
- **AAC (format `140`)**: ~128 kbps at 44.1 kHz. Fallback for the Apple ecosystem.

A "320 kbps MP3" from YouTube upsamples one of these sources. Upsampling adds no fidelity. It grows the file and stacks a lossy generation on top.

### Native Direct Streamcopy

Default for best/opus/m4a with no filters. The engine pulls the native YouTube audio stream through yt-dlp audio extraction and writes it without an FFmpeg audio filter chain. Zero filter loss, minimal CPU, fastest downloads.

---

## 2. Supported Formats

| Format            | Extension        | Codec / Mode                   | Bitrate Behavior                       | Target Usage                             |
| ----------------- | ---------------- | ------------------------------ | -------------------------------------- | ---------------------------------------- |
| **Best (Native)** | `.opus` / `.m4a` | Direct Streamcopy              | ~160k Opus / ~128k AAC                 | Highest fidelity, no transcoding loss.   |
| **Opus**          | `.opus`          | Direct Streamcopy or `libopus` | ~160 kbps (48 kHz)                     | Direct streamcopy of YouTube format 251. |
| **M4A**           | `.m4a`           | Direct Streamcopy or `aac`     | ~128 kbps (44.1 kHz)                   | Direct streamcopy of YouTube format 140. |
| **MP3**           | `.mp3`           | `libmp3lame`                   | Native (~160k), 128k, 192k, 256k, 320k | Universal legacy player compatibility.   |
| **FLAC**          | `.flac`          | `flac`                         | Lossless Master (Level 0)              | Archival, lossless audiophile playback.  |
| **WAV**           | `.wav`           | `pcm_s16le`                    | Uncompressed Raw PCM                   | Audio production, DAWs, sample editors.  |

Filtered Opus and M4A pin `libopus` at `160k` and `aac` at `128k` with the gain filter appended. Filtered MP3 pins `libmp3lame` with the gain filter and no explicit `-b:a`.

---

## 3. Processing Pipeline

```
[YouTube Video Stream]
         │
         ▼
[yt-dlp Stream Demuxer (-f ba/b)]
         │ (optional: --download-sections "*start-end")
         ▼
[Raw Native Audio Stream (~160k Opus / ~128k AAC)]
         │
         ├───► [No Filters & Native Format (best/opus/m4a)]
         │           │
         │           ▼
         │     [Direct Extraction (--extract-audio)]
         │     No FFmpeg filter chain
         │
          └───► [Filters Active (volume gain) OR Transcode Target (mp3/flac/wav)]
                      │
                      ▼
                [FFmpeg Re-Encoder with Explicit Codecs]
                ├─ Codec: libmp3lame / aac / libopus / flac / pcm_s16le
                └─ Volume gain: volume=1.25 / 1.50
                      │
                      ▼
[Metadata Tagging & Cover Artwork Injection]
         ├─ ID3v2 Tags (Title, Artist, Album, Year, Genre)
         └─ JPEG/PNG Cover Art Embedding
                     │
                     ▼
[Final Output Audio File]
```

---

## 4. Trimming

Pass `trimStart`/`trimEnd` as `01:23` or `83`. The engine forwards them to yt-dlp `--download-sections` with `--force-keyframes-at-cuts`. YouTube sends only the segment you asked for, which saves bandwidth and time, and keyframe-aligned cuts avoid clicks and clipped transients.

---

## 5. Volume Gain

Single source of truth: `server/services/audioFilterService.ts` (`AUDIO_DSP.VOLUME.ALLOWED = [100, 125, 150]`, `buildAudioFilters()`, `codecForTarget()`). Convert and library edit share these helpers.

- **Off + volume gain**: bare `volume=1.25 / 1.50` for quiet uploads. `100` applies no filter. Zero other processing.
- **Encoder mapping**: `codecForTarget()` pins the encoder per target (`mp3` to `libmp3lame` at `160k` or the selected bitrate, `m4a` to `aac` at `128k`, `opus` to `libopus` at `160k`, `flac` to `flac`, `wav` to `pcm_s16le`), so an active filter never collides with a copy path.
- **Previews** carry no gain. See section 7.

---

## 6. Metadata & Album Artwork

Each conversion pulls track title, channel name, and hi-res thumbnail. MP3/M4A/FLAC take native attached pictures. Opus needs a workaround: the Ogg muxer rejects mapped video streams, so the engine writes a `METADATA_BLOCK_PICTURE` sidecar (base64 FLAC Picture block through ffmetadata, dodging command-line length limits). The muxer stores it as an `attached_pic` mjpeg stream.

Library edits (format change, trim, gain) keep tags with `-map_metadata 0` plus explicit title/artist overrides, and forward cover art. An unmuxable cover retries audio-only and reports `coverDropped: true` instead of failing. WAV cannot carry embedded cover art: replacing cover art on a WAV file returns a `CoverUnsupportedError` and writes nothing. Cover images larger than 8 MB (`COVER_MAX_BYTES` in `server/services/audioMetadata.ts`) are rejected.

Library trim cuts `[start, end)` with FFmpeg `-ss`/`-to` and re-encodes the segment in place, separate from the Convert-tab `--download-sections` path.

---

## 7. In-App Preview Playback

Stored files and previews split duties. Opus and M4A stay native on disk. Downloads (`GET /api/download/:id`), tag edits, and trims touch originals only.

Browsers and the Electron shell cannot decode those containers, so those two formats get a cached MP3 for the player (`GET /api/stream/:id?preview=mp3`). MP3, FLAC, and WAV stream natively with no preview involved.

Preview encoding runs raw: `libmp3lame -q:a 0` (VBR, highest quality mode), audio stream only. No cover art, no filters, no resampling. A listening copy that keeps second-generation loss minimal.

The cache lives at `data/previews/<sha1(jobId)>.preview.mp3`, built on first playback. Mtime/size validation against the source regenerates it after trims, retags, format changes, and reconversion. Deleting a track removes its preview.

This section covers playback of converted library files only. Previewing remote YouTube videos before conversion is a separate embed player described in [YouTube Search & Preview](youtube-search.md).
