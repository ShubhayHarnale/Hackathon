import { DEFAULT_ENGINE_CONFIG } from "./config";
import {
  isHold,
  isTerminal,
  isWait,
  needsVerbal,
  needsVisual,
  newProgress,
  type EngineState,
  type RunState,
  type StepProgress,
} from "./state";
import type {
  CommandSource,
  CriticalMissCause,
  EngineConfig,
  EngineEvent,
  EngineEventBody,
  EngineInput,
  EngineStep,
  Millis,
  NeedsHumanCause,
  PauseReason,
  PauseSource,
  RunKind,
  StepId,
  StopReason,
} from "./types";

export interface TransitionResult {
  readonly state: EngineState;
  readonly events: readonly EngineEvent[];
}

/**
 * The step engine: a pure function of (state, input, config).
 *
 * The input state is never mutated. Terminal states (`completed`, `stopped`) return the
 * same state object and no events. The engine never continues on its own when unsure:
 * leaving a pause always requires an explicit `resume`, and uncertainty ends in
 * `needs_human`, never in advancing.
 */
export function transition(
  prev: EngineState,
  input: EngineInput,
  config: EngineConfig = DEFAULT_ENGINE_CONFIG,
): TransitionResult {
  if (isTerminal(prev)) return { state: prev, events: [] };

  const ctx: Ctx = { s: structuredClone(prev), events: [], at: input.at, config };

  if (isRunning(ctx.s)) {
    advanceClock(ctx);
    checkTimers(ctx);
  }
  if (!isTerminal(ctx.s)) handleInput(ctx, input);

  return { state: ctx.s, events: ctx.events };
}

interface Ctx {
  readonly s: EngineState;
  readonly events: EngineEvent[];
  readonly at: Millis;
  readonly config: EngineConfig;
}

function handleInput(ctx: Ctx, input: EngineInput): void {
  switch (input.type) {
    case "start_practice":
      return startRun(ctx, "practice");
    case "start":
      return startRun(ctx, "real");
    case "frame":
      return onFrame(ctx, input);
    case "frame_error":
      return onFrameError(ctx, input.seq);
    case "verbal_confirm":
      return onVerbalConfirm(ctx, input.stepId, input.method);
    case "pause":
      if (isRunning(ctx.s)) pause(ctx, input.source, "user");
      return;
    case "resume":
      return onResume(ctx, input.source);
    case "call_nurse":
      return onCallNurse(ctx, input.source);
    case "tick":
      return checkVisionOutage(ctx);
    case "stop":
      return stop(ctx, { kind: "ended", by: input.by });
  }
}

// --- Runs and steps --------------------------------------------------------------------

function startRun(ctx: Ctx, kind: RunKind): void {
  const { s } = ctx;
  if (s.status !== "idle") return;
  const steps = kind === "practice" ? s.practiceSteps : s.steps;
  if (steps.length === 0) return;

  s.run = {
    kind,
    steps,
    progress: steps.map((step) => newProgress(step.id)),
    index: 0,
    skip: null,
    acceptFramesFrom: ctx.at,
    clockAt: ctx.at,
  };
  s.status = kind === "practice" ? "practice" : "active";
  emit(ctx, kind === "practice" ? { type: "practice_started" } : { type: "run_started" });
  activateStep(ctx, 0);
}

function activateStep(ctx: Ctx, index: number): void {
  const run = requireRun(ctx);
  const step = run.steps[index];
  const progress = run.progress[index];
  if (!step || !progress) return;
  run.index = index;
  run.skip = null;
  run.acceptFramesFrom = ctx.at;
  progress.status = "active";
  progress.activatedAt = ctx.at;
  emit(ctx, { type: "step_activated", stepId: step.id, index });
}

/** Confirms the current step if all its requirements are met. Returns true if it did. */
function tryConfirm(ctx: Ctx): boolean {
  const run = requireRun(ctx);
  const step = run.steps[run.index];
  const p = run.progress[run.index];
  if (!step || !p || p.status === "confirmed") return false;

  const visualDone = !needsVisual(step) || p.visualOk;
  const verbalDone = !needsVerbal(step) || p.verbalOk;
  const waitDone = !isWait(step) || p.waitOk;
  if (!(visualDone && verbalDone && waitDone)) return false;

  p.status = "confirmed";
  p.confirmedAt = ctx.at;
  emit(ctx, {
    type: "step_confirmed",
    stepId: step.id,
    methods: [...p.methods],
    evidenceSeq: p.lastMatchSeq,
    activeMs: p.activeMs,
  });

  const next = run.index + 1;
  if (next < run.steps.length) activateStep(ctx, next);
  else finishRun(ctx);
  return true;
}

