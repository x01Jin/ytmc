import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { ApiClient } from "../services/apiClient";
import type {
  AppSettings,
  ConversionJob,
  ConversionOptions,
  CookieStatus,
  HistoryEntry,
  LibraryData,
  VideoMetadata,
} from "../types";
import { useJobPolling } from "../hooks/useJobPolling";
import { migrateNormalizeMode } from "../utils/normalizeModes";

// --- Jobs ---

interface JobsContextValue {
  state: {
    activeJob: ConversionJob | null;
    recentJobs: ConversionJob[];
    isConverting: boolean;
  };
  actions: {
    startConversion: (url: string, options: ConversionOptions) => Promise<void>;
    selectJob: (job: ConversionJob) => void;
    updateJob: (job: ConversionJob) => void;
    resetActive: () => void;
    refreshRecent: () => Promise<void>;
  };
}

const JobsContext = createContext<JobsContextValue | null>(null);

export function JobsProvider({ children }: { children: ReactNode }) {
  const [activeJob, setActiveJob] = useState<ConversionJob | null>(null);
  const [recentJobs, setRecentJobs] = useState<ConversionJob[]>([]);
  const [isConverting, setIsConverting] = useState(false);

  const refreshRecent = useCallback(async () => {
    try {
      setRecentJobs(await ApiClient.getRecentJobs());
    } catch {
      // Library view has its own on-disk fallback.
    }
  }, []);

  useEffect(() => {
    void refreshRecent();
  }, [refreshRecent]);

  useJobPolling(activeJob?.id ?? null, activeJob?.status, {
    onUpdate: (job) => setActiveJob(job),
    onDone: (job) => {
      setIsConverting(false);
      if (job.status === "completed") void refreshRecent();
    },
  });

  const startConversion = useCallback(
    async (url: string, options: ConversionOptions) => {
      setIsConverting(true);
      try {
        const job = await ApiClient.startConversion(url, options);
        setActiveJob(job);
      } catch (err) {
        setIsConverting(false);
        throw err;
      }
    },
    [],
  );

  const selectJob = useCallback((job: ConversionJob) => setActiveJob(job), []);
  const updateJob = useCallback((job: ConversionJob) => {
    setActiveJob(job);
    setRecentJobs((prev) => prev.map((j) => (j.id === job.id ? job : j)));
  }, []);
  const resetActive = useCallback(() => {
    setActiveJob(null);
    setIsConverting(false);
  }, []);

  const value = useMemo<JobsContextValue>(
    () => ({
      state: { activeJob, recentJobs, isConverting },
      actions: {
        startConversion,
        selectJob,
        updateJob,
        resetActive,
        refreshRecent,
      },
    }),
    [
      activeJob,
      recentJobs,
      isConverting,
      startConversion,
      selectJob,
      updateJob,
      resetActive,
      refreshRecent,
    ],
  );

  return <JobsContext value={value}>{children}</JobsContext>;
}

export function useJobs(): JobsContextValue {
  const ctx = use(JobsContext);
  if (!ctx) throw new Error("useJobs must be used inside JobsProvider");
  return ctx;
}

// --- History (persistent convert-tab log; untouched by library edits) ---

interface HistoryContextValue {
  state: {
    entries: HistoryEntry[];
    isLoading: boolean;
  };
  actions: {
    refresh: () => Promise<void>;
    removeEntry: (jobId: string) => Promise<void>;
    clear: () => Promise<void>;
  };
}

const HistoryContext = createContext<HistoryContextValue | null>(null);

export function HistoryProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      setEntries(await ApiClient.getHistory());
    } catch {
      // History stays as-is on network failure; never blanked optimistically.
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Optimistic removal with rollback (per frontend-api-integration-patterns).
  const removeEntry = useCallback(
    async (jobId: string) => {
      const previous = entries;
      if (!previous.some((e) => e.jobId === jobId)) return;
      setEntries(previous.filter((e) => e.jobId !== jobId));
      try {
        await ApiClient.deleteHistoryItem(jobId);
      } catch {
        // Roll back on failure so the entry is not silently lost.
        setEntries(previous);
      }
    },
    [entries],
  );

  const clear = useCallback(async () => {
    const previous = entries;
    setEntries([]);
    try {
      await ApiClient.clearHistory();
    } catch (err) {
      setEntries(previous);
      throw err;
    }
  }, [entries]);

  const value = useMemo<HistoryContextValue>(
    () => ({
      state: { entries, isLoading },
      actions: { refresh, removeEntry, clear },
    }),
    [entries, isLoading, refresh, removeEntry, clear],
  );

  return <HistoryContext value={value}>{children}</HistoryContext>;
}

export function useHistory(): HistoryContextValue {
  const ctx = use(HistoryContext);
  if (!ctx) throw new Error("useHistory must be used inside HistoryProvider");
  return ctx;
}

// --- Library ---

