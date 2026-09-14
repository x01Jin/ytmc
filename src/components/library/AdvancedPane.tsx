import { Loader2, Settings2 } from "lucide-react";
import { useState } from "react";
import { ApiClient } from "../../services/apiClient";
import type { AudioBitrate } from "../../types";
import { useEditPanel } from "./LibraryEditPanel";

const FORMATS = ["mp3", "m4a", "opus", "flac", "wav"] as const;

/**
 * Advanced pane: change container/codec, loudness handling, and file name.
 * Rename-only changes skip re-encoding on the server.
 */
export function AdvancedPane() {
  const { record, onEdited } = useEditPanel();
  const currentFormat = FORMATS.includes(
    record.format as (typeof FORMATS)[number],
  )
    ? record.format
    : "mp3";
  const [format, setFormat] = useState<string>(currentFormat);
  const [bitrate, setBitrate] = useState<AudioBitrate>("native");
  const [normalizeAudio, setNormalizeAudio] = useState(false);
  const [volumeBoost, setVolumeBoost] = useState(100);
  const [title, setTitle] = useState(record.title);
  const [artist, setArtist] = useState(record.author);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmArmed, setConfirmArmed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const touchesAudio =
    format !== record.format ||
    (format === "mp3" && bitrate !== "native") ||
    normalizeAudio ||
    volumeBoost !== 100;
  const touchesName =
    title.trim() !== record.title || artist.trim() !== record.author;
  const dirty = touchesAudio || touchesName;

  const markDirty = () => {
    setConfirmArmed(false);
    setNotice(null);
    setError(null);
  };

  const handleApply = async () => {
    if (!dirty) return;
    if (!confirmArmed) {
      setConfirmArmed(true);
      return;
    }
    setIsSaving(true);
    try {
      await ApiClient.editLibraryFile(record.jobId, {
        ...(touchesAudio
          ? {
              format,
              bitrate: format === "mp3" ? bitrate : undefined,
              normalizeAudio,
              volumeBoost,
            }
          : {}),
        ...(touchesName ? { title: title.trim(), artist: artist.trim() } : {}),
      });
      setNotice("Changes applied. The file was rewritten in place.");
      setConfirmArmed(false);
      onEdited();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not update the audio file.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label
          htmlFor={`adv-format-${record.jobId}`}
          className="mb-1 block text-xs font-semibold text-px-text"
        >
          File Extension & Codec
        </label>
        <select
          id={`adv-format-${record.jobId}`}
          name={`adv-format-${record.jobId}`}
          value={format}
          onChange={(e) => {
            setFormat(e.target.value);
            markDirty();
          }}
          className="px-select w-full text-sm"
        >
          {FORMATS.map((f) => (
            <option key={f} value={f}>
              .{f} {f === record.format ? "(current)" : ""}
            </option>
          ))}
        </select>
        {touchesAudio && (
          <p className="mt-1 text-[11px] text-px-warn" role="note">
            Changing the container re-encodes the audio. Quality cannot exceed
            the source.
          </p>
        )}
      </div>

      {format === "mp3" && (
        <div>
          <label
            htmlFor={`adv-bitrate-${record.jobId}`}
            className="mb-1 block text-xs font-semibold text-px-text"
          >
            MP3 Bitrate
          </label>
          <select
            id={`adv-bitrate-${record.jobId}`}
            name={`adv-bitrate-${record.jobId}`}
            value={bitrate}
            onChange={(e) => {
              setBitrate(e.target.value as AudioBitrate);
              markDirty();
            }}
            className="px-select w-full text-sm"
          >
            <option value="native">Native (~160k)</option>
            <option value="128k">128 kbps</option>
            <option value="192k">192 kbps</option>
            <option value="256k">256 kbps</option>
            <option value="320k">320 kbps</option>
          </select>
        </div>
      )}

      <div className="border-t border-px-line pt-3">
        <span className="mb-2 block text-xs font-semibold text-px-text">
          Audio Enhancements
        </span>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex cursor-pointer items-center gap-2 rounded-[2px] border border-px-line bg-px-bg p-2 text-xs">
            <input
              type="checkbox"
              checked={normalizeAudio}
              onChange={(e) => {
                setNormalizeAudio(e.target.checked);
                markDirty();
              }}
              className="h-4 w-4 accent-[#7c5cff]"
            />
            <span>
              <span className="font-semibold text-px-text">
                Loudness normalization
              </span>
              <span className="block text-[10px] text-px-dim">
                EBU R128, requires re-encode
              </span>
            </span>
          </label>
          <div className="flex items-center justify-between rounded-[2px] border border-px-line bg-px-bg p-2">
            <span className="text-xs font-semibold text-px-text">
              Volume gain
            </span>
            <select
              aria-label="Volume gain"
              value={volumeBoost}
              onChange={(e) => {
                setVolumeBoost(Number(e.target.value));
                markDirty();
              }}
              disabled={normalizeAudio}
              className="px-select py-1 text-xs disabled:opacity-50"
            >
              <option value={100}>100%</option>
              <option value={125}>125%</option>
              <option value={150}>150%</option>
            </select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 border-t border-px-line pt-3 sm:grid-cols-2">
        <div>
          <label
            htmlFor={`adv-title-${record.jobId}`}
            className="mb-1 block text-xs font-semibold text-px-text"
          >
            Title{" "}
            <span className="font-normal text-px-dim">(renames file)</span>
          </label>
          <input
            id={`adv-title-${record.jobId}`}
            name={`adv-title-${record.jobId}`}
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              markDirty();
            }}
            placeholder="Track title…"
            className="px-input w-full py-1.5 text-sm"
          />
        </div>
        <div>
          <label
            htmlFor={`adv-artist-${record.jobId}`}
            className="mb-1 block text-xs font-semibold text-px-text"
          >
            Artist{" "}
            <span className="font-normal text-px-dim">(renames file)</span>
          </label>
          <input
            id={`adv-artist-${record.jobId}`}
            name={`adv-artist-${record.jobId}`}
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={artist}
            onChange={(e) => {
              setArtist(e.target.value);
              markDirty();
            }}
            placeholder="Artist name…"
            className="px-input w-full py-1.5 text-sm"
          />
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="border-2 border-px-err bg-px-bg p-2 text-xs text-px-err"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          aria-live="polite"
          className="border-2 border-px-ok bg-px-bg p-2 text-xs text-px-ok"
        >
          {notice}
        </p>
      )}

      <button
        type="button"
        onClick={() => void handleApply()}
        disabled={isSaving || !dirty}
        className={`px-btn flex w-full items-center justify-center gap-2 !py-2.5 text-sm font-bold ${
          confirmArmed ? "!border-px-err !bg-px-err !text-[#0b0b12]" : ""
        }`}
      >
        {isSaving ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            <span aria-live="polite">Applying…</span>
          </>
        ) : (
          <>
            <Settings2 className="h-4 w-4" aria-hidden="true" />
            <span>
              {confirmArmed
                ? "Confirm — this rewrites the file"
                : "Apply changes"}
            </span>
          </>
        )}
      </button>
    </div>
  );
}
