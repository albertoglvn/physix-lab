import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { useSyncExternalStore } from "react";
import {
  toasts as sharedStore,
  type ToastStore,
  type ToastTone,
} from "./toastStore";
import "./ui.css";

const ICON = {
  info: Info,
  ok: CircleCheck,
  warn: TriangleAlert,
  bad: CircleAlert,
} as const satisfies Record<ToastTone, unknown>;

/** Renders the toasts of `store` at the top centre of the lab. */
export function ToastViewport({ store = sharedStore }: { store?: ToastStore }) {
  const items = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  return (
    <div className="px-toasts" aria-live="polite">
      {items.map(({ id, tone, message, action }) => {
        const Icon = ICON[tone];
        return (
          <div
            key={id}
            className={`px-toast px-tone-${tone}`}
            role={tone === "bad" ? "alert" : "status"}
          >
            <Icon className="px-toast-icon" size={16} aria-hidden="true" />
            <p>{message}</p>
            {action ? (
              <button
                type="button"
                className="px-toast-action"
                onClick={() => {
                  action.run();
                  store.dismiss(id);
                }}
              >
                {action.label}
              </button>
            ) : null}
            <button
              type="button"
              className="px-icon-button"
              aria-label="Dismiss"
              onClick={() => store.dismiss(id)}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
