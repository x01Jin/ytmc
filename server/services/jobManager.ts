import fs from 'fs';
import path from 'path';
import { DOWNLOADS_DIR } from '../config.js';
import { MusicTags } from './audioTagService.js';

export type JobStatus = 'queued' | 'downloading' | 'converting' | 'completed' | 'error';

export interface ConversionJob {
  id: string;
  videoId: string;
  title: string;
  author: string;
  thumbnail: string;
  format: string;
  bitrate: string;
  status: JobStatus;
  progress: number;
  stageMessage: string;
  error?: string;
  isBotBlocked?: boolean;
  outputFilePath?: string;
  outputFileName?: string;
  fileSizeBytes?: number;
  downloadUrl?: string;
  streamUrl?: string;
  createdAt: number;
  completedAt?: number;
  tags?: MusicTags;
}

export class JobManager {
  private static jobs: Map<string, ConversionJob> = new Map();

  public static createJob(
    id: string,
    videoId: string,
    title: string,
    author: string,
    thumbnail: string,
    format: string,
    bitrate: string
  ): ConversionJob {
    const job: ConversionJob = {
      id,
      videoId,
      title,
      author,
      thumbnail,
      format,
      bitrate,
      status: 'queued',
      progress: 0,
      stageMessage: 'Initializing conversion job...',
      createdAt: Date.now()
    };
    this.jobs.set(id, job);
    return job;
  }

  public static getJob(id: string): ConversionJob | undefined {
    return this.jobs.get(id);
  }

  public static updateJob(id: string, updates: Partial<ConversionJob>): ConversionJob | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    Object.assign(job, updates);
    return job;
  }

  public static listRecentJobs(limit = 10): ConversionJob[] {
    return Array.from(this.jobs.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  /**
   * Cleanup old jobs and files older than 2 hours.
   */
  public static cleanupOldJobs(): void {
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    for (const [id, job] of this.jobs.entries()) {
      if (job.createdAt < twoHoursAgo) {
        if (job.outputFilePath && fs.existsSync(job.outputFilePath)) {
          try {
            fs.unlinkSync(job.outputFilePath);
          } catch {
            // Ignore file deletion error
          }
        }
        this.jobs.delete(id);
      }
    }

    // Also scan downloads directory for orphaned files older than 2 hours
    if (fs.existsSync(DOWNLOADS_DIR)) {
      try {
        const files = fs.readdirSync(DOWNLOADS_DIR);
        for (const file of files) {
          const filePath = path.join(DOWNLOADS_DIR, file);
          const stat = fs.statSync(filePath);
          if (stat.mtimeMs < twoHoursAgo) {
            fs.unlinkSync(filePath);
          }
        }
      } catch {
        // Ignore directory cleanup error
      }
    }
  }
}

// Periodically run cleanup every 30 minutes
setInterval(() => {
  JobManager.cleanupOldJobs();
}, 30 * 60 * 1000);