interface LibraryContextValue {
  state: {
    library: LibraryData | null;
    isLoading: boolean;
    error: string | null;
  };
  actions: {
    refresh: () => Promise<void>;
    importFile: (file: File) => Promise<void>;
    deleteFile: (jobId: string) => Promise<void>;
    revealFile: (jobId: string) => Promise<void>;
  };
}

const LibraryContext = createContext<LibraryContextValue | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [library, setLibrary] = useState<LibraryData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Sequence guard: overlapping refreshes (edit + import + poll) resolve in
  // any order, so only the newest response may write state (race-safe fetch).
  const refreshSeq = useRef(0);

  const refresh = useCallback(async () => {
    const seq = (refreshSeq.current += 1);
    setIsLoading(true);
    setError(null);
    try {
      const data = await ApiClient.getLibrary();
      if (seq !== refreshSeq.current) return;
      setLibrary(data);
    } catch (err) {
      if (seq !== refreshSeq.current) return;
      setError(
        err instanceof Error ? err.message : "Could not load your library.",
      );
    } finally {
      if (seq === refreshSeq.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const deleteFile = useCallback(
    async (jobId: string) => {
      await ApiClient.deleteLibraryFile(jobId);
      await refresh();
    },
    [refresh],
  );

  const importFile = useCallback(async (file: File) => {
    await ApiClient.importLibraryFile(file);
  }, []);

  const revealFile = useCallback(async (jobId: string) => {
    await ApiClient.revealFile(jobId);
  }, []);

  const value = useMemo<LibraryContextValue>(
    () => ({
      state: { library, isLoading, error },
      actions: { refresh, importFile, deleteFile, revealFile },
    }),
    [library, isLoading, error, refresh, importFile, deleteFile, revealFile],
  );

  return <LibraryContext value={value}>{children}</LibraryContext>;
}

export function useLibrary(): LibraryContextValue {
  const ctx = use(LibraryContext);
  if (!ctx) throw new Error("useLibrary must be used inside LibraryProvider");
  return ctx;
}

// --- Settings ---

interface SettingsContextValue {
  state: {
    settings: AppSettings | null;
    isLoading: boolean;
    error: string | null;
  };
  actions: {
    save: (patch: Partial<AppSettings>) => Promise<void>;
    reset: () => Promise<void>;
  };
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

const SETTINGS_CACHE_KEY = "ytm-settings-v1";

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings | null>(() => {
    try {
      const cached = localStorage.getItem(SETTINGS_CACHE_KEY);
      return cached ? (JSON.parse(cached) as AppSettings) : null;
    } catch {
      return null;
    }
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    ApiClient.getSettings()
      .then((s) => {
        if (cancelled) return;
        setSettings(s);
        try {
          localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(s));
        } catch {}
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : "Could not load settings.",
          );
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = useCallback(async (patch: Partial<AppSettings>) => {
    const updated = await ApiClient.updateSettings(patch);
    setSettings(updated);
    try {
      localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(updated));
    } catch {}
  }, []);

  const reset = useCallback(async () => {
    const updated = await ApiClient.resetSettings();
    setSettings(updated);
    try {
      localStorage.setItem(SETTINGS_CACHE_KEY, JSON.stringify(updated));
    } catch {}
  }, []);

  const value = useMemo<SettingsContextValue>(
    () => ({ state: { settings, isLoading, error }, actions: { save, reset } }),
    [settings, isLoading, error, save, reset],
  );

  return <SettingsContext value={value}>{children}</SettingsContext>;
}

export function useSettings(): SettingsContextValue {
  const ctx = use(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used inside SettingsProvider");
  return ctx;
}

// --- Convert draft (survives tab switches + reloads) ---
//
// The Convert route unmounts on navigation, so inspected-video + conversion
// options live here (mounted above the router) instead of route-local
// useState. Mirrors the SettingsProvider localStorage pattern.

export interface ConvertDraft {
  url: string;
  metadata: VideoMetadata | null;
  options: ConversionOptions;
  /** One-shot URL queued by the History tab; Convert consumes it once and clears it. Not persisted. */
  pendingInspectUrl: string | null;
}

interface ConvertDraftContextValue {
  state: ConvertDraft;
  actions: {
    setUrl: (url: string) => void;
    setMetadata: (metadata: VideoMetadata | null) => void;
    setOptions: (options: ConversionOptions) => void;
    queueInspectUrl: (url: string) => void;
    consumeInspectUrl: () => void;
    resetDraft: () => void;
  };
}

const ConvertDraftContext = createContext<ConvertDraftContextValue | null>(
  null,
);

const CONVERT_DRAFT_KEY = "ytm-convert-draft-v1";

const DEFAULT_CONVERT_OPTIONS: ConversionOptions = {
  format: "best",
  bitrate: "native",
  trimStart: "",
  trimEnd: "",
  volumeBoost: 100,
  normalizeMode: "off",
  embedThumbnail: true,
};

function loadConvertDraft(): Omit<ConvertDraft, "pendingInspectUrl"> {
  const fallback = {
    url: "",
    metadata: null,
    options: DEFAULT_CONVERT_OPTIONS,
  };
  try {
    const raw = localStorage.getItem(CONVERT_DRAFT_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<ConvertDraft>;
    // Sanitize: the convert flow no longer carries autotagger tags, but
    // drafts persisted by older builds may still contain them. Drop the
    // stale field so it can never leak into a future conversion.
    if (
      parsed.options &&
      typeof parsed.options === "object" &&
      "tags" in parsed.options
    ) {
      const { tags: _staleTags, ...rest } =
        parsed.options as ConversionOptions & { tags?: unknown };
      parsed.options = rest;
    }
    return {
      url: typeof parsed.url === "string" ? parsed.url : "",
      metadata:
        parsed.metadata && typeof parsed.metadata === "object"
          ? (parsed.metadata as VideoMetadata)
          : null,
      options:
        parsed.options && typeof parsed.options === "object"
          ? {
              ...DEFAULT_CONVERT_OPTIONS,
              ...parsed.options,
              // Migrate legacy boolean drafts to the dual-mode selector.
              normalizeMode: migrateNormalizeMode(
                parsed.options as {
                  normalizeMode?: string;
                  normalizeAudio?: boolean;
                },
              ),
            }
          : DEFAULT_CONVERT_OPTIONS,
    };
  } catch {
    return fallback;
  }
}

export function ConvertDraftProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<ConvertDraft>(() => ({
    ...loadConvertDraft(),
    pendingInspectUrl: null,
  }));

  useEffect(() => {
    // Persist only the restorable fields; the one-shot inspect URL stays in memory.
    try {
      const { url, metadata, options } = draft;
      localStorage.setItem(
        CONVERT_DRAFT_KEY,
        JSON.stringify({ url, metadata, options }),
      );
    } catch {}
  }, [draft]);

  const setUrl = useCallback((url: string) => {
    setDraft((prev) => (prev.url === url ? prev : { ...prev, url }));
  }, []);
  const setMetadata = useCallback((metadata: VideoMetadata | null) => {
    setDraft((prev) => ({ ...prev, metadata }));
  }, []);
  const setOptions = useCallback((options: ConversionOptions) => {
    setDraft((prev) => ({ ...prev, options }));
  }, []);
  // Explicit Reset clears the inspected video but keeps the user's
  // conversion configuration.
  const resetDraft = useCallback(() => {
    setDraft((prev) => ({
      url: "",
      metadata: null,
      options: prev.options,
      pendingInspectUrl: null,
    }));
  }, []);
  const queueInspectUrl = useCallback((url: string) => {
    setDraft((prev) => ({ ...prev, pendingInspectUrl: url }));
  }, []);
  const consumeInspectUrl = useCallback(() => {
    setDraft((prev) =>
      prev.pendingInspectUrl === null
        ? prev
        : { ...prev, pendingInspectUrl: null },
    );
  }, []);

  const value = useMemo<ConvertDraftContextValue>(
    () => ({
      state: draft,
      actions: {
        setUrl,
        setMetadata,
        setOptions,
        queueInspectUrl,
        consumeInspectUrl,
        resetDraft,
      },
    }),
    [
      draft,
      setUrl,
      setMetadata,
      setOptions,
      queueInspectUrl,
      consumeInspectUrl,
      resetDraft,
    ],
  );

  return <ConvertDraftContext value={value}>{children}</ConvertDraftContext>;
}

export function useConvertDraft(): ConvertDraftContextValue {
  const ctx = use(ConvertDraftContext);
  if (!ctx)
    throw new Error("useConvertDraft must be used inside ConvertDraftProvider");
  return ctx;
}

// --- Session cookies (kept small: status only, modal owns the rest) ---

interface SessionContextValue {
  state: { status: CookieStatus };
  actions: {
    refresh: () => Promise<void>;
    update: (status: CookieStatus) => void;
  };
}

const SessionContext = createContext<SessionContextValue | null>(null);

const EMPTY_STATUS: CookieStatus = {
  configured: false,
  sizeBytes: 0,
  lineCount: 0,
  lastModified: null,
  sampleDomains: [],
};

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<CookieStatus>(EMPTY_STATUS);

  const refresh = useCallback(async () => {
    try {
      const next = await ApiClient.getCookieStatus();
      setStatus(next);
      if (!next.configured) {
        try {
          const res = await ApiClient.autoFetchCookies();
          setStatus(res.status);
        } catch {}
      }
    } catch {}
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<SessionContextValue>(
    () => ({ state: { status }, actions: { refresh, update: setStatus } }),
    [status, refresh],
  );

  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession(): SessionContextValue {
  const ctx = use(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
