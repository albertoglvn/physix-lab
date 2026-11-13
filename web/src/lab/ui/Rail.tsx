import { X } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import "./ui.css";

export type RailItem = {
  id: string;
  label: string;
  icon: ReactNode;
  /** Flyout content; `close` returns focus to the rail button. */
  content: (close: () => void) => ReactNode;
};

const FOCUSABLE =
  "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea, a[href], [tabindex]:not([tabindex='-1'])";

function FlyoutBody({
  item,
  onClose,
}: {
  item: RailItem;
  onClose: () => void;
}) {
  return <div className="px-flyout-body">{item.content(onClose)}</div>;
}

/**
 * Each rail button opens one flyout over the viewport;
 * Escape or a click outside closes it and focus returns to the icon (LAB_PLAN.md §3.2).
 */
export function Rail({
  label,
  items,
  initial = null,
}: {
  label: string;
  items: RailItem[];
  initial?: string | null;
}) {
  const id = useId();
  const [openId, setOpenId] = useState<string | null>(initial);
  const rail = useRef<HTMLElement>(null);
  const flyout = useRef<HTMLElement>(null);
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  const item = items.find((entry) => entry.id === openId);

  useEffect(() => {
    if (!openId) return;
    const body = flyout.current?.querySelector(".px-flyout-body");
    (
      body?.querySelector<HTMLElement>(FOCUSABLE) ??
      flyout.current?.querySelector<HTMLElement>(FOCUSABLE)
    )?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rail.current?.contains(event.target as Node)) setOpenId(null);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [openId]);

  const close = () => {
    const trigger = openId ? triggers.current.get(openId) : undefined;
    setOpenId(null);
    trigger?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };

  return (
    <nav ref={rail} className="px-rail" aria-label={label}>
      <div className="px-rail-buttons">
        {items.map((entry) => (
          <button
            key={entry.id}
            ref={(element) => {
              if (element) triggers.current.set(entry.id, element);
              else triggers.current.delete(entry.id);
            }}
            type="button"
            className="px-rail-button"
            aria-label={entry.label}
            title={entry.label}
            aria-expanded={openId === entry.id}
            aria-controls={openId === entry.id ? id : undefined}
            onClick={() => setOpenId(openId === entry.id ? null : entry.id)}
          >
            {entry.icon}
            <span aria-hidden="true">{entry.label}</span>
          </button>
        ))}
      </div>
      {item ? (
        <section
          ref={flyout}
          id={id}
          className="px-flyout"
          aria-label={item.label}
          onKeyDown={onKeyDown}
        >
          <header className="px-flyout-head">
            <h2>{item.label}</h2>
            <button
              type="button"
              className="px-icon-button"
              aria-label={`Close ${item.label}`}
              onClick={close}
            >
              <X size={15} aria-hidden="true" />
            </button>
          </header>
          <FlyoutBody item={item} onClose={close} />
        </section>
      ) : null}
    </nav>
  );
}
