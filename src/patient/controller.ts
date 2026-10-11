import {
  EngineRunner,
  isTerminal,
  type CommandSource,
  type EngineEvent,
  type EngineInput,
  type EngineListener,
  type EngineState,
  type FrameResult,
  type IssueCode,
} from "@/engine";
import type { Step } from "@/protocol/schema";
import {
  ScriptedVisionProvider,
  VisionLoop,
  createHttpVisionProvider,
  frameContext,
  type CapturedFrame,
  type ScenarioName,
  type VisionProvider,
  type VisionFailureKind,
} from "@/vision";
import type { VoiceCommand } from "@/voice/types";
import type { EvidenceUploader } from "./evidence";
import type { EventOutbox } from "./outbox";

export type VisionConfig =
  | { readonly kind: "scripted"; readonly scenario: ScenarioName }
  | { readonly kind: "server" }
  | { readonly kind: "replay" };

export interface PatientControllerOptions {
  readonly sessionId: string;
  readonly sessionToken?: string;
  readonly steps: readonly Step[];
  readonly practiceSteps: readonly Step[];
  readonly vision: VisionConfig;
  readonly capture: () => Promise<Omit<CapturedFrame, "seq" | "capturedAt"> | null>;
  readonly outbox: EventOutbox;
  readonly evidence: EvidenceUploader;
  /** Test seams. */
  readonly provider?: VisionProvider;
  readonly now?: () => number;
  readonly tickMs?: number;
  readonly visionIntervalMs?: number;
}

export interface Correction {
  readonly stepId: string;
  readonly issue: IssueCode;
  readonly at: number;
}

/** Everything the screens render from. A new object whenever anything changes. */
export interface PatientSnapshot {
  readonly engine: EngineState;
  /** The latest frame verdict (the practice screen shows whether hands are visible). */
  readonly lastFrame: FrameResult | null;
  readonly visionError: VisionFailureKind | null;
  /** The camera problem to show, if any. Cleared when the step moves on or after a while. */
  readonly correction: Correction | null;
}

/** How long a correction stays on screen without a fresh one. */
export const CORRECTION_TTL_MS = 8_000;

/**
 * Owns one patient session in the browser: the step engine, the vision loop, the 250 ms
 * tick, and persistence (event log and evidence frames). Framework-free; React reads it
 * through `subscribe`/`getSnapshot`.
 *
 * Integration point for voice (Phase 5): `addEngineListener` receives every engine event
 * batch (to speak prompts and corrections), and `command` turns a voice command into
 * the same engine input its on-screen button sends.
 */
export class PatientController {
  readonly runner: EngineRunner;
  readonly loop: VisionLoop;
  private readonly engineListeners = new Set<EngineListener>();
  private readonly repeatListeners = new Set<() => void>();
  private readonly snapshotListeners = new Set<() => void>();
  private readonly results = new Map<number, FrameResult>();
  private readonly now: () => number;
  /** Practice and procedure steps by id (for the voice coach and the screens). */
  readonly stepsById: ReadonlyMap<string, Step>;
  private tick: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private snapshot: PatientSnapshot;

  constructor(private readonly opts: PatientControllerOptions) {
    this.now = opts.now ?? (() => Date.now());
    this.stepsById = new Map([...opts.practiceSteps, ...opts.steps].map((s) => [s.id, s]));
    this.runner = new EngineRunner({
      steps: opts.steps,
      practiceSteps: opts.practiceSteps,
      ...(opts.vision.kind === "scripted" && opts.vision.scenario === "no-response"
        ? { config: { maxStepSeconds: 15, maxUnmatchedFrames: 1_000 } }
        : {}),
    });
    this.snapshot = {
      engine: this.runner.state,
      lastFrame: null,
      visionError: null,
      correction: null,
    };

    const provider =
      opts.provider ??
      (opts.vision.kind === "scripted"
        ? new ScriptedVisionProvider(opts.vision.scenario, [...opts.practiceSteps, ...opts.steps])
        : createHttpVisionProvider({ sessionToken: opts.sessionToken }));

    this.loop = new VisionLoop({
      provider,
      sessionId: opts.sessionId,
      capture: opts.capture,
      getContext: () => frameContext(this.runner.state, this.stepsById),
      dispatch: (input) => this.dispatch(input),
      now: this.now,
      ...(opts.visionIntervalMs ? { intervalMs: opts.visionIntervalMs } : {}),
      onResult: ({ seq, result, error }) => {
        this.update({ visionError: error ?? null });
        if (!result) return;
        this.results.set(seq, result);
        // Keep only as many results as the loop keeps frames.
        for (const key of this.results.keys()) if (key <= seq - 8) this.results.delete(key);
        this.update({ lastFrame: result });
      },
    });

    this.runner.subscribe((events, state) => this.onEngineEvents(events, state));
  }

  /** The event log's send queue (the page flushes it on reconnect and page hide). */
  get outbox(): EventOutbox {
    return this.opts.outbox;
  }

  // --- Integration points (UI now, VoiceCoach in Phase 5) -------------------------------

