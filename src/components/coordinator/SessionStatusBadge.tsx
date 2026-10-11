import type { SessionStatus } from "@/persistence/types";

const STYLE: Record<SessionStatus, { label: string; pill: string; dot: string }> = {
  created: { label: "Not started", pill: "bg-surface-2 text-muted", dot: "bg-muted" },
  practice: { label: "Practising", pill: "bg-primary-soft text-primary", dot: "bg-primary" },
  active: {
    label: "In progress",
    pill: "bg-primary-soft text-primary",
    dot: "bg-primary motion-safe:animate-pulse",
  },
  paused: { label: "Paused", pill: "bg-warning-bg text-warning-fg", dot: "bg-warning-fg" },
  completed: { label: "Completed", pill: "bg-success-soft text-success", dot: "bg-success" },
  stopped: { label: "Stopped", pill: "bg-danger-soft text-danger", dot: "bg-danger" },
};

export function SessionStatusBadge({ status }: { status: SessionStatus }) {
  const { label, pill, dot } = STYLE[status];
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-bold whitespace-nowrap ${pill}`}
    >
      <span aria-hidden="true" className={`size-2 rounded-full ${dot}`} />
      {label}
    </span>
  );
}
