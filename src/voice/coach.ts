import {
  currentProgress,
  currentStep,
  needsVerbal,
  type EngineEvent,
  type EngineInput,
  type EngineState,
  type Millis,
  type StepId,
  type Verification,
} from "@/engine";
import { COUNTDOWN_WORDS, ISSUE_PHRASES, SCRIPTS } from "./scripts";
import { SpeechQueue, type EnqueueOptions, type QueuedUtterance } from "./speech-queue";
import type { VoiceCommand, VoiceErrorKind, VoiceProvider } from "./types";

/** What the coach needs to know about a step. A protocol `Step` satisfies it. */
export interface VoiceStep {
  /** Coordinator-reviewed text; the only step-specific thing the coach ever says. */
  readonly spokenPrompt: string;
  readonly verification: Verification;
  readonly timerSeconds?: number | undefined;
  /** Critical steps get corrections sooner in quiet mode. */
  readonly critical?: boolean | undefined;
}

/**
 * Quiet-mode patience: a correction is spoken only once the same problem has persisted
 * for this many consecutive reports (about one per second), so a momentary slip passes
 * silently. Critical steps speak up sooner. Stops are never delayed.
 */
const PATIENCE_FRAMES = { normal: 3, critical: 2 } as const;
const PATIENCE_GAP_MS = 2500;

export type VoiceLogEntry =
  | { readonly kind: "spoken"; readonly at: Millis; readonly utterance: QueuedUtterance }
  | { readonly kind: "heard"; readonly at: Millis; readonly transcript: string }
  | {
      readonly kind: "command";
      readonly at: Millis;
      readonly command: VoiceCommand;
      readonly transcript: string | null;
      /** What the coach did with it, e.g. "pause" or "ignored: step needs no confirmation". */
      readonly outcome: string;
    }
  | {
      readonly kind: "error";
      readonly at: Millis;
      readonly error: VoiceErrorKind;
      readonly detail?: string | undefined;
    };

export interface VoiceCoachTimers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface VoiceCoachOptions {
  readonly provider: VoiceProvider;
  readonly stepsById: ReadonlyMap<StepId, VoiceStep>;
  /** Sends an input to the engine (e.g. `runner.dispatch`). */
  readonly dispatch: (input: EngineInput) => unknown;
  readonly now: () => Millis;
  /**
   * The engine's live state (e.g. `() => runner.state`). Used for commands and the hold
   * countdown; without it the coach uses the state from the last event batch and
   * doesn't count down.
   */
  readonly getState?: () => EngineState;
  /**
   * Speak only when the participant needs to act on something: corrections, interrupted
   * holds, checking problems, stops and nurse calls, plus anything they ask to Repeat.
   * Routine prompts, confirmations, pauses and completion stay on screen only.
   */
  readonly quiet?: boolean;
  /** Same-key cooldown for the speech queue. Default 6000 ms. */
  readonly cooldownMs?: number;
  /** Count the last N seconds of a hold out loud (1..5). 0 turns it off. Default 3. */
  readonly countdownFrom?: number;
  readonly timers?: VoiceCoachTimers;
  /** Every line spoken, transcript heard, command handled and error, for the session log. */
  readonly onLog?: (entry: VoiceLogEntry) => void;
}

export interface VoiceCoach {
  /** Plug into the engine's listeners: `runner.subscribe(coach.handleEvents)`. */
  handleEvents(events: readonly EngineEvent[], state: EngineState): void;
  /** Runs a command as if spoken (also used by the provider's listener). */
  handleCommand(command: VoiceCommand, transcript?: string): void;
  /** Says the current instruction again. */
  repeat(): void;
  /** Starts speaking and listening. Call from a tap so mobile browsers allow speech. */
  start(): void;
  /** Goes quiet: stops listening, cuts off speech, ignores further events. */
  stop(): void;
  /** `stop()` for good. Doesn't dispose the provider, which the caller owns. */
  dispose(): void;
  readonly active: boolean;
}