function finishRun(ctx: Ctx): void {
  const { s } = ctx;
  const run = requireRun(ctx);
  if (run.kind === "practice") {
    emit(ctx, { type: "practice_completed" });
    s.practiceCompleted = true;
    s.run = null;
    s.status = "idle";
  } else {
    run.clockAt = null;
    s.status = "completed";
    emit(ctx, { type: "completed" });
  }
}

// --- Time ------------------------------------------------------------------------------

/** Accounts elapsed unpaused time into the current step's timers. */
function advanceClock(ctx: Ctx): void {
  const run = ctx.s.run;
  if (!run || run.clockAt === null) return;
  const p = run.progress[run.index];
  const delta = Math.max(0, ctx.at - run.clockAt);
  run.clockAt = Math.max(run.clockAt, ctx.at);
  if (!p || delta === 0) return;
  p.activeMs += delta;
  if (p.status === "holding") p.holdMs += delta;
}

function checkTimers(ctx: Ctx): void {
  const run = ctx.s.run;
  if (!run) return;
  const step = run.steps[run.index];
  const p = run.progress[run.index];
  if (!step || !p || p.status === "confirmed") return;
  const timerMs = (step.timerSeconds ?? 0) * 1000;

  if (p.status === "holding" && p.holdMs >= timerMs) {
    p.status = "active";
    p.visualOk = true;
    p.methods.push("hold");
    tryConfirm(ctx);
    return;
  }
  if (isWait(step) && !p.waitOk && p.activeMs >= timerMs) {
    p.waitOk = true;
    p.methods.push("wait");
    if (tryConfirm(ctx)) return;
  }
  const limitMs = (ctx.config.maxStepSeconds + (step.timerSeconds ?? 0)) * 1000;
  if (p.activeMs >= limitMs) needsHuman(ctx, step.id, "step_timeout");
}

// --- Frames ----------------------------------------------------------------------------

function onFrame(ctx: Ctx, input: Extract<EngineInput, { type: "frame" }>): void {
  const { s, config } = ctx;
  if (input.seq <= s.lastSeq) return; // stale: a newer result was already processed
  s.lastSeq = input.seq;
  noteVisionOk(ctx);

  if (!isRunning(s)) return; // paused / idle: record nothing
  const run = requireRun(ctx);
  if (input.capturedAt < run.acceptFramesFrom) return; // captured before this step / resume

  const step = run.steps[run.index];
  const p = run.progress[run.index];
  if (!step || !p) return;

  const { result } = input;
  const confident = result.confidence >= config.minConfidence;
  const observedIndex =
    confident && result.observedStepId !== null
      ? run.steps.findIndex((st) => st.id === result.observedStepId)
      : -1;

  if (result.issue) emit(ctx, { type: "correction", stepId: step.id, issue: result.issue });

  // Skip tracking: consecutive confident observations of one specific later step.
  const observedLater = observedIndex > run.index ? run.steps[observedIndex] : undefined;
  if (observedLater) {
    run.skip =
      run.skip?.stepId === observedLater.id
        ? { stepId: observedLater.id, streak: run.skip.streak + 1 }
        : { stepId: observedLater.id, streak: 1 };
  } else {
    run.skip = null;
  }

  if (run.skip && run.skip.streak >= config.skipStreak) {
    onSkip(ctx, observedIndex, input.seq);
    return;
  }

  if (observedIndex === run.index) onMatch(ctx, step, p, input.seq);
  else onUnmatched(ctx, step, p);
}

function onMatch(ctx: Ctx, step: EngineStep, p: StepProgress, seq: number): void {
  p.lastMatchSeq = seq;
  if (p.status === "holding") {
    p.holdBreak = 0;
    return;
  }
  if (!needsVisual(step) || p.visualOk) return;

  p.matchStreak += 1;
  if (p.matchStreak < ctx.config.confirmStreak) return;
  markObserved(ctx, step, p, seq);
}

/** The visual evidence bar was reached: start the hold, or satisfy the visual requirement. */
function markObserved(ctx: Ctx, step: EngineStep, p: StepProgress, seq: number): void {
  p.lastMatchSeq = seq;
  if (isHold(step)) {
    p.status = "holding";
    p.holdMs = 0;
    p.holdBreak = 0;
    emit(ctx, { type: "step_observed", stepId: step.id, holding: true, evidenceSeq: seq });
    return;
  }
  p.visualOk = true;
  p.methods.push("visual");
  emit(ctx, { type: "step_observed", stepId: step.id, holding: false, evidenceSeq: seq });
  tryConfirm(ctx);
}

