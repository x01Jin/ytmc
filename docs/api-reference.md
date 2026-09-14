# API Reference

This document provides the full REST API specification for the YouTube to Music Converter backend service.

---

## 1. Video Inspection

### `GET /api/info`
Fetches video metadata and inspects available YouTube native audio streams for a given URL or video ID.

#### Query Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | `string` | Yes | YouTube video URL, short URL (`youtu.be`), or 11-character video ID. |

#### Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "id": "dQw4w9WgXcQ",
    "title": "Rick Astley - Never Gonna Give You Up (Official Video)",
    "author": "Rick Astley",
    "authorUrl": "https://www.youtube.com/@RickAstleyYT",
    "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    "duration": "3:33",
    "durationSeconds": 213,
    "viewCount": 1600000000,
    "isAvailable": true,
    "botVerificationRequired": false,
    "hasCookiesConfigured": true,
    "bestNativeStream": {
      "formatId": "251",
      "codec": "Opus",
      "bitrateKbps": 160,
      "container": "webm",
      "sampleRateHz": 48000,
      "channels": 2,
      "note": "Opus ~160 kbps (webm) • 48kHz"
    }
  }
}
```

---

## 2. Audio Conversion & Direct Stream Extraction

### `POST /api/convert`
Initiates an asynchronous audio extraction or conversion job. When `format` is `"best"`, `"opus"`, or `"m4a"` (without audio filters), direct streamcopy is used to pull the highest fidelity native YouTube stream with 0% transcoding loss.

#### Request Body
```json
{
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "format": "best",
  "bitrate": "native",
  "trimStart": "00:00",
  "trimEnd": "00:30",
  "volumeBoost": 100,
  "normalizeAudio": false,
  "embedThumbnail": true
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `url` | `string` | Required | YouTube video URL or ID. |
| `format` | `string` | `"best"` | One of: `"best"`, `"opus"`, `"m4a"`, `"mp3"`, `"flac"`, `"wav"`. |
| `bitrate` | `string` | `"native"` | One of: `"native"` (~160k source match), `"128k"`, `"192k"`, `"256k"`, `"320k"`. |
| `trimStart` | `string` | Optional | Start timestamp (`"MM:SS"` or seconds integer). |
| `trimEnd` | `string` | Optional | End timestamp (`"MM:SS"` or seconds integer). |
| `volumeBoost` | `number` | `100` | Volume percentage (`100`, `125`, `150`). |
| `normalizeAudio` | `boolean` | `false` | Apply EBU R128 loudness normalization (`loudnorm`). |
| `embedThumbnail` | `boolean` | `true` | Embed album artwork cover and ID3 tags. |

#### Response (`200 OK`)
```json
{
  "success": true,
  "job": {
    "id": "feb897d7-b7da-4e0e-abb7-552529ff67af",
    "videoId": "dQw4w9WgXcQ",
    "title": "Rick Astley - Never Gonna Give You Up",
    "author": "Rick Astley",
    "thumbnail": "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    "format": "best",
    "bitrate": "native",
    "status": "downloading",
    "progress": 5,
    "stageMessage": "Fetching highest native audio stream directly from YouTube (~160k Opus / ~128k AAC)...",
    "createdAt": 1789325347990
  }
}
```

---

## 3. Job Status Polling

### `GET /api/status/:id`
Retrieves current progress and status for a specific conversion job.

#### Path Parameters
| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | `string` | Unique UUID of the conversion job. |

#### Response (`200 OK`)
```json
{
  "success": true,
  "job": {
    "id": "feb897d7-b7da-4e0e-abb7-552529ff67af",
    "status": "completed",
    "progress": 100,
    "stageMessage": "Highest native audio stream extracted bit-for-bit (~160k Opus)!",
    "format": "opus",
    "outputFileName": "Rick Astley - Never Gonna Give You Up.opus",
    "fileSizeBytes": 4210533,
    "downloadUrl": "/api/download/feb897d7-b7da-4e0e-abb7-552529ff67af",
    "streamUrl": "/api/stream/feb897d7-b7da-4e0e-abb7-552529ff67af",
    "completedAt": 1789325352280
  }
}
```

---

## 4. Audio Streaming & Downloading

### `GET /api/stream/:id`
Streams the extracted audio file for in-browser playback. Supports HTTP Range requests (`HTTP 206 Partial Content`) for instant audio scrubbing and buffering.

### `GET /api/download/:id`
Downloads the audio file directly to the client's file system with clean `Content-Disposition: attachment` headers and sanitized file names.

---

## 5. Session Authentication & Verification

### `GET /api/cookies`
Checks current session status and loaded cookie metadata.

#### Response (`200 OK`)
```json
{
  "success": true,
  "data": {
    "configured": true,
    "isAccountSession": false,
    "isGuestSession": true,
    "sizeBytes": 3425,
    "lineCount": 23,
    "lastModified": "2026-09-13T19:04:00.000Z",
    "sampleDomains": ["youtube.com"]
  }
}
```

### `POST /api/cookies/auto-fetch`
Automatically provisions fresh guest visitor session cookies directly from YouTube's edge API.

### `POST /api/cookies/test`
Runs live end-to-end verification of active session cookies, Node.js JavaScript challenge solver, and PO Token provider against YouTube.

### `POST /api/cookies`
Stores YouTube session cookies in Netscape format or JSON format.

### `DELETE /api/cookies`
Purges existing session and guest cookies from the server.

---

## 6. Music Tagging & Autotagger

### `GET /api/tags/search`
Searches online music databases for track metadata and high-resolution album artwork matching the provided track name and optional artist.

#### Query Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `q` | `string` | Yes | Track title or search query. |
| `artist` | `string` | No | Optional artist name to refine results. |
| `source` | `string` | No | Metadata provider: `"all"` (default), `"itunes"`, `"deezer"`, or `"musicbrainz"`. |

#### Response (`200 OK`)
```json
{
  "success": true,
  "data": [
    {
      "source": "itunes",
      "title": "Never Gonna Give You Up",
      "artist": "Rick Astley",
      "album": "Whenever You Need Somebody",
      "albumArtist": "Rick Astley",
      "year": "1987",
      "genre": "Pop",
      "trackNumber": "1",
      "coverUrl": "https://is1-ssl.mzstatic.com/image/thumb/Music125/v4/ec/3b/b7/ec3bb74f-d897-4cba-eef2-06b231804f5e/source/1000x1000bb.jpg"
    }
  ]
}
```

---

### `POST /api/tags/apply/:id`
Applies custom or fetched music metadata and album cover art in-place to an already converted audio file.
