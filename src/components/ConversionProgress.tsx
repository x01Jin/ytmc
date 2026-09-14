import {
  AlertCircle,
  CheckCircle2,
  Cookie,
  Loader2,
  RotateCw,
} from "lucide-react";
import React from "react";
import { ConversionJob } from "../types";

interface ConversionProgressProps {
  job: ConversionJob;
  onRetry: () => void;
  onOpenCookiesModal: () => void;
}

export const ConversionProgress: React.FC<ConversionProgressProps> = ({
  job,
  onRetry,
  onOpenCookiesModal,
}) => {
  const isError = job.status === "error";
  const isCompleted = job.status === "completed";
  const isBotBlocked =
    job.isBotBlocked ||
    /sign in to confirm|not a bot|bot|login_required|cookies-from-browser|403/i.test(
      job.error || "",
    );

  return (
    <section
      id="conversion-progress-section"
      className="px-panel w-full space-y-4 p-4"
      aria-label="Conversion progress"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isError ? (
            <AlertCircle className="h-5 w-5 text-px-err" aria-hidden="true" />
          ) : isCompleted ? (
            <CheckCircle2 className="h-5 w-5 text-px-ok" aria-hidden="true" />
          ) : (
            <Loader2
              className="h-5 w-5 animate-spin text-px-acc"
              aria-hidden="true"
            />
          )}
          <h3 className="text-sm font-semibold">
            {isError
              ? "Conversion Halted"
              : isCompleted
                ? "Conversion Ready!"
                : "Converting Audio…"}
          </h3>
        </div>
        <span className="px-tabular text-xs font-bold" aria-hidden="true">
          {job.progress}%
        </span>
      </div>

      <div
        className="px-progress h-4 w-full overflow-hidden border-2 border-px-line bg-px-bg"
        role="progressbar"
        aria-valuenow={Math.round(job.progress)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Conversion progress"
      >
        <div
          id="conversion-progress-bar"
          className={`px-progress-fill h-full ${
            isError ? "bg-px-err" : isCompleted ? "bg-px-ok" : "bg-px-acc"
          }`}
          style={{ width: `${Math.max(4, job.progress)}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-px-dim" aria-live="polite">
          {job.stageMessage || "Processing track…"}
        </span>
        <span
          className="px-tabular font-semibold uppercase text-px-dim"
          translate="no"
        >
          {job.format.toUpperCase()} • {job.bitrate}
        </span>
      </div>

      {isError && (
        <div
          className="space-y-3 border-2 border-px-err bg-px-bg p-4 text-xs"
          role="alert"
        >
          <div className="flex items-start gap-2.5">
            <AlertCircle
              className="mt-0.5 h-5 w-5 shrink-0 text-px-err"
              aria-hidden="true"
            />
            <div className="space-y-1">
              <p className="text-sm font-semibold">
                {isBotBlocked
                  ? "YouTube Sign-in Verification Required"
                  : "Conversion Could Not Complete"}
              </p>
              <p className="leading-relaxed text-px-dim">
                {job.error ||
                  "Audio conversion failed. Try another track or format."}
              </p>
              {job.errorDetails && (
                <details className="mt-1 border border-px-line bg-px-panel p-2">
                  <summary className="cursor-pointer font-medium text-px-text">
                    Technical details
                  </summary>
                  <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-px-dim">
                    {job.errorDetails}
                  </pre>
                </details>
              )}
            </div>
          </div>

          {isBotBlocked ? (
            <div className="px-panel-raised space-y-2.5 p-3">
              <p className="leading-relaxed text-px-dim">
                YouTube requires user session authentication or browser cookies
                for this track in cloud environments.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  id="error-configure-cookies-btn"
                  type="button"
                  onClick={onOpenCookiesModal}
                  className="px-btn px-btn-primary inline-flex items-center gap-1.5 !py-1.5 text-xs"
                >
                  <Cookie className="h-4 w-4" aria-hidden="true" />
                  <span>Open Session & Cookie Settings</span>
                </button>
                <button
                  id="retry-conversion-btn"
                  type="button"
                  onClick={onRetry}
                  className="px-btn inline-flex items-center gap-1.5 !py-1.5 text-xs"
                >
                  <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Retry Conversion</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 pt-1">
              <button
                id="retry-conversion-btn"
                type="button"
                onClick={onRetry}
                className="px-btn px-btn-primary inline-flex items-center gap-1.5 !py-1.5 text-xs"
              >
                <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Retry</span>
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
