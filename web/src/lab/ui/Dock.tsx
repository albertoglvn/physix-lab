import { ChevronUp } from "lucide-react";
import {
  useId,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { isBoolean, isFiniteNumber, usePreference } from "./persist";
import "./ui.css";

export const DOCK_MIN_HEIGHT = 200;
export const DOCK_MAX_FRACTION = 0.6;
const STEP = 24;

/** Dock height in px, kept between the minimum and a fraction of the viewport height. */
export function clampDockHeight(
  height: number,
  viewportHeight: number,
  maxFraction = DOCK_MAX_FRACTION,
  minHeight = DOCK_MIN_HEIGHT,
): number {
  const max = Math.max(minHeight, viewportHeight * maxFraction);
  if (!Number.isFinite(height)) return minHeight;
  return Math.round(Math.min(max, Math.max(minHeight, height)));
}

export type DockProps = {
  title: string;
  /** The single readout line shown while the dock is collapsed and above its content. */
  summary: ReactNode;
  persistKey?: string;
  defaultOpen?: boolean;
  defaultHeight?: number;
  /** Largest height as a fraction of the window: 0.6 on desktop, 0.45 on tablets. */
  maxFraction?: number;
  /** Controlled open state; the dock then reports toggles through the callback. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Keeps the content mounted while collapsed, so running work keeps its state. */
  keepMounted?: boolean;
  children: ReactNode;
};

/**
 * The data dock floating along the bottom of the viewport (DESIGN.md §5). Collapsed it is
 * one 36 px readout line; expanded it is resizable by pointer or keyboard.
 */
export function Dock({
  title,
  summary,
  persistKey,
  defaultOpen = false,
  defaultHeight = 280,
  maxFraction = DOCK_MAX_FRACTION,
  open: controlled,
  onOpenChange,
  keepMounted = false,
  children,
}: DockProps) {
  const id = useId();
  const [stored, setStored] = usePreference(
    persistKey && `dock.${persistKey}.open`,
    defaultOpen,
    isBoolean,
  );
  const open = controlled ?? stored;
  const setOpen = (next: boolean) => {
    if (controlled === undefined) setStored(next);
    onOpenChange?.(next);
  };
  const [height, setHeight] = usePreference(
    persistKey && `dock.${persistKey}.height`,
    defaultHeight,
    isFiniteNumber,
  );
  const drag = useRef<{ y: number; height: number } | null>(null);
  const resize = (next: number) =>
    setHeight(clampDockHeight(next, window.innerHeight, maxFraction));

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { y: event.clientY, height };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    resize(drag.current.height + drag.current.y - event.clientY);
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const steps: Record<string, number> = {
      ArrowUp: height + STEP,
      ArrowDown: height - STEP,
      Home: DOCK_MIN_HEIGHT,
      End: Number.POSITIVE_INFINITY,
    };
    if (!(event.key in steps)) return;
    event.preventDefault();
    resize(steps[event.key]);
  };

  return (
    <section
      className="px-dock"
      aria-label={title}
      data-open={open ? "" : undefined}
    >
      {open ? (
        <div
          className="px-dock-handle"
          role="separator"
          aria-orientation="horizontal"
          aria-label={`Resize ${title}`}
          aria-controls={id}
          aria-valuemin={DOCK_MIN_HEIGHT}
          aria-valuenow={height}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
        />
      ) : null}
      <button
        type="button"
        className="px-dock-bar"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <span className="px-dock-summary num">{summary}</span>
        <ChevronUp className="px-dock-chevron" size={16} aria-hidden="true" />
        <span className="px-visually-hidden">
          {open ? `Collapse ${title}` : `Expand ${title}`}
        </span>
      </button>
      {open || keepMounted ? (
        <div
          id={id}
          className="px-dock-body"
          hidden={!open}
          style={{ height: `min(${height}px, ${maxFraction * 100}vh)` }}
        >
          {children}
        </div>
      ) : null}
    </section>
  );
}
