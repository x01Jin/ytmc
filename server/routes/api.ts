import express, { Request, Response, Router } from "express";
import fs from "fs";
import path from "path";
import { DEFAULT_DEMO_TRACKS, DOWNLOADS_DIR } from "../config.js";
import { AudioTagService, MusicTags } from "../services/audioTagService.js";
import {
  AudioEditService,
  EDITABLE_FORMATS,
  parseTimeInput,
} from "../services/audioEditService.js";
import { ConversionService } from "../services/conversionService.js";
import { CookieService } from "../services/cookieService.js";
import { FileService } from "../services/fileService.js";
import { JobManager } from "../services/jobManager.js";
import { LibraryStore } from "../services/libraryStore.js";
import { MetadataService } from "../services/metadataService.js";
import { SettingsService } from "../services/settingsService.js";
import { TagFetcherService } from "../services/tagFetcherService.js";
import { buildDisplayFileName, dedupeFileName } from "../utils/filename.js";
import { getAudioMimeType } from "../utils/mime.js";

export const apiRouter: Router = express.Router();

function resolveAudioFile(
  id: string,
): { filePath: string; fileName: string } | null {
  const job = JobManager.getJob(id);
  if (job?.outputFilePath && fs.existsSync(job.outputFilePath)) {
    return {
      filePath: job.outputFilePath,
      fileName: job.outputFileName || path.basename(job.outputFilePath),
    };
  }
  const record = LibraryStore.list().find((r) => r.jobId === id);
  if (record && fs.existsSync(record.filePath)) {
    return { filePath: record.filePath, fileName: record.fileName };
  }
  return null;
}

/**
 * Resolve a library track for in-place editing. Works for recent jobs and
 * for older library entries whose in-memory job has expired.
 */
function resolveLibraryTarget(id: string): {
  filePath: string;
  videoId: string;
  title: string;
  author: string;
  thumbnail: string;
  format: string;
  completedAt: number;
} | null {
  const job = JobManager.getJob(id);
  const record = LibraryStore.list().find((r) => r.jobId === id);
  const filePath =
    job?.outputFilePath && fs.existsSync(job.outputFilePath)
      ? job.outputFilePath
      : record && fs.existsSync(record.filePath)
        ? record.filePath
        : null;
  if (!filePath) return null;
  return {
    filePath,
    videoId: job?.videoId ?? record?.videoId ?? id,
    title: job?.title ?? record?.title ?? path.basename(filePath),
    author: job?.author ?? record?.author ?? "Unknown",
    thumbnail: job?.thumbnail ?? record?.thumbnail ?? "",
    format: path.extname(filePath).replace(".", "").toLowerCase(),
    completedAt: record?.completedAt ?? job?.completedAt ?? Date.now(),
  };
}

/** Keep the job cache and the on-disk library index in sync after an edit. */
function syncLibraryIndexes(
  id: string,
  update: {
    filePath: string;
    fileName: string;
    fileSizeBytes: number;
    format: string;
    title: string;
    author: string;
    thumbnail: string;
    videoId: string;
    completedAt: number;
  },
): void {
  const job = JobManager.getJob(id);
  const existing = LibraryStore.list().find((record) => record.jobId === id);
  if (job) {
    JobManager.updateJob(id, {
      title: update.title,
      author: update.author,
      thumbnail: update.thumbnail || job.thumbnail,
      format: update.format,
      outputFilePath: update.filePath,
      outputFileName: update.fileName,
      fileSizeBytes: update.fileSizeBytes,
    });
  }
  LibraryStore.upsert({
    jobId: id,
    source: existing?.source,
    videoId: update.videoId,
    title: update.title,
    author: update.author,
    thumbnail: update.thumbnail,
    format: update.format,
    fileName: update.fileName,
    filePath: update.filePath,
    fileSizeBytes: update.fileSizeBytes,
    completedAt: update.completedAt,
  });
}

/**
 * Fetch video metadata from YouTube URL or ID
 */
apiRouter.get("/info", async (req: Request, res: Response) => {
  try {
    const url = req.query.url as string;
    if (!url) {
      res
        .status(400)
        .json({ success: false, error: "YouTube URL or video ID is required" });
      return;
    }

    const metadata = await MetadataService.getVideoInfo(url);
    res.json({ success: true, data: metadata });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: error.message || "Failed to fetch video information",
    });
  }
});

/**
 * Start conversion job
 */
