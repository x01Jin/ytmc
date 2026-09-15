import { useEffect } from "react";
import { createPortal } from "react-dom";

interface CoverArtPreviewProps {
  src: string;
  title: string;
  subtitle?: string;
  onClose: () => void;
}

/**
 * App-level cover-art lightbox. Portaled to document.body so it centers on
 * the viewport no matter where it opens from (library rows, edit drawer).
 */
export function CoverArtPreview({
  src,
  title,
  subtitle,
  onClose,
}: CoverArtPreviewProps) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <figure
        role="dialog"
        aria-modal="true"
        aria-label={`Cover art preview: ${title}`}
        className="px-panel w-full max-w-md p-3"
        onClick={(event) => event.stopPropagation()}
      >
        <img
          src={src}
          alt={`Cover art preview: ${title}`}
          referrerPolicy="no-referrer"
          className="px-pixelated max-h-[70vh] w-full bg-px-bg object-contain"
        />
        <figcaption className="mt-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{title}</p>
            {subtitle && (
              <p className="truncate text-xs text-px-dim">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            className="px-btn shrink-0 !px-2 !py-1 text-xs"
            onClick={onClose}
            aria-label="Close cover art preview"
            autoFocus
          >
            ✕
          </button>
        </figcaption>
      </figure>
    </div>,
    document.body,
  );
}
