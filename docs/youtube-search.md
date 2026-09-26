# YouTube Search & Preview

The YouTube tab (`#/youtube`) finds videos without leaving the app. Search returns up to 12 results per query. Each row offers preview playback, link copy, one-click handoff to Convert, and opening the video in a browser.

## Search

The search form sends the trimmed query to `GET /api/youtube/search?q=<text>&limit=12`. Queries are trimmed and capped at 120 characters. `limit` defaults to 12 and clamps to 1–25.

The backend runs `yt-dlp` with `ytsearch<N>:<query>` in flat-playlist JSON mode (`--dump-json --flat-playlist --no-playlist --skip-download`), using the active extraction strategy and cookies when the strategy allows them. Each output line parses into one result; entries without a valid 11-character video id are dropped.

Each result carries:

| Field                          | Description                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| `id`                           | 11-character YouTube video id.                                                          |
| `title`                        | Video title, or `YouTube Video (<id>)` when absent.                                     |
| `author`                       | Channel/uploader name, or `YouTube` when absent.                                        |
| `thumbnail`                    | Widest `thumbnails` entry, falling back to `https://i.ytimg.com/vi/<id>/hqdefault.jpg`. |
| `duration` / `durationSeconds` | Present when the search entry reports them.                                             |
| `viewCount`                    | Present when the search entry reports it.                                               |

Search requests are abortable: typing a new query aborts the in-flight request. An empty result set renders a `NO RESULTS` panel. Failures render the server error message. Bot-verification failures return `502` with guidance to import browser cookies or auto-fetch a fresh session in Session Settings.

## Row actions

Each result row shows the thumbnail, title, author, and duration, plus four buttons:

- **Preview video** (`Play`/`X` toggle): opens or closes the preview modal for that row.
- **Copy YouTube link**: writes `https://www.youtube.com/watch?v=<videoId>` to the clipboard and shows a checkmark for 2 seconds.
- **Send to Convert** (`Download` icon): writes the canonical watch URL into the convert draft, queues it as the one-shot inspect URL, and navigates to `#/convert`. The Convert tab pastes the URL and runs inspection exactly once, then clears the queued URL.
- **Open in browser**: opens the canonical watch URL through the desktop shell (`window.desktop.openExternal`) when running in Electron, otherwise in a new tab (`noopener,noreferrer`).

## Preview modal

The modal (`YouTubePreviewModal`) embeds the video with `https://www.youtube-nocookie.com/embed/<videoId>?autoplay=1&rel=0` in a sandboxed iframe (`allow-scripts allow-same-origin allow-presentation allow-popups`). It shows the result title, author, and duration, closes on backdrop click or `Escape`, and renders only while the YouTube route is active.

This preview is a YouTube embed of the remote video. It is separate from converted-file playback: Opus and M4A library tracks play through a cached MP3 transcode described in [Audio Conversion Engine](audio-engine.md).