apiRouter.post("/convert", async (req: Request, res: Response) => {
  try {
    const {
      url,
      format,
      bitrate,
      trimStart,
      trimEnd,
      volumeBoost,
      normalizeAudio,
      embedThumbnail,
    } = req.body;
    if (!url) {
      res.status(400).json({ success: false, error: "Target URL is required" });
      return;
    }

    const job = await ConversionService.startConversion({
      url,
      format,
      bitrate,
      trimStart,
      trimEnd,
      volumeBoost: volumeBoost ? parseInt(volumeBoost, 10) : undefined,
      normalizeAudio: Boolean(normalizeAudio),
      embedThumbnail: embedThumbnail !== false,
    });

    res.json({ success: true, job });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: error.message || "Failed to start conversion job",
    });
  }
});

/**
 * Check conversion status
 */
apiRouter.get("/status/:id", (req: Request, res: Response) => {
  const jobId = req.params.id;
  const job = JobManager.getJob(jobId);
  if (!job) {
    res.status(404).json({ success: false, error: "Job not found" });
    return;
  }
  res.json({ success: true, job });
});

/**
 * List recent jobs
 */
apiRouter.get("/jobs", (req: Request, res: Response) => {
  const liveJobs = JobManager.listRecentJobs();
  const liveIds = new Set(liveJobs.map((job) => job.id));
  const persistedJobs = LibraryStore.list()
    .filter(
      (record) => record.source !== "import" && !liveIds.has(record.jobId),
    )
    .map((record) => ({
      id: record.jobId,
      videoId: record.videoId,
      title: record.title,
      author: record.author,
      thumbnail: record.thumbnail,
      format: record.format,
      bitrate: "native",
      status: "completed" as const,
      progress: 100,
      stageMessage: "Finished",
      outputFileName: record.fileName,
      outputFilePath: record.filePath,
      fileSizeBytes: record.fileSizeBytes,
      downloadUrl: `/api/download/${record.jobId}`,
      streamUrl: `/api/stream/${record.jobId}`,
      createdAt: record.completedAt,
      completedAt: record.completedAt,
    }));
  const jobs = [...liveJobs, ...persistedJobs].sort(
    (a, b) => (b.completedAt ?? b.createdAt) - (a.completedAt ?? a.createdAt),
  );
  res.json({ success: true, jobs });
});

/**
 * Stream audio file with HTTP Range support for HTML5 Audio player
 */
apiRouter.get("/stream/:id", (req: Request, res: Response) => {
  const jobId = req.params.id;
  const resolved = resolveAudioFile(jobId);

  if (!resolved) {
    res.status(404).json({
      success: false,
      error: "Audio file not found or still processing",
    });
    return;
  }

  const filePath = resolved.filePath;
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;
  const ext = path.extname(filePath).replace(".", "");
  const contentType = getAudioMimeType(ext);

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = end - start + 1;
    const file = fs.createReadStream(filePath, { start, end });

    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunksize,
      "Content-Type": contentType,
    });
    file.pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

/**
 * Download converted audio file
 */
apiRouter.get("/download/:id", (req: Request, res: Response) => {
  const jobId = req.params.id;
  const resolved = resolveAudioFile(jobId);

  if (!resolved) {
    res.status(404).json({ success: false, error: "Audio file not found" });
    return;
  }

  const job = JobManager.getJob(jobId);
  const fileName =
    job?.outputFileName ||
    resolved.fileName ||
    `audio_${job?.videoId ?? jobId}.mp3`;
  res.download(resolved.filePath, fileName, (err) => {
    if (err && !res.headersSent) {
      res
        .status(500)
        .json({ success: false, error: "Failed to download file" });
    }
  });
});

/**
 * Cookie status
 */
apiRouter.get("/cookies", (req: Request, res: Response) => {
  const status = CookieService.getStatus();
  res.json({ success: true, data: status });
});

/**
 * Auto-fetch YouTube guest session cookies
 */
apiRouter.post("/cookies/auto-fetch", async (req: Request, res: Response) => {
  try {
    const result = await CookieService.autoFetchGuestSession();
    const status = CookieService.getStatus();
    const { success: _serviceSuccess, ...details } = result;
    res.json({ success: true, ...details, status });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Failed to auto-fetch guest session",
    });
  }
});

/**
 * Test current YouTube session cookies and challenge solver
 */
apiRouter.post("/cookies/test", async (req: Request, res: Response) => {
  try {
    const result = await CookieService.testSession();
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Failed to test session",
    });
  }
});

