/**
 * Step engine contract.
 *
 * The engine is a pure state machine: `(state, input, config) -> { state, events }`.
 * It performs no I/O and never reads a clock; every input carries its own `at` timestamp.
 * Other modules (vision, voice, UI, persistence) depend on these types, never the reverse.
 */

export type StepId = string;

/** Epoch milliseconds, supplied by the caller. */
export type Millis = number;

/** How a step is confirmed. `verbal` replaces the spec's `requiresVerbalConfirm` flag. */
export type Verification = "visual" | "verbal" | "visual+verbal";

/** The minimal step shape the engine needs. Structurally compatible with protocol `Step`. */
export interface EngineStep {
  readonly id: StepId;
  readonly order: number;
  readonly critical: boolean;
  readonly verification: Verification;
  /**
   * For visual steps: a hold. The timer runs only while the step keeps being observed.
   * For verbal-only steps: a wait, counted from when the step starts.
   */
  readonly timerSeconds?: number | undefined;
}

/**
 * Fixed vocabulary of frame problems. The patient only ever hears scripted phrases
 * mapped from these codes, never model-generated text.
 */
export const ISSUE_CODES = [
  "hands_not_visible",
  "pen_not_visible",
  "too_dark",
  "too_far",
  "too_close",
  "camera_blocked",
  "wrong_angle",
  "unclear",
] as const;
export type IssueCode = (typeof ISSUE_CODES)[number];

/** One frame's verdict from a VisionProvider. */
export interface FrameResult {
  /** The step the frame shows, from the candidates offered; null if none / unsure. */
  readonly observedStepId: StepId | null;
  /** 0..1 */
  readonly confidence: number;
  readonly issue?: IssueCode | undefined;
  readonly handsVisible?: boolean | undefined;
}

export type FrameErrorKind = "timeout" | "network" | "provider" | "rate_limited";
export type CommandSource = "button" | "voice";
export type PauseSource = CommandSource | "system";
export type PauseReason = "user" | "nurse_called" | "vision_unavailable";
export type ConfirmMethod = "visual" | "hold" | "voice" | "tap" | "wait";
export type RunKind = "practice" | "real";

export type EngineInput =
  | { readonly type: "start_practice"; readonly at: Millis }
  | { readonly type: "start"; readonly at: Millis }
  | {
      readonly type: "frame";
      readonly at: Millis;
      /** Monotonic per session; results arriving with seq <= last seen are stale. */
      readonly seq: number;
      readonly capturedAt: Millis;
      readonly result: FrameResult;
    }
  | {
      readonly type: "frame_error";
      readonly at: Millis;
      readonly seq: number;
      readonly kind: FrameErrorKind;
    }
  | {
      readonly type: "verbal_confirm";
      readonly at: Millis;
      readonly stepId: StepId;
      readonly method: "voice" | "tap";
    }
  | { readonly type: "pause"; readonly at: Millis; readonly source: CommandSource }
  | { readonly type: "resume"; readonly at: Millis; readonly source: CommandSource }
  | { readonly type: "call_nurse"; readonly at: Millis; readonly source: CommandSource }
  | { readonly type: "tick"; readonly at: Millis }
  | {
      readonly type: "stop";
      readonly at: Millis;
      readonly by: "patient" | "coordinator" | "system";
    };

export type NeedsHumanCause =
  | "too_many_unmatched_frames"
  | "too_many_attempts"
  | "step_timeout"
  | "vision_outage"
  | "hold_interrupted";

export type CriticalMissCause = "skipped" | "hold_released_early";

export type StopReason =
  | {
      readonly kind: "critical_miss";
      readonly missedStepId: StepId;
      readonly observedStepId: StepId;
      readonly cause: CriticalMissCause;
    }
  | {
      readonly kind: "needs_human";
      readonly stepId: StepId | null;
      readonly cause: NeedsHumanCause;
    }
  | { readonly kind: "ended"; readonly by: "patient" | "coordinator" | "system" };

/** Flags surfaced to the study team for review on the session timeline. */
export type ReviewFlag = "skipped" | "interrupted_hold" | "nurse_called";

export type EngineEventBody =
  | { readonly type: "practice_started" }
  | { readonly type: "practice_completed" }
  | { readonly type: "run_started" }
  | { readonly type: "step_activated"; readonly stepId: StepId; readonly index: number }
  | {
      /** The visual requirement was met (streak reached). For timed steps the hold begins. */
      readonly type: "step_observed";
      readonly stepId: StepId;
      readonly holding: boolean;
      readonly evidenceSeq: number;
    }
  | {
      readonly type: "step_confirmed";
      readonly stepId: StepId;
      readonly methods: readonly ConfirmMethod[];
      readonly evidenceSeq: number | null;
      readonly activeMs: number;
    }
  | { readonly type: "correction"; readonly stepId: StepId; readonly issue: IssueCode }
  | { readonly type: "hold_interrupted"; readonly stepId: StepId; readonly attempts: number }
  | { readonly type: "step_missed"; readonly stepId: StepId; readonly observedStepId: StepId }
  | { readonly type: "flagged"; readonly stepId: StepId | null; readonly flag: ReviewFlag }
  | { readonly type: "paused"; readonly source: PauseSource; readonly reason: PauseReason }
  | { readonly type: "resumed"; readonly source: CommandSource }
  | { readonly type: "nurse_called"; readonly source: CommandSource }
  | { readonly type: "vision_degraded"; readonly consecutiveErrors: number }
  | { readonly type: "vision_recovered" }
  | {
      readonly type: "critical_miss";
      readonly missedStepId: StepId;
      readonly observedStepId: StepId;
      readonly cause: CriticalMissCause;
      readonly evidenceSeq: number;
    }
  | {
      readonly type: "needs_human";
      readonly stepId: StepId | null;
      readonly cause: NeedsHumanCause;
    }
  | { readonly type: "completed" }
  | { readonly type: "stopped"; readonly reason: StopReason };

export type EngineEventType = EngineEventBody["type"];

/** Every emitted event carries a per-session sequence number for idempotent persistence. */
export type EngineEvent = EngineEventBody & {
  readonly eventSeq: number;
  readonly at: Millis;
  readonly run: RunKind | null;
};

export interface EngineConfig {
  /** Consecutive matching frames needed to treat a step as observed. */
  readonly confirmStreak: number;
  /** Consecutive frames of a single later step needed to treat it as a skip. */
  readonly skipStreak: number;
  /** Frames below this confidence never count as a match. */
  readonly minConfidence: number;
  /** Non-matching / low-confidence frames on one step before routing to a human. */
  readonly maxUnmatchedFrames: number;
  /** Interrupted holds on one step before routing to a human. */
  readonly maxAttempts: number;
  /** Active (unpaused) seconds on one step, beyond its own timer, before routing to a human. */
  readonly maxStepSeconds: number;
  /** Consecutive non-matching frames that break a hold. */
  readonly holdBreakFrames: number;
  /** Consecutive vision errors before a system pause. */
  readonly maxConsecutiveVisionErrors: number;
  /** Vision outage length before routing to a human. */
  readonly visionOutageMs: number;
}