const HOLD_POLL_MS = 200;
/** A countdown number that can't start within this long is skipped, not said late. */
const COUNTDOWN_MAX_WAIT_MS = 700;
const FORCE: EnqueueOptions = { force: true };

/**
 * Turns engine events into speech and spoken commands into engine inputs.
 *
 * The patient only hears app-authored scripts (`scripts.ts`) and each step's
 * coordinator-reviewed `spokenPrompt`. Nothing a model generates is ever spoken.
 */
export function createVoiceCoach(options: VoiceCoachOptions): VoiceCoach {
  const { provider, stepsById, dispatch, now, onLog } = options;
  const timers: VoiceCoachTimers = options.timers ?? {
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
  };
  const quiet = options.quiet ?? false;
  let issueStreak: { key: string; count: number; at: Millis } | null = null;
  const countdownFrom = quiet ? 0 : Math.max(0, Math.min(5, options.countdownFrom ?? 3));

  const queue = new SpeechQueue({
    speak: (u) => provider.speak(u),
    cancel: () => provider.cancel(),
    now,
    ...(options.cooldownMs !== undefined ? { cooldownMs: options.cooldownMs } : {}),
    onStart: (utterance) => onLog?.({ kind: "spoken", at: now(), utterance }),
  });

  let active = false;
  let disposed = false;
  let lastState: EngineState | null = null;
  let countdown: { stepId: StepId; handle: unknown; said: Set<number> } | null = null;

  const state = (): EngineState | null => options.getState?.() ?? lastState;

  function say(utterance: QueuedUtterance, opts?: EnqueueOptions): void {
    queue.enqueue(utterance, opts);
  }

  /** The step's own prompt, plus how to confirm it when it needs a spoken "done". */
  function stepPrompt(stepId: StepId): QueuedUtterance | null {
    const step = stepsById.get(stepId);
    if (!step) return null;
    const verbal = step.verification !== "visual";
    const text = verbal ? `${step.spokenPrompt} ${SCRIPTS.sayDone}` : step.spokenPrompt;
    return { key: `step:${stepId}`, text, priority: "prompt", stepId };
  }

  // --- Hold countdown ------------------------------------------------------------------

  function startCountdown(stepId: StepId): void {
    stopCountdown();
    const timerSeconds = stepsById.get(stepId)?.timerSeconds;
    if (!options.getState || countdownFrom === 0 || !timerSeconds) return;
    const said = new Set<number>();
    const handle = timers.setInterval(() => pollCountdown(stepId, timerSeconds), HOLD_POLL_MS);
    countdown = { stepId, handle, said };
  }

  function pollCountdown(stepId: StepId, timerSeconds: number): void {
    const s = options.getState?.();
    const p = s ? currentProgress(s) : null;
    if (
      !s ||
      !countdown ||
      s.status === "paused" ||
      p?.stepId !== stepId ||
      p.status !== "holding"
    ) {
      stopCountdown();
      return;
    }
    const left = Math.ceil((timerSeconds * 1000 - p.holdMs) / 1000);
    if (left < 1 || left > countdownFrom || countdown.said.has(left)) return;
    countdown.said.add(left);
    const text = COUNTDOWN_WORDS[left];
    if (!text) return;
    say(
      {
        key: `countdown:${stepId}:${left}`,
        text,
        priority: "prompt",
        stepId,
        maxWaitMs: COUNTDOWN_MAX_WAIT_MS,
      },
      FORCE,
    );
  }

  function stopCountdown(): void {
    if (countdown) timers.clearInterval(countdown.handle);
    countdown = null;
  }

  // --- Events -> speech ----------------------------------------------------------------

  function handleEvents(events: readonly EngineEvent[], s: EngineState): void {
    lastState = s;
    if (!active) return;
    const stops = events.some(
      (e) => e.type === "critical_miss" || e.type === "needs_human" || e.type === "stopped",
    );
    for (const event of events) handleEvent(event, s, stops);
  }

  function handleEvent(event: EngineEvent, s: EngineState, stopsInBatch: boolean): void {
    switch (event.type) {
      case "practice_started":
        if (quiet) return;
        say({ key: "practice-intro", text: SCRIPTS.practiceIntro, priority: "prompt" }, FORCE);
        return;
      case "practice_completed":
        if (quiet) return;
        say({ key: "practice-done", text: SCRIPTS.practiceDone, priority: "prompt" }, FORCE);
        return;
      case "step_activated": {
        stopCountdown();
        issueStreak = null;
        queue.setStep(event.stepId);
        const prompt = stepPrompt(event.stepId);
        if (prompt && !quiet) say(prompt, FORCE);
        return;
      }
      case "step_observed":
        if (!event.holding || quiet) return;
        say(
          {
            key: `hold:${event.stepId}`,
            text: SCRIPTS.holdStarted,
            priority: "prompt",
            stepId: event.stepId,
          },
          FORCE,
        );
        startCountdown(event.stepId);
        return;
      case "step_confirmed": {
        if (countdown?.stepId === event.stepId) stopCountdown();
        if (quiet) return;
        const wasHold = event.methods.includes("hold");
        say({
          key: `confirmed:${event.stepId}`,
          text: wasHold ? SCRIPTS.holdDone : SCRIPTS.stepDone,
          priority: "prompt",
        });
        return;
      }
      case "correction": {
        if (quiet) {
          const key = `${event.stepId}:${event.issue}`;
          const t = now();
          issueStreak =
            issueStreak && issueStreak.key === key && t - issueStreak.at <= PATIENCE_GAP_MS
              ? { key, count: issueStreak.count + 1, at: t }
              : { key, count: 1, at: t };
          const needed = stepsById.get(event.stepId)?.critical
            ? PATIENCE_FRAMES.critical
            : PATIENCE_FRAMES.normal;
          if (issueStreak.count < needed) return;
        }
        say({
          key: `issue:${event.issue}`,
          text: ISSUE_PHRASES[event.issue],
          priority: "correction",
          stepId: event.stepId,
        });
        return;
      }
      case "hold_interrupted": {
        stopCountdown();
        // A critical hold that breaks stops the procedure; the stop line covers it.
        if (stopsInBatch) return;
        const prompt = stepsById.get(event.stepId);
        if (!prompt) return;
        say(
          {
            key: `hold-interrupted:${event.stepId}`,
            text: `${SCRIPTS.holdInterrupted} ${prompt.spokenPrompt}`,
            priority: "prompt",
            stepId: event.stepId,
          },
          FORCE,
        );
        return;
      }
      case "paused":
        stopCountdown();
        // Nurse calls and vision outages announce themselves (see below).
        if (event.reason !== "user") return;
        queue.interrupt();
        if (!quiet) say({ key: "paused", text: SCRIPTS.paused, priority: "prompt" }, FORCE);
        return;
      case "resumed": {
        queue.interrupt();
        if (quiet) return;
        say({ key: "resumed", text: SCRIPTS.resumed, priority: "prompt" }, FORCE);
        // Say where they are again: after a pause they may not remember.
        const step = currentStep(s);
        const prompt = step ? stepPrompt(step.id) : null;
        if (prompt) say(prompt, FORCE);
        return;
      }
      case "nurse_called":
        stopCountdown();
        queue.interrupt();
        say({ key: "nurse-called", text: SCRIPTS.nurseCalled, priority: "prompt" }, FORCE);
        return;
      case "vision_degraded":
        stopCountdown();
        queue.interrupt();
        say(
          { key: "vision-unavailable", text: SCRIPTS.visionUnavailable, priority: "prompt" },
          FORCE,
        );
        return;
      case "critical_miss":
        stopCountdown();
        say({ key: "stop", text: SCRIPTS.stopCriticalMiss, priority: "urgent" }, FORCE);
        return;
      case "needs_human":
        stopCountdown();
        say({ key: "stop", text: SCRIPTS.stopNeedsHuman, priority: "urgent" }, FORCE);
        return;
      case "stopped":
        stopCountdown();
        if (event.reason.kind === "ended") {
          say({ key: "stop", text: SCRIPTS.stopEnded, priority: "urgent" }, FORCE);
        }
        return;
      case "completed":
        stopCountdown();
        queue.setStep(null);
        if (!quiet) say({ key: "completed", text: SCRIPTS.completed, priority: "prompt" }, FORCE);
        return;
      case "run_started":
      case "step_missed":
      case "flagged":
        return;
      case "vision_recovered":
        if (s.status === "paused" && s.pause?.reason === "vision_unavailable") {
          queue.interrupt();
          say(
            { key: "vision-recovered", text: SCRIPTS.visionRecovered, priority: "prompt" },
            FORCE,
          );
        }
        return;
    }
  }

  // --- Commands -> engine inputs -------------------------------------------------------

  function handleCommand(command: VoiceCommand, transcript?: string): void {
    if (!active) return;
    const log = (outcome: string) =>
      onLog?.({ kind: "command", at: now(), command, transcript: transcript ?? null, outcome });
    switch (command) {
      case "pause":
        dispatch({ type: "pause", at: now(), source: "voice" });
        return log("pause");
      case "continue":
        dispatch({ type: "resume", at: now(), source: "voice" });
        return log("resume");
      case "call_nurse":
        dispatch({ type: "call_nurse", at: now(), source: "voice" });
        return log("call_nurse");
      case "repeat":
        repeat();
        return log("repeat");
      case "done": {
        const s = state();
        const step = s ? currentStep(s) : null;
        const running = s?.status === "active" || s?.status === "practice";
        if (!s || !running || !step) return log("ignored: no step in progress");
        // "Done" only confirms steps that ask for it; it never advances a visual step.
        if (!needsVerbal(step)) return log("ignored: step is confirmed by camera");
        dispatch({ type: "verbal_confirm", at: now(), stepId: step.id, method: "voice" });
        return log(`verbal_confirm ${step.id}`);
      }
    }
  }

  function repeat(): void {
    if (!active) return;
    const s = state();
    if (!s) return;
    const line = repeatLine(s);
    if (line) say(line, FORCE);
  }

  function repeatLine(s: EngineState): QueuedUtterance | null {
    switch (s.status) {
      case "active":
      case "practice": {
        const step = currentStep(s);
        return step ? stepPrompt(step.id) : null;
      }
      case "paused":
        return s.pause?.reason === "vision_unavailable"
          ? { key: "vision-unavailable", text: SCRIPTS.visionUnavailable, priority: "prompt" }
          : { key: "paused", text: SCRIPTS.paused, priority: "prompt" };
      case "stopped": {
        const kind = s.stopReason?.kind;
        const text =
          kind === "critical_miss"
            ? SCRIPTS.stopCriticalMiss
            : kind === "needs_human"
              ? SCRIPTS.stopNeedsHuman
              : SCRIPTS.stopEnded;
        return { key: "stop", text, priority: "prompt" };
      }
      case "completed":
        return { key: "completed", text: SCRIPTS.completed, priority: "prompt" };
      case "idle":
        return s.practiceCompleted
          ? { key: "practice-done", text: SCRIPTS.practiceDone, priority: "prompt" }
          : null;
    }
  }

  // --- Lifecycle -----------------------------------------------------------------------

  function start(): void {
    if (active || disposed) return;
    active = true;
    provider.prime?.();
    if (!provider.capabilities.listen) return;
    provider.startListening({
      onCommand: (command, transcript) => handleCommand(command, transcript),
      onTranscript: (transcript) => onLog?.({ kind: "heard", at: now(), transcript }),
      onError: (error, detail) => onLog?.({ kind: "error", at: now(), error, detail }),
    });
  }

  function stop(): void {
    if (!active) return;
    active = false;
    stopCountdown();
    provider.stopListening();
    queue.interrupt();
  }

  return {
    handleEvents,
    handleCommand,
    repeat,
    start,
    stop,
    dispose() {
      stop();
      queue.dispose();
      disposed = true;
    },
    get active() {
      return active;
    },
  };
}
