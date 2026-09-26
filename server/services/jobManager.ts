import fs from 'fs';
import path from 'path';
import type { MusicTags } from './audioTagService.js';
import { FileService } from './fileService.js';

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
  errorDetails?: string;
  exitCode?: number | null;
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

const JOB_RETENTION_MS = 2 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000;

export namespace JobManager {
  let jobs: Map<string, ConversionJob> = new Map();

  export function createJob(
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
      createdAt: Date.now(),
    };
    jobs.set(id, job);
    return job;
  }

  export function getJob(id: string): ConversionJob | undefined {
    return jobs.get(id);
  }

  export function updateJob(
    id: string,
    updates: Partial<ConversionJob>
  ): ConversionJob | undefined {
    const job = jobs.get(id);
    if (!job) return undefined;
    Object.assign(job, updates);
    return job;
  }

  export function listRecentJobs(limit = 10): ConversionJob[] {
    return Array.from(jobs.values())
      .toSorted((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  export function cleanupOldJobs(): void {
    const twoHoursAgo = Date.now() - JOB_RETENTION_MS;
    for (const [id, job] of jobs.entries()) {
      if (job.createdAt < twoHoursAgo) {
        if (job.outputFilePath && fs.existsSync(job.outputFilePath)) {
          try {
            fs.unlinkSync(job.outputFilePath);
          } catch (err: unknown) {
            console.warn(
              `cleanup: could not delete ${job.outputFilePath}:`,
              err instanceof Error ? err.message : err
            );
          }
        }
        jobs.delete(id);
      }
    }

    const downloadsDir = FileService.getDownloadsDir();
    if (fs.existsSync(downloadsDir)) {
      try {
        const files = fs.readdirSync(downloadsDir);
        for (const file of files) {
          const filePath = path.join(downloadsDir, file);
          const stat = fs.statSync(filePath);
          if (stat.mtimeMs < twoHoursAgo) {
            fs.unlinkSync(filePath);
          }
        }
      } catch (err: unknown) {
        console.warn(
          `cleanup: could not sweep ${downloadsDir}:`,
          err instanceof Error ? err.message : err
        );
      }
    }
  }
}

const cleanupTimer = setInterval(() => {
  JobManager.cleanupOldJobs();
}, CLEANUP_INTERVAL_MS);
cleanupTimer.unref?.();
