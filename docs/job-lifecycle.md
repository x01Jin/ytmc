# Job Lifecycle & Queue

A conversion job moves from the Convert tab through the live queue into the Library and History. This page describes the states, polling, cancellation, and cleanup.

## States

`server/services/jobManager.ts` owns the in-memory state machine. `JobStatus` is one of `queued`, `downloading`, `converting`, `completed`, or `error`. `POST /api/convert` creates a job in `queued` with `progress 0`; the conversion pipeline advances `progress` and `stageMessage` until it reaches `completed` or `error`. `GET /api/status/:id` returns the current job; `GET /api/jobs` lists recent jobs for the Queue view.

## Polling

The Queue and Convert routes poll `GET /api/status/:id` every second (`src/hooks/useJobPolling.ts`). Repeated failures back off to every three seconds, and polling pauses while the tab is hidden. Identical GETs within two seconds share one request (`src/services/apiClient.ts`).

## Cancellation

`POST /api/cancel/:id` cancels a running job by sending `SIGTERM` to its `yt-dlp`/FFmpeg process (`JobManager.cancelJob`). Cancelling a `completed` or `error` job returns the job unchanged. Unknown ids return `404`; a job that cannot be cancelled returns `409`.

## Handoff and retention

When a job completes, the Convert route refreshes History and the Library, clears the active job and draft, and shows a floating confirmation. Jobs older than two hours are swept every 30 minutes (`JOB_RETENTION_MS`, `CLEANUP_INTERVAL_MS` in `server/services/jobManager.ts`); the sweep also removes stale output files from the downloads folder.
