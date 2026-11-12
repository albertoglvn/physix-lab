import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { isBoolean, usePreference } from "./persist";
import "./ui.css";

export type PanelAnchor = "left" | "right" | "bottom";

export type FloatingPanelProps = {
  title: string;
  anchor: PanelAnchor;
  icon?: ReactNode;
  /** Extra header controls, shown before the collapse button. */
  actions?: ReactNode;
  /** Remembers the collapsed state for this viewer under this key. */
  persistKey?: string;
  defaultCollapsed?: boolean;
  /** Controlled collapsed state; the panel then reports toggles through the callback. */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  className?: string;
  children: ReactNode;
};

const COLLAPSE_ICON = {
  left: ChevronLeft,
  right: ChevronRight,
  bottom: ChevronDown,
} as const;

const EXPAND_ICON = {
  left: ChevronRight,
  right: ChevronLeft,
  bottom: ChevronDown,
} as const;

/**
 * A panel docked to one edge of the viewport (DESIGN.md §5). It collapses to an edge tab
 * and does not support free dragging, which keeps layouts predictable.
 */
export function FloatingPanel({
  title,
  anchor,
  icon,
  actions,
  persistKey,
  defaultCollapsed = false,
  collapsed: controlled,
  onCollapsedChange,
  className,
  children,
}: FloatingPanelProps) {
  const id = useId();
  const [stored, setStored] = usePreference(
    persistKey && `panel.${persistKey}.collapsed`,
    defaultCollapsed,
    isBoolean,
  );
  const collapsed = controlled ?? stored;
  const tab = useRef<HTMLButtonElement>(null);
  const collapse = useRef<HTMLButtonElement>(null);
  const toggled = useRef(false);

  // Keep keyboard focus with the control that replaced the one the user pressed.
  useEffect(() => {
    if (!toggled.current) return;
    toggled.current = false;
    (collapsed ? tab : collapse).current?.focus();
  }, [collapsed]);

  const toggle = (next: boolean) => {
    toggled.current = true;
    if (controlled === undefined) setStored(next);
    onCollapsedChange?.(next);
  };

  const anchorClass = `px-anchor-${anchor}`;
  if (collapsed) {
    const Expand = EXPAND_ICON[anchor];
    return (
      <button
        ref={tab}
        type="button"
        className={`px-edge-tab ${anchorClass}`}
        aria-expanded={false}
        aria-controls={id}
        title={title}
        onClick={() => toggle(false)}
      >
        {icon ?? <Expand size={16} aria-hidden="true" />}
        <span className="px-edge-tab-label">{title}</span>
      </button>
    );
  }

  const Collapse = COLLAPSE_ICON[anchor];
  return (
    <section
      id={id}
      className={`px-panel ${anchorClass}${className ? ` ${className}` : ""}`}
      aria-label={title}
    >
      <header className="px-panel-head">
        <h2>
          {icon}
          {title}
        </h2>
        {actions}
        <button
          ref={collapse}
          type="button"
          className="px-icon-button"
          aria-label={`Collapse ${title}`}
          aria-expanded={true}
          aria-controls={id}
          title="Collapse"
          onClick={() => toggle(true)}
        >
          <Collapse size={16} aria-hidden="true" />
        </button>
      </header>
      <div className="px-panel-body">{children}</div>
    </section>
  );
}
