import { AlertCircle, Music, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ConversionOptionsPanel } from "./components/ConversionOptionsPanel";
import { ConversionProgress } from "./components/ConversionProgress";
import { CookieModal } from "./components/CookieModal";
import { DownloadSection } from "./components/DownloadSection";
import { Header } from "./components/Header";
import { HistoryList } from "./components/HistoryList";
import { UrlInput } from "./components/UrlInput";
import { VideoCard } from "./components/VideoCard";
import { ApiClient } from "./services/apiClient";
import {
  ConversionJob,
  ConversionOptions,
  CookieStatus,
  DemoTrack,
  VideoMetadata,
} from "./types";

export default function App() {
  const [url, setUrl] = useState("");
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [isInspecting, setIsInspecting] = useState(false);
  const [inspectError, setInspectError] = useState<string | null>(null);

  const [options, setOptions] = useState<ConversionOptions>({
    format: "best",
    bitrate: "native",
    trimStart: "",
    trimEnd: "",
    volumeBoost: 100,
    normalizeAudio: false,
    embedThumbnail: true,
  });

  const [activeJob, setActiveJob] = useState<ConversionJob | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [recentJobs, setRecentJobs] = useState<ConversionJob[]>([]);
  const [demoTracks, setDemoTracks] = useState<DemoTrack[]>([]);

  const [cookieStatus, setCookieStatus] = useState<CookieStatus>({
    configured: false,
    sizeBytes: 0,
    lineCount: 0,
    lastModified: null,
    sampleDomains: [],
  });
  const [isCookieModalOpen, setIsCookieModalOpen] = useState(false);

  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Initialize data on mount
  useEffect(() => {
    ApiClient.getCookieStatus()
      .then((status) => {
        setCookieStatus(status);
        if (!status.configured) {
          ApiClient.autoFetchCookies()
            .then((res) => {
              setCookieStatus(res.status);
            })
            .catch(() => {});
        }
      })
      .catch(() => {});
    ApiClient.getDemoTracks()
      .then(setDemoTracks)
      .catch(() => {});
    ApiClient.getRecentJobs()
      .then(setRecentJobs)
      .catch(() => {});
  }, []);

  // Poll active conversion job until completed or failed
  useEffect(() => {
    if (!activeJob) return;

    if (activeJob.status === "completed" || activeJob.status === "error") {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      setIsConverting(false);
      if (activeJob.status === "completed") {
        ApiClient.getRecentJobs()
          .then(setRecentJobs)
          .catch(() => {});
      }
      return;
    }

    if (!pollIntervalRef.current) {
      pollIntervalRef.current = setInterval(async () => {
        try {
          const updated = await ApiClient.getJobStatus(activeJob.id);
          setActiveJob(updated);
        } catch {
          // Ignore network glitch during polling
        }
      }, 1000);
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [activeJob?.id, activeJob?.status]);

  const handleInspectUrl = async (inputUrl?: string) => {
    const targetUrl = inputUrl || url;
    if (!targetUrl.trim()) return;

    setIsInspecting(true);
    setInspectError(null);
    setActiveJob(null);

    try {
      const data = await ApiClient.fetchVideoInfo(targetUrl);
      setMetadata(data);
    } catch (err: unknown) {
      setInspectError(
        err instanceof Error
          ? err.message
          : "Failed to load video details. Please check the URL.",
      );
      setMetadata(null);
    } finally {
      setIsInspecting(false);
    }
  };

  const handleSelectDemo = (track: DemoTrack) => {
    const demoUrl = `https://www.youtube.com/watch?v=${track.id}`;
    setUrl(demoUrl);
    handleInspectUrl(demoUrl);
  };

  const handleStartConversion = async () => {
    if (!metadata) return;

    setIsConverting(true);
    try {
      const canonicalUrl = `https://www.youtube.com/watch?v=${metadata.id}`;
      const job = await ApiClient.startConversion(canonicalUrl, options);
      setActiveJob(job);
    } catch (err: unknown) {
      setIsConverting(false);
      setInspectError(
        err instanceof Error
          ? err.message
          : "Failed to initiate audio conversion",
      );
    }
  };

  const handleReset = () => {
    setActiveJob(null);
    setMetadata(null);
    setUrl("");
    setInspectError(null);
  };

  const handleSelectHistoryJob = (job: ConversionJob) => {
    setActiveJob(job);
    setUrl(`https://www.youtube.com/watch?v=${job.videoId}`);
    setMetadata({
      id: job.videoId,
      title: job.title,
      author: job.author,
      thumbnail: job.thumbnail,
      isAvailable: true,
      botVerificationRequired: false,
      hasCookiesConfigured: cookieStatus.configured,
    });
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 flex flex-col selection:bg-rose-500 selection:text-white transition-colors">
      {/* Header */}
      <Header
        cookieStatus={cookieStatus}
        onOpenCookiesModal={() => setIsCookieModalOpen(true)}
      />

      {/* Main App Container */}
      <main className="flex-1 w-full max-w-3xl mx-auto px-4 sm:px-6 py-6 md:py-8 space-y-6">
        {/* Intro Tagline */}
        <section className="text-center space-y-1.5 pb-2">
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-zinc-900 dark:text-zinc-100">
            Convert YouTube to Music
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400 max-w-lg mx-auto">
            Extract studio-grade audio in MP3, M4A, FLAC, WAV, and Opus. Fast,
            private, and tagged with album cover art.
          </p>
        </section>

        {/* Step 1: Input URL and Demo tracks */}
        <UrlInput
          value={url}
          onChange={(newVal) => {
            setUrl(newVal);
            if (inspectError) setInspectError(null);
          }}
          onSubmit={() => handleInspectUrl()}
          isLoading={isInspecting}
          demoTracks={demoTracks}
          onSelectDemo={handleSelectDemo}
        />

        {/* Error message */}
        {inspectError && (
          <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-300 text-xs sm:text-sm flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold">Unable to load video</p>
              <p className="text-rose-700 dark:text-rose-400 mt-0.5">
                {inspectError}
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleInspectUrl()}
              className="px-2 py-1 rounded bg-rose-100 dark:bg-rose-900/60 hover:bg-rose-200 dark:hover:bg-rose-800 text-rose-900 dark:text-rose-200 text-xs font-semibold shrink-0"
            >
              Retry
            </button>
          </div>
        )}

        {/* Step 2: Loaded Video Preview */}
        {metadata && (
          <VideoCard
            metadata={metadata}
            onOpenCookiesModal={() => setIsCookieModalOpen(true)}
          />
        )}

        {/* Step 3: Active Job Progress or Completed State */}
        {activeJob ? (
          activeJob.status === "completed" ? (
            <DownloadSection
              job={activeJob}
              onReset={handleReset}
              onJobUpdated={(updatedJob) => {
                setActiveJob(updatedJob);
                setRecentJobs((prev) =>
                  prev.map((j) => (j.id === updatedJob.id ? updatedJob : j)),
                );
              }}
            />
          ) : (
            <ConversionProgress
              job={activeJob}
              onRetry={handleStartConversion}
              onOpenCookiesModal={() => setIsCookieModalOpen(true)}
            />
          )
        ) : (
          /* Step 3: Options Panel (when video is inspected and no active job running) */
          metadata && (
            <ConversionOptionsPanel
              options={options}
              onChange={setOptions}
              onConvert={handleStartConversion}
              isConverting={isConverting}
              defaultVideoTitle={metadata.title}
              defaultArtist={metadata.author}
              defaultThumbnail={metadata.thumbnail}
            />
          )
        )}

        {/* Step 4: Recent Conversions History */}
        {recentJobs.length > 0 && (
          <HistoryList jobs={recentJobs} onSelectJob={handleSelectHistoryJob} />
        )}
      </main>

      {/* Footer */}
      <footer className="w-full border-t border-zinc-200 dark:border-zinc-800 py-4 bg-white dark:bg-zinc-900 text-center text-xs text-zinc-500 dark:text-zinc-400 transition-colors">
        <div className="max-w-3xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>YouTube to Music Converter • Audio Extraction Engine</span>
          <span>Powered by yt-dlp & FFmpeg</span>
        </div>
      </footer>

      {/* Session Cookies Modal */}
      <CookieModal
        isOpen={isCookieModalOpen}
        onClose={() => setIsCookieModalOpen(false)}
        status={cookieStatus}
        onStatusUpdated={setCookieStatus}
      />
    </div>
  );
}
