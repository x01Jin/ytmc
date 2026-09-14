import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { COOKIES_FILE, DOWNLOADS_DIR, PLUGINS_DIR, SUPPORTED_BITRATES, SUPPORTED_FORMATS, YTDLP_PATH } from '../config.js';
import { AudioTagService, MusicTags } from './audioTagService.js';
import { CookieService } from './cookieService.js';
import { ConversionJob, JobManager } from './jobManager.js';
import { MetadataService } from './metadataService.js';
import { parseYouTubeInput } from './urlService.js';

export interface ConvertRequestOptions {
  url: string;
  format?: string;
  bitrate?: string;
  trimStart?: string;
  trimEnd?: string;
  volumeBoost?: number;
  normalizeAudio?: boolean;
  embedThumbnail?: boolean;
  tags?: MusicTags;
}

export class ConversionService {
  private static ensureDownloadsDir(): void {
    if (!fs.existsSync(DOWNLOADS_DIR)) {
      fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
    }
  }

  private static sanitizeFilename(name: string): string {
    return name
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
  }

  public static async startConversion(options: ConvertRequestOptions): Promise<ConversionJob> {
    this.ensureDownloadsDir();

    const parsed = parseYouTubeInput(options.url);
    if (!parsed.isValid || !parsed.videoId || !parsed.canonicalUrl) {
      throw new Error('Invalid YouTube URL or Video ID provided');
    }

    const videoId = parsed.videoId;
    const canonicalUrl = parsed.canonicalUrl;
    const format = (options.format && SUPPORTED_FORMATS.includes(options.format as any))
      ? options.format
      : 'best';
    const bitrate = (options.bitrate && SUPPORTED_BITRATES.includes(options.bitrate as any))
      ? options.bitrate
      : 'native';

    // Fetch quick oEmbed info to immediately initialize job and output filename
    const oembed = await MetadataService.fetchOEmbed(canonicalUrl);
    const rawTitle = options.tags?.title || oembed?.title || `Track_${videoId}`;
    const rawAuthor = options.tags?.artist || oembed?.author || 'YouTube';
    const thumbnail = options.tags?.coverUrl || oembed?.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    const jobId = crypto.randomUUID();
    const cleanTitle = this.sanitizeFilename(rawTitle);
    const cleanAuthor = this.sanitizeFilename(rawAuthor);
    const extLabel = format === 'best' ? 'opus' : format;
    const displayFileName = cleanTitle.toLowerCase().startsWith(cleanAuthor.toLowerCase())
      ? `${cleanTitle}.${extLabel}`
      : `${cleanAuthor} - ${cleanTitle}.${extLabel}`;

    const job = JobManager.createJob(
      jobId,
      videoId,
      rawTitle,
      rawAuthor,
      thumbnail,
      format,
      bitrate
    );
    if (options.tags) {
      job.tags = options.tags;
    }

    // Asynchronously execute yt-dlp conversion pipeline
    this.executeYtDlp(jobId, canonicalUrl, videoId, format, bitrate, displayFileName, options);

    return job;
  }