function onUnmatched(ctx: Ctx, step: EngineStep, p: StepProgress): void {
  const { config } = ctx;
  p.matchStreak = 0;

  if (p.status === "holding") {
    p.holdBreak += 1;
    if (p.holdBreak >= config.holdBreakFrames) breakHold(ctx, step, p);
    return;
  }
  if (!needsVisual(step) || p.visualOk) return;

  p.unmatchedFrames += 1;
  if (p.unmatchedFrames >= config.maxUnmatchedFrames) {
    needsHuman(ctx, step.id, "too_many_unmatched_frames");
  }
}

function breakHold(ctx: Ctx, step: EngineStep, p: StepProgress): void {
  p.attempts += 1;
  emit(ctx, { type: "hold_interrupted", stepId: step.id, attempts: p.attempts });
  if (step.critical) {
    // A critical hold that was interrupted can't be verified. Stop and route to a human.
    needsHuman(ctx, step.id, "hold_interrupted");
    return;
  }
  if (p.attempts >= ctx.config.maxAttempts) {
    needsHuman(ctx, step.id, "too_many_attempts");
    return;
  }
  p.status = "active";
  p.holdMs = 0;
  p.holdBreak = 0;
  p.matchStreak = 0;
}

/** A later step was observed `skipStreak` times in a row. */
function onSkip(ctx: Ctx, observedIndex: number, seq: number): void {
  const run = requireRun(ctx);
  const observed = run.steps[observedIndex];
  const current = run.steps[run.index];
  const currentProgress = run.progress[run.index];
  if (!observed || !current || !currentProgress) return;

  if (current.critical && currentProgress.status === "holding") {
    return criticalMiss(ctx, current.id, observed.id, "hold_released_early", seq);
  }

  const skipped: number[] = [];
  for (let i = run.index; i < observedIndex; i++) {
    if (run.progress[i]?.status !== "confirmed") skipped.push(i);
  }
  const missedCritical = skipped.map((i) => run.steps[i]).find((st) => st?.critical);
  if (missedCritical) {
    return criticalMiss(ctx, missedCritical.id, observed.id, "skipped", seq);
  }

  // Only non-critical steps were skipped: flag them for review and follow the patient.
  for (const i of skipped) {
    const st = run.steps[i];
    const pr = run.progress[i];
    if (!st || !pr) continue;
    pr.status = "missed";
    pr.flags.push("skipped");
    emit(ctx, { type: "step_missed", stepId: st.id, observedStepId: observed.id });
    emit(ctx, { type: "flagged", stepId: st.id, flag: "skipped" });
  }

  const streak = run.skip?.streak ?? 0;
  activateStep(ctx, observedIndex);
  const p = run.progress[observedIndex];
  if (!p) return;
  p.lastMatchSeq = seq;
  if (!needsVisual(observed)) return;
  // The observations that revealed the skip are evidence for the observed step.
  p.matchStreak = streak;
  if (p.matchStreak >= ctx.config.confirmStreak) markObserved(ctx, observed, p, seq);
}

// --- Verbal confirmation ---------------------------------------------------------------

function onVerbalConfirm(ctx: Ctx, stepId: StepId, method: "voice" | "tap"): void {
  if (!isRunning(ctx.s)) return;
  const run = requireRun(ctx);
  const step = run.steps[run.index];
  const p = run.progress[run.index];
  if (!step || !p || step.id !== stepId || !needsVerbal(step) || p.verbalOk) return;
  p.verbalOk = true;
  p.methods.push(method);
  tryConfirm(ctx);
}

// --- Vision availability ---------------------------------------------------------------

function onFrameError(ctx: Ctx, seq: number): void {
  const { s, config } = ctx;
  if (seq <= s.lastSeq) return;
  s.lastSeq = seq;

  const visionPaused = s.status === "paused" && s.pause?.reason === "vision_unavailable";
  if (!isRunning(s) && !visionPaused) return;

  s.vision.consecutiveErrors += 1;
  s.vision.downSince ??= ctx.at;

  if (isRunning(s) && s.vision.consecutiveErrors >= config.maxConsecutiveVisionErrors) {
    s.vision.degraded = true;
    emit(ctx, { type: "vision_degraded", consecutiveErrors: s.vision.consecutiveErrors });
    pause(ctx, "system", "vision_unavailable");
  }
  checkVisionOutage(ctx);
}

