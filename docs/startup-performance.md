# Startup & Performance

## Instant window

The desktop shell opens one window as the first act of `boot()`, before IPC registration, CSP setup, or any backend work. It paints the splash immediately, then the backend spawns only after splash paint (or a 5s paint timeout), so engine processes never contend with first paint. When `waitForServer()` resolves, the same window navigates to the app URL. A backend failure reports the failure text on the splash status line and quits the app.

## Splash screen

`public/splash.html` is a single self-contained file (styles inline, no external CSS) that renders with no backend dependency:

- App icon, pixelated.
- `YTMC` in the display face, one `span` per letter, each letter jumping in sequence on a stepped loop with a staggered delay.
- `YouTube to Music Converter` below the animated letters, smaller.
- App version below the full title, smaller and dimmed. Main passes `app.getVersion()` as the `?v=` query value on `loadFile`; an empty value renders nothing.
- Stepped indeterminate progress bar plus a status line. Main sends `splash:status` messages (`Starting backend…`, `Probing engine…`, `Loading library…`, or the failure text). The preload bridge exposes `window.splash.onStatus`.
- The frameless window drags via a `drag` region on the page root.
- `prefers-reduced-motion` disables the letter jump and the bar slide.

## Packaging and app data

Windows ships one artifact: the zip archive. It is extracted once by hand and launches from disk with no per-launch extraction.

Packaged runs keep all generated files next to the executable: the main process points `userData` at `<exe-dir>/data` (the executable's own directory; dev runs are unaffected), falling back to the default location when it is not writable, and the server inherits it, so cookies, library, history, settings, session cache, yt-dlp cache, and logs live beside the exe. The app name is set explicitly so any fallback path uses `%APPDATA%\YT Music Converter`, never the package slug. The downloads folder is the only outside write.

## Listen-first backend boot

`startServer()` builds the Express app, registers guards, API routes, `/api/health`, and static serving, then calls `app.listen()` before any engine work. After the port binds and `PORT_READY=` prints, `runBackgroundProbes()` executes:

- `ensureYtDlp()` and `ensureFfmpeg()` concurrently (8s and 5s per-probe timeouts).
- `refreshSidecarReachability()` for the POT sidecar.
- `FileService.sweepPartFiles()` and `LibraryStore.reconcile()` (single index read, single conditional write).

## Readiness flags

`GET /api/health` returns the loopback token plus readiness:

```json
{
  "status": "ok",
  "time": "2026-09-27T00:00:00.000Z",
  "loopbackToken": "<per-process uuid>",
  "readiness": {
    "ytDlp": true,
    "ffmpeg": true,
    "pot": false,
    "library": true
  }
}
```

`ytDlp`, `ffmpeg`, and `pot` are `null` while their probe is still running, `true` when ready, `false` when unavailable. `library` is `false` until the reconcile pass completes. The status bar treats `null` as pending rather than failure. Conversion and inspection paths work before probes finish; they use the cached launch config and the POT fallback strategy when the sidecar is absent.

## Static caching

Hashed production assets serve with long immutable caching and ETags. `index.html` serves with `no-store` so clients always pick up the newest bundle. JSON body limits are 1mb.

## Lazy frontend

The Convert route and the app shell load eagerly. YouTube, Library, History, Queue, and Settings load on first navigation behind a skeleton fallback; the YouTube route stays mounted under `hidden` when inactive. The session cookie modal, the YouTube preview modal, and the library edit panel (with the tag editor) load only when opened.

## Deferred provider fetches

- Jobs: no mount fetch; the queue refreshes explicitly on conversion events.
- History: mount fetch deferred to idle so first paint never waits for the log.
- Session: status loads at mount for the status dot; the guest auto-fetch chain waits two seconds.
- Settings and library: load at mount; settings serve the cached copy first and revalidate.
- Identical library, history, jobs, settings, and cookie-status GETs within two seconds share a single request.
- Job polling ticks every second with backoff to three seconds on repeated failures and pauses while the tab is hidden.

## Diagnosing a slow start

The main process writes staged timings to the console and `<userData>/boot-times.log`: module load, `whenReady`, payload birthtime, window created, splash painted, backend ready, app painted. Deltas count from module load, not from the user double-clicking. Time between window creation and paint belongs to first-renderer load; time after paint belongs to backend probes, which no longer block anything visible. A long `null` tail in the readiness flags points at the matching probe; a gap between backend resolution and app paint points at bundle fetch or render cost.

## Lists, headers, and icons

Scrollbars are thin and square in panel-line color, turning accent on hover. Library and YouTube rows share row padding and text sizes inside matching divided panels. Both search headers pin with `sticky` while only their lists scroll. Row and preview actions use lucide icons throughout, with delete on the trash icon.