/**
 * Save user session cookies
 */
apiRouter.post("/cookies", (req: Request, res: Response) => {
  try {
    const { cookies } = req.body;
    if (!cookies) {
      res
        .status(400)
        .json({ success: false, error: "Cookies text is required" });
      return;
    }
    const result = CookieService.saveCookies(cookies);
    const { success: _serviceSuccess, ...details } = result;
    res.json({ success: true, ...details });
  } catch (error: any) {
    res.status(400).json({
      success: false,
      error: error.message || "Failed to save cookies",
    });
  }
});

/**
 * Clear session cookies
 */
apiRouter.delete("/cookies", (req: Request, res: Response) => {
  const result = CookieService.clearCookies();
  res.json(result);
});

/**
 * Pre-verified demo tracks
 */
apiRouter.get("/demo-tracks", (req: Request, res: Response) => {
  res.json({ success: true, data: DEFAULT_DEMO_TRACKS });
});

/**
 * Library settings: where finished files live on disk.
 */
apiRouter.get("/settings", (req: Request, res: Response) => {
  const settings = SettingsService.getSettings();
  res.json({
    success: true,
    data: {
      ...settings,
      defaultDownloadsDir: DOWNLOADS_DIR,
      isCustom:
        path.normalize(settings.downloadsDir) !== path.normalize(DOWNLOADS_DIR),
    },
  });
});

apiRouter.patch("/settings", (req: Request, res: Response) => {
  try {
    const { downloadsDir, filenameTemplate, revealAfterConvert } =
      req.body ?? {};
    const settings = SettingsService.updateSettings({
      downloadsDir,
      filenameTemplate,
      revealAfterConvert,
    });
    res.json({ success: true, data: settings });
  } catch (error: any) {
    res
      .status(400)
      .json({ success: false, error: error.message || "Invalid settings" });
  }
});

apiRouter.post("/settings/reset", (req: Request, res: Response) => {
  const settings = SettingsService.resetSettings();
  res.json({ success: true, data: settings });
});

/**
 * On-disk library: persistent records plus any unindexed audio files.
 */
apiRouter.get("/library", (req: Request, res: Response) => {
  let records = LibraryStore.list();
  const indexedPaths = new Set(records.map((r) => path.normalize(r.filePath)));
  const loose = FileService.scanLibrary().filter(
    (f) => !indexedPaths.has(path.normalize(f.filePath)),
  );
  for (const file of loose) {
    LibraryStore.upsert({
      jobId: `file:${file.fileName}`,
      source: "import",
      videoId: "",
      title: path.basename(file.fileName, path.extname(file.fileName)),
      author: "Local file",
      thumbnail: "",
      format: file.ext,
      fileName: file.fileName,
      filePath: file.filePath,
      fileSizeBytes: file.sizeBytes,
      completedAt: file.mtimeMs,
    });
  }
  records = LibraryStore.list();
  const looseFiles = FileService.scanLibrary().filter(
    (f) =>
      !records.some(
        (r) => path.normalize(r.filePath) === path.normalize(f.filePath),
      ),
  );
  const totalSizeBytes =
    records.reduce((sum, r) => sum + r.fileSizeBytes, 0) +
    looseFiles.reduce((sum, f) => sum + f.sizeBytes, 0);
  res.json({
    success: true,
    data: {
      downloadsDir: FileService.getDownloadsDir(),
      records,
      looseFiles,
      totalSizeBytes,
    },
  });
});

apiRouter.post(
  "/library/import",
  express.raw({ type: "application/octet-stream", limit: "200mb" }),
  (req: Request, res: Response) => {
    try {
      const fileName =
        typeof req.headers["x-file-name"] === "string"
          ? decodeURIComponent(req.headers["x-file-name"])
          : typeof req.body?.fileName === "string"
            ? req.body.fileName
            : "";
      const encoded = typeof req.body?.data === "string" ? req.body.data : "";
      const ext = path.extname(fileName).toLowerCase();
      if (!fileName || !FileService.AUDIO_EXTENSIONS.has(ext) || !encoded) {
        res.status(400).json({
          success: false,
          error: "Drop an audio file supported by the library.",
        });
        return;
      }
      const safeName = path.basename(fileName);
      const targetDir = FileService.ensureDownloadsDir();
      const targetName = dedupeFileName(targetDir, safeName);
      const targetPath = path.join(targetDir, targetName);
      const data = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(encoded, "base64");
      fs.writeFileSync(targetPath, data, { flag: "wx" });
      const stat = fs.statSync(targetPath);
      LibraryStore.upsert({
        jobId: `file:${path.basename(targetPath)}`,
        source: "import",
        videoId: "",
        title: path.basename(targetPath, path.extname(targetPath)),
        author: "Local file",
        thumbnail: "",
        format: ext.slice(1),
        fileName: path.basename(targetPath),
        filePath: targetPath,
        fileSizeBytes: stat.size,
        completedAt: stat.mtimeMs,
      });
      res.json({ success: true });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: error.message || "Could not copy audio into the library.",
      });
    }
  },
);

