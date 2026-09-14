import { ArrowRight, Clipboard, Loader2, X } from "lucide-react";
import React, { useState } from "react";

interface UrlInputProps {
  value: string;
  onChange: (val: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
}

export const UrlInput: React.FC<UrlInputProps> = ({
  value,
  onChange,
  onSubmit,
  isLoading,
}) => {
  const [copiedNotification, setCopiedNotification] = useState(false);

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        onChange(text);
        setCopiedNotification(true);
        setTimeout(() => setCopiedNotification(false), 2000);
      }
    } catch {
      // Clipboard permissions may not be granted in iframe
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && value.trim() && !isLoading) {
      onSubmit();
    }
  };

  return (
    <section
      id="url-input-section"
      className="w-full space-y-3"
      aria-label="Video source"
    >
      <div className="px-panel-raised flex items-center focus-within:border-px-acc">
        <label htmlFor="youtube-url-input" className="sr-only">
          YouTube link or video ID
        </label>
        <input
          id="youtube-url-input"
          name="youtube-url"
          type="url"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Paste YouTube link or video ID…"
          disabled={isLoading}
          className="w-full min-w-0 flex-1 bg-transparent px-3 py-3 text-sm text-px-text placeholder:text-px-dim focus:outline-none md:text-base"
        />

        <div className="flex shrink-0 items-center gap-1.5 pr-2">
          {value && (
            <button
              id="clear-url-btn"
              type="button"
              onClick={() => onChange("")}
              aria-label="Clear input"
              title="Clear input"
              className="px-btn !border-0 !p-1.5"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}

          <button
            id="paste-clipboard-btn"
            type="button"
            onClick={handlePaste}
            title="Paste from clipboard"
            className="px-btn hidden !py-1.5 text-xs sm:inline-flex sm:items-center sm:gap-1"
          >
            <Clipboard className="h-3.5 w-3.5" aria-hidden="true" />
            <span aria-live="polite">
              {copiedNotification ? "Pasted!" : "Paste"}
            </span>
          </button>

          <button
            id="submit-url-btn"
            type="button"
            onClick={onSubmit}
            disabled={!value.trim() || isLoading}
            className="px-btn px-btn-primary inline-flex items-center justify-center gap-1.5 !py-2 text-xs md:text-sm"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span className="hidden sm:inline">Loading…</span>
              </>
            ) : (
              <>
                <span>Inspect</span>
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </>
            )}
          </button>
        </div>
      </div>
    </section>
  );
};
