import {
  currentProgress,
  currentStep,
  isHold,
  isWait,
  needsVerbal,
  type EngineState,
  type StopReason,
} from "@/engine";

/** Where the patient is before the engine takes over (all client-side). */
export type UiPhase = "welcome" | "permissions" | "camera_check";
export type MediaPermission = "unknown" | "requesting" | "granted" | "denied" | "unavailable";
export type VisionMode = "scripted" | "server";

export type Screen =
  | { readonly kind: "welcome" }
  | { readonly kind: "permissions" }
  | { readonly kind: "camera_denied" }
  /** Camera preview and the practice run. */
  | { readonly kind: "camera_check" }
  /** Practice done: one tap to start the real procedure. */
  | { readonly kind: "ready" }
  | { readonly kind: "step" }
  | { readonly kind: "paused"; readonly reason: "user" | "nurse_called" }
  | { readonly kind: "vision_unavailable" }
  | { readonly kind: "stopped"; readonly reason: StopReason }
  | { readonly kind: "completed" };

export interface ScreenInput {
  readonly phase: UiPhase;
  readonly camera: MediaPermission;
  readonly visionMode: VisionMode;
  readonly engine: EngineState;
}

/**
 * Which screen to show. The engine wins once it has something to say (stopped, paused,
 * running); before that, the UI phase decides. Server vision can't work without a
 * camera, so a denied camera blocks it; scripted demo vision carries on without one.
 */
export function deriveScreen({ phase, camera, visionMode, engine }: ScreenInput): Screen {
  if (engine.status === "completed") return { kind: "completed" };
  if (engine.status === "stopped") {
    return { kind: "stopped", reason: engine.stopReason ?? { kind: "ended", by: "system" } };
  }
  if (engine.status === "paused") {
    const reason = engine.pause?.reason ?? "user";
    return reason === "vision_unavailable"
      ? { kind: "vision_unavailable" }
      : { kind: "paused", reason };
  }
  if (engine.status === "active") return { kind: "step" };
  if (engine.status === "practice") return { kind: "camera_check" };

  // idle
  if (phase === "welcome") return { kind: "welcome" };
  const cameraBlocked = camera === "denied" || camera === "unavailable";
  if (cameraBlocked && visionMode === "server") return { kind: "camera_denied" };
  if (phase === "permissions") return { kind: "permissions" };
  return engine.practiceCompleted ? { kind: "ready" } : { kind: "camera_check" };
}

/** Pause/Continue only make sense while a run is going or paused. */
export function canPause(engine: EngineState): boolean {
  return engine.status === "active" || engine.status === "practice";
}

export type StepTimer =
  | { readonly kind: "none" }
  /** A hold that hasn't started: the step must be seen first. */
  | { readonly kind: "hold_pending"; readonly totalMs: number }
  | { readonly kind: "holding"; readonly remainingMs: number; readonly totalMs: number }
  | { readonly kind: "wait"; readonly remainingMs: number; readonly totalMs: number };

/** The countdown for the current step: holds count only while held, waits from the start. */
export function stepTimer(engine: EngineState): StepTimer {
  const step = currentStep(engine);
  const progress = currentProgress(engine);
  if (!step || !progress || step.timerSeconds === undefined) return { kind: "none" };
  const totalMs = step.timerSeconds * 1000;
  if (isHold(step)) {
    if (progress.status === "holding") {
      return { kind: "holding", remainingMs: Math.max(0, totalMs - progress.holdMs), totalMs };
    }
    return { kind: "hold_pending", totalMs };
  }
  if (isWait(step)) {
    return { kind: "wait", remainingMs: Math.max(0, totalMs - progress.activeMs), totalMs };
  }
  return { kind: "none" };
}

/** Whether the current step is waiting on a spoken or tapped "done". */
export function awaitingDone(engine: EngineState): boolean {
  const step = currentStep(engine);
  const progress = currentProgress(engine);
  return !!step && !!progress && needsVerbal(step) && !progress.verbalOk;
}

export type DotStatus = "done" | "missed" | "current" | "todo";

/** Progress dots for the real run (practice steps aren't shown as procedure progress). */
export function progressDots(engine: EngineState): readonly DotStatus[] {
  const run = engine.run;
  if (!run || run.kind !== "real") return [];
  return run.progress.map((p, i) =>
    p.status === "confirmed"
      ? "done"
      : p.status === "missed"
        ? "missed"
        : i === run.index
          ? "current"
          : "todo",
  );
}

/**
 * Whole seconds left, rounded up so the display never shows 0 while time remains.
 * Under a minute: "7". From a minute: "1:05".
 */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  if (total < 60) return String(total);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** For screen readers and captions: "7 seconds", "1 second", "1 minute 5 seconds". */
export function describeDuration(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (m === 0) return plural(s, "second");
  return s === 0 ? plural(m, "minute") : `${plural(m, "minute")} ${plural(s, "second")}`;
}

/** A tel: href from a display number like "+1-555-0100". */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}
