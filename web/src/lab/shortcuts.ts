/** Keyboard shortcuts of the lab (LAB_PLAN.md §3.4). */
import { useEffect, useRef } from "react";

export type ShortcutAction =
  "run" | "step" | "reset" | "frame" | "delete" | "deselect" | "undo" | "redo";

export type KeyLike = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  target?: unknown;
};

export const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: "Space", action: "Run or pause" },
  { keys: ".", action: "Step" },
  { keys: "R", action: "Reset the run" },
  { keys: "F", action: "Frame the scene" },
  { keys: "Delete", action: "Remove the selection" },
  { keys: "Esc", action: "Clear the selection" },
  { keys: "Ctrl Z", action: "Undo" },
  { keys: "Ctrl Shift Z", action: "Redo" },
];

/** True when typing into `target` should not trigger lab shortcuts. */
export function isEditable(target: unknown): boolean {
  if (typeof target !== "object" || target === null) return false;
  const element = target as {
    tagName?: string;
    isContentEditable?: boolean;
    closest?: (selector: string) => unknown;
  };
  if (element.isContentEditable) return true;
  const tag = element.tagName?.toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return !!element.closest?.("dialog[open], [role='menu']");
}

function isControl(target: unknown): boolean {
  if (typeof target !== "object" || target === null) return false;
  const element = target as { tagName?: string; getAttribute?: unknown };
  const tag = element.tagName?.toUpperCase();
  if (tag === "BUTTON" || tag === "A" || tag === "SUMMARY") return true;
  const role =
    typeof element.getAttribute === "function"
      ? (element.getAttribute as (name: string) => string | null).call(
          target,
          "role",
        )
      : null;
  return !!role && /^(button|radio|tab|menuitem|switch|checkbox)$/.test(role);
}

export function shortcutFor(event: KeyLike): ShortcutAction | null {
  const command = !!(event.ctrlKey || event.metaKey);
  const key = event.key.toLowerCase();
  if (command && !event.altKey) {
    if (isEditable(event.target)) return null;
    if (key === "z") return event.shiftKey ? "redo" : "undo";
    if (key === "y" && !event.shiftKey) return "redo";
    return null;
  }
  if (command || event.altKey || event.shiftKey) return null;
  if (isEditable(event.target)) return null;
  switch (key) {
    case " ":
      // Space presses a focused control; it runs only from the viewport or the page.
      return isControl(event.target) ? null : "run";
    case ".":
      return "step";
    case "r":
      return "reset";
    case "f":
      return "frame";
    case "delete":
    case "backspace":
      return "delete";
    case "escape":
      return "deselect";
    default:
      return null;
  }
}

/** Calls the handler for each shortcut while `active`; unhandled actions pass through. */
export function useShortcuts(
  active: boolean,
  handlers: Partial<Record<ShortcutAction, () => void>>,
): void {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const action = shortcutFor(event);
      const handler = action && latest.current[action];
      if (!handler) return;
      event.preventDefault();
      handler();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active]);
}