apiRouter.delete("/library/:id", (req: Request, res: Response) => {
  const id = req.params.id;
  const record = LibraryStore.list().find((r) => r.jobId === id);
  const job = JobManager.getJob(id);
  const filePath = record?.filePath ?? job?.outputFilePath;
  if (!filePath || !fs.existsSync(filePath)) {
    LibraryStore.remove(id);
    res.json({ success: true, message: "Library entry removed." });
    return;
  }
  if (!FileService.isInsideLibrary(path.resolve(filePath))) {
    res
      .status(400)
      .json({ success: false, error: "File is outside the library folder." });
    return;
  }
  try {
    fs.unlinkSync(filePath);
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Could not delete the file.",
    });
    return;
  }
  LibraryStore.remove(id);
  res.json({ success: true, message: "File deleted from your library." });
});

/**
 * Probe a library track (duration/format/size) for the trimmer preview.
 */
apiRouter.get("/library/:id/probe", async (req: Request, res: Response) => {
  const target = resolveLibraryTarget(req.params.id);
  if (!target) {
    res.status(404).json({ success: false, error: "Audio file not found" });
    return;
  }
  if (!FileService.isInsideLibrary(path.resolve(target.filePath))) {
    res
      .status(400)
      .json({ success: false, error: "File is outside the library folder." });
    return;
  }
  try {
    const probe = await AudioEditService.probe(target.filePath);
    res.json({ success: true, data: probe });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Could not probe the audio file",
    });
  }
});

/**
 * Trim a library track in place: cuts [start, end) and overwrites the file.
 * Body: { start: "0:15" | "15", end?: "2:45" | "" } — blank end keeps the tail.
 */
apiRouter.post("/library/:id/trim", async (req: Request, res: Response) => {
  const target = resolveLibraryTarget(req.params.id);
  if (!target) {
    res.status(404).json({ success: false, error: "Audio file not found" });
    return;
  }
  if (!FileService.isInsideLibrary(path.resolve(target.filePath))) {
    res
      .status(400)
      .json({ success: false, error: "File is outside the library folder." });
    return;
  }
  const { start, end } = (req.body ?? {}) as { start?: string; end?: string };
  const startSecs =
    typeof start === "string"
      ? (parseTimeInput(start) ?? (start.trim() === "" ? 0 : null))
      : 0;
  const endSecs =
    typeof end === "string" && end.trim() !== "" ? parseTimeInput(end) : null;
  if (
    startSecs === null ||
    (typeof end === "string" && end.trim() !== "" && endSecs === null)
  ) {
    res.status(400).json({
      success: false,
      error: "Invalid trim times. Use seconds or MM:SS (e.g. 15 or 0:15).",
    });
    return;
  }
  if (startSecs < 0 || (endSecs !== null && endSecs <= (startSecs ?? 0))) {
    res
      .status(400)
      .json({ success: false, error: "Trim start must be before trim end." });
    return;
  }
  try {
    const probe = await AudioEditService.probe(target.filePath);
    if (probe.durationSeconds !== null) {
      if ((startSecs ?? 0) >= probe.durationSeconds) {
        res.status(400).json({
          success: false,
          error: "Trim start is past the end of the track.",
        });
        return;
      }
      if (endSecs !== null && endSecs > probe.durationSeconds) {
        res.status(400).json({
          success: false,
          error: "Trim end is past the end of the track.",
        });
        return;
      }
    }
    const result = await AudioEditService.trim(
      target.filePath,
      startSecs ?? 0,
      endSecs,
    );
    syncLibraryIndexes(req.params.id, {
      filePath: result.filePath,
      fileName: result.fileName,
      fileSizeBytes: result.fileSizeBytes,
      format: result.format,
      title: target.title,
      author: target.author,
      thumbnail: target.thumbnail,
      videoId: target.videoId,
      completedAt: target.completedAt,
    });
    res.json({ success: true, message: "Trim applied.", data: result });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Could not trim the audio file",
    });
  }
});

