"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { telHref } from "@/patient/screen";
import { LABELS } from "@/patient/copy";

/** Patient-facing building blocks: large text, >= 56px targets, high-contrast tokens. */

type Variant = "primary" | "secondary" | "danger";

const VARIANT: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground",
  secondary: "border-4 border-foreground bg-background text-foreground",
  danger: "bg-danger text-danger-foreground",
};

const BASE =
  "flex min-h-16 items-center justify-center rounded-2xl text-center font-bold disabled:opacity-60";

/** `full`: the screen's main actions. `bar`: the always-visible bottom controls. */
const SIZE = {
  full: "w-full gap-3 px-6 py-3 text-2xl",
  bar: "gap-2 whitespace-nowrap px-4 text-xl",
} as const;
type Size = keyof typeof SIZE;

export function BigButton({
  children,
  onClick,
  variant = "primary",
  disabled = false,
  size = "full",
}: {
  children: ReactNode;
  onClick: () => void;
  variant?: Variant;
  disabled?: boolean;
  size?: Size;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${BASE} ${SIZE[size]} ${VARIANT[variant]}`}
    >
      {children}
    </button>
  );
}

/** A real tel: link (works even if JavaScript stalls) that also tells the engine. */
export function CallNurseLink({
  phone,
  onCall,
  label = LABELS.callNurse,
  variant = "secondary",
  size = "full",
}: {
  phone: string;
  onCall: () => void;
  label?: string;
  variant?: Variant;
  size?: Size;
}) {
  return (
    <a
      href={telHref(phone)}
      onClick={onCall}
      aria-label={`${label}, ${phone}`}
      className={`${BASE} ${SIZE[size]} ${VARIANT[variant]}`}
    >
      <PhoneIcon />
      {label}
    </a>
  );
}

/**
 * The screen's main heading. Takes focus when the screen appears, so screen readers
 * announce the new screen and keyboard users start from the top.
 */
export function ScreenHeading({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus({ preventScroll: false }), []);
  return (
    <h1 ref={ref} tabIndex={-1} className={`text-4xl font-bold leading-tight ${className}`}>
      {children}
    </h1>
  );
}

export function Lead({ children }: { children: ReactNode }) {
  return <p className="text-2xl leading-snug">{children}</p>;
}

function PhoneIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6 shrink-0" fill="currentColor">
      <path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z" />
    </svg>
  );
}
