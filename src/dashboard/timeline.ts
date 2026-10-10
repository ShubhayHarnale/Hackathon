import type { ConfirmMethod, EngineEvent, Millis, StopReason } from "@/engine";
import type { EvidenceFrameRecord, FlagReview, StoredEvent } from "@/persistence/types";
import type { Protocol, Step } from "@/protocol/schema";

/**
 * Builds the study team's view of one session from its append-only event log. Pure, so
 * the dashboard page stays thin and the rules here are unit-tested. Practice-run events
 * are left out: only the real procedure is part of the record.
 */

export type StepOutcome = "confirmed" | "missed" | "stopped_here" | "in_progress" | "not_reached";

export interface TimelineRow {
  readonly step: Step;
  readonly outcome: StepOutcome;
  readonly startedAt: Millis | null;
  readonly confirmedAt: Millis | null;
  /** Unpaused time on the step, as measured by the engine. */
  readonly activeMs: number | null;
  readonly methods: readonly ConfirmMethod[];
  readonly evidence: EvidenceFrameRecord | null;
}

export type FlagKind =
  | "critical_miss"
  | "needs_human"
  | "skipped"
  | "interrupted_hold"
  | "nurse_called"
  | "vision_paused"
  | "paused";

export type FlagSeverity = "critical" | "warning" | "info";

export interface TimelineFlag {
  readonly eventSeq: number;
  readonly at: Millis;
  readonly kind: FlagKind;
  readonly severity: FlagSeverity;
  readonly stepId: string | null;
  readonly title: string;
  readonly detail: string;
  readonly evidence: EvidenceFrameRecord | null;
  readonly review: FlagReview | null;
}

export interface Timeline {
  readonly rows: readonly TimelineRow[];
  readonly flags: readonly TimelineFlag[];
  readonly runStartedAt: Millis | null;
  readonly openFlags: number;
  readonly openCritical: number;
}

const SEVERITY: Record<FlagKind, FlagSeverity> = {
  critical_miss: "critical",
  needs_human: "critical",
  skipped: "warning",
  interrupted_hold: "warning",
  nurse_called: "warning",
  vision_paused: "warning",
  paused: "info",
};

const NEEDS_HUMAN_DETAIL: Record<string, string> = {
  too_many_unmatched_frames: "The camera couldn't confirm the step after many frames.",
  too_many_attempts: "The step was interrupted repeatedly.",
  step_timeout: "The step took longer than the allowed time.",
  vision_outage: "Step checking was unavailable for too long.",
  hold_interrupted: "The timed hold was interrupted, so it couldn't be verified.",
};

