import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import mark from "../assets/brand/physix-mark.png";

export function PhysixMark() {
  return (
    <img className="physix-mark" src={mark} width={24} height={24} alt="" />
  );
}

export function Action({
  href,
  children,
  variant = "primary",
  target,
  onClick,
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "text" | "glass";
  target?: "_top";
  /** Runs alongside the navigation, which still follows `href`. */
  onClick?: () => void;
}) {
  return (
    <a
      className={`pastoral-action pastoral-action--${variant}`}
      href={href}
      target={target}
      onClick={onClick}
    >
      <span>{children}</span>
      <span className="pastoral-keycap">
        <ChevronRight size={9} strokeWidth={2.8} aria-hidden="true" />
      </span>
    </a>
  );
}
