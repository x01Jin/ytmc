import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";

export type AppRoute = "convert" | "library" | "history" | "queue" | "settings";

const ROUTES: AppRoute[] = [
  "convert",
  "library",
  "history",
  "queue",
  "settings",
];

const ROUTE_LABELS: Record<AppRoute, string> = {
  convert: "Convert",
  library: "Library",
  history: "History",
  queue: "Queue",
  settings: "Settings",
};

const ROUTE_GLYPHS: Record<AppRoute, string> = {
  convert: "▶",
  library: "♫",
  history: "↺",
  queue: "☰",
  settings: "⚙",
};

function routeFromHash(): AppRoute {
  const hash = window.location.hash.replace(/^#\/?/, "");
  return (ROUTES as string[]).includes(hash) ? (hash as AppRoute) : "convert";
}

export function useHashRoute(): {
  route: AppRoute;
  navigate: (route: AppRoute) => void;
} {
  const [route, setRoute] = useState<AppRoute>(() => routeFromHash());

  useEffect(() => {
    const onChange = () => setRoute(routeFromHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = useCallback((next: AppRoute) => {
    window.location.hash = `#/${next}`;
    setRoute(next);
  }, []);

  return { route, navigate };
}

export function TitleBar({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <header className="px-panel flex shrink-0 items-center gap-3 px-3 py-2">
      <span
        aria-hidden="true"
        className="font-display text-[10px] leading-none text-px-acc"
      >
        ▓
      </span>
      <h1
        className="font-display text-[11px] leading-none tracking-wide"
        translate="no"
      >
        YT<span className="text-px-acc">★</span>MUSIC
      </h1>
      <span className="text-[11px] text-px-dim">Converter</span>
      <span className="flex-1" />
      <button
        type="button"
        className="px-btn !py-1 !px-2 text-xs"
        onClick={onOpenSettings}
        aria-label="Open settings"
      >
        ⚙
      </button>
    </header>
  );
}

export function SideNav({
  route,
  onNavigate,
  queueCount,
}: {
  route: AppRoute;
  onNavigate: (route: AppRoute) => void;
  queueCount: number;
}) {
  return (
    <nav
      aria-label="Primary"
      className="px-panel flex shrink-0 flex-row gap-1 p-2 sm:w-40 sm:min-h-0 sm:flex-col sm:overflow-y-auto"
    >
      {ROUTES.map((r) => {
        const active = r === route;
        return (
          <button
            key={r}
            type="button"
            onClick={() => onNavigate(r)}
            aria-current={active ? "page" : undefined}
            className={`px-btn flex flex-1 items-center gap-2 !border-0 text-left text-sm sm:flex-none ${
              active ? "!bg-px-acc !text-[#0b0b12]" : ""
            }`}
          >
            <span aria-hidden="true">{ROUTE_GLYPHS[r]}</span>
            {ROUTE_LABELS[r]}
            {r === "queue" && queueCount > 0 && (
              <span
                className="px-tabular ml-auto text-xs"
                aria-label={`${queueCount} active jobs`}
              >
                {queueCount}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

export function StatusBar({
  engineOk,
  sessionOk,
  folderLabel,
  fileCount,
  totalSize,
  onRevealFolder,
}: {
  engineOk: boolean;
  sessionOk: boolean;
  folderLabel: string;
  fileCount: number | null;
  totalSize: string | null;
  onRevealFolder: () => void;
}) {
  return (
    <footer
      className="px-panel flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-[11px] text-px-dim"
      aria-live="polite"
    >
      <span title="Conversion engine">
        ENG
        <span
          aria-hidden="true"
          className={engineOk ? "text-px-ok" : "text-px-err"}
        >
          ●
        </span>
      </span>
      <span title="YouTube session">
        SES
        <span
          aria-hidden="true"
          className={sessionOk ? "text-px-ok" : "text-px-warn"}
        >
          ●
        </span>
      </span>
      <button
        type="button"
        onClick={onRevealFolder}
        className="min-w-0 flex-1 truncate text-left hover:text-px-text"
        title="Show library folder in Explorer"
      >
        ♫ <span className="underline decoration-dotted">{folderLabel}</span>
      </button>
      {fileCount !== null && (
        <span className="px-tabular">{fileCount} files</span>
      )}
      {totalSize !== null && <span className="px-tabular">{totalSize}</span>}
    </footer>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh flex-col gap-2 overflow-hidden bg-px-bg p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] font-body text-px-text">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:px-2 focus:py-1 focus:outline-2"
      >
        Skip to main content
      </a>
      {children}
    </div>
  );
}

export function ShellMain({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 sm:flex-row">
      {children}
    </div>
  );
}

export function ShellContent({ children }: { children: ReactNode }) {
  return (
    <main
      id="main"
      className="min-w-0 flex-1 min-h-0 space-y-3 overflow-x-clip overflow-y-auto overscroll-contain scroll-p-2"
    >
      {children}
    </main>
  );
}
