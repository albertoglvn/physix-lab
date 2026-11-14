/**
 * Per-viewer layout preferences (panel collapsed, dock height). Storage can be missing or
 * throw in private windows and previews, so every access is guarded and the lab renders
 * from its defaults without it.
 */
import { useCallback, useState } from "react";

const PREFIX = "physix.lab.ui.";

export type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

function browserStore(): KeyValueStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readPreference<T>(
  key: string,
  fallback: T,
  isValid: (value: unknown) => value is T,
  store: KeyValueStore | null = browserStore(),
): T {
  try {
    const raw = store?.getItem(PREFIX + key);
    if (raw == null) return fallback;
    const value: unknown = JSON.parse(raw);
    return isValid(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function writePreference(
  key: string,
  value: unknown,
  store: KeyValueStore | null = browserStore(),
): void {
  try {
    store?.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage is a convenience; losing a preference is harmless.
  }
}

export const isBoolean = (value: unknown): value is boolean =>
  typeof value === "boolean";

export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** `useState` that remembers its value under `key` when a key is given. */
export function usePreference<T>(
  key: string | undefined,
  fallback: T,
  isValid: (value: unknown) => value is T,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() =>
    key ? readPreference(key, fallback, isValid) : fallback,
  );
  const update = useCallback(
    (next: T) => {
      setValue(next);
      if (key) writePreference(key, next);
    },
    [key],
  );
  return [value, update];
}
