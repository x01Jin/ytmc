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
} from 'lucide-react';
import React, { useRef, useState } from 'react';
import { ApiClient } from '../services/apiClient';
import { CookieStatus } from '../types';

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
  const [cookieText, setCookieText] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isAutoFetching, setIsAutoFetching] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    title?: string;
    errorDetails?: string;
    strategy?: 'pot' | 'fallback';
    potReachable?: boolean;
    cookiesUsed?: boolean;
  } | null>(null);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!cookieText.trim()) {
      setFeedback({
        type: 'error',
        message: 'Please paste cookies text first.',
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
      setFeedback({ type: 'success', message: result.message });
      setCookieText('');
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to save cookies.',
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
      setFeedback({ type: 'success', message: result.message });
    } catch (err: unknown) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to auto-fetch YouTube guest session.',
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
        message: err instanceof Error ? err.message : 'Session verification failed.',
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
    reader.addEventListener('load', event => {
      const text = event.target?.result as string;
      if (text) {
        setCookieText(text);
        setFeedback({
          type: 'success',
          message: `Loaded ${file.name} (${text.split('\n').length} lines). Click "Save Cookies" to apply.`,
        });
      }
    });
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
        type: 'success',
        message: 'Cookies cleared successfully.',
      });
    } catch {
      setFeedback({ type: 'error', message: 'Failed to clear cookies.' });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div
        id="cookie-settings-modal"
        className="px-panel flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between border-b-2 border-px-line bg-px-panel-2 p-4 sm:p-5">
          <div className="flex items-center gap-2.5">
            <div className="border-2 border-px-warn/50 bg-px-warn/10 p-2 text-px-warn">
              <Cookie className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-px-text">YouTube Session & Authentication</h3>
              <p className="text-xs text-px-dim">Node.js challenge solver & PO Token engine</p>
            </div>
          </div>

          <button
            id="close-cookie-modal-btn"
            type="button"
            onClick={onClose}
            className="px-btn !border-0 !bg-transparent !p-1.5 text-px-dim hover:!bg-px-panel"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto overscroll-contain p-4 text-xs sm:p-5">
          <div
            className={`flex items-center justify-between border-2 p-3.5 ${
              status.configured
                ? 'border-px-ok/40 bg-px-ok/10 text-px-text'
                : 'border-px-line bg-px-bg/60 text-px-dim'
            }`}
          >
            <div className="flex items-start gap-2.5">
              {status.configured ? (
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-px-ok" />
              ) : (
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-px-dim" />
              )}
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold">
                    {status.configured
                      ? status.isAccountSession
                        ? 'Authenticated Account Session Active'
                        : 'YouTube Guest Session Active'
                      : 'No Active Session'}
                  </span>
                  {status.configured && (
                    <span className="border border-px-ok/40 bg-px-ok/10 px-1.5 py-0.5 text-[10px] font-medium text-px-ok">
                      {status.isAccountSession ? 'Personal Account' : 'Auto Guest'}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] text-px-dim">
                  {status.configured
                    ? `${status.lineCount} session entries loaded • Node.js JS challenge solver active`
                    : 'Click Auto-Fetch Guest Session or paste cookies below'}
                </p>
              </div>
            </div>

            {status.configured && (
              <button
                id="clear-cookies-btn"
                type="button"
                onClick={handleClear}
                className="inline-flex items-center gap-1 p-1.5 text-[11px] font-semibold text-px-err hover:bg-px-err/10"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Reset</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <button
              id="auto-fetch-guest-session-btn"
              type="button"
              onClick={handleAutoFetch}
              disabled={isAutoFetching}
              className="px-btn !border-px-acc/60 !bg-px-acc/10 !p-3"
            >
              {isAutoFetching ? (
                <Loader2 className="h-4 w-4 animate-spin text-px-acc" />
              ) : (
                <Sparkles className="h-4 w-4 text-px-acc" />
              )}
              <span>Auto-Fetch Guest Session</span>
            </button>

            <button
              id="test-session-connection-btn"
              type="button"
              onClick={handleTestSession}
              disabled={isTesting}
              className="px-btn !p-3"
            >
              {isTesting ? (
                <Loader2 className="h-4 w-4 animate-spin text-px-dim" />
              ) : (
                <RefreshCw className="h-4 w-4 text-px-dim" />
              )}
              <span>Test Live Connection</span>
            </button>
          </div>

          {testResult && (
            <div
              className={`border-2 p-3 text-xs ${
                testResult.success
                  ? 'border-px-ok/40 bg-px-ok/10 text-px-text'
                  : 'border-px-err/40 bg-px-err/10 text-px-text'
              }`}
            >
              <div className="flex items-start gap-2">
                {testResult.success ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-px-ok" />
                ) : (
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-px-err" />
                )}
                <div className="space-y-0.5">
                  <p className="font-semibold">{testResult.message}</p>
                  {testResult.title && (
                    <p className="text-[11px] text-px-dim">
                      Successfully verified stream parsing for:{' '}
                      <span className="font-medium text-px-text">{testResult.title}</span>
                    </p>
                  )}
                  {(testResult.strategy || testResult.errorDetails) && (
                    <p className="text-[11px] text-px-dim">
                      Path:{' '}
                      <span className="font-medium text-px-text" translate="no">
                        {testResult.strategy === 'pot' ? 'PO Token sidecar' : 'no-POT fallback'}
                      </span>
                      {testResult.cookiesUsed ? ' • cookies sent' : ' • no cookies sent'}
                    </p>
                  )}
                  {testResult.errorDetails && (
                    <details className="mt-1 border-2 border-px-line bg-px-panel p-2">
                      <summary className="cursor-pointer font-medium text-px-text">
                        Technical details
                      </summary>
                      <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-px-dim">
                        {testResult.errorDetails}
                      </pre>
                    </details>
                  )}
                </div>
              </div>
            </div>
          )}

          {feedback && (
            <div
              className={`flex items-center gap-2 border-2 p-3 text-xs ${
                feedback.type === 'success'
                  ? 'border-px-ok/40 bg-px-ok/10 text-px-text'
                  : 'border-px-err/40 bg-px-err/10 text-px-text'
              }`}
            >
              {feedback.type === 'success' ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-px-ok" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0 text-px-err" />
              )}
              <span>{feedback.message}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="font-semibold text-px-text">
                Custom Account Cookies (Netscape / JSON)
              </label>
              <button
                id="upload-cookie-file-btn"
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-px-acc hover:text-px-text"
              >
                <Upload className="h-3.5 w-3.5" />
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
              onDragOver={e => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={`relative ${isDragging ? 'bg-px-acc/10 ring-2 ring-px-acc' : ''}`}
            >
              <textarea
                id="cookie-textarea"
                rows={4}
                value={cookieText}
                onChange={e => setCookieText(e.target.value)}
                placeholder="# Netscape HTTP Cookie File&#10;.youtube.com&#9;TRUE&#9;/&#9;TRUE&#9;1789325080&#9;VISITOR_INFO1_LIVE&#9;...&#10;or paste exported JSON from Cookie-Editor / drop cookies.txt here"
                className="px-input w-full resize-none font-mono text-[11px] leading-relaxed"
              />
              {isDragging && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-px-acc/10">
                  <span className="text-xs font-semibold text-px-acc">Drop cookies.txt here</span>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-1.5 border-2 border-px-line bg-px-bg/60 p-3 text-px-dim">
            <div className="flex items-center gap-1.5 font-semibold text-px-text">
              <Cpu className="h-3.5 w-3.5 text-px-dim" />
              <span>How Automatic Sessions Work</span>
            </div>
            <ul className="list-inside list-disc space-y-1 text-[11px] leading-relaxed">
              <li>
                <strong>Auto-Fetch Guest Session:</strong> Requests fresh visitor cookies from
                YouTube's homepage. These identify your session but do not unlock streams by
                themselves.
              </li>
              <li>
                <strong>Node.js Challenge Engine:</strong> Automatically executes YouTube's
                JavaScript player challenges to decode audio streams.
              </li>
              <li>
                <strong>PO Token sidecar:</strong> Strictly-checked uploads need a Proof-of-Origin
                token from the optional sidecar (see docs). Without it the app uses a no-POT player
                fallback that covers embeddable videos.
              </li>
              <li>
                <strong>Personal Account Cookies:</strong> Only required for private or
                age-restricted tracks that require 18+ sign-in.
              </li>
            </ul>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t-2 border-px-line bg-px-panel-2 p-4">
          <button
            id="cancel-cookie-modal-btn"
            type="button"
            onClick={onClose}
            className="px-btn text-xs"
          >
            Close
          </button>

          {cookieText.trim() && (
            <button
              id="save-cookies-btn"
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="px-btn px-btn-primary text-xs"
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <span>Save Cookies</span>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
