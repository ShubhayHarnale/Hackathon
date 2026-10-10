import type { ProtocolStatus } from "@/persistence/types";

export function StatusBadge({ status }: { status: ProtocolStatus }) {
  const published = status === "published";
  return (
    <span
      className={`inline-block rounded-full border-2 px-3 py-0.5 text-sm font-bold ${
        published
          ? "border-success text-success"
          : "border-warning-fg bg-warning-bg text-warning-fg"
      }`}
    >
      {published ? "Published" : "Draft"}
    </span>
  );
}
