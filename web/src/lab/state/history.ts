/**
 * Undo and redo for the experiment. Each study keeps one stack of committed states; an edit
 * pushes the previous state and clears the redo branch.
 */
import { useCallback, useRef, useState } from "react";

export const HISTORY_LIMIT = 100;
/** Edits of one group closer together than this merge into one undo step. */
export const MERGE_WINDOW_MS = 800;

export type History<T> = { past: T[]; present: T; future: T[] };

export const startHistory = <T>(present: T): History<T> => ({
  past: [],
  present,
  future: [],
});

export function pushHistory<T>(
  history: History<T>,
  next: T,
  limit = HISTORY_LIMIT,
): History<T> {
  if (Object.is(next, history.present)) return history;
  const past = [...history.past, history.present];
  return {
    past: past.length > limit ? past.slice(past.length - limit) : past,
    present: next,
    future: [],
  };
}

/** Replaces the present state without adding an undo step, as during a drag. */
export function replaceHistory<T>(history: History<T>, next: T): History<T> {
  if (Object.is(next, history.present)) return history;
  return { past: history.past, present: next, future: [] };
}

/** True when an edit of `group` at `now` continues the previous edit of the same group. */
export function continuesEdit(
  previous: { group: string; time: number } | null,
  group: string | undefined,
  now: number,
  window = MERGE_WINDOW_MS,
): boolean {
  return (
    group !== undefined &&
    previous !== null &&
    previous.group === group &&
    now - previous.time < window
  );
}

export function undoHistory<T>(history: History<T>): History<T> {
  if (!history.past.length) return history;
  return {
    past: history.past.slice(0, -1),
    present: history.past[history.past.length - 1],
    future: [history.present, ...history.future],
  };
}

export function redoHistory<T>(history: History<T>): History<T> {
  if (!history.future.length) return history;
  return {
    past: [...history.past, history.present],
    present: history.future[0],
    future: history.future.slice(1),
  };
}

export type HistoryControls<T> = {
  value: T;
  /**
   * Commits a new state that can be undone. Successive edits with the same `group`, such as
   * the moves of one drag or the keystrokes of one field, merge into one undo step.
   */
  set: (next: T, group?: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
};

export function useHistory<T>(initial: T | (() => T)): HistoryControls<T> {
  const [history, setHistory] = useState(() =>
    startHistory(
      typeof initial === "function" ? (initial as () => T)() : initial,
    ),
  );
  const last = useRef<{ group: string; time: number } | null>(null);
  const set = useCallback((next: T, group?: string) => {
    const now = performance.now();
    const merge = continuesEdit(last.current, group, now);
    last.current = group === undefined ? null : { group, time: now };
    setHistory((current) =>
      merge ? replaceHistory(current, next) : pushHistory(current, next),
    );
  }, []);
  const undo = useCallback(() => {
    last.current = null;
    setHistory(undoHistory);
  }, []);
  const redo = useCallback(() => {
    last.current = null;
    setHistory(redoHistory);
  }, []);
  return {
    value: history.present,
    set,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  };
}
