# Music Tagging & Autotagger Architecture

This document describes the music tagging, metadata manipulation, and multi-source autotagging features of the YouTube to Music Converter.

---

## 1. Overview

YouTube video titles typically contain extraneous formatting such as "(Official Music Video)", "[HD]", "ft.", or release channel notes. The Music Tagging system enables users to clean, inspect, customize, and automatically match standard ID3/audio metadata from music databases, embedding cover art and tags directly into the audio container (MP3, M4A, FLAC, Opus, WAV).

---

## 2. Supported Tags & Fields

The application supports standard metadata fields defined in `src/types.ts`:

| Field         | Tag Type / Frame                                 | Description                                             |
| ------------- | ------------------------------------------------ | ------------------------------------------------------- |
| `title`       | Track Title (`TIT2` / `©nam` / `TITLE`)          | Name of the track or song.                              |
| `artist`      | Primary Artist (`TPE1` / `©ART` / `ARTIST`)      | Performing musician, band, or creator.                  |
| `album`       | Album Title (`TALB` / `©alb` / `ALBUM`)          | Album, EP, or Single release name.                      |
| `albumArtist` | Album Artist (`TPE2` / `aART` / `ALBUMARTIST`)   | Primary artist for compilation/album organization.      |
| `year`        | Release Year (`TYER` / `TDRC` / `©day` / `DATE`) | Four-digit release year (e.g. `1987`).                  |
| `genre`       | Musical Genre (`TCON` / `©gen` / `GENRE`)        | Musical genre classification (e.g. `Pop`, `Rock`).      |
| `trackNumber` | Track Index (`TRCK` / `trkn` / `TRACKNUMBER`)    | Track position within the album (e.g. `1` or `1/12`).   |
| `coverUrl`    | Front Cover Art (`APIC` / `covr` / `PICTURE`)    | URL or file source for high-resolution album cover art. |
| `comment`     | User Comment (`COMM` / `©cmt` / `COMMENT`)       | Optional notes, encoder attribution, or track info.     |

---

## 3. Autotagging & Multi-Source Search

### External Music Metadata Sources (`server/services/tagFetcherService.ts`)

The autotagger can search individual sources or aggregate results simultaneously across:

- **iTunes Search API**: High-quality metadata, album names, release years, and up to 1000x1000 resolution cover art.
- **Deezer API**: Extensive international catalog with high-resolution album artwork (`xl` 1000x1000).
- **MusicBrainz**: Open community music encyclopedia providing canonical release and artist classifications.
- **All Sources (`all`)**: Concurrently queries all upstream providers and aggregates candidates, sorting by relevance and title matching score.

### Trigger Behavior

- Autotagging is triggered directly when entering or editing text in the **Track Name** input field (debounced by 450ms).
- Users can choose any matched candidate card with one click to populate all fields and high-resolution cover artwork.
- Each candidate also offers an artwork-only action when the user wants to change the cover without changing the album or other tags.
- Users can choose an image from the local computer. The image is sent only with the tag-write request and is not stored in the library index as a data URL.

---

## 4. Tag Injection Workflow

1. **Conversion-Time Stamping**:
   - Conversion writes only YouTube-native identity: title, uploader as artist, and the video thumbnail as cover art (when the embed toggle is on). No autotagger lookup runs during conversion.
   - Job, library, and history names always match the YouTube title and channel.

2. **Post-Conversion Tagging**:
   - In the Library tab, expanding a track's Edit panel opens the tag editor, including the multi-source autotagger.
   - When saved, the server runs in-place metadata rewriting via `POST /api/tags/apply/:id`, updating the audio container, artwork, and filename without re-downloading from YouTube.
   - Artwork can come from a fetched candidate URL or a local image data URL (limited to 8 MB); supported artwork containers are MP3, M4A, and FLAC.

---

## 5. FFmpeg Container Metadata Encoding

The audio tag service (`server/services/audioTagService.ts`) handles format-specific metadata mapping:

- **MP3**: Encodes ID3v2.3 tags (`-id3v2_version 3`) for universal player compatibility. If cover artwork is provided, it embeds an attached picture video stream (`-c:v copy -metadata:s:v title="Album cover" -metadata:s:v comment="Cover (front)" -disposition:v:0 attached_pic`).
- **M4A / AAC**: Encodes standard MP4 metadata atoms (`-movflags +faststart`).
- **FLAC**: Embeds Vorbis comments with uncompressed stream data.
- **Opus**: Encodes Ogg Vorbis comment fields.
- **WAV**: Encodes standard RIFF `INFO` chunks.

---

## 6. Dark Theme

The application includes full native dark mode:

- Controlled via the `dark` class on the root HTML element.
- Tailwind CSS `dark:` variant utilities throughout all components.
- Persistent state saved to `localStorage` under `theme` (`'light'` or `'dark'`).
- System color scheme detection on initial visit with seamless manual toggling in the header.
