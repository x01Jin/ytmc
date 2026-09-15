import {
  AlertCircle,
  CheckCircle2,
  Cookie,
  Cpu,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import React, { useRef, useState } from "react";
import { ApiClient } from "../services/apiClient";
import { CookieStatus } from "../types";

interface CookieModalProps {
  isOpen: boolean;
  onClose: () => void;
  status: CookieStatus;
  onStatusUpdated: (newStatus: CookieStatus) => void;
}

export const CookieModal: React.FC<CookieModalProps> = ({
  isOpen,
  onClose,
  status,
  onStatusUpdated,
}) => {
  const [cookieText, setCookieText] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isAutoFetching, setIsAutoFetching] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    title?: string;
    errorDetails?: string;
    strategy?: "pot" | "fallback";
    potReachable?: boolean;
    cookiesUsed?: boolean;
  } | null>(null);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!cookieText.trim()) {
      setFeedback({
        type: "error",
        message: "Please paste cookies text first.",
      });
      return;
    }

    setIsSaving(true);
    setFeedback(null);
    setTestResult(null);
    try {
      const result = await ApiClient.saveCookies(cookieText);
      const updated = await ApiClient.getCookieStatus();
      onStatusUpdated(updated);
      setFeedback({ type: "success", message: result.message });
      setCookieText("");
    } catch (err: unknown) {
      setFeedback({
        type: "error",
        message:
          err instanceof Error ? err.message : "Failed to save cookies.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleAutoFetch = async () => {
    setIsAutoFetching(true);
    setFeedback(null);
    setTestResult(null);
    try {
      const result = await ApiClient.autoFetchCookies();
      onStatusUpdated(result.status);
      setFeedback({ type: "success", message: result.message });
    } catch (err: unknown) {
      setFeedback({
        type: "error",
        message:
          err instanceof Error
            ? err.message
            : "Failed to auto-fetch YouTube guest session.",
      });
    } finally {
      setIsAutoFetching(false);
    }
  };

  const handleTestSession = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await ApiClient.testSession();
      setTestResult(result);
    } catch (err: unknown) {
      setTestResult({
        success: false,
        message:
          err instanceof Error ? err.message : "Session verification failed.",
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    readFile(file);
  };

  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        setCookieText(text);
        setFeedback({
          type: "success",
          message: `Loaded ${file.name} (${text.split("\n").length} lines). Click "Save Cookies" to apply.`,
        });
      }
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      readFile(file);
    }
  };

  const handleClear = async () => {
    try {
      await ApiClient.clearCookies();
      const updated = await ApiClient.getCookieStatus();
      onStatusUpdated(updated);
      setTestResult(null);
      setFeedback({
        type: "success",
        message: "Cookies cleared successfully.",
      });
    } catch {
      setFeedback({ type: "error", message: "Failed to clear cookies." });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        id="cookie-settings-modal"
        className="px-panel flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden transition-colors"
      >
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between bg-zinc-50/50 dark:bg-zinc-950/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-[2px] bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
              <Cookie className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                YouTube Session & Authentication
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Node.js challenge solver & PO Token engine
              </p>
            </div>
          </div>

          <button
            id="close-cookie-modal-btn"
            type="button"
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 rounded-[2px] hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-4 sm:p-5 overflow-y-auto overscroll-contain space-y-4 text-xs">
          {/* Status banner */}
          <div
            className={`p-3.5 rounded-[2px] border flex items-center justify-between transition-colors ${
              status.configured
                ? "bg-emerald-50/90 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200"
                : "bg-zinc-50 dark:bg-zinc-950/60 border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300"
            }`}
          >
            <div className="flex items-start gap-2.5">
              {status.configured ? (
                <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 text-zinc-400 dark:text-zinc-500 shrink-0 mt-0.5" />
              )}
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-sm">
                    {status.configured
                      ? status.isAccountSession
                        ? "Authenticated Account Session Active"
                        : "YouTube Guest Session Active"
                      : "No Active Session"}
                  </span>
                  {status.configured && (
                    <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                      {status.isAccountSession
                        ? "Personal Account"
                        : "Auto Guest"}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
                  {status.configured
                    ? `${status.lineCount} session entries loaded • Node.js JS challenge solver active`
                    : "Click Auto-Fetch Guest Session or paste cookies below"}
                </p>
              </div>
            </div>

            {status.configured && (
              <button
                id="clear-cookies-btn"
                type="button"
                onClick={handleClear}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 p-1.5 rounded-[2px] hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>
            )}
          </div>

          {/* Quick Actions (Auto Fetch & Test Connection) */}
          <div className="grid grid-cols-2 gap-2.5">
            <button
              id="auto-fetch-guest-session-btn"
              type="button"
              onClick={handleAutoFetch}
              disabled={isAutoFetching}
              className="flex items-center justify-center gap-2 p-3 rounded-[2px] border border-rose-200 dark:border-rose-900 bg-rose-50/50 dark:bg-rose-950/30 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-rose-700 dark:text-rose-400 font-semibold transition-colors shadow-xs disabled:opacity-50"
            >
              {isAutoFetching ? (
                <Loader2 className="w-4 h-4 animate-spin text-rose-600 dark:text-rose-400" />
              ) : (
                <Sparkles className="w-4 h-4 text-rose-600 dark:text-rose-400" />
              )}
              <span>Auto-Fetch Guest Session</span>
            </button>

            <button
              id="test-session-connection-btn"
              type="button"
              onClick={handleTestSession}
              disabled={isTesting}
              className="flex items-center justify-center gap-2 p-3 rounded-[2px] border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-semibold transition-colors shadow-xs disabled:opacity-50"
            >
              {isTesting ? (
                <Loader2 className="w-4 h-4 animate-spin text-zinc-600 dark:text-zinc-400" />
              ) : (
                <RefreshCw className="w-4 h-4 text-zinc-600 dark:text-zinc-400" />
              )}
              <span>Test Live Connection</span>
            </button>
          </div>

          {/* Test connection result display */}
          {testResult && (
            <div
              className={`p-3 rounded-[2px] border text-xs animate-in fade-in duration-150 ${
                testResult.success
                  ? "bg-emerald-50/80 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300"
                  : "bg-rose-50/80 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300"
              }`}
            >
              <div className="flex items-start gap-2">
                {testResult.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                )}
                <div className="space-y-0.5">
                  <p className="font-semibold">{testResult.message}</p>
                  {testResult.title && (
                    <p className="text-[11px] text-zinc-600 dark:text-zinc-400">
                      Successfully verified stream parsing for:{" "}
                      <span className="font-medium text-zinc-800 dark:text-zinc-200">
                        {testResult.title}
                      </span>
                    </p>
                  )}
                  {(testResult.strategy || testResult.errorDetails) && (
                    <p className="text-[11px] text-zinc-600 dark:text-zinc-400">
                      Path:{" "}
                      <span className="font-medium" translate="no">
                        {testResult.strategy === "pot"
                          ? "PO Token sidecar"
                          : "no-POT fallback"}
                      </span>
                      {testResult.cookiesUsed
                        ? " • cookies sent"
                        : " • no cookies sent"}
                    </p>
                  )}
                  {testResult.errorDetails && (
                    <details className="mt-1 rounded-[2px] border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 p-2">
                      <summary className="cursor-pointer font-medium text-zinc-700 dark:text-zinc-300">
                        Technical details
                      </summary>
                      <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                        {testResult.errorDetails}
                      </pre>
                    </details>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Feedback banner */}
          {feedback && (
            <div
              className={`p-3 rounded-[2px] border text-xs flex items-center gap-2 ${
                feedback.type === "success"
                  ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300"
                  : "bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300"
              }`}
            >
              {feedback.type === "success" ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
              )}
              <span>{feedback.message}</span>
            </div>
          )}

          {/* Drag & Drop / File Input Area */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="font-semibold text-zinc-800 dark:text-zinc-200">
                Custom Account Cookies (Netscape / JSON)
              </label>
              <button
                id="upload-cookie-file-btn"
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 font-medium text-xs cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Upload cookies.txt</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt"
                onChange={handleFileUpload}
                className="hidden"
              />
            </div>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={`relative rounded-[2px] transition-colors ${isDragging ? "ring-2 ring-rose-500 bg-rose-50/30 dark:bg-rose-950/30" : ""}`}
            >
              <textarea
                id="cookie-textarea"
                rows={4}
                value={cookieText}
                onChange={(e) => setCookieText(e.target.value)}
                placeholder="# Netscape HTTP Cookie File&#10;.youtube.com&#9;TRUE&#9;/&#9;TRUE&#9;1789325080&#9;VISITOR_INFO1_LIVE&#9;...&#10;or paste exported JSON from Cookie-Editor / drop cookies.txt here"
                className="w-full p-3 font-mono text-[11px] rounded-[2px] border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 focus:bg-white dark:focus:bg-zinc-950 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500 text-zinc-800 dark:text-zinc-200 resize-none leading-relaxed"
              />
              {isDragging && (
                <div className="absolute inset-0 flex items-center justify-center bg-rose-500/10 rounded-[2px] pointer-events-none">
                  <span className="font-semibold text-rose-600 dark:text-rose-400 text-xs">
                    Drop cookies.txt here
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Engine & Architecture Info */}
          <div className="p-3 rounded-[2px] bg-zinc-50 dark:bg-zinc-950/60 border border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 space-y-1.5">
            <div className="flex items-center gap-1.5 font-semibold text-zinc-800 dark:text-zinc-200">
              <Cpu className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400" />
              <span>How Automatic Sessions Work</span>
            </div>
            <ul className="space-y-1 text-[11px] leading-relaxed list-disc list-inside text-zinc-600 dark:text-zinc-400">
              <li>
                <strong>Auto-Fetch Guest Session:</strong> Requests fresh
                visitor cookies from YouTube's homepage. These identify your
                session but do not unlock streams by themselves.
              </li>
              <li>
                <strong>Node.js Challenge Engine:</strong> Automatically
                executes YouTube's JavaScript player challenges to decode audio
                streams.
              </li>
              <li>
                <strong>PO Token sidecar:</strong> Strictly-checked uploads need
                a Proof-of-Origin token from the optional sidecar (see docs).
                Without it the app uses a no-POT player fallback that covers
                embeddable videos.
              </li>
              <li>
                <strong>Personal Account Cookies:</strong> Only required for
                private or age-restricted tracks that require 18+ sign-in.
              </li>
            </ul>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/50 flex items-center justify-end gap-2">
          <button
            id="cancel-cookie-modal-btn"
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-[2px] text-xs font-semibold text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            Close
          </button>

          <button
            id="save-cookies-btn"
            type="button"
            onClick={handleSave}
            disabled={isSaving || !cookieText.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[2px] text-xs font-semibold text-white bg-rose-600 hover:bg-rose-500 disabled:bg-zinc-300 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-600 disabled:cursor-not-allowed transition-colors shadow-xs"
          >
            {isSaving ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <span>Save Cookies</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