export function buildTimeline(input: {
  readonly protocol: Protocol;
  readonly events: readonly StoredEvent[];
  readonly frames: readonly EvidenceFrameRecord[];
  readonly reviews: readonly FlagReview[];
}): Timeline {
  const { protocol, frames, reviews } = input;
  const events = input.events
    .map((s) => s.event)
    .filter((e) => e.run !== "practice")
    .sort((a, b) => a.eventSeq - b.eventSeq);
  const stepTitle = (id: string | null) =>
    protocol.steps.find((s) => s.id === id)?.instruction ?? id ?? "the procedure";
  const frameFor = (seq: number | null, stepId?: string) =>
    seq === null
      ? null
      : (frames.find((f) => f.seq === seq && (stepId === undefined || f.stepId === stepId)) ??
        frames.find((f) => f.seq === seq) ??
        null);
  const reviewFor = (eventSeq: number) => reviews.find((r) => r.eventSeq === eventSeq) ?? null;

  type MutableRow = { -readonly [K in keyof TimelineRow]: TimelineRow[K] };
  const rows: MutableRow[] = protocol.steps.map((step) => ({
    step,
    outcome: "not_reached",
    startedAt: null,
    confirmedAt: null,
    activeMs: null,
    methods: [],
    evidence: null,
  }));
  const rowFor = (id: string) => rows.find((r) => r.step.id === id);

  const flags: TimelineFlag[] = [];
  const flag = (
    e: EngineEvent,
    kind: FlagKind,
    stepId: string | null,
    title: string,
    detail: string,
    evidence: EvidenceFrameRecord | null = null,
  ) =>
    flags.push({
      eventSeq: e.eventSeq,
      at: e.at,
      kind,
      severity: SEVERITY[kind],
      stepId,
      title,
      detail,
      evidence,
      review: reviewFor(e.eventSeq),
    });

  let runStartedAt: Millis | null = null;
  let stopReason: StopReason | null = null;
  let finished = false;

  for (const e of events) {
    switch (e.type) {
      case "run_started":
        runStartedAt ??= e.at;
        break;
      case "step_activated": {
        const row = rowFor(e.stepId);
        if (row) {
          row.outcome = "in_progress";
          row.startedAt ??= e.at;
        }
        break;
      }
      case "step_confirmed": {
        const row = rowFor(e.stepId);
        if (row) {
          row.outcome = "confirmed";
          row.confirmedAt = e.at;
          row.activeMs = e.activeMs;
          row.methods = e.methods;
          row.evidence = frameFor(e.evidenceSeq, e.stepId);
        }
        break;
      }
      case "step_missed": {
        const row = rowFor(e.stepId);
        if (row) row.outcome = "missed";
        flag(
          e,
          "skipped",
          e.stepId,
          `Skipped: ${stepTitle(e.stepId)}`,
          `The camera saw "${stepTitle(e.observedStepId)}" before this step was confirmed. Not a critical step, so the procedure continued.`,
        );
        break;
      }
      case "critical_miss":
        flag(
          e,
          "critical_miss",
          e.missedStepId,
          `Critical step not confirmed: ${stepTitle(e.missedStepId)}`,
          e.cause === "hold_released_early"
            ? `The hold ended early: the camera saw "${stepTitle(e.observedStepId)}" before the timer finished. The procedure was stopped.`
            : `The camera saw "${stepTitle(e.observedStepId)}" before this critical step was confirmed. The procedure was stopped.`,
          frameFor(e.evidenceSeq),
        );
        break;
      case "needs_human":
        flag(
          e,
          "needs_human",
          e.stepId,
          `Needs review${e.stepId ? `: ${stepTitle(e.stepId)}` : ""}`,
          `${NEEDS_HUMAN_DETAIL[e.cause] ?? e.cause} The procedure was stopped and the participant was told to call their nurse.`,
        );
        break;
      case "flagged":
        // "skipped" and "nurse_called" flags duplicate step_missed / nurse_called events.
        if (e.flag === "interrupted_hold") {
          flag(
            e,
            "interrupted_hold",
            e.stepId,
            `Paused during a critical hold: ${stepTitle(e.stepId)}`,
            "The participant paused while holding. Check the hold was completed as intended.",
          );
        }
        break;
      case "nurse_called":
        flag(
          e,
          "nurse_called",
          null,
          "Participant called the nurse",
          `Via ${e.source === "voice" ? "voice command" : "the on-screen button"}.`,
        );
        break;
      case "paused":
        if (e.reason === "vision_unavailable") {
          flag(
            e,
            "vision_paused",
            null,
            "Step checking paused",
            "Repeated vision errors paused the procedure until the participant chose to continue.",
          );
        } else if (e.reason === "user") {
          flag(
            e,
            "paused",
            null,
            "Participant paused",
            `Via ${e.source === "voice" ? "voice command" : "the on-screen button"}.`,
          );
        }
        break;
      case "stopped":
        stopReason = e.reason;
        break;
      case "completed":
        finished = true;
        break;
      default:
        break;
    }
  }

  if (stopReason) {
    const stoppedStep =
      stopReason.kind === "critical_miss"
        ? stopReason.missedStepId
        : stopReason.kind === "needs_human"
          ? stopReason.stepId
          : null;
    const row = stoppedStep ? rowFor(stoppedStep) : rows.find((r) => r.outcome === "in_progress");
    if (row && row.outcome !== "confirmed") row.outcome = "stopped_here";
    for (const r of rows) if (r.outcome === "in_progress") r.outcome = "not_reached";
  } else if (finished) {
    for (const r of rows) if (r.outcome === "in_progress") r.outcome = "not_reached";
  }

  const open = flags.filter((f) => !f.review && f.severity !== "info");
  return {
    rows,
    flags,
    runStartedAt,
    openFlags: open.length,
    openCritical: open.filter((f) => f.severity === "critical").length,
  };
}

/** "02:15" from the run start; durations under an hour. */
export function formatOffset(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Plain-language session outcome for the list and header. */
export function describeStop(reason: StopReason | null, protocol: Protocol | null): string | null {
  if (!reason) return null;
  const title = (id: string | null) =>
    protocol?.steps.find((s) => s.id === id)?.instruction ?? id ?? "";
  switch (reason.kind) {
    case "critical_miss":
      return reason.cause === "hold_released_early"
        ? `Stopped: hold ended early (${title(reason.missedStepId)})`
        : `Stopped: critical step not confirmed (${title(reason.missedStepId)})`;
    case "needs_human":
      return `Stopped: needs review${reason.stepId ? ` (${title(reason.stepId)})` : ""}`;
    case "ended":
      return `Ended by ${reason.by}`;
  }
}
