import { Pencil, Scissors, Settings2, Tag } from "lucide-react";
import {
  createContext,
  use,
  useCallback,
  useId,
  useRef,
  useState,
} from "react";
import type { LibraryRecord } from "../../types";
import { AdvancedPane } from "./AdvancedPane";
import { TagPane } from "./TagPane";
import { TrimPane } from "./TrimPane";

export type EditTabId = "trim" | "tags" | "advanced";

const TABS: { id: EditTabId; label: string; icon: typeof Scissors }[] = [
  { id: "trim", label: "Trimmer", icon: Scissors },
  { id: "tags", label: "Tagger", icon: Tag },
  { id: "advanced", label: "Advanced", icon: Settings2 },
];

interface EditPanelContextValue {
  record: LibraryRecord;
  tab: EditTabId;
  baseId: string;
  onEdited: () => void;
}

const EditPanelContext = createContext<EditPanelContextValue | null>(null);

/** Read the enclosing edit-panel context (React 19 `use`, conditional-safe). */
export function useEditPanel(): EditPanelContextValue {
  const ctx = use(EditPanelContext);
  if (!ctx)
    throw new Error("Edit panel parts must render inside <LibraryEditPanel>");
  return ctx;
}

interface LibraryEditPanelProps {
  record: LibraryRecord;
  initialTab?: EditTabId;
  onEdited: () => void;
}

function EditTabs({
  tab,
  onTabChange,
  baseId,
}: {
  tab: EditTabId;
  onTabChange: (t: EditTabId) => void;
  baseId: string;
}) {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const focusTab = useCallback(
    (index: number) => {
      const next = (index + TABS.length) % TABS.length;
      tabRefs.current[next]?.focus();
      onTabChange(TABS[next].id);
    },
    [onTabChange],
  );

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      focusTab(index + 1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      focusTab(index - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusTab(0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusTab(TABS.length - 1);
    }
  };

  return (
    <div
      role="tablist"
      aria-label={`Edit ${tab}`}
      className="flex gap-1 border-b-2 border-px-line pb-2"
    >
      {TABS.map((t, i) => {
        const selected = t.id === tab;
        const Icon = t.icon;
        return (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${baseId}-tab-${t.id}`}
            aria-selected={selected}
            aria-controls={`${baseId}-panel-${t.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onTabChange(t.id)}
            onKeyDown={(e) => handleKeyDown(e, i)}
            className={`px-btn flex items-center gap-1.5 !border-0 !py-1.5 text-xs ${
              selected ? "!bg-px-acc !text-[#0b0b12]" : ""
            }`}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Inline expandable editor for a library track.
 * Compound structure: <LibraryEditPanel> owns tab state + record context,
 * each pane is an explicit variant component (no boolean-prop modes).
 */
export function LibraryEditPanel({
  record,
  initialTab = "trim",
  onEdited,
}: LibraryEditPanelProps) {
  const [tab, setTab] = useState<EditTabId>(initialTab);
  const baseId = useId().replace(/[^a-zA-Z0-9]/g, "");

  return (
    <EditPanelContext value={{ record, tab, baseId, onEdited }}>
      <div className="min-w-0 border-t-2 border-px-line bg-px-bg p-3">
        <div className="mb-1 flex items-center gap-1.5 text-[11px] text-px-dim">
          <Pencil className="h-3 w-3" aria-hidden="true" />
          <span className="truncate">
            Editing{" "}
            <span className="font-semibold text-px-text">
              {record.fileName}
            </span>
          </span>
        </div>
        <EditTabs tab={tab} onTabChange={setTab} baseId={baseId} />
        {/* Panes stay mounted with `hidden` so tab switches keep TagEditor drafts. */}
        <div className="pt-3">
          <div
            role="tabpanel"
            id={`${baseId}-panel-trim`}
            aria-labelledby={`${baseId}-tab-trim`}
            hidden={tab !== "trim"}
          >
            <TrimPane />
          </div>
          <div
            role="tabpanel"
            id={`${baseId}-panel-tags`}
            aria-labelledby={`${baseId}-tab-tags`}
            hidden={tab !== "tags"}
          >
            <TagPane />
          </div>
          <div
            role="tabpanel"
            id={`${baseId}-panel-advanced`}
            aria-labelledby={`${baseId}-tab-advanced`}
            hidden={tab !== "advanced"}
          >
            <AdvancedPane />
          </div>
        </div>
      </div>
    </EditPanelContext>
  );
}
