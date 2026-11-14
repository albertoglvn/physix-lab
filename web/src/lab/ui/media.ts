import { useSyncExternalStore } from "react";

/** Breakpoints of LAB_PLAN.md §5.4. */
export const COMPACT = "(max-width: 759px)";
export const TABLET = "(max-width: 1199px)";

export function matches(query: string): boolean {
  try {
    return typeof window !== "undefined" && window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

/** Tracks a media query; false where `matchMedia` is unavailable. */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      try {
        const list = window.matchMedia(query);
        list.addEventListener("change", notify);
        return () => list.removeEventListener("change", notify);
      } catch {
        return () => {};
      }
    },
    () => matches(query),
    () => false,
  );
}
