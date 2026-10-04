# Library Management

The Library tab is the on-disk collection of finished tracks. This page describes the index, pagination, import, trim, edit, artwork, and reveal flows.

## Index and pagination

`GET /api/library` returns `{ downloadsDir, records, looseFiles, totalSizeBytes, total, page, pageSize }`. `page` defaults to `1`; `pageSize` defaults to `100` and clamps to 1–200. Records persist in `data/library.json` with one row per file on disk. Folder-scan auto-indexing reuses the existing row when the path is already indexed, and a boot-time reconcile collapses duplicates and drops rows whose file no longer exists.

## Import

`POST /api/library/import` copies a local audio file (MP3, M4A, FLAC, WAV, Opus) into the library folder without transcoding and reads its embedded tags for the new record. Send the bytes as `application/octet-stream` (200 MB limit) with the file name in the `x-file-name` header, or as JSON `{ fileName, data }` with base64 `data`.

## Trim

`POST /api/library/:id/trim` cuts `[start, end)` in place with FFmpeg `-ss`/`-to` and overwrites the file. Body: `{ start: "0:15" | "15", end?: "2:45" | "" }`. A blank `end` keeps the tail. Start must sit before end and inside the track; violations return `400`. `GET /api/library/:id/probe` returns `{ durationSeconds, format, sizeBytes }` for the trim preview.

## Edit

`POST /api/library/:id/edit` edits a track in place. Body: `{ format, bitrate, volumeBoost, title, artist }`. `format` is one of `mp3`, `m4a`, `opus`, `flac`, `wav`; `volumeBoost` is one of `100`, `125`, `150`; `title` cannot be empty. Tags carry over with `-map_metadata 0` plus explicit title/artist overrides, and cover art is forwarded when muxable.

## Artwork and previews

`GET /api/library/:id/artwork` serves the embedded cover with a long immutable cache (`Cache-Control: public, max-age=31536000, immutable`). Opus and M4A tracks play through a cached VBR MP3 preview (`GET /api/stream/:id?preview=mp3`); other formats stream natively. Trim, edit, retag, and delete invalidate the preview for that track.

## Delete and reveal

`DELETE /api/library/:id` deletes the file and drops its index entry behind a confirm step; when the file is already gone it removes the entry and invalidates the preview. `POST /api/files/reveal` opens Explorer with the file selected; the body is `{ jobId }` (a job id or library record id) and the resolved path must sit inside the library folder.
