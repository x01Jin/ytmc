import {
  AppShell,
  ShellContent,
  ShellMain,
  SideNav,
  StatusBar,
  TitleBar,
  useHashRoute,
} from "./components/AppShell";
import { ConvertRoute } from "./routes/Convert";
import { HistoryRoute } from "./routes/History";
import { LibraryRoute } from "./routes/Library";
import { QueueRoute } from "./routes/Queue";
import { SettingsRoute } from "./routes/Settings";
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
} from "./store/appStore";
import { ApiClient } from "./services/apiClient";

const BYTES_PER_MB = 1024 * 1024;
const MB_PER_GB = 1024;

function formatTotal(bytes: number): string {
  const mb = bytes / BYTES_PER_MB;
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
  });
  if (mb >= MB_PER_GB) return `${formatted.format(mb / MB_PER_GB)} GB`;
  return `${formatted.format(mb)} MB`;
}

function ShellChrome() {
  const { route, navigate } = useHashRoute();
  const { state: jobs } = useJobs();
  const { state: libraryState } = useLibrary();
  const { state: settingsState } = useSettings();
  const { state: session } = useSession();

  const activeCount =
    jobs.activeJob &&
    jobs.activeJob.status !== "completed" &&
    jobs.activeJob.status !== "error"
      ? 1
      : 0;
  const folderLabel =
    settingsState.settings?.downloadsDir ??
    libraryState.library?.downloadsDir ??
    "Library folder…";
  const fileCount = libraryState.library
    ? libraryState.library.records.length
    : null;
  const totalSize = libraryState.library
    ? formatTotal(libraryState.library.totalSizeBytes)
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
          {route === "convert" && <ConvertRoute />}
          {route === "library" && <LibraryRoute />}
          {route === "history" && (
            <HistoryRoute onReconvert={() => navigate("convert")} />
          )}
          {route === "queue" && <QueueRoute />}
          {route === "settings" && <SettingsRoute />}
        </ShellContent>
      </ShellMain>
      <StatusBar
        engineOk={!libraryState.error}
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
