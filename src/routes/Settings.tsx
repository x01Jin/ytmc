import { useEffect, useRef, useState } from "react";
import { CookieModal } from "../components/CookieModal";
import { useSession, useSettings } from "../store/appStore";

export function SettingsRoute() {
  const { state, actions } = useSettings();
  const { settings, isLoading, error } = state;
  const { state: session, actions: sessionActions } = useSession();

  const [folder, setFolder] = useState("");
  const [revealAfterConvert, setRevealAfterConvert] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedTick, setSavedTick] = useState(false);
  const [isCookieModalOpen, setIsCookieModalOpen] = useState(false);
  const errorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (settings) {
      setFolder(settings.downloadsDir);
      setRevealAfterConvert(settings.revealAfterConvert);
    }
  }, [settings]);

  const pickFolder = async () => {
    setSaveError(null);
    if (window.desktop?.pickFolder) {
      const picked = await window.desktop.pickFolder();
      if (picked) setFolder(picked);
      return;
    }
    const input = window.prompt("Library folder (absolute path):", folder);
    if (input !== null) setFolder(input);
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    setSavedTick(false);
    try {
      await actions.save({ downloadsDir: folder, revealAfterConvert });
      setSavedTick(true);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Could not save settings.",
      );
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      await actions.reset();
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Could not reset settings.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading && !settings) {
    return (
      <section className="px-panel p-4" aria-label="Settings">
        <p className="text-sm text-px-dim">Loading settings…</p>
      </section>
    );
  }

  if (error && !settings) {
    return (
      <section
        className="px-panel border-px-err p-4"
        role="alert"
        aria-label="Settings"
      >
        <p className="text-sm font-semibold">Settings did not load</p>
        <p className="mt-1 text-sm text-px-dim">{error}</p>
      </section>
    );
  }

  return (
    <div className="space-y-3">
      <section className="px-panel space-y-3 p-4" aria-label="Library folder">
        <h2 className="font-display text-[11px]">LIBRARY FOLDER</h2>
        <p className="text-sm text-px-dim">
          Finished tracks save straight to this folder. No browser save dialog.
        </p>

        <div>
          <label
            htmlFor="settings-folder"
            className="mb-1 block text-xs text-px-dim"
          >
            Folder path
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="settings-folder"
              name="library-folder"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder="C:\Users\you\Downloads\YT Music…"
              className="px-input min-w-0 flex-1 text-sm"
            />
            <button
              type="button"
              className="px-btn text-sm"
              onClick={() => void pickFolder()}
            >
              Browse…
            </button>
          </div>
        </div>

        {settings?.isCustom === false && (
          <p className="text-xs text-px-dim">
            Using the default:{" "}
            <span className="px-tabular">{settings.defaultDownloadsDir}</span>
          </p>
        )}

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={revealAfterConvert}
            onChange={(e) => setRevealAfterConvert(e.target.checked)}
            className="h-4 w-4 accent-[#7c5cff]"
          />
          Show each finished file in Explorer
        </label>

        {saveError && (
          <div
            ref={errorRef}
            tabIndex={-1}
            role="alert"
            className="border-2 border-px-err p-3 text-sm"
          >
            <span className="font-semibold">Could not save: </span>
            <span className="text-px-dim">{saveError}</span>
          </div>
        )}
        {savedTick && !saveError && (
          <p role="status" className="text-sm text-px-ok">
            Library folder saved.
          </p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            className="px-btn px-btn-primary text-sm"
            disabled={isSaving}
            onClick={() => void handleSave()}
          >
            {isSaving ? "Saving…" : "Save Library Folder"}
          </button>
          <button
            type="button"
            className="px-btn text-sm"
            disabled={isSaving}
            onClick={() => void handleReset()}
          >
            Reset to Default
          </button>
        </div>
      </section>

      <section className="px-panel space-y-2 p-4" aria-label="YouTube session">
        <h2 className="font-display text-[11px]">YOUTUBE SESSION</h2>
        <p className="text-sm text-px-dim" aria-live="polite">
          {session.status.configured
            ? "Session cookies are set. Age-restricted and protected tracks work."
            : "No session set. Some tracks may ask for verification."}
        </p>
        <button
          type="button"
          className="px-btn text-sm"
          onClick={() => setIsCookieModalOpen(true)}
        >
          Manage Session Cookies
        </button>
      </section>

      <CookieModal
        isOpen={isCookieModalOpen}
        onClose={() => {
          setIsCookieModalOpen(false);
          void sessionActions.refresh();
        }}
        status={session.status}
        onStatusUpdated={(next) => sessionActions.update(next)}
      />
    </div>
  );
}
