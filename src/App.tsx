import { Suspense, lazy, useEffect, useState } from 'react';
import {
  AppShell,
  ShellContent,
  ShellMain,
  SideNav,
  StatusBar,
  TitleBar,
  useHashRoute,
} from './components/AppShell';
import { UpdateNotice } from './components/UpdateNotice';
import { ConvertRoute } from './routes/Convert';
import {
  ConvertDraftProvider,
  HistoryProvider,
  JobsProvider,
  LibraryProvider,
  SessionProvider,
  SettingsProvider,
  useJobs,
  useLibrary,
  useSession,
  useSettings,
} from './store/appStore';
import { ApiClient } from './services/apiClient';
import { formatFileSize } from './utils/format';

const YouTubeRoute = lazy(() =>
  import('./routes/YouTube').then(m => ({ default: m.YouTubeRoute }))
);
const LibraryRoute = lazy(() =>
  import('./routes/Library').then(m => ({ default: m.LibraryRoute }))
);
const HistoryRoute = lazy(() =>
  import('./routes/History').then(m => ({ default: m.HistoryRoute }))
);
const QueueRoute = lazy(() => import('./routes/Queue').then(m => ({ default: m.QueueRoute })));
const SettingsRoute = lazy(() =>
  import('./routes/Settings').then(m => ({ default: m.SettingsRoute }))
);

function RouteFallback() {
  return (
    <div className="px-panel p-2" aria-label="Loading section">
      <p className="text-sm text-px-dim">Loading…</p>
    </div>
  );
}

function ShellChrome() {
  const { route, navigate } = useHashRoute();
  const { state: jobs } = useJobs();
  const { state: libraryState } = useLibrary();
  const { state: settingsState } = useSettings();
  const { state: session } = useSession();
  const [engineOk, setEngineOk] = useState(false);
  const [youtubeMounted, setYoutubeMounted] = useState(false);

  useEffect(() => {
    if (route === 'youtube') setYoutubeMounted(true);
  }, [route]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      ApiClient.getHealth()
        .then(health => {
          if (!cancelled) {
            setEngineOk(health.readiness.ytDlp === true && health.readiness.ffmpeg === true);
          }
        })
        .catch(() => {
          if (!cancelled) setEngineOk(false);
        });
    };
    load();
    const timer = window.setInterval(load, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const activeCount =
    jobs.activeJob && jobs.activeJob.status !== 'completed' && jobs.activeJob.status !== 'error'
      ? 1
      : 0;
  const folderLabel =
    settingsState.settings?.downloadsDir ?? libraryState.library?.downloadsDir ?? 'Library folder…';
  const fileCount = libraryState.library ? libraryState.library.records.length : null;
  const totalSize = libraryState.library
    ? formatFileSize(libraryState.library.totalSizeBytes)
    : null;

  const handleRevealFolder = () => {
    const first = libraryState.library?.records[0];
    if (first) void ApiClient.revealFile(first.jobId).catch(() => {});
  };

  return (
    <AppShell>
      <TitleBar />
      <ShellMain>
        <SideNav route={route} onNavigate={navigate} queueCount={activeCount} />
        <ShellContent>
          <UpdateNotice />
          {route === 'convert' && <ConvertRoute />}
          {youtubeMounted && (
            <div className={route === 'youtube' ? 'contents' : 'hidden'}>
              <Suspense fallback={<RouteFallback />}>
                <YouTubeRoute onDownload={() => navigate('convert')} active={route === 'youtube'} />
              </Suspense>
            </div>
          )}
          {route === 'library' && (
            <Suspense fallback={<RouteFallback />}>
              <LibraryRoute />
            </Suspense>
          )}
          {route === 'history' && (
            <Suspense fallback={<RouteFallback />}>
              <HistoryRoute onReconvert={() => navigate('convert')} />
            </Suspense>
          )}
          {route === 'queue' && (
            <Suspense fallback={<RouteFallback />}>
              <QueueRoute />
            </Suspense>
          )}
          {route === 'settings' && (
            <Suspense fallback={<RouteFallback />}>
              <SettingsRoute />
            </Suspense>
          )}
        </ShellContent>
      </ShellMain>
      <StatusBar
        engineOk={engineOk}
        sessionOk={session.status.configured}
        folderLabel={folderLabel}
        fileCount={fileCount}
        totalSize={totalSize}
        onRevealFolder={handleRevealFolder}
      />
    </AppShell>
  );
}

export default function App() {
  return (
    <SettingsProvider>
      <SessionProvider>
        <JobsProvider>
          <ConvertDraftProvider>
            <LibraryProvider>
              <HistoryProvider>
                <ShellChrome />
              </HistoryProvider>
            </LibraryProvider>
          </ConvertDraftProvider>
        </JobsProvider>
      </SessionProvider>
    </SettingsProvider>
  );
}
