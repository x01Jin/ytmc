import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  SUPPORTED_BITRATES,
  SUPPORTED_FORMATS,
  FFMPEG_PATH,
} from "../config.js";
import { buildDisplayFileName, dedupeFileName } from "../utils/filename.js";
import { FileService } from "./fileService.js";
import { LibraryStore } from "./libraryStore.js";
import { AudioTagService, MusicTags } from "./audioTagService.js";
import { CookieService } from "./cookieService.js";
import { ConversionJob, JobManager } from "./jobManager.js";
import { PreviewService } from "./previewService.js";
import { MetadataService } from "./metadataService.js";
import {
  cookiesAllowed,
  extractorArgsFor,
  resolveStrategy,
} from "./potService.js";
import { parseYouTubeInput } from "./urlService.js";
import { ytdlpEnv, ytdlpLaunch } from "./ytdlpRunner.js";
import {
  buildAudioFilters,
  resolveNormalizeMode,
  transcodeWithLinearLoudness,
  type NormalizeMode,
} from "./audioFilterService.js";

export interface ConvertRequestOptions {
  url: string;
  format?: string;
  bitrate?: string;
  trimStart?: string;
  trimEnd?: string;
  volumeBoost?: number;
  normalizeAudio?: boolean;
  /** New dual-mode selector. Legacy `normalizeAudio: true` maps to "loudness". */
  normalizeMode?: NormalizeMode | string;
  embedThumbnail?: boolean;
}

export class ConversionService {
  private static ensureDownloadsDir(): void {
    FileService.ensureDownloadsDir();
  }

  public static async startConversion(
    options: ConvertRequestOptions,
  ): Promise<ConversionJob> {
    this.ensureDownloadsDir();

    const parsed = parseYouTubeInput(options.url);
    if (!parsed.isValid || !parsed.videoId || !parsed.canonicalUrl) {
      throw new Error("Invalid YouTube URL or Video ID provided");
    }

    const videoId = parsed.videoId;
    const canonicalUrl = parsed.canonicalUrl;
    const format =
      options.format && SUPPORTED_FORMATS.includes(options.format as any)
        ? options.format
        : "best";
    const bitrate =
      options.bitrate && SUPPORTED_BITRATES.includes(options.bitrate as any)
        ? options.bitrate
        : "native";

    // Fetch quick oEmbed info to immediately initialize job and output filename.
    // Job identity is always the YouTube title/uploader/thumbnail — the
    // convert flow carries no autotagger tags.
    const oembed = await MetadataService.fetchOEmbed(canonicalUrl);
    const rawTitle = oembed?.title || `Track_${videoId}`;
    const rawAuthor = oembed?.author || "YouTube";
    const thumbnail =
      oembed?.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    const jobId = crypto.randomUUID();
    const extLabel = format === "best" ? "opus" : format;
    const displayFileName = buildDisplayFileName(rawAuthor, rawTitle, extLabel);

    const job = JobManager.createJob(
      jobId,
      videoId,
      rawTitle,
      rawAuthor,
      thumbnail,
      format,
      bitrate,
    );
    // Asynchronously execute yt-dlp conversion pipeline
    void this.executeYtDlp(
      jobId,
      canonicalUrl,
      videoId,
      format,
      bitrate,
      displayFileName,
      options,
    ).catch((err: any) => {
      JobManager.updateJob(jobId, {
        status: "error",
        error: `Conversion setup failed: ${err?.message || err}`,
      });
    });

    return job;
  }

