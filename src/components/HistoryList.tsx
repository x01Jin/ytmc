import { Download, FileAudio, History, Play } from 'lucide-react';
import React from 'react';
import { ConversionJob } from '../types';

interface HistoryListProps {
  jobs: ConversionJob[];
  onSelectJob: (job: ConversionJob) => void;
}

export const HistoryList: React.FC<HistoryListProps> = ({ jobs, onSelectJob }) => {
  const completedJobs = jobs.filter(j => j.status === 'completed');

  if (completedJobs.length === 0) {
    return null;
  }

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  return (
    <section id="conversion-history-section" className="w-full bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 shadow-sm space-y-3 transition-colors">
      <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-2">
        <div className="flex items-center gap-1.5 text-zinc-800 dark:text-zinc-200">
          <History className="w-4 h-4 text-zinc-500 dark:text-zinc-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider">Recent Conversions</h3>
        </div>
        <span className="text-xs text-zinc-400 dark:text-zinc-500">{completedJobs.length} tracks</span>
      </div>

      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {completedJobs.map((job) => (
          <div
            key={job.id}
            id={`history-item-${job.id}`}
            className="py-2.5 flex items-center justify-between gap-3 group"
          >
            <div
              className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer"
              onClick={() => onSelectJob(job)}
            >
              <div className="relative w-10 h-10 rounded-lg overflow-hidden bg-zinc-100 dark:bg-zinc-950 shrink-0 border border-zinc-200 dark:border-zinc-800">
                <img
                  src={job.thumbnail}
                  alt={job.title}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                  <Play className="w-4 h-4 fill-white" />
                </div>
              </div>

              <div className="min-w-0">
                <h4 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100 truncate group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors">
                  {job.title}
                </h4>
                <div className="flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                  <span>{job.author}</span>
                  <span>•</span>
                  <span className="uppercase font-medium text-zinc-600 dark:text-zinc-300">{job.format}</span>
                  {job.fileSizeBytes && <span>• {formatFileSize(job.fileSizeBytes)}</span>}
                </div>
              </div>
            </div>

            <a
              id={`history-download-${job.id}`}
              href={job.downloadUrl || `/api/download/${job.id}`}
              download={job.outputFileName || `${job.title}.${job.format}`}
              className="p-2 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors shrink-0"
              title="Download file"
            >
              <Download className="w-4 h-4" />
            </a>
          </div>
        ))}
      </div>
    </section>
  );
};
