import { execFile } from 'child_process';
import { CookieService } from './cookieService.js';
import { cookiesAllowed, extractorArgsFor, resolveStrategy } from './potService.js';
import { extractYouTubeId, parseYouTubeInput } from './urlService.js';
import { ytdlpEnv, ytdlpLaunch } from './ytdlpRunner.js';

export interface NativeAudioStreamInfo {
  formatId: string;
  codec: string;
  bitrateKbps: number;
  container: string;
  sampleRateHz?: number;
  channels?: number;
  note: string;
}

export interface VideoMetadata {
  id: string;
  title: string;
  author: string;
  authorUrl?: string;
  thumbnail: string;
  duration?: string;
  durationSeconds?: number;
  viewCount?: number;
  uploadDate?: string;
  isAvailable: boolean;
  botVerificationRequired: boolean;
  hasCookiesConfigured: boolean;
  /** Raw yt-dlp failure (first ERROR line) when the stream probe failed. */
  probeError?: string;
  description?: string;
  nativeStreams?: NativeAudioStreamInfo[];
  bestNativeStream?: NativeAudioStreamInfo;
}

export class MetadataService {
  /**
   * Fetches official oEmbed data for high reliability.
   */
  public static async fetchOEmbed(canonicalUrl: string): Promise<{
    title: string;
    author: string;
    authorUrl?: string;
    thumbnail: string;
  } | null> {
    try {
      const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`;
      const response = await fetch(endpoint, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!response.ok) return null;
      const data = await response.json() as any;

      return {
        title: data.title || 'Untitled Video',
        author: data.author_name || 'Unknown Channel',
        authorUrl: data.author_url,
        thumbnail: data.thumbnail_url || ''
      };
    } catch {
      return null;
    }
  }

  /**
   * Fetches full metadata using yt-dlp, augmented with oEmbed fallback.
   */
  public static async getVideoInfo(input: string): Promise<VideoMetadata> {
    const parsed = parseYouTubeInput(input);
    if (!parsed.isValid || !parsed.videoId || !parsed.canonicalUrl) {
      throw new Error('Please enter a valid YouTube video URL or ID');
    }

    const videoId = parsed.videoId;
    const canonicalUrl = parsed.canonicalUrl;
    const cookiesPath = CookieService.getCookiesPath();
    const hasCookies = !!cookiesPath;

    // 1. Fetch oEmbed first
    const oembed = await this.fetchOEmbed(canonicalUrl);

    // Default fallback metadata from oembed
    const metadata: VideoMetadata = {
      id: videoId,
      title: oembed?.title || `YouTube Video (${videoId})`,
      author: oembed?.author || 'YouTube Creator',
      authorUrl: oembed?.authorUrl,
      thumbnail: oembed?.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      isAvailable: true,
      botVerificationRequired: false,
      hasCookiesConfigured: hasCookies
    };

    // 2. Query yt-dlp for detailed metadata (duration, format readiness)
    const { strategy } = await resolveStrategy();
    const launch = ytdlpLaunch();
    const useCookies = cookiesAllowed(strategy, hasCookies);
    return new Promise((resolve) => {
      const args = [
        ...launch.prefixArgs,
        '--js-runtimes', `node:${process.execPath}`,
        ...extractorArgsFor(strategy),
        '--dump-json',
        '--no-playlist',
        '--no-warnings',
        '--skip-download'
      ];

      if (useCookies && cookiesPath) {
        args.push('--cookies', cookiesPath);
      }

      // Query direct canonical URL
      args.push(canonicalUrl);

      execFile(
        launch.command,
        args,
        {
          timeout: 45000,
          env: ytdlpEnv()
        },
        (error, stdout, stderr) => {
          if (error) {
            const errStr = `${stderr} ${error.message}`;
            if (/sign in to confirm|not a bot|bot|login_required|cookies-from-browser|403/i.test(errStr)) {
              metadata.botVerificationRequired = true;
            }
            // Surface the probe failure instead of silently implying
            // "Direct streamcopy ready" from oEmbed data alone.
            metadata.probeError =
              stderr.split('\n').filter(l => l.includes('ERROR:'))[0] ||
              error.message ||
              'Stream probe failed';
            // Even if yt-dlp errored, we resolve with the oembed data
            resolve(metadata);
            return;
          }

          try {
            const rawJson = stdout.trim();
            if (rawJson) {
              const details = JSON.parse(rawJson);
              if (details.title && !oembed?.title) {
                metadata.title = details.title;
              }
              if (details.uploader && !oembed?.author) {
                metadata.author = details.uploader;
              }
              if (details.duration_string) {
                metadata.duration = details.duration_string;
              }
              if (typeof details.duration === 'number') {
                metadata.durationSeconds = details.duration;
              }
              if (typeof details.view_count === 'number') {
                metadata.viewCount = details.view_count;
              }
              if (details.upload_date) {
                metadata.uploadDate = details.upload_date;
              }
              if (details.description) {
                metadata.description = details.description.slice(0, 300);
              }

              // Extract native audio streams directly from YouTube server format definitions
              if (Array.isArray(details.formats)) {
                const audioFormats = details.formats.filter((f: any) => 
                  f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none')
                );

                const streams: NativeAudioStreamInfo[] = audioFormats.map((f: any) => {
                  const isOpus = (f.acodec || '').toLowerCase().includes('opus');
                  const isAac = (f.acodec || '').toLowerCase().includes('mp4a') || (f.acodec || '').toLowerCase().includes('aac');
                  const codecName = isOpus ? 'Opus' : isAac ? 'AAC' : (f.acodec || 'Audio');
                  const abr = Math.round(f.abr || (f.tbr ? f.tbr : 128));
                  return {
                    formatId: String(f.format_id || ''),
                    codec: codecName,
                    bitrateKbps: abr,
                    container: f.ext || (isOpus ? 'webm' : 'm4a'),
                    sampleRateHz: f.asr ? Number(f.asr) : undefined,
                    channels: f.audio_channels ? Number(f.audio_channels) : 2,
                    note: `${codecName} ~${abr} kbps (${f.ext || (isOpus ? 'webm' : 'm4a')})${f.asr ? ` • ${f.asr / 1000}kHz` : ''}`
                  };
                });

                // Sort by highest bitrate
                streams.sort((a, b) => b.bitrateKbps - a.bitrateKbps);

                if (streams.length > 0) {
                  metadata.nativeStreams = streams;
                  metadata.bestNativeStream = streams[0];
                }
              }

              // Fallback native stream info if formats list wasn't populated
              if (!metadata.bestNativeStream) {
                metadata.bestNativeStream = {
                  formatId: '251',
                  codec: 'Opus',
                  bitrateKbps: 160,
                  container: 'webm',
                  sampleRateHz: 48000,
                  channels: 2,
                  note: 'Opus ~160 kbps (48kHz) • YouTube Max Native Stream'
                };
              }
            }
          } catch {
            // Keep oembed metadata
          }

          resolve(metadata);
        }
      );
    });
  }
}
