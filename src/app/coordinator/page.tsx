import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/coordinator/AutoRefresh";
import { NewSessionForm } from "@/components/coordinator/NewSessionForm";
import { SessionStatusBadge } from "@/components/coordinator/SessionStatusBadge";
import { loadSessionList } from "@/dashboard/server";
import { describeStop, formatOffset } from "@/dashboard/timeline";
import { getRepository } from "@/persistence/server";

export default function SessionsPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-8 py-10">
      <h1 className="text-3xl font-bold">Sessions</h1>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <NewSession />
      </Suspense>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <SessionTable />
      </Suspense>
    </main>
  );
}

async function NewSession() {
  await connection();
  const repo = getRepository();
  const [participants, records] = await Promise.all([
    repo.listParticipants(),
    repo.listProtocols(),
  ]);
  const published = await Promise.all(records.map((r) => repo.getLatestPublishedProtocol(r.id)));
  return (
    <NewSessionForm
      participants={participants.map((p) => ({
        id: p.id,
        label: `${p.displayName} · ${p.trialNumber}`,
      }))}
      protocols={published.flatMap((p) =>
        p ? [{ id: p.id, label: `${p.protocol.title} (v${p.version})` }] : [],
      )}
    />
  );
}

const time = (ms: number | null) =>
  ms === null
    ? "–"
    : new Date(ms).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

async function SessionTable() {
  await connection();
  const rows = await loadSessionList();
  const live = rows.some((r) => ["practice", "active", "paused"].includes(r.session.status));
  if (rows.length === 0) {
    return (
      <p className="text-lg text-muted">
        No sessions yet. Create a link above and open it on a phone.
      </p>
    );
  }
  return (
    <>
      {/* Keep the list current while any session is running. */}
      {live && <AutoRefresh ms={4000} />}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b-2 border-border">
              <th className="py-2 pr-4">Participant</th>
              <th className="py-2 pr-4">Protocol</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Started</th>
              <th className="py-2 pr-4">Duration</th>
              <th className="py-2 pr-4">Open flags</th>
              <th className="py-2">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ session, participant, protocol, timeline }) => {
              const duration =
                session.startedAt !== null && session.endedAt !== null
                  ? formatOffset(session.endedAt - session.startedAt)
                  : session.startedAt !== null
                    ? "running"
                    : "–";
              return (
                <tr key={session.id} className="border-b border-border/40 align-top">
                  <td className="py-3 pr-4">
                    <Link
                      href={`/coordinator/sessions/${session.id}`}
                      className="font-bold text-primary underline"
                    >
                      {participant?.displayName ?? session.participantId}
                    </Link>
                    <div className="text-sm text-muted">{participant?.trialNumber}</div>
                  </td>
                  <td className="py-3 pr-4">
                    {protocol?.protocol.title ?? session.protocolId}
                    <div className="text-sm text-muted">
                      v{session.protocolVersion} ·{" "}
                      {session.mode === "live" ? "live camera" : session.mode}
                    </div>
                  </td>
                  <td className="py-3 pr-4">
                    <SessionStatusBadge status={session.status} />
                  </td>
                  <td className="py-3 pr-4">{time(session.startedAt)}</td>
                  <td className="py-3 pr-4">{duration}</td>
                  <td className="py-3 pr-4">
                    {timeline && timeline.openFlags > 0 ? (
                      <span
                        className={`font-bold ${timeline.openCritical > 0 ? "text-danger" : "text-warning-fg"}`}
                      >
                        {timeline.openFlags}
                        {timeline.openCritical > 0 && ` (${timeline.openCritical} critical)`}
                      </span>
                    ) : (
                      <span className="text-muted">0</span>
                    )}
                  </td>
                  <td className="py-3 text-sm">
                    {describeStop(session.stopReason, protocol?.protocol ?? null) ??
                      (session.status === "completed" ? "All steps confirmed" : "–")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
