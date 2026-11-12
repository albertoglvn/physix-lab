/** A small store for lab notifications (DESIGN.md §6, Toast). */

export type ToastTone = "info" | "ok" | "warn" | "bad";

export type ToastAction = { label: string; run: () => void };

export type Toast = {
  id: number;
  tone: ToastTone;
  message: string;
  action?: ToastAction;
};

export type ToastStore = {
  push: (toast: Omit<Toast, "id">) => number;
  dismiss: (id: number) => void;
  clear: () => void;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => readonly Toast[];
};

export type ToastOptions = {
  /** Auto-dismiss delay in ms. Errors (`bad`) stay until dismissed. */
  duration?: number;
  /** Most toasts shown at once; the oldest is dropped first. */
  limit?: number;
};

export function createToastStore({
  duration = 5000,
  limit = 3,
}: ToastOptions = {}): ToastStore {
  let toasts: readonly Toast[] = [];
  let next = 1;
  const listeners = new Set<() => void>();
  const timers = new Map<number, ReturnType<typeof setTimeout>>();

  const emit = () => listeners.forEach((listener) => listener());
  const forget = (id: number) => {
    const timer = timers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(id);
  };

  const dismiss = (id: number) => {
    if (!toasts.some((toast) => toast.id === id)) return;
    forget(id);
    toasts = toasts.filter((toast) => toast.id !== id);
    emit();
  };

  return {
    push(toast) {
      const id = next++;
      const all = [...toasts, { ...toast, id }];
      all
        .slice(0, Math.max(0, all.length - limit))
        .forEach((old) => forget(old.id));
      toasts = all.slice(-limit);
      if (toast.tone !== "bad") {
        timers.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }
      emit();
      return id;
    },
    dismiss,
    clear() {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
      toasts = [];
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => toasts,
  };
}

/** The lab's shared store. */
export const toasts = createToastStore();
