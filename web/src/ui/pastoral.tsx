import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export function PhysixMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      width="23"
      height="23"
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      <path d="M11 2h2v5h-2zM5 5h2v2H5zm12 0h2v2h-2zM2 11h5v2H2zm15 0h5v2h-5zm-6 6h2v5h-2zm-6 0h2v2H5zm12 0h2v2h-2zM10 8h4v2h2v4h-2v2h-4v-2H8v-4h2z" />
    </svg>
  );
}

export function Action({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "text" | "glass";
}) {
  return (
    <a className={`pastoral-action pastoral-action--${variant}`} href={href}>
      <span>{children}</span>
      <span className="pastoral-keycap">
        <ChevronRight size={9} strokeWidth={2.8} aria-hidden="true" />
      </span>
    </a>
  );
}
