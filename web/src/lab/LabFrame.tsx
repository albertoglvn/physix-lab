import { MoreHorizontal, Redo2, Undo2 } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { Study } from "../routes";
import { PhysixMark } from "../ui/pastoral";
import { SHORTCUTS } from "./shortcuts";
import { matches, TABLET, COMPACT, useMedia } from "./ui/media";
import { Menu, type MenuEntry } from "./ui/Menu";
import { Rail, type RailItem } from "./ui/Rail";
import { Sheet } from "./ui/Sheet";
import "./lab.css";

export const STUDIES: { value: Study; label: string }[] = [
  { value: "motion", label: "Motion" },
  { value: "stress", label: "Stress" },
];

/** The two studies as one radio group; arrow keys move and select (LAB_PLAN.md §3.1). */
export function StudySwitch({
  value,
  onChange,
}: {
  value: Study;
  onChange: (study: Study) => void;
}) {
  const group = useRef<HTMLDivElement>(null);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[
      event.key
    ];
    if (!step) return;
    event.preventDefault();
    const index = STUDIES.findIndex((study) => study.value === value);
    const next = STUDIES[(index + step + STUDIES.length) % STUDIES.length];
    onChange(next.value);
    group.current
      ?.querySelector<HTMLElement>(`[data-study="${next.value}"]`)
      ?.focus();
  };
  return (
    <div
      ref={group}
      className="lab-switch"
      role="radiogroup"
      aria-label="Study"
      onKeyDown={onKeyDown}
    >
      {STUDIES.map((study) => (
        <button
          key={study.value}
          type="button"
          role="radio"
          data-study={study.value}
          aria-checked={study.value === value}
          tabIndex={study.value === value ? 0 : -1}
          onClick={() => onChange(study.value)}
        >
          {study.label}
        </button>
      ))}
    </div>
  );
}

/** The experiment name in the top bar; commits on Enter or blur, Escape restores it. */
export function NameField({
  value,
  label,
  onCommit,
}: {
  value: string;
  label: string;
  onCommit: (name: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const name = draft.trim();
    setDraft(null);
    if (name && name !== value) onCommit(name);
  };
  return (
    <input
      className="lab-name"
      aria-label={label}
      title={label}
      maxLength={80}
      spellCheck={false}
      value={draft ?? value}
      size={Math.min(28, Math.max(8, (draft ?? value).length + 1))}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        else if (event.key === "Escape") {
          event.preventDefault();
          setDraft(null);
        }
      }}
    />
  );
}

export function UndoRedo({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  return (
    <div className="lab-history">
      <button
        type="button"
        className="px-icon-button"
        aria-label="Undo"
        title="Undo (Ctrl Z)"
        disabled={!canUndo}
        onClick={onUndo}
      >
        <Undo2 size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="px-icon-button"
        aria-label="Redo"
        title="Redo (Ctrl Shift Z)"
        disabled={!canRedo}
        onClick={onRedo}
      >
        <Redo2 size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

export type StatusTone = "idle" | "busy" | "ok" | "warn" | "bad";

/** A labelled status dot; the label hides below 1200 px and stays as the tooltip. */
export function StatusDot({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: StatusTone;
}) {
  return (
    <span
      className="lab-status"
      data-tone={tone}
      title={`${label}: ${value}`}
      role="status"
    >
      <span className="lab-status-dot" aria-hidden="true" />
      <span className="lab-status-label">
        <span className="px-visually-hidden">{label}: </span>
        {value}
      </span>
    </span>
  );
}

export function ShortcutsSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} title="Keyboard shortcuts" onClose={onClose}>
      <dl className="lab-keys">
        {SHORTCUTS.map(({ keys, action }) => (
          <div key={keys}>
            <dt>
              {keys.split(" ").map((key) => (
                <kbd key={key}>{key}</kbd>
              ))}
            </dt>
            <dd>{action}</dd>
          </div>
        ))}
      </dl>
    </Sheet>
  );
}

/**
 * The inspector and dock share the bottom of the screen below 760 px, so only one is open
 * there at a time. The inspector starts collapsed below 1200 px (LAB_PLAN.md §5.4).
 */
export function useLabPanels(initialDock = false) {
  const compact = useMedia(COMPACT);
  const tablet = useMedia(TABLET);
  const [inspector, setInspector] = useState(() => !matches(TABLET));
  const [dock, setDock] = useState(initialDock);
  return {
    compact,
    dockMaxFraction: tablet ? 0.45 : 0.6,
    inspectorOpen: inspector && !(compact && dock),
    dockOpen: dock,
    setInspectorOpen(open: boolean) {
      setInspector(open);
      if (open && compact) setDock(false);
    },
    setDockOpen(open: boolean) {
      setDock(open);
      if (open && compact) setInspector(false);
    },
  };
}

export type LabFrameProps = {
  study: Study;
  active: boolean;
  onStudyChange: (study: Study) => void;
  /** Document title while this study is shown. */
  documentTitle: string;
  /** Name field and undo and redo. */
  title: ReactNode;
  /** Run, verify and other primary actions of the study. */
  controls: ReactNode;
  status: ReactNode;
  menu: MenuEntry[];
  rail: RailItem[];
  railLabel: string;
  /** Sheets owned by the study. */
  sheets?: ReactNode;
  /** The viewport, its HUD, the inspector and the dock. */
  children: ReactNode;
};

/** The lab shell: top bar, parts rail and one stage (LAB_PLAN.md §3). */
export function LabFrame({
  study,
  active,
  onStudyChange,
  documentTitle,
  title,
  controls,
  status,
  menu,
  rail,
  railLabel,
  sheets,
  children,
}: LabFrameProps) {
  useEffect(() => {
    if (active) document.title = documentTitle;
  }, [active, documentTitle]);

  return (
    <div className="lab-frame" data-study={study} hidden={!active}>
      <header className="lab-topbar">
        <a className="lab-brand" href="#/" aria-label="Physix home">
          <PhysixMark />
          <span>Physix</span>
        </a>
        <div className="lab-title">{title}</div>
        <StudySwitch value={study} onChange={onStudyChange} />
        <div className="lab-controls">{controls}</div>
        <div className="lab-statuses">{status}</div>
        <Menu
          label="More actions"
          icon={<MoreHorizontal size={18} aria-hidden="true" />}
          items={menu}
        />
      </header>
      <div className="lab-body">
        <Rail label={railLabel} items={rail} />
        <main
          className="lab-stage"
          aria-label={`${STUDIES.find((item) => item.value === study)?.label ?? ""} study`}
        >
          {children}
        </main>
      </div>
      {sheets}
    </div>
  );
}
