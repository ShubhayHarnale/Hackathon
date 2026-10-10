import type { SessionStatus } from "@/persistence/types";

const STYLE: Record<SessionStatus, { label: string; className: string }> = {
  created: { label: "Not started", className: "border-border text-muted" },
  practice: { label: "Practising", className: "border-primary text-primary" },
  active: { label: "In progress", className: "border-primary bg-primary text-primary-foreground" },
  paused: { label: "Paused", className: "border-warning-fg bg-warning-bg text-warning-fg" },
  completed: { label: "Completed", className: "border-success text-success" },
  stopped: { label: "Stopped", className: "border-danger bg-danger text-danger-foreground" },
};

export function SessionStatusBadge({ status }: { status: SessionStatus }) {
  const { label, className } = STYLE[status];
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full border-2 px-3 py-0.5 text-sm font-bold ${className}`}
    >
      {label}
    </span>
  );
}
