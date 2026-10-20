import { spawn, type ChildProcess } from 'child_process';
import type { MusicTags } from './audioTagService.js';

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
  tagWarning?: string;
  exitCode?: number | null;
  isBotBlocked?: boolean;
  outputFilePath?: string;
  outputFileName?: string;
  fileSizeBytes?: number;
  streamUrl?: string;
  createdAt: number;
  completedAt?: number;
  tags?: MusicTags;
}

const JOB_RETENTION_MS = 2 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000;

function terminateTree(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid) {
    try {
      child.kill('SIGTERM');
    } catch (err) {
      console.warn('Could not signal conversion process:', err);
    }
    return;
  }
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    killer.on('error', err => {
      console.warn(`Could not terminate process tree ${pid}:`, err);
      try {
        child.kill('SIGTERM');
      } catch (killErr) {
        console.warn(`Could not signal conversion process ${pid}:`, killErr);
      }
    });
    return;
  }
  try {
    child.kill('SIGTERM');
  } catch (err) {
    console.warn(`Could not signal conversion process ${pid}:`, err);
  }
}

export namespace JobManager {
  let jobs: Map<string, ConversionJob> = new Map();
  let processes: Map<string, ChildProcess> = new Map();

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

  export function registerProcess(id: string, child: ChildProcess): void {
    processes.set(id, child);
  }

  export function clearProcess(id: string): void {
    processes.delete(id);
  }

  export function terminateProcess(id: string): boolean {
    const child = processes.get(id);
    if (!child) return false;
    terminateTree(child);
    return true;
  }

  export function cancelJob(id: string): boolean {
    const job = jobs.get(id);
    if (!job) return false;
    if (job.status === 'completed' || job.status === 'error') return false;
    return terminateProcess(id);
  }

  export function cleanupOldJobs(): void {
    const twoHoursAgo = Date.now() - JOB_RETENTION_MS;
    for (const [id, job] of jobs.entries()) {
      if (job.createdAt < twoHoursAgo) {
        jobs.delete(id);
      }
    }
  }
}

const cleanupTimer = setInterval(() => {
  JobManager.cleanupOldJobs();
}, CLEANUP_INTERVAL_MS);
cleanupTimer.unref?.();
