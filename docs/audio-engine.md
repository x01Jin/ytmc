# Audio Conversion & Stream Extraction Engine

You request a song. The engine downloads the native audio stream, re-encodes only when your filters or target format demand it, then tags the file.

---

## 1. YouTube Audio Sources

YouTube serves two audio streams:

- **Opus (format `251`)**: ~160 kbps at 48 kHz. Best available.
- **AAC (format `140`)**: ~128 kbps at 44.1 kHz. Fallback for the Apple ecosystem.

A "320 kbps MP3" from YouTube upsamples one of these sources. Upsampling adds no fidelity. It grows the file and stacks a lossy generation on top.

### Native Direct Streamcopy

Default for best/opus/m4a with no filters. The engine pulls format 251 or 140 and writes it with `-c copy`. Zero transcoding loss, minimal CPU, fastest downloads.

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
         │     [Direct Streamcopy (-c copy)]
         │     0% Transcoding Loss
         │
          └───► [Filters Active (loudness / peak-safe / volume) OR Transcode Target (mp3/flac/wav)]
                      │
                      ▼
                [FFmpeg Re-Encoder with Explicit Codecs]
                ├─ Codec: libmp3lame / aac / libopus / flac / pcm_s16le
                ├─ Loudness mode (two-pass linear EBU R128, uniform gain)
                └─ Peak-safe mode (aresample + alimiter at −1 dBTP)
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

## 5. Volume Normalization & Boost

Single source of truth: `server/services/audioFilterService.ts` (`AUDIO_DSP` constants plus `measureLoudness()`, `linearGainFilter()`, `transcodeWithLinearLoudness()`, `buildAudioFilters()`). Convert and library edit share these helpers. No duplicated filter strings.

- **Loudness mode (two-pass uniform gain, target −14 LUFS / −1 dBTP)**:
  Pass 1 measures EBU R128 stats. Pass 2 applies one static `volume` gain = min(target − measured, TP − measuredTP − 1 dB headroom, +12 dB max boost), then `aresample` and a peak-only safety `alimiter`. A static multiplier cannot pump or compress. LRA survives intact and quiet intros stay proportionally quiet. Physics sets the trade-off: peak-capped material lands below −14 LUFS instead of getting squashed, and the +12 dB cap keeps near-silence from turning into noise. The job message reports the result (e.g. "−20.4 LUFS with a uniform +4.5 dB gain"). Conversions download the native stream first and run both passes locally (measurement cannot run inside yt-dlp's one-shot transcode). One transcode total. Failed measurement falls back to single-pass `loudnorm`.
- **Peak-safe mode (`[volume=…,]aresample=48000,alimiter=limit=0.891251:attack=7:release=100:level=disabled:asc=0`)**:
  Never boosts silence. Holds −1 dBTP (≈0.891251 linear). `level=disabled` carries the whole mode: enabled, alimiter re-levels output to 0 dB and re-boosts quiet sections (the original bug). Optional volume gain (125% / 150%) runs before the limiter, so boosted peaks still cannot clip. Single pass inside yt-dlp args.
- **Off + volume gain**: bare `volume=1.25 / 1.50` for quiet uploads. Zero other processing.
- **Encoder safeguard**: active filters force an explicit encoder (`libopus`, `aac`, `libmp3lame`, `flac`, `pcm_s16le`), so `-c copy` and `-af` never collide.
- **Previews** carry no DSP. See section 7.

Tuning: edit `AUDIO_DSP`. The backend owns the chain. `src/utils/normalizeModes.ts` mirrors labels for display only.

---

## 6. Metadata & Album Artwork

Each conversion pulls track title, channel name, and hi-res thumbnail. MP3/M4A/FLAC take native attached pictures. Opus needs a workaround: the Ogg muxer rejects mapped video streams, so the engine writes a `METADATA_BLOCK_PICTURE` sidecar (base64 FLAC Picture block through ffmetadata, dodging command-line length limits). The muxer stores it as an `attached_pic` mjpeg stream.

Library edits (format change, trim, loudness) keep tags with `-map_metadata 0` plus explicit title/artist overrides, and forward cover art. An unmuxable cover retries audio-only and reports `coverDropped: true` instead of failing.

---

## 7. In-App Preview Playback

Stored files and previews split duties. Opus and M4A stay native on disk. Downloads (`GET /api/download/:id`), tag edits, and trims touch originals only.

Browsers and the Electron shell cannot decode those containers, so those two formats get a cached MP3 for the player (`GET /api/stream/:id?preview=mp3`). MP3, FLAC, and WAV stream natively with no preview involved.

Preview encoding runs raw: `libmp3lame -q:a 0` (VBR, highest quality mode), audio stream only. No cover art, no filters, no resampling. A listening copy that keeps second-generation loss minimal.

The cache lives at `data/previews/<sha1(jobId)>.preview.mp3`, built on first playback. Mtime/size validation against the source regenerates it after trims, retags, format changes, and reconversion. Deleting a track removes its preview.
