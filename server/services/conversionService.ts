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
import { MetadataService } from "./metadataService.js";
import {
  cookiesAllowed,
  extractorArgsFor,
  resolveStrategy,
} from "./potService.js";
import { parseYouTubeInput } from "./urlService.js";
import { ytdlpEnv, ytdlpLaunch } from "./ytdlpRunner.js";

export interface ConvertRequestOptions {
  url: string;
  format?: string;
  bitrate?: string;
  trimStart?: string;
  trimEnd?: string;
  volumeBoost?: number;
  normalizeAudio?: boolean;
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

    // Setup audio filters (loudnorm, volume)
    const ffmpegFilters: string[] = [];
    if (options.normalizeAudio) {
      ffmpegFilters.push("loudnorm");
    } else if (options.volumeBoost && options.volumeBoost !== 100) {
      const factor = (options.volumeBoost / 100).toFixed(2);
      ffmpegFilters.push(`volume=${factor}`);
    }
    const hasFilters = ffmpegFilters.length > 0;

    // Target highest quality audio stream from YouTube
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

    // Cookies only accompany the no-POT fallback path (anonymous PO tokens
    // do not validate against cookie sessions server-side).
    if (useCookies && cookiesPath) {
      args.push("--cookies", cookiesPath);
    }

    // Trimming / section download support
    if (options.trimStart || options.trimEnd) {
      const start = options.trimStart?.trim() || "00:00";
      const end = options.trimEnd?.trim() || "inf";
      args.push("--download-sections", `*${start}-${end}`);
      args.push("--force-keyframes-at-cuts");
    }

    // Audio format & extraction configuration
    if (format === "best" || format === "opus" || format === "m4a") {
      if (!hasFilters) {
        // DIRECT STREAM COPY: Highest native bitrate without lossy re-encoding
        args.push("--extract-audio");
        args.push("--audio-format", format === "best" ? "best" : format);
      } else {
        // Filtering requires re-encoding; explicitly supply encoder codec to prevent
        // FFmpeg error: "Filtering and streamcopy cannot be used together"
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
      // MP3 is always a transcode from native ~160k Opus / ~128k AAC
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

    // Embed thumbnail if requested and format supports direct thumbnail container
    if (
      options.embedThumbnail &&
      (format === "mp3" || format === "m4a" || format === "flac")
    ) {
      args.push("--embed-thumbnail");
    }

    // Always target canonical URL
    args.push(canonicalUrl);

    JobManager.updateJob(jobId, {
      status: "downloading",
      progress: 5,
      stageMessage:
        format === "best" || format === "opus" || format === "m4a"
          ? "Fetching highest native audio stream directly from YouTube..."
          : `Connecting to YouTube audio stream for ${format.toUpperCase()} conversion...`,
    });

    const child = spawn(launch.command, args, {
      env: ytdlpEnv(),
    });

    let stderrBuffer = "";
    // A failed spawn fires 'error' AND then 'close'; the close handler must
    // not overwrite the precise launch message with the generic fallback.
    let spawnFailed = false;

    child.stdout.on("data", (chunk: Buffer) => {
      const line = chunk.toString();

      // Check for download percentage
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

      // Check for audio extraction
      if (line.includes("[ExtractAudio]") || line.includes("Destination:")) {
        JobManager.updateJob(jobId, {
          status: "converting",
          progress: 80,
          stageMessage: `Converting to ${format.toUpperCase()} (${bitrate})...`,
        });
      }

      // Check for postprocessing
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

      // Locate output file, then rename it from the internal jobId name to
      // the human-readable display name so the library folder stays clean.
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

      const stagedFile = path.join(downloadsDir, matchedFile);
      const actualExt = path.extname(stagedFile).replace(".", "").toLowerCase();

      // Compute display file name with actual extension
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

      // Stamp minimal YouTube-native identity (title/uploader + thumbnail
      // art) so the file carries no autotagger metadata. The empty album is
      // skipped by AudioTagService; album_artist mirrors the artist.
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
        stageMessage:
          format === "best" || format === "opus" || format === "m4a"
            ? `Highest native audio stream extracted bit-for-bit (~${actualExt === "opus" ? "160k Opus" : "128k AAC"})!`
            : "Audio converted successfully!",
        format: actualExt,
        outputFilePath: finalFile,
        outputFileName: finalName,
        fileSizeBytes: fileStat.size,
        downloadUrl: `/api/download/${jobId}`,
        streamUrl: `/api/stream/${jobId}`,
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
