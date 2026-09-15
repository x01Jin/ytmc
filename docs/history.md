# Conversion History

The History tab is the recoverable record of every finished conversion. If a library file is lost or deleted, its source can always be found here and converted again.

## Row contents

Each row represents one completed job and shows:

- **Cover art** — the job thumbnail (40px), with an audio-icon fallback when no thumbnail exists.
- **Original title and artist** — the YouTube title and channel name as converted.
- **Copy link** — copies the canonical watch URL (`https://www.youtube.com/watch?v=<videoId>`) to the clipboard, with a brief checkmark confirmation.
- **Convert again** — sends the URL to the Convert tab, which pastes and inspects it automatically so conversion is one click away.
- **Remove** — deletes that entry from History only; the library file is untouched.

A **Clear** button in the header removes all entries behind a two-step confirm.

## Data source

Rows come from the history endpoint (`GET /api/history`), backed by the persistent log at `data/history.json`. One entry is appended when a Convert-tab conversion finishes, capturing the original YouTube title, channel, thumbnail, and canonical URL. The entry is frozen at that point: retagging, trimming, or reformatting the library file never alters it, and imported local files are never recorded. Deleting a library file keeps its History entry, so the source can still be re-converted.

## Re-convert handoff

Re-convert uses a one-shot `pendingInspectUrl` field on the convert draft (`ConvertDraftProvider` in `src/store/appStore.tsx`). The History tab sets the draft URL, queues the inspect URL, and navigates to `#/convert`. The Convert route consumes the queued URL exactly once — pasting it into the input and running inspection — then clears it. The queued URL lives in memory only and is never written to `localStorage`.
