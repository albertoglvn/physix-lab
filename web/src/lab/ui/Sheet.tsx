import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import "./ui.css";

export type SheetProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  /** Extra header controls, shown before the close button. */
  actions?: ReactNode;
  wide?: boolean;
  children: ReactNode;
};

/**
 * A centred modal sheet (DESIGN.md §5). It uses the native dialog, so focus is trapped,
 * Escape closes it and focus returns to the control that opened it. Only one is open at a
 * time and closing returns to the same lab state.
 */
export function Sheet({
  open,
  title,
  onClose,
  actions,
  wide,
  children,
}: SheetProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      try {
        element.showModal();
      } catch {
        element.setAttribute("open", "");
      }
    } else if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className="px-sheet"
      data-wide={wide ? "" : undefined}
      aria-labelledby={heading}
      onClose={() => {
        if (open) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) dialog.current?.close();
      }}
    >
      {open ? (
        <div className="px-sheet-frame">
          <header className="px-sheet-head">
            <h2 id={heading}>{title}</h2>
            {actions}
            <button
              type="button"
              className="px-icon-button"
              aria-label={`Close ${title}`}
              onClick={() => dialog.current?.close()}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </header>
          <div className="px-sheet-body">{children}</div>
        </div>
      ) : null}
    </dialog>
  );
}