/**
 * Advanced edit for a library track: container/codec change, loudness
 * handling, and/or title-artist rename. Rename-only patches skip re-encoding.
 * Body: { format?, bitrate?, normalizeAudio?, volumeBoost?, title?, artist? }
 */
apiRouter.post("/library/:id/edit", async (req: Request, res: Response) => {
  const target = resolveLibraryTarget(req.params.id);
  if (!target) {
    res.status(404).json({ success: false, error: "Audio file not found" });
    return;
  }
  if (!FileService.isInsideLibrary(path.resolve(target.filePath))) {
    res
      .status(400)
      .json({ success: false, error: "File is outside the library folder." });
    return;
  }
  const { format, bitrate, normalizeAudio, volumeBoost, title, artist } =
    (req.body ?? {}) as {
      format?: string;
      bitrate?: string;
      normalizeAudio?: boolean;
      volumeBoost?: number;
      title?: string;
      artist?: string;
    };
  const nextFormat =
    format !== undefined ? String(format).toLowerCase() : target.format;
  if (!(EDITABLE_FORMATS as readonly string[]).includes(nextFormat)) {
    res.status(400).json({
      success: false,
      error: `Unsupported format. Choose one of: ${(EDITABLE_FORMATS as readonly string[]).join(", ")}.`,
    });
    return;
  }
  const nextTitle = title !== undefined ? String(title).trim() : target.title;
  const nextAuthor =
    artist !== undefined ? String(artist).trim() : target.author;
  if (!nextTitle) {
    res.status(400).json({ success: false, error: "Title cannot be empty." });
    return;
  }
  const gain = volumeBoost === undefined ? 100 : Number(volumeBoost);
  if (![100, 125, 150].includes(gain)) {
    res.status(400).json({ success: false, error: "Invalid volume gain." });
    return;
  }
  try {
    const dir = path.dirname(target.filePath);
    const displayName = buildDisplayFileName(
      nextAuthor || "Unknown",
      nextTitle,
      nextFormat,
    );
    const currentBase = path.basename(target.filePath);
    const finalName =
      displayName === currentBase
        ? currentBase
        : dedupeFileName(dir, displayName);
    const finalPath = path.join(dir, finalName);
    const result = await AudioEditService.edit(
      target.filePath,
      {
        format: nextFormat,
        bitrate,
        normalizeAudio: Boolean(normalizeAudio),
        volumeBoost: gain,
        title: title !== undefined ? nextTitle : undefined,
        artist: artist !== undefined ? nextAuthor : undefined,
      },
      { filePath: finalPath, format: nextFormat },
    );
    syncLibraryIndexes(req.params.id, {
      filePath: result.filePath,
      fileName: result.fileName,
      fileSizeBytes: result.fileSizeBytes,
      format: result.format,
      title: nextTitle,
      author: nextAuthor,
      thumbnail: target.thumbnail,
      videoId: target.videoId,
      completedAt: target.completedAt,
    });
    res.json({ success: true, message: "Changes applied.", data: result });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Could not update the audio file",
    });
  }
});

/**
 * Reveal a finished file in the OS file manager. Constrained to the
 * library folder so callers cannot open arbitrary paths.
 */
apiRouter.post("/files/reveal", async (req: Request, res: Response) => {
  try {
    const { jobId } = req.body ?? {};
    if (!jobId) {
      res.status(400).json({ success: false, error: "jobId is required" });
      return;
    }
    const resolved = resolveAudioFile(String(jobId));
    if (!resolved) {
      res.status(404).json({ success: false, error: "Audio file not found" });
      return;
    }
    const absolute = path.resolve(resolved.filePath);
    if (!FileService.isInsideLibrary(absolute)) {
      res
        .status(400)
        .json({ success: false, error: "File is outside the library folder." });
      return;
    }
    const { spawn } = await import("child_process");
    if (process.platform === "win32") {
      spawn("explorer", ["/select,", absolute], {
        detached: true,
        stdio: "ignore",
      }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", ["-R", absolute], {
        detached: true,
        stdio: "ignore",
      }).unref();
    } else {
      spawn("xdg-open", [path.dirname(absolute)], {
        detached: true,
        stdio: "ignore",
      }).unref();
    }
    res.json({ success: true, path: absolute });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Could not reveal the file.",
    });
  }
});