  /** Every engine event batch, after persistence has queued it. Returns an unsubscribe. */
  addEngineListener(listener: EngineListener): () => void {
    this.engineListeners.add(listener);
    return () => this.engineListeners.delete(listener);
  }

  /** Called when the patient asks to hear the current step again. */
  onRepeat(listener: () => void): () => void {
    this.repeatListeners.add(listener);
    return () => this.repeatListeners.delete(listener);
  }

  /** Feeds an input to the engine. Every input path (vision, tick, buttons, voice) uses this. */
  dispatch(input: EngineInput): readonly EngineEvent[] {
    if (
      input.type === "resume" &&
      this.runner.state.pause?.reason === "vision_unavailable" &&
      (this.runner.state.vision.degraded || this.snapshot.visionError !== null)
    )
      return [];
    const events = this.runner.dispatch(input);
    if (this.runner.state !== this.snapshot.engine) this.update({ engine: this.runner.state });
    return events;
  }

  /** A patient command, from a button or (Phase 5) the voice coach. */
  command(command: VoiceCommand, source: CommandSource): void {
    const at = this.now();
    switch (command) {
      case "pause":
        this.dispatch({ type: "pause", at, source });
        return;
      case "continue":
        this.dispatch({ type: "resume", at, source });
        return;
      case "call_nurse":
        this.dispatch({ type: "call_nurse", at, source });
        return;
      case "done": {
        const run = this.runner.state.run;
        const step = run?.steps[run.index];
        if (step) {
          this.dispatch({
            type: "verbal_confirm",
            at,
            stepId: step.id,
            method: source === "voice" ? "voice" : "tap",
          });
        }
        return;
      }
      case "repeat":
        for (const listener of this.repeatListeners) listener();
        return;
    }
  }

  // --- Lifecycle -------------------------------------------------------------------------

  startPractice(): void {
    this.started = true;
    this.dispatch({ type: "start_practice", at: this.now() });
    this.resumeTimers();
  }

  start(): void {
    this.started = true;
    this.dispatch({ type: "start", at: this.now() });
    this.resumeTimers();
  }

  /** Starts the tick and vision loop once a run has begun. Idempotent; safe after suspend. */
  resumeTimers(): void {
    if (!this.started || isTerminal(this.runner.state)) return;
    this.tick ??= setInterval(() => this.onTick(), this.opts.tickMs ?? 250);
    this.loop.start();
  }

  /** Stops timers (unmount, or the run ended). Queued events keep sending. */
  suspend(): void {
    this.loop.stop();
    if (this.tick) clearInterval(this.tick);
    this.tick = null;
  }

  dispose(): void {
    this.suspend();
    this.engineListeners.clear();
    this.repeatListeners.clear();
    this.snapshotListeners.clear();
  }

  // --- React external store ----------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  };

  getSnapshot = (): PatientSnapshot => this.snapshot;

  step(stepId: string): Step | undefined {
    return this.stepsById.get(stepId);
  }

  // --- Internals ---------------------------------------------------------------------------

  private onTick(): void {
    const at = this.now();
    this.dispatch({ type: "tick", at });
    const c = this.snapshot.correction;
    if (c && at - c.at > CORRECTION_TTL_MS) this.update({ correction: null });
  }

  private onEngineEvents(events: readonly EngineEvent[], state: EngineState): void {
    // 1. Persistence first, so nothing a listener does can lose an event.
    this.opts.outbox.push(events);

    // 2. Evidence for confirmed steps and critical misses in the real run.
    for (const e of events) {
      if (e.run !== "real") continue;
      if (e.type === "step_confirmed" && e.evidenceSeq !== null) {
        this.uploadEvidence(e.stepId, e.evidenceSeq);
      } else if (e.type === "critical_miss") {
        this.uploadEvidence(e.missedStepId, e.evidenceSeq);
      }
    }

    // 3. On-screen corrections.
    let correction = this.snapshot.correction;
    for (const e of events) {
      if (e.type === "correction") correction = { stepId: e.stepId, issue: e.issue, at: e.at };
      else if (
        e.type === "step_activated" ||
        e.type === "step_observed" ||
        e.type === "step_confirmed" ||
        e.type === "resumed"
      ) {
        correction = null;
      }
    }
    if (correction !== this.snapshot.correction) this.update({ correction });

    // 4. A finished run needs no more frames or ticks.
    if (isTerminal(state)) this.suspend();

    // 5. Everyone else (voice coach in Phase 5). A failing listener must not break the run.
    for (const listener of this.engineListeners) {
      try {
        listener(events, state);
      } catch (error) {
        console.error("[patient] engine listener failed", error);
      }
    }
  }

  private uploadEvidence(stepId: string, seq: number): void {
    const frame = this.loop.frames.get(seq);
    if (!frame) return;
    this.opts.evidence.upload({
      stepId,
      seq,
      capturedAt: frame.capturedAt,
      base64: frame.base64,
      visionResult: this.results.get(seq) ?? null,
    });
  }

  private update(patch: Partial<PatientSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.snapshotListeners) listener();
  }
}
