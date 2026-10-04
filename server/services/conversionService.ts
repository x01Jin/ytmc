import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { SUPPORTED_BITRATES, SUPPORTED_FORMATS, FFMPEG_PATH } from '../config.js';
import { buildDisplayFileName, dedupeFileName } from '../utils/filename.js';
import { buildArtworkUrl } from '../utils/artwork.js';
import { FileService } from './fileService.js';
import { HistoryStore } from './historyStore.js';
import { LibraryStore } from './libraryStore.js';
import { AudioTagService, MusicTags } from './audioTagService.js';
import { CookieService } from './cookieService.js';
import { ConversionJob, JobManager } from './jobManager.js';
import { PreviewService } from './previewService.js';
import { MetadataService } from './metadataService.js';
import { cookiesAllowed, extractorArgsFor, resolveStrategy } from './potService.js';
import { parseYouTubeInput } from './urlService.js';
import { ensureYtDlp, ytdlpEnv } from './ytdlpRunner.js';
import { AUDIO_DSP, buildAudioFilters } from './audioFilterService.js';
import { readAudioMetadata } from './audioMetadata.js';

const MAX_CONCURRENT_CONVERSIONS = 2;
const CONVERSION_TIMEOUT_MS = 30 * 60 * 1000;

function isTrimValue(value: string | undefined, allowInf: boolean): boolean {
  if (value === undefined) return true;
  const trimmed = value.trim();
  if (trimmed === '') return true;
  if (allowInf && trimmed === 'inf') return true;
  return /^(\d+:)?\d{1,2}:\d{2}(\.\d+)?$/.test(trimmed) || /^\d+(\.\d+)?$/.test(trimmed);
}

function isVolumeBoost(value: number | undefined): boolean {
  if (value === undefined) return true;
  return (AUDIO_DSP.VOLUME.ALLOWED as readonly number[]).includes(value);
}

export interface ConvertRequestOptions {
  url: string;
  format?: string;
  bitrate?: string;
  trimStart?: string;
  trimEnd?: string;
  volumeBoost?: number;
  embedThumbnail?: boolean;
}

export namespace ConversionService {
  export function cancelConversion(jobId: string): boolean {
    return JobManager.cancelJob(jobId);
  }

  export async function startConversion(options: ConvertRequestOptions): Promise<ConversionJob> {
    if (JobManager.activeCount() >= MAX_CONCURRENT_CONVERSIONS) {
      throw new Error('Too many concurrent conversions. Wait for one to finish and try again.');
    }
    if (!isTrimValue(options.trimStart, false)) {
      throw new Error('Invalid trim start. Use seconds or MM:SS.');
    }
    if (!isTrimValue(options.trimEnd, true)) {
      throw new Error('Invalid trim end. Use seconds, MM:SS, or leave empty.');
    }
    if (!isVolumeBoost(options.volumeBoost)) {
      throw new Error('Invalid volume boost. Allowed values are 100, 125, 150.');
    }
    FileService.ensureDownloadsDir();

    const parsed = parseYouTubeInput(options.url);
    if (!parsed.isValid || !parsed.videoId || !parsed.canonicalUrl) {
      throw new Error('Invalid YouTube URL or Video ID provided');
    }

    const videoId = parsed.videoId;
    const canonicalUrl = parsed.canonicalUrl;
    const format =
      options.format && (SUPPORTED_FORMATS as readonly string[]).includes(options.format)
        ? options.format
        : 'best';
    const bitrate =
      options.bitrate && (SUPPORTED_BITRATES as readonly string[]).includes(options.bitrate)
        ? options.bitrate
        : 'native';

    const oembed = await MetadataService.fetchOEmbed(canonicalUrl);
    const rawTitle = oembed?.title || `Track_${videoId}`;
    const rawAuthor = oembed?.author || 'YouTube';
    const thumbnail = oembed?.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    const jobId = crypto.randomUUID();
    const extLabel = format === 'best' ? 'opus' : format;
    const displayFileName = buildDisplayFileName(rawAuthor, rawTitle, extLabel);

    const job = JobManager.createJob(
      jobId,
      videoId,
      rawTitle,
      rawAuthor,
      thumbnail,
      format,
      bitrate
    );
    void executeYtDlp(
      jobId,
      canonicalUrl,
      videoId,
      format,
      bitrate,
      displayFileName,
      options
    ).catch((err: any) => {
      JobManager.updateJob(jobId, {
        status: 'error',
        error: `Conversion setup failed: ${err?.message || err}`,
      });
    });

    return job;
  }