function noteVisionOk(ctx: Ctx): void {
  const { vision } = ctx.s;
  vision.consecutiveErrors = 0;
  vision.downSince = null;
  if (vision.degraded) {
    vision.degraded = false;
    emit(ctx, { type: "vision_recovered" });
  }
}

function checkVisionOutage(ctx: Ctx): void {
  const { s, config } = ctx;
  const visionPaused = s.status === "paused" && s.pause?.reason === "vision_unavailable";
  if (!isRunning(s) && !visionPaused) return;
  if (s.vision.downSince === null) return;
  if (ctx.at - s.vision.downSince >= config.visionOutageMs) {
    const stepId = s.run?.steps[s.run.index]?.id ?? null;
    needsHuman(ctx, stepId, "vision_outage");
  }
}

// --- Pause, resume, nurse --------------------------------------------------------------

function pause(ctx: Ctx, source: PauseSource, reason: PauseReason): void {
  const { s } = ctx;
  if (s.status !== "practice" && s.status !== "active") return;
  const run = requireRun(ctx);
  const step = run.steps[run.index];
  const p = run.progress[run.index];
  if (step && p?.status === "holding" && step.critical) {
    p.flags.push("interrupted_hold");
    emit(ctx, { type: "flagged", stepId: step.id, flag: "interrupted_hold" });
  }
  s.pause = { since: ctx.at, source, reason, resumeTo: s.status };
  s.status = "paused";
  run.clockAt = null;
  emit(ctx, { type: "paused", source, reason });
}

function onResume(ctx: Ctx, source: CommandSource): void {
  const { s } = ctx;
  if (s.status !== "paused" || !s.pause) return;
  const run = requireRun(ctx);
  s.status = s.pause.resumeTo;
  s.pause = null;
  run.clockAt = ctx.at;
  run.acceptFramesFrom = ctx.at;
  run.skip = null;
  const p = run.progress[run.index];
  if (p) {
    // Evidence must be consecutive in real time; frames from before the pause don't count.
    p.matchStreak = 0;
    p.holdBreak = 0;
  }
  s.vision.consecutiveErrors = 0;
  s.vision.downSince = null;
  emit(ctx, { type: "resumed", source });
}

function onCallNurse(ctx: Ctx, source: CommandSource): void {
  const { s } = ctx;
  emit(ctx, { type: "nurse_called", source });
  const stepId = s.run?.steps[s.run.index]?.id ?? null;
  if (stepId) {
    s.run?.progress[s.run.index]?.flags.push("nurse_called");
  }
  emit(ctx, { type: "flagged", stepId, flag: "nurse_called" });
  if (isRunning(s)) pause(ctx, source, "nurse_called");
}

// --- Stopping --------------------------------------------------------------------------

function criticalMiss(
  ctx: Ctx,
  missedStepId: StepId,
  observedStepId: StepId,
  cause: CriticalMissCause,
  evidenceSeq: number,
): void {
  emit(ctx, { type: "critical_miss", missedStepId, observedStepId, cause, evidenceSeq });
  stop(ctx, { kind: "critical_miss", missedStepId, observedStepId, cause });
}

function needsHuman(ctx: Ctx, stepId: StepId | null, cause: NeedsHumanCause): void {
  emit(ctx, { type: "needs_human", stepId, cause });
  stop(ctx, { kind: "needs_human", stepId, cause });
}

function stop(ctx: Ctx, reason: StopReason): void {
  const { s } = ctx;
  if (isTerminal(s)) return;
  s.status = "stopped";
  s.stopReason = reason;
  s.pause = null;
  if (s.run) s.run.clockAt = null;
  emit(ctx, { type: "stopped", reason });
}

// --- Helpers ---------------------------------------------------------------------------

function isRunning(s: EngineState): boolean {
  return s.status === "practice" || s.status === "active";
}

function requireRun(ctx: Ctx): RunState {
  const run = ctx.s.run;
  if (!run) throw new Error("engine invariant: no active run");
  return run;
}

function emit(ctx: Ctx, body: EngineEventBody): void {
  const { s } = ctx;
  ctx.events.push({ ...body, eventSeq: s.nextEventSeq, at: ctx.at, run: s.run?.kind ?? null });
  s.nextEventSeq += 1;
}
