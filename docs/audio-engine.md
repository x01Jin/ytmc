# Audio Conversion & Stream Extraction Engine

The audio conversion engine is responsible for downloading YouTube media streams, extracting native audio streams bit-for-bit without lossy transcoding, re-encoding audio when filters are applied, slicing segments, applying DSP volume normalization, and writing ID3 metadata tags.

---

## 1. YouTube Audio Stream Realities & Native Extraction

YouTube servers host audio in two primary stream encodings:
- **Opus (`audio/webm`, format `251`)**: ~160 kbps (48 kHz sample rate) — YouTube's highest quality audio stream.
- **AAC (`audio/mp4`, format `140`)**: ~128 kbps (44.1 kHz sample rate) — Apple AAC audio stream.

> **Why 320 kbps MP3 is a Placebo:**  
> Any request claiming "320 kbps MP3" from YouTube merely upsamples the underlying ~160 kbps Opus or ~128 kbps AAC source audio. Upsampling does not add acoustic fidelity; it inflates file size and introduces lossy re-encoding generation artifacts.

### Native Direct Streamcopy (Recommended)
By default, the engine uses **Direct Streamcopy** (`format: best` or `format: opus` / `m4a` without filters):
- Directly extracts the highest available audio stream (`format 251` Opus or `format 140` AAC) from YouTube servers untouched.
- 0% transcoding generation loss.
- Minimal CPU usage and ultra-fast download speeds.

---

## 2. Supported Audio Formats & Codecs

| Format | Extension | Codec / Mode | Bitrate Behavior | Target Usage |
|--------|-----------|--------------|------------------|--------------|
| **Best (Native)** | `.opus` / `.m4a` | Direct Streamcopy | ~160k Opus / ~128k AAC | Highest fidelity native audio without transcoding loss. |
| **Opus** | `.opus` | Direct Streamcopy or `libopus` | ~160 kbps (48 kHz) | Direct streamcopy of YouTube format 251. |
| **M4A** | `.m4a` | Direct Streamcopy or `aac` | ~128 kbps (44.1 kHz) | Direct streamcopy of YouTube format 140 for Apple ecosystem. |
| **MP3** | `.mp3` | `libmp3lame` | Native (~160k), 128k, 192k, 256k, 320k | Universal legacy player compatibility. |
| **FLAC** | `.flac` | `flac` | Lossless Master (Level 0) | Archival, lossless audiophile playback wrapper. |
| **WAV** | `.wav` | `pcm_s16le` | Uncompressed Raw PCM | Audio production, DAWs, and sample editors. |

---

## 3. Audio Processing Pipeline & Streamcopy Coexistence

```
[YouTube Video Stream]
         │
         ▼
[yt-dlp Stream Demuxer (-f ba/b)]
         │ (optional: --download-sections "*start-end")
         ▼
[Raw Native Audio Stream (~160k Opus / ~128k AAC)]
         │
         ├───► [No Filters Active & Native Format (best/opus/m4a)]
         │           │
         │           ▼
         │     [Direct Streamcopy (-c copy)]
         │     0% Transcoding Loss
         │
         └───► [Filters Active (loudnorm / volume) OR Transcode Target (mp3/flac/wav)]
                     │
                     ▼
               [FFmpeg Re-Encoder with Explicit Codecs]
               ├─ Prevents streamcopy & filter conflicts
               ├─ Codec: libmp3lame / aac / libopus / flac / pcm_s16le
               ├─ Loudness Normalization (loudnorm EBU R128)
               └─ Volume Gain Filter (volume=1.25 / volume=1.50)
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

## 4. Audio Trimming & Section Selection

When users specify `trimStart` or `trimEnd`, the engine leverages yt-dlp's `--download-sections` parameter combined with `--force-keyframes-at-cuts`. This ensures:
- Only the requested segment of audio is downloaded from YouTube, saving bandwidth and execution time.
- Cut boundaries are aligned with keyframes to prevent audio clicks or cut-off transients.
- Start and end points accept both standard timestamp notations (`01:23` or `83`).

---

## 5. Volume Normalization & Boost

- **Loudness Normalization (`loudnorm`)**: Applies the EBU R128 standard to balance track volume without clipping.
- **Volume Boost**: For quiet YouTube videos, users can apply a linear gain factor (`125%` / `+2 dB` or `150%` / `+3.5 dB`) to elevate listening levels.
- **Encoder Safeguard**: When filters are enabled, the pipeline automatically supplies the appropriate encoder codec (`libopus`, `aac`, `libmp3lame`, `flac`, or `pcm_s16le`) to ensure FFmpeg never encounters conflicts between streamcopy (`-c copy`) and audio filters (`-af`).

---

## 6. Metadata & Album Artwork Embedding

The conversion service automatically extracts:
- Track Title
- Creator / Channel Name
- High-Resolution Album Artwork Thumbnail

When converting to MP3, M4A, or FLAC formats, the thumbnail image is encoded as a native cover art attachment (`APIC` ID3 frame) so that music players (like Apple Music, Spotify local files, VLC, or car dashboards) immediately display the artwork.
