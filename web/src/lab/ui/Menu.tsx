import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import "./ui.css";

export type MenuEntry =
  | {
      label: string;
      icon?: ReactNode;
      /** Shortcut or short value shown at the end of the row. */
      hint?: string;
      disabled?: boolean;
      onSelect: () => void;
    }
  | "separator";

/** Items that can take focus, in order. */
export function focusableItems(root: ParentNode | null): HTMLElement[] {
  return root
    ? [
        ...root.querySelectorAll<HTMLElement>(
          "[role='menuitem']:not([disabled])",
        ),
      ]
    : [];
}

/** The index that arrow, Home and End keys move to in a list of `count` items. */
export function nextIndex(key: string, current: number, count: number) {
  if (!count) return -1;
  switch (key) {
    case "ArrowDown":
      return (current + 1) % count;
    case "ArrowUp":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return current;
  }
}

/** The overflow menu of the top bar. It is the only place for global actions. */
export function Menu({
  label,
  icon,
  items,
}: {
  label: string;
  icon: ReactNode;
  items: MenuEntry[];
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    focusableItems(list.current)[0]?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!list.current?.contains(target) && !trigger.current?.contains(target))
        setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab") close(false);
    else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const entries = focusableItems(list.current);
      const current = entries.indexOf(document.activeElement as HTMLElement);
      entries[nextIndex(event.key, current, entries.length)]?.focus();
    }
  };

  return (
    <div className="px-menu">
      <button
        ref={trigger}
        type="button"
        className="px-icon-button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
      >
        {icon}
      </button>
      {open ? (
        <div
          ref={list}
          id={id}
          className="px-menu-list"
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
        >
          {items.map((item, index) =>
            item === "separator" ? (
              <hr key={`separator-${index}`} className="px-menu-separator" />
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className="px-menu-item"
                disabled={item.disabled}
                tabIndex={-1}
                onClick={() => {
                  close(false);
                  item.onSelect();
                }}
              >
                <span className="px-menu-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span className="px-menu-label">{item.label}</span>
                {item.hint ? (
                  <span className="px-menu-hint">{item.hint}</span>
                ) : null}
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
