import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/coordinator/AutoRefresh";
import { NewSessionForm } from "@/components/coordinator/NewSessionForm";
import { SessionStatusBadge } from "@/components/coordinator/SessionStatusBadge";
import { loadSessionList, type SessionSummary } from "@/dashboard/server";
import { describeStop, formatOffset } from "@/dashboard/timeline";
import { getRepository } from "@/persistence/server";

export default function SessionsPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-6 py-10">
      <div className="flex flex-col gap-2">
        <p className="font-mono text-sm font-bold tracking-[0.14em] text-accent uppercase">
          Study team
        </p>
        <h1 className="text-5xl font-semibold tracking-tight">Sessions</h1>
        <p className="text-lg text-muted">
          Every at-home procedure, with its flags and evidence. Running sessions update live.
        </p>
      </div>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <SessionOverview />
      </Suspense>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <NewSession />
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

/** Sessions that may still change (auto-refresh while any exist). */
const RUNNING = ["created", "practice", "active", "paused"];
const IN_PROGRESS = ["practice", "active", "paused"];

function Stat({
  label,
  value,
  tone = "plain",
}: {
  label: string;
  value: number;
  tone?: "plain" | "danger" | "primary";
}) {
  const TONE = {
    plain: "text-foreground",
    primary: "text-primary",
    danger: "text-danger",
  } as const;
  return (
    <div className="rounded-3xl border-2 border-hairline bg-surface px-5 py-4 shadow-soft">
      <p className="text-sm font-bold text-muted">{label}</p>
      <p className={`font-display text-4xl font-semibold tabular-nums ${TONE[tone]}`}>{value}</p>
    </div>
  );
}

async function SessionOverview() {
  await connection();
  const rows = await loadSessionList();
  const live = rows.some((r) => RUNNING.includes(r.session.status));
  const openFlags = rows.reduce((n, r) => n + (r.timeline?.openFlags ?? 0), 0);
  const openCritical = rows.reduce((n, r) => n + (r.timeline?.openCritical ?? 0), 0);
  return (
    <>
      {/* Keep the list current while any session is running. */}
      {live && <AutoRefresh ms={4000} />}
      <section aria-label="Overview" className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Sessions" value={rows.length} />
        <Stat
          label="In progress"
          value={rows.filter((r) => IN_PROGRESS.includes(r.session.status)).length}
          tone="primary"
        />
        <Stat label="Open flags" value={openFlags} />
        <Stat
          label="Open critical"
          value={openCritical}
          tone={openCritical > 0 ? "danger" : "plain"}
        />
      </section>
      <SessionTable rows={rows} />
    </>
  );
}

function SessionTable({ rows }: { rows: readonly SessionSummary[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-3xl border-2 border-dashed border-border bg-surface px-6 py-12 text-center">
        <p className="font-display text-2xl font-semibold">No sessions yet</p>
        <p className="mt-2 text-lg text-muted">
          Create a link below and open it on a phone, or start one from the patient demo.
        </p>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-3xl border-2 border-hairline bg-surface shadow-soft">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b-2 border-hairline text-sm text-muted">
            <th className="px-5 py-3 font-bold">Participant</th>
            <th className="px-4 py-3 font-bold">Protocol</th>
            <th className="px-4 py-3 font-bold">Status</th>
            <th className="px-4 py-3 font-bold">Started</th>
            <th className="px-4 py-3 font-bold">Duration</th>
            <th className="px-4 py-3 font-bold">Open flags</th>
            <th className="px-5 py-3 font-bold">Outcome</th>
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
            const outcome =
              describeStop(session.stopReason, protocol?.protocol ?? null) ??
              (session.status === "completed" ? "All steps confirmed" : "–");
            return (
              <tr
                key={session.id}
                className="border-b border-hairline align-top transition-colors last:border-0 hover:bg-background"
              >
                <td className="px-5 py-4">
                  <Link
                    href={`/coordinator/sessions/${session.id}`}
                    className="font-bold whitespace-nowrap text-primary underline decoration-2 underline-offset-4 hover:decoration-primary/40"
                  >
                    {participant?.displayName ?? session.participantId}
                  </Link>
                  <div className="font-mono text-sm text-muted">{participant?.trialNumber}</div>
                </td>
                <td className="px-4 py-4">
                  {protocol?.protocol.title ?? session.protocolId}
                  <div className="text-sm text-muted">
                    v{session.protocolVersion} ·{" "}
                    {session.mode === "live" ? "live camera" : session.mode}
                  </div>
                </td>
                <td className="px-4 py-4">
                  <SessionStatusBadge status={session.status} />
                </td>
                <td className="px-4 py-4 text-sm whitespace-nowrap">{time(session.startedAt)}</td>
                <td className="px-4 py-4 font-mono text-sm">{duration}</td>
                <td className="px-4 py-4">
                  {timeline && timeline.openFlags > 0 ? (
                    <span
                      className={`inline-flex rounded-full px-3 py-1 text-sm font-bold ${timeline.openCritical > 0 ? "bg-danger-soft text-danger" : "bg-warning-bg text-warning-fg"}`}
                    >
                      {timeline.openFlags}
                      {timeline.openCritical > 0 && ` (${timeline.openCritical} critical)`}
                    </span>
                  ) : (
                    <span className="text-muted">0</span>
                  )}
                </td>
                <td
                  className={`px-5 py-4 text-sm ${session.status === "stopped" ? "font-bold text-danger" : session.status === "completed" ? "text-success" : ""}`}
                >
                  {outcome}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
