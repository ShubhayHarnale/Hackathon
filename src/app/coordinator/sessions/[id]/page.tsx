import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { ReviewAlertButton } from "@/components/coordinator/ReviewAlertButton";
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
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-6 py-8">
      <Link
        href="/coordinator"
        className="w-fit rounded-full px-3 py-1 font-bold text-primary hover:bg-primary-soft"
      >
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

const OUTCOME: Record<StepOutcome, { icon: string; label: string; node: string; text: string }> = {
  confirmed: {
    icon: "✓",
    label: "Confirmed",
    node: "border-success bg-success text-[var(--surface)]",
    text: "text-success",
  },
  missed: {
    icon: "!",
    label: "Skipped",
    node: "border-warning-fg bg-warning-bg text-warning-fg",
    text: "text-warning-fg",
  },
  stopped_here: {
    icon: "✕",
    label: "Stopped here",
    node: "border-danger bg-danger text-danger-foreground",
    text: "text-danger",
  },
  in_progress: {
    icon: "●",
    label: "In progress",
    node: "border-primary bg-primary-soft text-primary",
    text: "text-primary",
  },
  not_reached: {
    icon: "",
    label: "Not reached",
    node: "border-border bg-surface text-muted",
    text: "text-muted",
  },
};

const METHOD_LABEL: Record<ConfirmMethod, string> = {
  visual: "camera",
  hold: "camera, timed hold",
  voice: "spoken",
  tap: "tapped Done",
  wait: "timer",
};

const SEVERITY_STYLE: Record<TimelineFlag["severity"], string> = {
  critical: "border-danger/40 bg-danger-soft",
  warning: "border-warning-fg/40 bg-warning-bg",
  info: "border-hairline bg-surface",
};

