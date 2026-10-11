import type { ProtocolStatus } from "@/persistence/types";

export function StatusBadge({ status }: { status: ProtocolStatus }) {
  const published = status === "published";
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-bold ${
        published ? "bg-success-soft text-success" : "bg-warning-bg text-warning-fg"
      }`}
    >
      <span
        aria-hidden="true"
        className={`size-2 rounded-full ${published ? "bg-success" : "bg-warning-fg"}`}
      />
      {published ? "Published" : "Draft"}
    </span>
  );
}