  private static executeYtDlp(
    jobId: string,
    canonicalUrl: string,
    videoId: string,
    format: string,
    bitrate: string,
    displayFileName: string,
    options: ConvertRequestOptions
  ): void {
    const outputTemplate = path.join(DOWNLOADS_DIR, `${jobId}.%(ext)s`);
    const cookiesPath = CookieService.getCookiesPath();

    // Setup audio filters (loudnorm, volume)
    const ffmpegFilters: string[] = [];
    if (options.normalizeAudio) {
      ffmpegFilters.push('loudnorm');
    } else if (options.volumeBoost && options.volumeBoost !== 100) {
      const factor = (options.volumeBoost / 100).toFixed(2);
      ffmpegFilters.push(`volume=${factor}`);
    }
    const hasFilters = ffmpegFilters.length > 0;

    // Target highest quality audio stream from YouTube
    const args: string[] = [
      '--js-runtimes', `node:${process.execPath}`,
      '--extractor-args', 'youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416',
      '--no-playlist',
      '--newline',
      '-f', 'ba/b',
      '-o', outputTemplate
    ];

    // Cookies support
    if (cookiesPath) {
      args.push('--cookies', cookiesPath);
    }

    // Trimming / section download support
    if (options.trimStart || options.trimEnd) {
      const start = options.trimStart?.trim() || '00:00';
      const end = options.trimEnd?.trim() || 'inf';
      args.push('--download-sections', `*${start}-${end}`);
      args.push('--force-keyframes-at-cuts');
    }

    // Audio format & extraction configuration
    if (format === 'best' || format === 'opus' || format === 'm4a') {
      if (!hasFilters) {
        // DIRECT STREAM COPY: Highest native bitrate without lossy re-encoding
        args.push('--extract-audio');
        args.push('--audio-format', format === 'best' ? 'best' : format);
      } else {
        // Filtering requires re-encoding; explicitly supply encoder codec to prevent
        // FFmpeg error: "Filtering and streamcopy cannot be used together"
        const targetFormat = format === 'm4a' ? 'm4a' : 'opus';
        const targetCodec = format === 'm4a' ? 'aac' : 'libopus';
        const targetBitrate = format === 'm4a' ? '128k' : '160k';

        args.push('--extract-audio');
        args.push('--audio-format', targetFormat);
        args.push('--postprocessor-args', `ExtractAudio:-c:a ${targetCodec} -b:a ${targetBitrate} -af ${ffmpegFilters.join(',')}`);
      }
    } else if (format === 'mp3') {
      // MP3 is always a transcode from native ~160k Opus / ~128k AAC
      const mp3Quality = (bitrate === 'native' || !bitrate) ? '160k' : bitrate;
      args.push('--extract-audio');
      args.push('--audio-format', 'mp3');
      args.push('--audio-quality', mp3Quality);

      if (hasFilters) {
        args.push('--postprocessor-args', `ExtractAudio:-c:a libmp3lame -af ${ffmpegFilters.join(',')}`);
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
        args.push('--postprocessor-args', `ExtractAudio:-c:a pcm_s16le -af ${ffmpegFilters.join(',')}`);
      }
    }

    // Embed thumbnail if requested and format supports direct thumbnail container
    if (options.embedThumbnail && (format === 'mp3' || format === 'm4a' || format === 'flac')) {
      args.push('--embed-thumbnail');
    }

    // Always target canonical URL
    args.push(canonicalUrl);

    JobManager.updateJob(jobId, {
      status: 'downloading',
      progress: 5,
      stageMessage: format === 'best' || format === 'opus' || format === 'm4a'
        ? 'Fetching highest native audio stream directly from YouTube (~160k Opus / ~128k AAC)...'
        : `Connecting to YouTube audio stream for ${format.toUpperCase()} conversion...`
    });

    const child = spawn(YTDLP_PATH, args, {
      env: {
        ...process.env,
        PYTHONPATH: PLUGINS_DIR
      }
    });

    let stderrBuffer = '';

    child.stdout.on('data', (chunk: Buffer) => {
      const line = chunk.toString();
      
      // Check for download percentage
      const downloadMatch = line.match(/\[download\]\s+([\d\.]+)%/);
      if (downloadMatch) {
        const percent = parseFloat(downloadMatch[1]);
        const calculated = Math.min(75, Math.floor(percent * 0.75));
        JobManager.updateJob(jobId, {
          status: 'downloading',
          progress: calculated,
          stageMessage: `Downloading audio stream (${Math.floor(percent)}%)...`
        });
      }

      // Check for audio extraction
      if (line.includes('[ExtractAudio]') || line.includes('Destination:')) {
        JobManager.updateJob(jobId, {
          status: 'converting',
          progress: 80,
          stageMessage: `Converting to ${format.toUpperCase()} (${bitrate})...`
        });
      }

      // Check for postprocessing
      if (line.includes('[Metadata]') || line.includes('[ThumbnailsConvertor]')) {
        JobManager.updateJob(jobId, {
          status: 'converting',
          progress: 90,
          stageMessage: 'Embedding ID3 metadata & album artwork...'
        });
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrBuffer += chunk.toString();
    });

    child.on('close', async (code) => {
      if (code !== 0) {
        const isBot = /sign in to confirm|not a bot|bot|login_required|cookies-from-browser|403/i.test(stderrBuffer);

        JobManager.updateJob(jobId, {
          status: 'error',
          isBotBlocked: isBot,
          error: isBot
            ? 'YouTube requires user session cookies or verification for this track in cloud environments. Please open Session & Cookie Settings to import browser cookies or auto-fetch a fresh session.'
            : (stderrBuffer.split('\n').filter(l => l.includes('ERROR:'))[0] || 'Audio conversion failed. Please try another track or format.')
        });
        return;
      }

      // Locate output file
      const files = fs.readdirSync(DOWNLOADS_DIR);
      const matchedFile = files.find(f => f.startsWith(jobId) && !f.endsWith('.part') && !f.endsWith('.ytdl'));
      
      if (!matchedFile) {
        JobManager.updateJob(jobId, {
          status: 'error',
          error: 'Converted audio file was not found on disk.'
        });
        return;
      }

      const finalFile = path.join(DOWNLOADS_DIR, matchedFile);
      const actualExt = path.extname(finalFile).replace('.', '').toLowerCase();

      // Compute display file name with actual extension
      const resolvedDisplayFileName = displayFileName.replace(/\.[a-z0-9]+$/i, `.${actualExt}`);

      // If user specified custom metadata tags, embed them directly using AudioTagService
      if (options.tags) {
        try {
          JobManager.updateJob(jobId, {
            stageMessage: 'Writing custom music tags and album artwork...'
          });
          await AudioTagService.applyTagsToFile(finalFile, options.tags);
        } catch (tagErr: any) {
          console.warn(`Tagging warning for job ${jobId}:`, tagErr.message);
        }
      }

      const fileStat = fs.statSync(finalFile);

      JobManager.updateJob(jobId, {
        status: 'completed',
        progress: 100,
        stageMessage: format === 'best' || format === 'opus' || format === 'm4a'
          ? `Highest native audio stream extracted bit-for-bit (~${actualExt === 'opus' ? '160k Opus' : '128k AAC'})!`
          : 'Audio converted and tagged successfully!',
        format: actualExt,
        outputFilePath: finalFile,
        outputFileName: resolvedDisplayFileName,
        fileSizeBytes: fileStat.size,
        downloadUrl: `/api/download/${jobId}`,
        streamUrl: `/api/stream/${jobId}`,
        completedAt: Date.now(),
        tags: options.tags
      });
    });

    child.on('error', (err) => {
      JobManager.updateJob(jobId, {
        status: 'error',
        error: `Process error: ${err.message}`
      });
    });
  }
}