function Evidence({
  frame,
  urls,
  size = "md",
}: {
  frame: EvidenceFrameRecord | null;
  urls: ReadonlyMap<string, string>;
  size?: "md" | "lg";
}) {
  const url = frame ? urls.get(frame.id) : undefined;
  if (!frame || !url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="group relative shrink-0 overflow-hidden rounded-xl border-2 border-hairline shadow-soft"
      aria-label={`Open evidence frame ${frame.seq}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed / private URLs, not optimisable */}
      <img
        src={url}
        alt={`Camera frame ${frame.seq}`}
        className={`${size === "lg" ? "h-28 w-40" : "h-20 w-28"} object-cover transition-transform duration-300 group-hover:scale-105`}
      />
      <span className="absolute right-1 bottom-1 rounded-md bg-foreground px-1.5 font-mono text-xs font-bold text-background">
        #{frame.seq}
      </span>
    </a>
  );
}

function Card({
  children,
  labelledBy,
  className = "",
}: {
  children: ReactNode;
  labelledBy: string;
  className?: string;
}) {
  return (
    <section
      aria-labelledby={labelledBy}
      className={`flex flex-col gap-4 rounded-3xl border-2 border-hairline bg-surface p-6 shadow-soft ${className}`}
    >
      {children}
    </section>
  );
}

async function SessionDetailView({ id }: { id: string }) {
  await connection();
  const detail = await loadSessionDetail(id);
  if (!detail) notFound();
  const { session, participant, protocol, timeline, events, evidenceUrls, alerts } = detail;
  const start = timeline?.runStartedAt ?? session.startedAt;
  const offset = (at: number | null) =>
    at === null || start === null ? "" : formatOffset(at - start);
  const running = ["created", "practice", "active", "paused"].includes(session.status);
  const outcome = describeStop(session.stopReason, protocol?.protocol ?? null);
  const flags = [...(timeline?.flags ?? [])].sort(
    (a, b) => Number(!!a.review) - Number(!!b.review) || a.eventSeq - b.eventSeq,
  );
  const confirmed = timeline?.rows.filter((r) => r.outcome === "confirmed").length ?? 0;
  const total = timeline?.rows.length ?? 0;

  return (
    <>
      <AutoRefresh ms={2500} limit={running ? undefined : 12} />

      {/* Header */}
      <header className="flex flex-col gap-5 rounded-[2rem] border-2 border-hairline bg-surface p-7 shadow-soft">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            {participant?.displayName ?? session.participantId}
          </h1>
          <SessionStatusBadge status={session.status} />
          {running && (
            <span className="inline-flex items-center gap-2 text-sm font-bold text-primary">
              <span
                aria-hidden="true"
                className="size-2 rounded-full bg-primary motion-safe:animate-pulse"
              />
              Live: updates automatically.
            </span>
          )}
        </div>
        <p className="text-lg text-muted">
          <span className="font-mono">{participant?.trialNumber}</span> ·{" "}
          {protocol?.protocol.title ?? session.protocolId} v{session.protocolVersion} ·{" "}
          {session.mode === "live" ? "live camera" : session.mode}
          {session.startedAt !== null &&
            ` · started ${new Date(session.startedAt).toLocaleString()}`}
          {session.startedAt !== null &&
            session.endedAt !== null &&
            ` · ${formatOffset(session.endedAt - session.startedAt)} long`}
        </p>
        {timeline && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-sm font-bold text-muted">
              <span>Steps confirmed</span>
              <span className="font-mono">
                {confirmed} / {total}
              </span>
            </div>
            <div className="flex gap-1" aria-hidden="true">
              {timeline.rows.map((r) => (
                <span
                  key={r.step.id}
                  className={`h-2 flex-1 rounded-full ${
                    r.outcome === "confirmed"
                      ? "bg-success"
                      : r.outcome === "stopped_here"
                        ? "bg-danger"
                        : r.outcome === "missed"
                          ? "bg-warning-fg"
                          : r.outcome === "in_progress"
                            ? "bg-primary"
                            : "bg-surface-2"
                  }`}
                />
              ))}
            </div>
          </div>
        )}
        {outcome && (
          <p className="rounded-2xl border-2 border-danger/40 bg-danger-soft px-4 py-3 text-lg font-bold text-danger">
            {outcome}
          </p>
        )}
        {session.status === "completed" && (
          <p className="rounded-2xl border-2 border-success/40 bg-success-soft px-4 py-3 text-lg font-bold text-success">
            All steps confirmed.
          </p>
        )}
      </header>

      <div className="grid items-start gap-8 lg:grid-cols-[1.25fr_1fr]">
        {/* The record: one rail, one node per step */}
        <Card labelledBy="steps-heading">
          <h2 id="steps-heading" className="text-3xl font-semibold tracking-tight">
            Steps
          </h2>
          {!timeline ? (
            <p className="text-danger">Protocol version not found.</p>
          ) : (
            <ol className="relative flex flex-col">
              {timeline.rows.map((row, i) => {
                const style = OUTCOME[row.outcome];
                const last = i === timeline.rows.length - 1;
                return (
                  <li key={row.step.id} className="relative flex gap-4 pb-6 last:pb-0">
                    {!last && (
                      <span
                        aria-hidden="true"
                        className="absolute top-10 bottom-0 left-[18px] w-0.5 bg-hairline"
                      />
                    )}
                    <span
                      aria-label={style.label}
                      title={style.label}
                      className={`relative z-10 flex size-10 shrink-0 items-center justify-center rounded-full border-2 font-bold ${style.node}`}
                    >
                      {style.icon || <span className="font-mono text-sm">{row.step.order}</span>}
                    </span>
                    <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-3 pt-1">
                      <div className="min-w-0">
                        <p className="text-lg font-bold">
                          <span className="mr-1 font-mono text-muted">{row.step.order}.</span>{" "}
                          {row.step.instruction}
                          {row.step.critical && (
                            <span className="ml-2 rounded-full bg-danger-soft px-2 py-0.5 align-middle text-xs font-bold text-danger">
                              Critical
                            </span>
                          )}
                        </p>
                        <p className="text-sm text-muted">
                          <span className={`font-bold ${style.text}`}>{style.label}</span>
                          {row.confirmedAt !== null && (
                            <>
                              {" at "}
                              <span className="font-mono">{offset(row.confirmedAt)}</span>
                            </>
                          )}
                          {row.activeMs !== null && ` · took ${Math.round(row.activeMs / 1000)}s`}
                          {row.methods.length > 0 &&
                            ` · ${row.methods.map((m) => METHOD_LABEL[m]).join(" + ")}`}
                        </p>
                      </div>
                      <Evidence frame={row.evidence} urls={evidenceUrls} />
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>

        <div className="flex flex-col gap-8">
          <Card labelledBy="flags-heading">
            <h2 id="flags-heading" className="text-3xl font-semibold tracking-tight">
              Flags{" "}
              <span className="font-sans text-lg font-normal text-muted">
                ({timeline?.openFlags ?? 0} open
                {timeline && timeline.openCritical > 0 ? `, ${timeline.openCritical} critical` : ""}
                )
              </span>
            </h2>
            {flags.length === 0 ? (
              <p className="rounded-2xl bg-success-soft px-4 py-3 font-bold text-success">
                Nothing flagged.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {flags.map((f) => (
                  <li
                    key={f.eventSeq}
                    className={`flex flex-col gap-3 rounded-2xl border-2 p-4 ${SEVERITY_STYLE[f.severity]} ${f.review ? "opacity-60" : ""}`}
                  >
                    <div className="flex flex-col gap-1">
                      <p className="font-bold">
                        <span className="mr-2 font-mono text-sm text-muted">{offset(f.at)}</span>
                        {f.severity === "critical" && (
                          <span className="mr-2 text-danger">CRITICAL</span>
                        )}
                        {f.title}
                      </p>
                      <p>{f.detail}</p>
                    </div>
                    <div className="flex flex-wrap items-end justify-between gap-3">
                      <Evidence frame={f.evidence} urls={evidenceUrls} size="lg" />
                      {f.severity !== "info" &&
                        (f.review ? (
                          <span className="text-sm text-muted">
                            Reviewed {new Date(f.review.reviewedAt).toLocaleTimeString()}
                          </span>
                        ) : (
                          <ReviewFlagButton sessionId={session.id} eventSeq={f.eventSeq} />
                        ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card labelledBy="alerts-heading">
            <h2 id="alerts-heading" className="text-3xl font-semibold tracking-tight">
              Escalation alerts
            </h2>
            <p className="text-muted">
              Demo notifications only. No texts or calls are sent. Reviewing an alert does not
              change the procedure record.
            </p>
            {alerts.length === 0 ? (
              <p>No escalation alerts.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {alerts.map((alert) => (
                  <li
                    key={alert.id}
                    className="flex flex-wrap items-start gap-4 rounded-2xl border-2 border-hairline bg-background p-4"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-bold">
                        {alert.kind.replaceAll("_", " ")} ·{" "}
                        {alert.recipient.kind === "study_team"
                          ? "Study team"
                          : `Trusted contact: ${alert.recipient.name}`}
                      </p>
                      <p>{alert.message}</p>
                      <p className="text-sm text-muted">
                        <span className="font-mono">{offset(alert.createdAt)}</span> ·{" "}
                        {alert.delivery?.ok
                          ? `Simulated delivery (${alert.delivery.channel})`
                          : alert.delivery
                            ? "Delivery failed — awaiting retry"
                            : "Delivery pending"}
                      </p>
                    </div>
                    {alert.status === "reviewed" ? (
                      <span className="rounded-full bg-success-soft px-3 py-1 text-sm font-bold text-success">
                        Reviewed
                      </span>
                    ) : (
                      <ReviewAlertButton sessionId={session.id} alertId={alert.id} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <details className="rounded-3xl border-2 border-hairline bg-surface p-5">
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
