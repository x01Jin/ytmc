import {
  AlertTriangle,
  CheckCircle,
  Clock,
  ExternalLink,
  ShieldCheck,
  User,
} from "lucide-react";
import React from "react";
import { VideoMetadata } from "../types";

interface VideoCardProps {
  metadata: VideoMetadata;
  onOpenCookiesModal: () => void;
}

export const VideoCard: React.FC<VideoCardProps> = ({
  metadata,
  onOpenCookiesModal,
}) => {
  return (
    <article
      id="video-preview-card"
      className="px-panel w-full p-3"
      aria-label="Video preview"
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative aspect-video w-full shrink-0 overflow-hidden border-2 border-px-line bg-px-bg sm:w-48">
          <img
            id="video-thumbnail-img"
            src={metadata.thumbnail}
            alt={metadata.title}
            width={192}
            height={108}
            referrerPolicy="no-referrer"
            className="px-pixelated h-full w-full object-cover"
          />
          {metadata.duration && (
            <div className="px-tabular absolute bottom-1.5 right-1.5 flex items-center gap-1 bg-black/80 px-1.5 py-0.5 text-[11px] font-medium tracking-wide text-white">
              <Clock className="h-3 w-3" aria-hidden="true" />
              <span>{metadata.duration}</span>
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
          <div>
            <h2
              id="video-title"
              className="line-clamp-2 text-base font-semibold leading-snug"
            >
              {metadata.title}
            </h2>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-px-dim">
              <span className="flex items-center gap-1 font-medium text-px-text">
                <User className="h-3.5 w-3.5 text-px-dim" aria-hidden="true" />
                {metadata.author}
              </span>

              {metadata.viewCount !== undefined && (
                <span className="px-tabular">
                  {new Intl.NumberFormat("en-US").format(metadata.viewCount)}{" "}
                  views
                </span>
              )}

              <a
                id="view-on-youtube-link"
                href={`https://www.youtube.com/watch?v=${metadata.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-px-acc hover:underline"
              >
                <span>YouTube</span>
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t-2 border-px-line pt-2">
            {metadata.botVerificationRequired ? (
              <div className="flex w-full items-center gap-2 border-2 border-px-warn bg-px-bg px-3 py-1.5 text-xs text-px-warn">
                <AlertTriangle
                  className="h-4 w-4 shrink-0"
                  aria-hidden="true"
                />
                <div className="flex flex-1 flex-wrap items-center justify-between gap-2">
                  <span>
                    Session authentication recommended for this track.
                  </span>
                  <button
                    id="video-card-cookie-btn"
                    type="button"
                    onClick={onOpenCookiesModal}
                    className="font-semibold underline hover:text-px-text"
                  >
                    Configure Session Cookies
                  </button>
                </div>
              </div>
            ) : metadata.nativeStreams && metadata.nativeStreams.length > 0 ? (
              <div className="flex w-full flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1 border-2 border-px-ok bg-px-bg px-2.5 py-1 text-xs text-px-ok">
                  <CheckCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>
                    Native Audio:{" "}
                    {metadata.bestNativeStream?.note ||
                      "Opus ~160 kbps (48kHz)"}
                  </span>
                </span>
                <span className="flex items-center gap-1 text-[11px] font-medium text-px-dim">
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  Direct streamcopy ready (0% transcoding loss)
                </span>
              </div>
            ) : (
              <div className="flex w-full items-center gap-2 border-2 border-px-line bg-px-bg px-3 py-1.5 text-xs text-px-dim">
                <AlertTriangle
                  className="h-4 w-4 shrink-0"
                  aria-hidden="true"
                />
                <div className="flex flex-1 flex-wrap items-center justify-between gap-2">
                  <span title={metadata.probeError}>
                    Stream check inconclusive
                    {metadata.probeError ? " — conversion may still work" : ""}.
                  </span>
                  <button
                    id="video-card-cookie-btn"
                    type="button"
                    onClick={onOpenCookiesModal}
                    className="font-semibold underline hover:text-px-text"
                  >
                    Check Session
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
};
