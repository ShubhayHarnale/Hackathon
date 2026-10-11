"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { telHref } from "@/patient/screen";
import { LABELS } from "@/patient/copy";

/** Patient-facing building blocks: large text, >= 64px targets, high-contrast tokens. */

type Variant = "primary" | "secondary" | "danger";

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-primary text-primary-foreground shadow-lift hover:brightness-110 active:brightness-95",
  secondary:
    "border-2 border-border bg-surface text-foreground shadow-soft hover:border-foreground hover:bg-surface-2",
  danger: "bg-danger text-danger-foreground shadow-lift hover:brightness-110 active:brightness-95",
};

const BASE =
  "flex min-h-16 items-center justify-center rounded-[1.25rem] text-center font-bold transition-[filter,background-color,border-color,transform] duration-150 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none";

/** `full`: the screen's main actions. `bar`: the always-visible bottom controls. */
const SIZE = {
  full: "w-full gap-3 px-6 py-4 text-2xl",
  bar: "gap-2 px-4 py-2 text-xl",
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
  useEffect(() => ref.current?.focus({ preventScroll: false }), [children]);
  return (
    <h1
      ref={ref}
      tabIndex={-1}
      className={`font-display text-[2.5rem] font-semibold leading-[1.08] tracking-tight text-balance outline-none sm:text-5xl ${className}`}
    >
      {children}
    </h1>
  );
}

export function Lead({ children }: { children: ReactNode }) {
  return <p className="text-2xl leading-relaxed text-pretty">{children}</p>;
}

/** A small label above a heading ("Step 3 of 9", "Practice"). */
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p
      className={`font-mono text-lg font-bold uppercase tracking-[0.14em] text-muted ${className}`}
    >
      {children}
    </p>
  );
}

/** A soft panel for grouped content (instructions, timers, notes). */
export function Panel({
  children,
  tone = "plain",
  className = "",
}: {
  children: ReactNode;
  tone?: "plain" | "primary" | "warning" | "danger" | "success";
  className?: string;
}) {
  const TONE = {
    plain: "border-hairline bg-surface",
    primary: "border-primary/30 bg-primary-soft",
    warning: "border-warning-fg/40 bg-warning-bg text-warning-fg",
    danger: "border-danger/40 bg-danger-soft",
    success: "border-success/40 bg-success-soft",
  } as const;
  return (
    <div className={`rounded-3xl border-2 px-5 py-4 shadow-soft ${TONE[tone]} ${className}`}>
      {children}
    </div>
  );
}

function PhoneIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6 shrink-0" fill="currentColor">
      <path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z" />
    </svg>
  );
}
