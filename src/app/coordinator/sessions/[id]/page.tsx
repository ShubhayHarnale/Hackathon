import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/coordinator/AutoRefresh";
import { ReviewFlagButton } from "@/components/coordinator/ReviewFlagButton";
import { SessionStatusBadge } from "@/components/coordinator/SessionStatusBadge";
import { loadSessionDetail } from "@/dashboard/server";
import {
  describeStop,
  formatOffset,
  type StepOutcome,
  type TimelineFlag,
} from "@/dashboard/timeline";
import type { ConfirmMethod } from "@/engine";
import type { EvidenceFrameRecord } from "@/persistence/types";

export default function SessionPage({ params }: PageProps<"/coordinator/sessions/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-8 py-10">
      <Link href="/coordinator" className="text-primary underline">
        ← All sessions
      </Link>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        {params.then(({ id }) => (
          <SessionDetailView id={id} />
        ))}
      </Suspense>
    </main>
  );
}

const OUTCOME: Record<StepOutcome, { icon: string; label: string; className: string }> = {
  confirmed: { icon: "✓", label: "Confirmed", className: "border-success text-success" },
  missed: {
    icon: "!",
    label: "Skipped",
    className: "border-warning-fg bg-warning-bg text-warning-fg",
  },
  stopped_here: {
    icon: "✕",
    label: "Stopped here",
    className: "border-danger bg-danger text-danger-foreground",
  },
  in_progress: { icon: "●", label: "In progress", className: "border-primary text-primary" },
  not_reached: { icon: "○", label: "Not reached", className: "border-border text-muted" },
};

const METHOD_LABEL: Record<ConfirmMethod, string> = {
  visual: "camera",
  hold: "camera, timed hold",
  voice: "spoken",
  tap: "tapped Done",
  wait: "timer",
};

const SEVERITY_STYLE: Record<TimelineFlag["severity"], string> = {
  critical: "border-danger",
  warning: "border-warning-fg",
  info: "border-border",
};

function Evidence({
  frame,
  urls,
}: {
  frame: EvidenceFrameRecord | null;
  urls: ReadonlyMap<string, string>;
}) {
  const url = frame ? urls.get(frame.id) : undefined;
  if (!frame || !url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="shrink-0"
      aria-label={`Open evidence frame ${frame.seq}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed / private URLs, not optimisable */}
      <img
        src={url}
        alt={`Camera frame ${frame.seq}`}
        className="h-20 w-28 rounded-lg border-2 border-border object-cover"
      />
    </a>
  );
}

async function SessionDetailView({ id }: { id: string }) {
  await connection();
  const detail = await loadSessionDetail(id);
  if (!detail) notFound();
  const { session, participant, protocol, timeline, events, evidenceUrls } = detail;
  const start = timeline?.runStartedAt ?? session.startedAt;
  const offset = (at: number | null) =>
    at === null || start === null ? "" : formatOffset(at - start);
  const running = ["created", "practice", "active", "paused"].includes(session.status);
  const outcome = describeStop(session.stopReason, protocol?.protocol ?? null);
  const flags = [...(timeline?.flags ?? [])].sort(
    (a, b) => Number(!!a.review) - Number(!!b.review) || a.eventSeq - b.eventSeq,
  );

  return (
    <>
      {running && <AutoRefresh ms={2500} />}
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold">
            {participant?.displayName ?? session.participantId}
          </h1>
          <SessionStatusBadge status={session.status} />
        </div>
        <p className="text-lg text-muted">
          {participant?.trialNumber} · {protocol?.protocol.title ?? session.protocolId} v
          {session.protocolVersion} · {session.mode === "live" ? "live camera" : session.mode}
          {session.startedAt !== null &&
            ` · started ${new Date(session.startedAt).toLocaleString()}`}
          {session.startedAt !== null &&
            session.endedAt !== null &&
            ` · ${formatOffset(session.endedAt - session.startedAt)} long`}
        </p>
        {outcome && <p className="text-lg font-bold text-danger">{outcome}</p>}
        {session.status === "completed" && (
          <p className="text-lg font-bold text-success">All steps confirmed.</p>
        )}
        {running && <p className="text-sm text-muted">Live: updates automatically.</p>}
      </header>

      <section aria-labelledby="flags-heading" className="flex flex-col gap-3">
        <h2 id="flags-heading" className="text-2xl font-bold">
          Flags{" "}
          <span className="text-lg font-normal text-muted">
            ({timeline?.openFlags ?? 0} open
            {timeline && timeline.openCritical > 0 ? `, ${timeline.openCritical} critical` : ""})
          </span>
        </h2>
        {flags.length === 0 ? (
          <p className="text-muted">Nothing flagged.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {flags.map((f) => (
              <li
                key={f.eventSeq}
                className={`flex flex-wrap items-start gap-4 rounded-xl border-2 border-l-8 p-4 ${SEVERITY_STYLE[f.severity]} ${f.review ? "opacity-60" : ""}`}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="font-bold">
                    <span className="mr-2 font-mono text-sm text-muted">{offset(f.at)}</span>
                    {f.severity === "critical" && (
                      <span className="mr-2 text-danger">CRITICAL</span>
                    )}
                    {f.title}
                  </p>
                  <p>{f.detail}</p>
                </div>
                <Evidence frame={f.evidence} urls={evidenceUrls} />
                {f.severity !== "info" &&
                  (f.review ? (
                    <span className="text-sm text-muted">
                      Reviewed {new Date(f.review.reviewedAt).toLocaleTimeString()}
                    </span>
                  ) : (
                    <ReviewFlagButton sessionId={session.id} eventSeq={f.eventSeq} />
                  ))}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="steps-heading" className="flex flex-col gap-3">
        <h2 id="steps-heading" className="text-2xl font-bold">
          Steps
        </h2>
        {!timeline ? (
          <p className="text-danger">Protocol version not found.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {timeline.rows.map((row) => {
              const style = OUTCOME[row.outcome];
              return (
                <li
                  key={row.step.id}
                  className="flex flex-wrap items-center gap-4 rounded-xl border-2 border-border p-3"
                >
                  <span
                    aria-label={style.label}
                    title={style.label}
                    className={`flex size-9 shrink-0 items-center justify-center rounded-full border-2 font-bold ${style.className}`}
                  >
                    {style.icon}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <p className="font-bold">
                      {row.step.order}. {row.step.instruction}
                      {row.step.critical && (
                        <span className="ml-2 rounded-full bg-danger px-2 py-0.5 text-xs font-bold text-danger-foreground">
                          Critical
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-muted">
                      {style.label}
                      {row.confirmedAt !== null && ` at ${offset(row.confirmedAt)}`}
                      {row.activeMs !== null && ` · took ${Math.round(row.activeMs / 1000)}s`}
                      {row.methods.length > 0 &&
                        ` · ${row.methods.map((m) => METHOD_LABEL[m]).join(" + ")}`}
                    </p>
                  </div>
                  <Evidence frame={row.evidence} urls={evidenceUrls} />
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <details className="rounded-xl border-2 border-border p-4">
        <summary className="cursor-pointer font-bold">
          Raw event log ({events.length} events)
        </summary>
        <ol className="mt-3 max-h-96 overflow-auto font-mono text-sm">
          {events.map(({ event }) => (
            <li key={event.eventSeq} className={event.run === "practice" ? "text-muted" : ""}>
              {event.eventSeq} {offset(event.at)} {event.run ?? "-"} {event.type}
              {"stepId" in event && event.stepId ? ` ${event.stepId}` : ""}
            </li>
          ))}
        </ol>
      </details>
    </>
  );
}
