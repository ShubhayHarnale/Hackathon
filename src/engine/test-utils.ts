// Test helpers for the engine. Imported only by *.test.ts files.
import { EngineRunner, type EngineRunnerOptions } from "./runner";
import type { EngineState } from "./state";
import type {
  CommandSource,
  EngineConfig,
  EngineEvent,
  EngineEventType,
  EngineInput,
  EngineStep,
  FrameErrorKind,
  IssueCode,
  StepId,
} from "./types";

/** Mirrors the seeded mock autoinjector demo protocol. */
export const DEMO_STEPS: readonly EngineStep[] = [
  { id: "wash-hands", order: 1, critical: false, verification: "visual" },
  { id: "read-label", order: 2, critical: false, verification: "verbal" },
  { id: "check-expiry", order: 3, critical: false, verification: "visual+verbal" },
  { id: "clean-site", order: 4, critical: true, verification: "visual" },
  { id: "remove-cap", order: 5, critical: false, verification: "visual" },
  { id: "place-pen", order: 6, critical: false, verification: "visual" },
  { id: "press-hold", order: 7, critical: true, verification: "visual", timerSeconds: 10 },
  { id: "remove-pen", order: 8, critical: false, verification: "visual" },
  { id: "sharps", order: 9, critical: false, verification: "visual" },
];

export const PRACTICE_STEPS: readonly EngineStep[] = [
  { id: "show-hands", order: 1, critical: false, verification: "visual" },
  { id: "show-pen", order: 2, critical: false, verification: "visual" },
];

export interface FrameOptions {
  confidence?: number;
  issue?: IssueCode;
  /** Time since the previous input. Default 1000 (1 fps). */
  dtMs?: number;
  /** How long before arrival the frame was captured. Default 300. */
  latencyMs?: number;
}

/** Drives an EngineRunner with a fake clock and records every event. */
export class Sim {
  readonly runner: EngineRunner;
  readonly events: EngineEvent[] = [];
  t = 1_000_000;
  seq = 0;

  constructor(
    steps: readonly EngineStep[] = DEMO_STEPS,
    options: { practiceSteps?: readonly EngineStep[]; config?: Partial<EngineConfig> } = {},
  ) {
    const runnerOptions: EngineRunnerOptions = {
      steps,
      practiceSteps: options.practiceSteps ?? PRACTICE_STEPS,
      ...(options.config ? { config: options.config } : {}),
    };
    this.runner = new EngineRunner(runnerOptions);
    this.runner.subscribe((events) => this.events.push(...events));
  }

  get state(): EngineState {
    return this.runner.state;
  }

  get status() {
    return this.runner.state.status;
  }

  /** Index of the current step, or null outside a run. */
  get current(): StepId | null {
    const run = this.state.run;
    return run?.steps[run.index]?.id ?? null;
  }

  progress(stepId: StepId) {
    const p = this.state.run?.progress.find((pr) => pr.stepId === stepId);
    if (!p) throw new Error(`no progress for ${stepId}`);
    return p;
  }

  send(input: EngineInput): readonly EngineEvent[] {
    return this.runner.dispatch(input);
  }

  start() {
    return this.send({ type: "start", at: this.t });
  }

  startPractice() {
    return this.send({ type: "start_practice", at: this.t });
  }

  frame(observedStepId: StepId | null, opts: FrameOptions = {}) {
    this.t += opts.dtMs ?? 1000;
    this.seq += 1;
    return this.send({
      type: "frame",
      at: this.t,
      seq: this.seq,
      capturedAt: this.t - (opts.latencyMs ?? 300),
      result: {
        observedStepId,
        confidence: opts.confidence ?? 0.95,
        ...(opts.issue ? { issue: opts.issue } : {}),
      },
    });
  }

  frames(observedStepId: StepId | null, n: number, opts: FrameOptions = {}) {
    const out: EngineEvent[] = [];
    for (let i = 0; i < n; i++) out.push(...this.frame(observedStepId, opts));
    return out;
  }

  error(kind: FrameErrorKind = "timeout", dtMs = 1000) {
    this.t += dtMs;
    this.seq += 1;
    return this.send({ type: "frame_error", at: this.t, seq: this.seq, kind });
  }

  tick(ms: number) {
    this.t += ms;
    return this.send({ type: "tick", at: this.t });
  }

  say(stepId: StepId, method: "voice" | "tap" = "voice") {
    this.t += 500;
    return this.send({ type: "verbal_confirm", at: this.t, stepId, method });
  }

  pause(source: CommandSource = "button") {
    return this.send({ type: "pause", at: this.t, source });
  }

  resume(source: CommandSource = "button") {
    return this.send({ type: "resume", at: this.t, source });
  }

  callNurse(source: CommandSource = "button") {
    return this.send({ type: "call_nurse", at: this.t, source });
  }

  stop(by: "patient" | "coordinator" | "system" = "patient") {
    return this.send({ type: "stop", at: this.t, by });
  }

  /** Completes the current step the way a well-behaved patient would. */
  completeCurrent() {
    const run = this.state.run;
    const step = run?.steps[run.index];
    if (!step) throw new Error("no current step");
    if (step.verification !== "visual") this.say(step.id);
    if (step.verification !== "verbal") {
      this.frames(step.id, 3);
      // Holds: keep showing the step until the timer completes.
      if (step.timerSeconds !== undefined) this.frames(step.id, step.timerSeconds);
    }
  }

  /** Completes steps until `stepId` is current. */
  advanceTo(stepId: StepId) {
    for (let guard = 0; this.current !== stepId; guard++) {
      if (guard > 50) throw new Error(`never reached ${stepId}`);
      this.completeCurrent();
    }
  }

  types(events: readonly EngineEvent[] = this.events): EngineEventType[] {
    return events.map((e) => e.type);
  }

  last<T extends EngineEventType>(type: T): Extract<EngineEvent, { type: T }> | undefined {
    for (let i = this.events.length - 1; i >= 0; i--) {
      const e = this.events[i];
      if (e?.type === type) return e as Extract<EngineEvent, { type: T }>;
    }
    return undefined;
  }
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}