  private static async executeYtDlp(
    jobId: string,
    canonicalUrl: string,
    videoId: string,
    format: string,
    bitrate: string,
    displayFileName: string,
    options: ConvertRequestOptions,
  ): Promise<void> {
    const outputTemplate = path.join(
      FileService.getDownloadsDir(),
      `${jobId}.%(ext)s`,
    );
    const cookiesPath = CookieService.getCookiesPath();
    const launch = ytdlpLaunch();
    const { strategy } = await resolveStrategy();
    const useCookies = cookiesAllowed(strategy, !!cookiesPath);

    // Loudness mode runs as a LOCAL two-pass post-pass after a native
    // download: true-linear scaling needs a measurement pass first, which
    // can't run inside yt-dlp's one-shot transcode. Peak/off+boost stay in
    // yt-dlp args (single-pass, pumping-free by construction).
    const loudnessPostPass =
      resolveNormalizeMode({
        normalizeMode: options.normalizeMode,
        normalizeAudio: options.normalizeAudio,
      }) === "loudness";
    const ffmpegFilters: string[] = loudnessPostPass
      ? []
      : buildAudioFilters({
          normalizeMode: options.normalizeMode,
          normalizeAudio: options.normalizeAudio,
          volumeBoost: options.volumeBoost,
        });
    const hasFilters = ffmpegFilters.length > 0;

    const args: string[] = [
      ...launch.prefixArgs,
      "--js-runtimes",
      `node:${process.execPath}`,
      ...extractorArgsFor(strategy),
      "--ffmpeg-location",
      path.dirname(FFMPEG_PATH),
      "--no-playlist",
      "--newline",
      "-f",
      "ba/b",
      "-o",
      outputTemplate,
    ];

    if (useCookies && cookiesPath) {
      args.push("--cookies", cookiesPath);
    }

    if (options.trimStart || options.trimEnd) {
      const start = options.trimStart?.trim() || "00:00";
      const end = options.trimEnd?.trim() || "inf";
      args.push("--download-sections", `*${start}-${end}`);
      args.push("--force-keyframes-at-cuts");
    }

    if (loudnessPostPass) {
      // Native streamcopy download; the two-pass linear post-pass below
      // transcodes to the requested target afterwards. (Single transcode
      // total — same cost class as the old in-yt-dlp filter.)
      args.push("--extract-audio");
      args.push("--audio-format", "best");
    } else if (format === "best" || format === "opus" || format === "m4a") {
      if (!hasFilters) {
        args.push("--extract-audio");
        args.push("--audio-format", format === "best" ? "best" : format);
      } else {
        const targetFormat = format === "m4a" ? "m4a" : "opus";
        const targetCodec = format === "m4a" ? "aac" : "libopus";
        const targetBitrate = format === "m4a" ? "128k" : "160k";

        args.push("--extract-audio");
        args.push("--audio-format", targetFormat);
        args.push(
          "--postprocessor-args",
          `ExtractAudio:-c:a ${targetCodec} -b:a ${targetBitrate} -af ${ffmpegFilters.join(",")}`,
        );
      }
    } else if (format === "mp3") {
      const mp3Quality = bitrate === "native" || !bitrate ? "160k" : bitrate;
      args.push("--extract-audio");
      args.push("--audio-format", "mp3");
      args.push("--audio-quality", mp3Quality);

      if (hasFilters) {
        args.push(
          "--postprocessor-args",
          `ExtractAudio:-c:a libmp3lame -af ${ffmpegFilters.join(",")}`,
        );
      }
    } else if (format === "flac") {
      args.push("--extract-audio");
      args.push("--audio-format", "flac");
      args.push("--audio-quality", "0");

      if (hasFilters) {
        args.push(
          "--postprocessor-args",
          `ExtractAudio:-c:a flac -af ${ffmpegFilters.join(",")}`,
        );
      }
    } else if (format === "wav") {
      args.push("--extract-audio");
      args.push("--audio-format", "wav");

      if (hasFilters) {
        args.push(
          "--postprocessor-args",
          `ExtractAudio:-c:a pcm_s16le -af ${ffmpegFilters.join(",")}`,
        );
      }
    }

    // NOTE: opus excluded — ffmpeg cannot mux attached_pic into Ogg/Opus
    // (cover would fail the whole conversion). Opus cover is embedded later
    // via METADATA_BLOCK_PICTURE in the minimalTags step below.
    // Loudness post-pass also skips yt-dlp embedding: the native download
    // may be opus (un-embeddable) and the local transcode + minimalTags step
    // attach the artwork afterwards.
    if (
      options.embedThumbnail &&
      !loudnessPostPass &&
      (format === "mp3" || format === "m4a" || format === "flac")
    ) {
      args.push("--embed-thumbnail");
    }

    args.push(canonicalUrl);

    JobManager.updateJob(jobId, {
      status: "downloading",
      progress: 5,
      stageMessage: loudnessPostPass
        ? "Fetching native audio stream (loudness balanced afterwards, dynamics preserved)..."
        : format === "best" || format === "opus" || format === "m4a"
          ? "Fetching highest native audio stream directly from YouTube..."
          : `Connecting to YouTube audio stream for ${format.toUpperCase()} conversion...`,
    });

    const child = spawn(launch.command, args, {
      env: ytdlpEnv(),
    });

    let stderrBuffer = "";
    let spawnFailed = false;

    child.stdout.on("data", (chunk: Buffer) => {
      const line = chunk.toString();

      const downloadMatch = line.match(/\[download\]\s+([\d\.]+)%/);
      if (downloadMatch) {
        const percent = parseFloat(downloadMatch[1]);
        const calculated = Math.min(75, Math.floor(percent * 0.75));
        JobManager.updateJob(jobId, {
          status: "downloading",
          progress: calculated,
          stageMessage: `Downloading audio stream (${Math.floor(percent)}%)...`,
        });
      }

      if (line.includes("[ExtractAudio]") || line.includes("Destination:")) {
        JobManager.updateJob(jobId, {
          status: "converting",
          progress: 80,
          stageMessage: `Converting to ${format.toUpperCase()} (${bitrate})...`,
        });
      }

      if (
        line.includes("[Metadata]") ||
        line.includes("[ThumbnailsConvertor]")
      ) {
        JobManager.updateJob(jobId, {
          status: "converting",
          progress: 90,
          stageMessage: "Embedding ID3 metadata & album artwork...",
        });
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrBuffer += chunk.toString();
    });

    child.on("close", async (code) => {
      if (spawnFailed) return;
      if (code !== 0) {
        const isBot =
          /sign in to confirm|not a bot|bot|login_required|cookies-from-browser|403/i.test(
            stderrBuffer,
          );
        const potDown = /bgutil|po_token|pot[^a-z]|4416|TransportError/i.test(
          stderrBuffer,
        );
        const firstError = stderrBuffer
          .split("\n")
          .filter((l) => l.includes("ERROR:"))[0];

        JobManager.updateJob(jobId, {
          status: "error",
          exitCode: code,
          isBotBlocked: isBot,
          error: isBot
            ? "YouTube requires user session cookies or verification for this track in cloud environments. Please open Session & Cookie Settings to import browser cookies or auto-fetch a fresh session."
            : potDown && strategy === "pot"
              ? "PO Token sidecar unreachable mid-conversion. Restart the app so the sidecar re-spawns, or see Session settings for the no-POT fallback."
              : firstError ||
                "Audio conversion failed. Please try another track or format.",
          errorDetails: stderrBuffer.slice(-2000) || undefined,
        });
        return;
      }

      const downloadsDir = FileService.getDownloadsDir();
      const files = fs.readdirSync(downloadsDir);
      const matchedFile = files.find(
        (f) =>
          f.startsWith(jobId) && !f.endsWith(".part") && !f.endsWith(".ytdl"),
      );

      if (!matchedFile) {
        JobManager.updateJob(jobId, {
          status: "error",
          error: "Converted audio file was not found on disk.",
        });
        return;
      }

      let stagedFile = path.join(downloadsDir, matchedFile);
      let actualExt = path.extname(stagedFile).replace(".", "").toLowerCase();

      let loudnessInfo: { gainDb: number; outputI: number } | null = null;
      if (loudnessPostPass) {
        // Two-pass linear loudnorm to the REQUESTED target ("best" keeps the
        // native container). Uniform gain — dynamics preserved, silence
        // untouched. Runs after the native download, before naming/tagging.
        const SUPPORTED_TARGETS = ["opus", "m4a", "mp3", "flac", "wav"];
        const finalTarget =
          format === "best"
            ? SUPPORTED_TARGETS.includes(actualExt)
              ? actualExt
              : "opus"
            : format;
        const postPath = path.join(
          downloadsDir,
          `${jobId}.loudness.${finalTarget}`,
        );
        try {
          const res = await transcodeWithLinearLoudness(stagedFile, postPath, {
            format: finalTarget,
            bitrate,
            onPass: (pass) =>
              JobManager.updateJob(jobId, {
                status: "converting",
                progress: pass === 1 ? 86 : 92,
                stageMessage:
                  pass === 1
                    ? "Measuring loudness (pass 1/2) — audio untouched..."
                    : "Applying uniform loudness gain (pass 2/2)...",
              }),
          });
          loudnessInfo = { gainDb: res.gainDb, outputI: res.outputI };
        } catch (postErr: any) {
          JobManager.updateJob(jobId, {
            status: "error",
            exitCode: code,
            error: `Loudness pass failed: ${postErr?.message || postErr}`,
          });
          return;
        }
        try {
          fs.unlinkSync(stagedFile);
        } catch {}
        stagedFile = postPath;
        actualExt = finalTarget;
      }

      const resolvedDisplayFileName = displayFileName.replace(
        /\.[a-z0-9]+$/i,
        `.${actualExt}`,
      );
      const finalName = dedupeFileName(downloadsDir, resolvedDisplayFileName);
      const finalFile = path.join(downloadsDir, finalName);
      try {
        if (stagedFile !== finalFile) fs.renameSync(stagedFile, finalFile);
      } catch (renameErr: any) {
        JobManager.updateJob(jobId, {
          status: "error",
          error: `Could not name the finished file: ${renameErr.message}`,
        });
        return;
      }

      if (options.embedThumbnail) {
        try {
          JobManager.updateJob(jobId, {
            stageMessage: "Writing title, artist and album artwork...",
          });
          const current = JobManager.getJob(jobId);
          const minimalTags: MusicTags = {
            title: current?.title ?? `Track_${videoId}`,
            artist: current?.author ?? "YouTube",
            album: "",
            coverUrl: current?.thumbnail,
            cleanDescription: true,
          };
          await AudioTagService.applyTagsToFile(finalFile, minimalTags);
        } catch (tagErr: any) {
          console.warn(`Tagging warning for job ${jobId}:`, tagErr.message);
        }
      }

      const fileStat = fs.statSync(finalFile);

      const updated = JobManager.updateJob(jobId, {
        status: "completed",
        progress: 100,
        stageMessage: loudnessPostPass
          ? loudnessInfo && Number.isFinite(loudnessInfo.outputI)
            ? `Loudness balanced to ${loudnessInfo.outputI.toFixed(1)} LUFS with a uniform ${loudnessInfo.gainDb >= 0 ? "+" : ""}${loudnessInfo.gainDb.toFixed(1)} dB gain — dynamics fully preserved!`
            : "Loudness balanced with a uniform gain — dynamics fully preserved!"
          : format === "best" || format === "opus" || format === "m4a"
            ? `Highest native audio stream extracted bit-for-bit (~${actualExt === "opus" ? "160k Opus" : "128k AAC"})!`
            : "Audio converted successfully!",
        format: actualExt,
        outputFilePath: finalFile,
        outputFileName: finalName,
        fileSizeBytes: fileStat.size,
        downloadUrl: `/api/download/${jobId}`,
        streamUrl: PreviewService.isEligible(actualExt)
          ? `/api/stream/${jobId}?preview=mp3`
          : `/api/stream/${jobId}`,
        completedAt: Date.now(),
      });
      if (updated?.outputFilePath) {
        LibraryStore.upsert({
          jobId,
          videoId,
          title: updated.title,
          author: updated.author,
          thumbnail: updated.thumbnail,
          format: actualExt,
          fileName: finalName,
          filePath: updated.outputFilePath,
          fileSizeBytes: fileStat.size,
          completedAt: updated.completedAt ?? Date.now(),
          tags: updated.tags,
        });
      }
    });

    child.on("error", (err) => {
      spawnFailed = true;
      JobManager.updateJob(jobId, {
        status: "error",
        exitCode: null,
        error: `yt-dlp failed to start: ${err.message}. Check that Python is installed (Windows "py" launcher) or set YTDLP_PATH to a working yt-dlp.exe.`,
        errorDetails: String(err.stack || err.message).slice(0, 1000),
      });
    });
  }
}
