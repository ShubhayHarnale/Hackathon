import type { EngineEvent } from "@/engine";
import type { SessionRecord } from "@/persistence/types";

export type SessionPatch = {
  -readonly [K in "status" | "stopReason" | "startedAt" | "endedAt"]?: SessionRecord[K];
};

const TERMINAL = new Set<SessionRecord["status"]>(["completed", "stopped"]);

/**
 * How a batch of engine events changes the session record. Pure, so the events route
 * stays thin. Times come from the events (the patient's clock: when things happened),
 * not from when the server received them. A finished session never changes status
 * again, so a late retry can't reopen it.
 */
export function sessionPatchFor(
  session: Pick<SessionRecord, "status" | "startedAt" | "endedAt">,
  events: readonly EngineEvent[],
): SessionPatch {
  if (TERMINAL.has(session.status)) return {};
  const patch: SessionPatch = {};
  let status = session.status;

  for (const e of [...events].sort((a, b) => a.eventSeq - b.eventSeq)) {
    if (TERMINAL.has(status)) break;
    switch (e.type) {
      case "practice_started":
        status = "practice";
        break;
      case "run_started":
        status = "active";
        if (session.startedAt === null && patch.startedAt === undefined) patch.startedAt = e.at;
        break;
      case "paused":
        status = "paused";
        break;
      case "resumed":
        status = e.run === "practice" ? "practice" : "active";
        break;
      case "completed":
        status = "completed";
        patch.endedAt = e.at;
        break;
      case "stopped":
        status = "stopped";
        patch.stopReason = e.reason;
        patch.endedAt = e.at;
        break;
      default:
        break;
    }
  }
  if (status !== session.status) patch.status = status;
  return patch;
}