/**
 * Search/detect music tags from external databases (iTunes, Deezer, MusicBrainz)
 * based on the music/track name input in the tag editor
 */
apiRouter.get("/tags/search", async (req: Request, res: Response) => {
  try {
    const q = req.query.q as string;
    const source =
      (req.query.source as "all" | "itunes" | "deezer" | "musicbrainz") ||
      "all";

    if (!q || !q.trim()) {
      res.json({ success: true, count: 0, data: [] });
      return;
    }

    const results = await TagFetcherService.searchTags(q.trim(), source);
    res.json({ success: true, count: results.length, data: results });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Failed to search tags",
    });
  }
});

/**
 * Apply/update custom tags on an existing completed audio file
 */
apiRouter.post("/tags/apply/:id", async (req: Request, res: Response) => {
  try {
    const jobId = req.params.id;
    const { tags } = req.body as { tags: MusicTags };

    if (!tags || !tags.title) {
      res.status(400).json({
        success: false,
        error: "Valid music tags with at least a title are required",
      });
      return;
    }

    const job = JobManager.getJob(jobId);
    // Fall back to the on-disk library index so tracks converted before the
    // last restart (no in-memory job) can still be retagged from the Library.
    const target =
      job?.outputFilePath && fs.existsSync(job.outputFilePath)
        ? {
            filePath: job.outputFilePath,
            format: path
              .extname(job.outputFilePath)
              .replace(".", "")
              .toLowerCase(),
            title: job.title,
            author: job.author,
            thumbnail: job.thumbnail,
            videoId: job.videoId,
            completedAt: job.completedAt ?? Date.now(),
          }
        : resolveLibraryTarget(jobId);
    if (!target) {
      res
        .status(404)
        .json({ success: false, error: "Conversion job not found" });
      return;
    }

    if (!target.filePath || !fs.existsSync(target.filePath)) {
      res.status(400).json({
        success: false,
        error: "Audio file is not ready or has expired",
      });
      return;
    }
    if (!FileService.isInsideLibrary(path.resolve(target.filePath))) {
      res
        .status(400)
        .json({ success: false, error: "File is outside the library folder." });
      return;
    }

    const result = await AudioTagService.applyTagsToFile(target.filePath, tags);

    // Rename the file on disk to match the new tags (not just metadata).
    const newFileName = buildDisplayFileName(
      tags.artist || "Unknown",
      tags.title,
      target.format,
    );
    const dir = path.dirname(target.filePath);
    const currentBase = path.basename(target.filePath);
    const finalName =
      newFileName === currentBase
        ? currentBase
        : dedupeFileName(dir, newFileName);
    const finalPath = path.join(dir, finalName);
    try {
      if (finalPath !== target.filePath)
        fs.renameSync(target.filePath, finalPath);
    } catch (renameErr: any) {
      res.status(500).json({
        success: false,
        error: `Tags saved, but renaming failed: ${renameErr.message}`,
      });
      return;
    }

    const nextTitle = tags.title;
    const nextAuthor = tags.artist || target.author;
    const nextThumbnail = tags.coverUrl || target.thumbnail;
    const updatedJob = job
      ? JobManager.updateJob(jobId, {
          title: nextTitle,
          author: nextAuthor,
          thumbnail: nextThumbnail,
          outputFilePath: finalPath,
          outputFileName: finalName,
          fileSizeBytes: result.fileSizeBytes,
          tags,
        })
      : undefined;
    LibraryStore.upsert({
      jobId,
      videoId: target.videoId,
      title: nextTitle,
      author: nextAuthor,
      thumbnail: nextThumbnail,
      format: target.format,
      fileName: finalName,
      filePath: finalPath,
      fileSizeBytes: result.fileSizeBytes,
      completedAt: target.completedAt,
    });

    res.json({
      success: true,
      message: "Audio tags updated successfully",
      job: updatedJob ?? {
        id: jobId,
        videoId: target.videoId,
        title: nextTitle,
        author: nextAuthor,
        thumbnail: nextThumbnail,
        format: target.format,
        outputFilePath: finalPath,
        outputFileName: finalName,
        fileSizeBytes: result.fileSizeBytes,
        tags,
      },
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: error.message || "Failed to apply audio tags",
    });
  }
});
