/**
 * The Witness mark: an open eye whose pupil is a check. "Seen, and confirmed."
 * Decorative unless a label is given.
 */
export function WitnessMark({
  className = "size-8",
  label,
}: {
  className?: string;
  label?: string;
}) {
  return (
    <svg
      viewBox="0 0 40 40"
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      fill="none"
    >
      <rect x="1" y="1" width="38" height="38" rx="11" fill="var(--primary)" />
      <path
        d="M7 20.5C10.4 14.6 14.9 11.7 20 11.7s9.6 2.9 13 8.8c-3.4 5.9-7.9 8.8-13 8.8S10.4 26.4 7 20.5Z"
        stroke="var(--primary-foreground)"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <path
        d="m15.8 20.6 2.9 2.9 5.6-6"
        stroke="var(--primary-foreground)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Mark + wordmark. `tone="muted"` adds a quiet descriptor after the name. */
export function Wordmark({ suffix, className = "" }: { suffix?: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <WitnessMark className="size-8" />
      <span className="font-display text-2xl font-semibold tracking-tight">Witness</span>
      {suffix && <span className="text-base text-muted">{suffix}</span>}
    </span>
  );
}
