# Conversion History

The History tab is the recoverable record of every finished conversion. If a library file is lost or deleted, its source can always be found here and converted again.

## Row contents

Each row represents one completed job and shows:

- **Cover art** — the job thumbnail (40px), with an audio-icon fallback when no thumbnail exists.
- **Original title and artist** — the YouTube title and channel name as converted.
- **Copy link** — copies the canonical watch URL (`https://www.youtube.com/watch?v=<videoId>`) to the clipboard, with a brief checkmark confirmation.
- **Convert again** — sends the URL to the Convert tab, which pastes and inspects it automatically so conversion is one click away.

## Data source

Rows come from the recent-jobs endpoint (`GET /api/jobs`), filtered to `completed` status. The endpoint combines live jobs with completed conversion records from the persistent library index, so history remains available after the application restarts. Imported local files are marked as library-only records and are excluded from conversion history. The canonical URL is reconstructed from each conversion's `videoId`; no separate URL field is stored.

## Re-convert handoff

Re-convert uses a one-shot `pendingInspectUrl` field on the convert draft (`ConvertDraftProvider` in `src/store/appStore.tsx`). The History tab sets the draft URL, queues the inspect URL, and navigates to `#/convert`. The Convert route consumes the queued URL exactly once — pasting it into the input and running inspection — then clears it. The queued URL lives in memory only and is never written to `localStorage`.
