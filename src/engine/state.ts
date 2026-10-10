import type {
  ConfirmMethod,
  EngineStep,
  Millis,
  PauseReason,
  PauseSource,
  ReviewFlag,
  RunKind,
  StepId,
  StopReason,
} from "./types";

export type EngineStatus = "idle" | "practice" | "active" | "paused" | "completed" | "stopped";
export type StepStatus = "pending" | "active" | "holding" | "confirmed" | "missed";

export interface StepProgress {
  stepId: StepId;
  status: StepStatus;
  /** Consecutive frames matching this step. */
  matchStreak: number;
  /** Frames that didn't match while waiting for the visual requirement. */
  unmatchedFrames: number;
  /** Consecutive non-matching frames while holding. */
  holdBreak: number;
  /** Interrupted holds. */
  attempts: number;
  /** Unpaused time spent on this step. */
  activeMs: number;
  /** Unpaused time spent holding. */
  holdMs: number;
  visualOk: boolean;
  verbalOk: boolean;
  waitOk: boolean;
  methods: ConfirmMethod[];
  lastMatchSeq: number | null;
  activatedAt: Millis | null;
  confirmedAt: Millis | null;
  flags: ReviewFlag[];
}

export interface RunState {
  kind: RunKind;
  steps: readonly EngineStep[];
  progress: StepProgress[];
  index: number;
  /** Consecutive observations of one later step. */
  skip: { stepId: StepId; streak: number } | null;
  /** Frames captured before this (step activation or resume) are stale. */
  acceptFramesFrom: Millis;
  /** Last time accounted into step timers; null while paused. */
  clockAt: Millis | null;
}

export interface EngineState {
  status: EngineStatus;
  steps: readonly EngineStep[];
  practiceSteps: readonly EngineStep[];
  run: RunState | null;
  practiceCompleted: boolean;
  pause: {
    since: Millis;
    source: PauseSource;
    reason: PauseReason;
    resumeTo: "practice" | "active";
  } | null;
  stopReason: StopReason | null;
  lastSeq: number;
  vision: { consecutiveErrors: number; downSince: Millis | null; degraded: boolean };
  nextEventSeq: number;
}

export function createEngineState(
  steps: readonly EngineStep[],
  practiceSteps: readonly EngineStep[] = [],
): EngineState {
  assertValidSteps(steps, "steps");
  if (practiceSteps.length > 0) assertValidSteps(practiceSteps, "practiceSteps");
  return {
    status: "idle",
    steps,
    practiceSteps,
    run: null,
    practiceCompleted: false,
    pause: null,
    stopReason: null,
    lastSeq: -1,
    vision: { consecutiveErrors: 0, downSince: null, degraded: false },
    nextEventSeq: 0,
  };
}

function assertValidSteps(steps: readonly EngineStep[], label: string): void {
  if (steps.length === 0) throw new Error(`${label} must not be empty`);
  const ids = new Set(steps.map((s) => s.id));
  if (ids.size !== steps.length) throw new Error(`${label} contain duplicate ids`);
}

export function newProgress(stepId: StepId): StepProgress {
  return {
    stepId,
    status: "pending",
    matchStreak: 0,
    unmatchedFrames: 0,
    holdBreak: 0,
    attempts: 0,
    activeMs: 0,
    holdMs: 0,
    visualOk: false,
    verbalOk: false,
    waitOk: false,
    methods: [],
    lastMatchSeq: null,
    activatedAt: null,
    confirmedAt: null,
    flags: [],
  };
}

// --- Selectors -------------------------------------------------------------------------

export function isTerminal(state: EngineState): boolean {
  return state.status === "completed" || state.status === "stopped";
}

export function currentStep(state: EngineState): EngineStep | null {
  return state.run?.steps[state.run.index] ?? null;
}

export function currentProgress(state: EngineState): StepProgress | null {
  return state.run?.progress[state.run.index] ?? null;
}

export function needsVisual(step: EngineStep): boolean {
  return step.verification !== "verbal";
}

export function needsVerbal(step: EngineStep): boolean {
  return step.verification !== "visual";
}

/** Verbal-only steps with a timer are waits, counted from activation. */
export function isWait(step: EngineStep): boolean {
  return step.verification === "verbal" && step.timerSeconds !== undefined;
}

/** Visual steps with a timer are holds, counted only while the step is observed. */
export function isHold(step: EngineStep): boolean {
  return needsVisual(step) && step.timerSeconds !== undefined;
}