  async function executeYtDlp(
    jobId: string,
    canonicalUrl: string,
    videoId: string,
    format: string,
    bitrate: string,
    displayFileName: string,
    options: ConvertRequestOptions
  ): Promise<void> {
    const outputTemplate = path.join(FileService.getDownloadsDir(), `${jobId}.%(ext)s`);
    const cookiesPath = CookieService.getCookiesPath();
    const launch = await ensureYtDlp();
    if (!launch.version) {
      throw new Error('yt-dlp is not ready. Check Python launcher or YTDLP_PATH, then retry.');
    }
    const { strategy } = await resolveStrategy();
    const useCookies = cookiesAllowed(strategy, !!cookiesPath);

    const ffmpegFilters: string[] = buildAudioFilters({
      volumeBoost: options.volumeBoost,
    });
    const hasFilters = ffmpegFilters.length > 0;

    const args: string[] = [
      ...launch.prefixArgs,
      '--js-runtimes',
      `node:${process.execPath}`,
      ...extractorArgsFor(strategy),
      '--ffmpeg-location',
      path.dirname(FFMPEG_PATH),
      '--no-playlist',
      '--newline',
      '-f',
      'ba/b',
      '-o',
      outputTemplate,
    ];

    if (useCookies && cookiesPath) {
      args.push('--cookies', cookiesPath);
    }

    if (options.trimStart || options.trimEnd) {
      const start = options.trimStart?.trim() || '00:00';
      const end = options.trimEnd?.trim() || 'inf';
      args.push('--download-sections', `*${start}-${end}`);
      args.push('--force-keyframes-at-cuts');
    }

    if (format === 'best' || format === 'opus' || format === 'm4a') {
      if (!hasFilters) {
        args.push('--extract-audio');
        args.push('--audio-format', format === 'best' ? 'best' : format);
      } else {
        const targetFormat = format === 'm4a' ? 'm4a' : 'opus';
        const targetCodec = format === 'm4a' ? 'aac' : 'libopus';
        const targetBitrate = format === 'm4a' ? '128k' : '160k';

        args.push('--extract-audio');
        args.push('--audio-format', targetFormat);
        args.push(
          '--postprocessor-args',
          `ExtractAudio:-c:a ${targetCodec} -b:a ${targetBitrate} -af ${ffmpegFilters.join(',')}`
        );
      }
    } else if (format === 'mp3') {
      const mp3Quality = bitrate === 'native' || !bitrate ? '160k' : bitrate;
      args.push('--extract-audio');
      args.push('--audio-format', 'mp3');
      args.push('--audio-quality', mp3Quality);

      if (hasFilters) {
        args.push(
          '--postprocessor-args',
          `ExtractAudio:-c:a libmp3lame -af ${ffmpegFilters.join(',')}`
        );
      }
    } else if (format === 'flac') {
      args.push('--extract-audio');
      args.push('--audio-format', 'flac');
      args.push('--audio-quality', '0');

      if (hasFilters) {
        args.push('--postprocessor-args', `ExtractAudio:-c:a flac -af ${ffmpegFilters.join(',')}`);
      }
    } else if (format === 'wav') {
      args.push('--extract-audio');
      args.push('--audio-format', 'wav');

      if (hasFilters) {
        args.push(
          '--postprocessor-args',
          `ExtractAudio:-c:a pcm_s16le -af ${ffmpegFilters.join(',')}`
        );
      }
    }

    if (options.embedThumbnail && (format === 'mp3' || format === 'm4a' || format === 'flac')) {
      args.push('--embed-thumbnail');
    }

    args.push(canonicalUrl);

    JobManager.updateJob(jobId, {
      status: 'downloading',
      progress: 5,
      stageMessage:
        format === 'best' || format === 'opus' || format === 'm4a'
          ? 'Fetching highest native audio stream directly from YouTube...'
          : `Connecting to YouTube audio stream for ${format.toUpperCase()} conversion...`,
    });

    const child = spawn(launch.command, args, {
      env: ytdlpEnv(),
    });
    JobManager.registerProcess(jobId, child);

    let stderrBuffer = '';
    let spawnFailed = false;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch {
        return;
      }
      JobManager.updateJob(jobId, {
        status: 'error',
        error: 'Conversion timed out after 30 minutes and was stopped.',
      });
    }, CONVERSION_TIMEOUT_MS);
    if (timeout.unref) timeout.unref();

    child.stdout.on('data', (chunk: Buffer) => {
      const line = chunk.toString();

      const downloadMatch = line.match(/\[download\]\s+([\d.]+)%/);
      if (downloadMatch) {
        const percent = parseFloat(downloadMatch[1]);
        const calculated = Math.min(75, Math.floor(percent * 0.75));
        JobManager.updateJob(jobId, {
          status: 'downloading',
          progress: calculated,
          stageMessage: `Downloading audio stream (${Math.floor(percent)}%)...`,
        });
      }

      if (line.includes('[ExtractAudio]') || line.includes('Destination:')) {
        JobManager.updateJob(jobId, {
          status: 'converting',
          progress: 80,
          stageMessage: `Converting to ${format.toUpperCase()} (${bitrate})...`,
        });
      }

      if (line.includes('[Metadata]') || line.includes('[ThumbnailsConvertor]')) {
        JobManager.updateJob(jobId, {
          status: 'converting',
          progress: 90,
          stageMessage: 'Embedding ID3 metadata & album artwork...',
        });
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrBuffer += chunk.toString();
    });

    child.on('close', async code => {
      clearTimeout(timeout);
      JobManager.clearProcess(jobId);
      if (spawnFailed) return;
      if (timedOut) return;
      if (code !== 0) {
        const isBot =
          /sign in to confirm|not a bot|bot|login_required|cookies-from-browser|403/i.test(
            stderrBuffer
          );
        const potDown = /bgutil|po_token|pot[^a-z]|4416|TransportError/i.test(stderrBuffer);
        const firstError = stderrBuffer.split('\n').filter(l => l.includes('ERROR:'))[0];

        JobManager.updateJob(jobId, {
          status: 'error',
          exitCode: code,
          isBotBlocked: isBot,
          error: isBot
            ? 'YouTube requires user session cookies or verification for this track in cloud environments. Please open Session & Cookie Settings to import browser cookies or auto-fetch a fresh session.'
            : potDown && strategy === 'pot'
              ? 'PO Token sidecar unreachable mid-conversion. Restart the app so the sidecar re-spawns, or see Session settings for the no-POT fallback.'
              : firstError || 'Audio conversion failed. Please try another track or format.',
          errorDetails: stderrBuffer.slice(-2000) || undefined,
        });
        return;
      }

      const downloadsDir = FileService.getDownloadsDir();
      const files = fs.readdirSync(downloadsDir);
      const matchedFile = files.find(
        f => f.startsWith(jobId) && !f.endsWith('.part') && !f.endsWith('.ytdl')
      );

      if (!matchedFile) {
        JobManager.updateJob(jobId, {
          status: 'error',
          error: 'Converted audio file was not found on disk.',
        });
        return;
      }

      const stagedFile = path.join(downloadsDir, matchedFile);
      const actualExt = path.extname(stagedFile).replace('.', '').toLowerCase();

      const resolvedDisplayFileName = displayFileName.replace(/\.[a-z0-9]+$/i, `.${actualExt}`);
      const finalName = dedupeFileName(downloadsDir, resolvedDisplayFileName);
      const finalFile = path.join(downloadsDir, finalName);
      try {
        if (stagedFile !== finalFile) fs.renameSync(stagedFile, finalFile);
      } catch (renameErr: any) {
        JobManager.updateJob(jobId, {
          status: 'error',
          error: `Could not name the finished file: ${renameErr.message}`,
        });
        return;
      }

      if (options.embedThumbnail) {
        try {
          JobManager.updateJob(jobId, {
            stageMessage: 'Writing title, artist and album artwork...',
          });
          const current = JobManager.getJob(jobId);
          const minimalTags: MusicTags = {
            title: current?.title ?? `Track_${videoId}`,
            artist: current?.author ?? 'YouTube',
            album: undefined,
            coverUrl: current?.thumbnail,
            cleanDescription: true,
          };
          const tagged = await AudioTagService.applyTagsToFile(finalFile, minimalTags);
          if (tagged.coverDropped) {
            JobManager.updateJob(jobId, {
              tagWarning: `Cover art was dropped (${tagged.coverDropReason ?? 'unknown reason'}). Audio is intact.`,
            });
          }
        } catch (tagErr: unknown) {
          const message = tagErr instanceof Error ? tagErr.message : String(tagErr);
          console.warn(`Tagging warning for job ${jobId}:`, message);
          JobManager.updateJob(jobId, {
            tagWarning: `Metadata tagging failed: ${message}. Audio is intact.`,
          });
        }
      }

      const fileStat = fs.statSync(finalFile);
      const fileMeta = await readAudioMetadata(finalFile).catch(() => null);
      const fileTitle =
        fileMeta?.tags.title || JobManager.getJob(jobId)?.title || `Track_${videoId}`;
      const fileAuthor = fileMeta?.tags.artist || JobManager.getJob(jobId)?.author || 'YouTube';
      const fileTags = fileMeta?.tags;
      const fileHasCover = (fileMeta?.cover ?? null) !== null;

      const updated = JobManager.updateJob(jobId, {
        status: 'completed',
        progress: 100,
        stageMessage:
          format === 'best' || format === 'opus' || format === 'm4a'
            ? `Highest native audio stream extracted bit-for-bit (~${actualExt === 'opus' ? '160k Opus' : '128k AAC'})!`
            : 'Audio converted successfully!',
        title: fileTitle,
        author: fileAuthor,
        tags: fileTags,
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
          source: 'conversion',
          videoId,
          title: fileTitle,
          author: fileAuthor,
          thumbnail: buildArtworkUrl(jobId, updated.outputFilePath),
          sourceThumbnail: updated.thumbnail,
          format: actualExt,
          fileName: finalName,
          filePath: updated.outputFilePath,
          fileSizeBytes: fileStat.size,
          completedAt: updated.completedAt ?? Date.now(),
          tags: fileTags,
          hasCover: fileHasCover,
        });
        HistoryStore.add({
          jobId,
          videoId,
          canonicalUrl,
          title: updated.title,
          author: updated.author,
          thumbnail: updated.thumbnail,
          createdAt: updated.createdAt ?? Date.now(),
          completedAt: updated.completedAt ?? Date.now(),
        });
      }
    });

    child.on('error', err => {
      clearTimeout(timeout);
      JobManager.clearProcess(jobId);
      spawnFailed = true;
      JobManager.updateJob(jobId, {
        status: 'error',
        exitCode: null,
        error: `yt-dlp failed to start: ${err.message}. Check that Python is installed (Windows "py" launcher) or set YTDLP_PATH to a working yt-dlp.exe.`,
        errorDetails: String(err.stack || err.message).slice(0, 1000),
      });
    });
  }
}
