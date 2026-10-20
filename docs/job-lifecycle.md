# Job Lifecycle

A conversion job moves from the Convert tab into the Library and History. This page describes the states, polling, cancellation, and cleanup.

## States

`server/services/jobManager.ts` owns the in-memory state machine. `JobStatus` is one of `queued`, `downloading`, `converting`, `completed`, or `error`. `POST /api/convert` creates a job in `queued` with `progress 0`; the conversion pipeline advances `progress` and `stageMessage` until it reaches `completed` or `error`. Only one conversion runs at a time: `MAX_CONCURRENT_CONVERSIONS` is 1, and a second request is rejected while a job is active. `GET /api/status/:id` returns the current job; `GET /api/jobs` lists recent jobs for the updater's active-conversion check.

## Polling

A single polling loop in `JobsProvider` (`src/hooks/useJobPolling.ts`) follows the active job every second. Repeated failures back off to every three seconds, and polling pauses while the tab is hidden. Identical history and settings GETs share one request while the earlier request is still in flight; the dedupe entry expires after two seconds (`src/services/apiClient.ts`).

## Cancellation

`POST /api/cancel/:id` cancels a running job by terminating its process tree (`JobManager.cancelJob`): `taskkill /T /F` on Windows, `SIGTERM` elsewhere. The progress card's Cancel button calls it and clears the active job. Cancelling a `completed` or `error` job returns the job unchanged. Unknown ids return `404`; a job that cannot be cancelled returns `409`.

## Handoff and retention

When a job completes, the Convert route refreshes History and the Library, clears the active job and draft, and shows a floating confirmation. Jobs older than two hours are pruned from the in-memory job map every 30 minutes (`JOB_RETENTION_MS`, `CLEANUP_INTERVAL_MS` in `server/services/jobManager.ts`). The cleanup timer never deletes library audio files; removal happens only through the explicit delete action.
