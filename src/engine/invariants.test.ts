import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEFAULT_ENGINE_CONFIG } from "./config";
import { transition } from "./reducer";
import { createEngineState, isTerminal, type EngineState } from "./state";
import { DEMO_STEPS, PRACTICE_STEPS, deepFreeze } from "./test-utils";
import type { EngineInput, StepId } from "./types";

/**
 * Property-based tests: random input sequences (including stale, out-of-order and
 * low-confidence frames, pauses at any moment, vision errors) must never break the
 * engine's safety invariants.
 */

const ALL_IDS: StepId[] = [...DEMO_STEPS, ...PRACTICE_STEPS].map((s) => s.id);

type Command =
  | {
      kind: "frame";
      target: "current" | "next" | "random";
      id: StepId | null;
      conf: number;
      dt: number;
      latency: number;
      jitter: number;
    }
  | { kind: "error"; dt: number }
  | { kind: "say"; target: "current" | "random"; id: StepId }
  | { kind: "tick"; dt: number }
  /** Several consecutive confident frames of a later step: the patient skips ahead. */
  | { kind: "skip_ahead"; offset: number; n: number }
  | { kind: "pause" | "resume" | "call_nurse" | "start" | "start_practice" | "stop" };

const commandArb: fc.Arbitrary<Command> = fc.oneof(
  {
    weight: 12,
    arbitrary: fc.record({
      kind: fc.constant("frame" as const),
      target: fc.constantFrom(
        "current" as const,
        "current" as const,
        "next" as const,
        "random" as const,
      ),
      id: fc.option(fc.constantFrom(...ALL_IDS), { nil: null }),
      conf: fc.double({ min: 0, max: 1, noNaN: true }),
      dt: fc.integer({ min: 0, max: 3_000 }),
      latency: fc.integer({ min: 0, max: 4_000 }),
      jitter: fc.integer({ min: -2, max: 1 }),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant("error" as const),
      dt: fc.integer({ min: 0, max: 8_000 }),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant("say" as const),
      target: fc.constantFrom("current" as const, "random" as const),
      id: fc.constantFrom(...ALL_IDS),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant("tick" as const),
      dt: fc.integer({ min: 0, max: 60_000 }),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constantFrom(
        "pause" as const,
        "resume" as const,
        "call_nurse" as const,
        "start" as const,
        "start" as const,
        "start_practice" as const,
      ),
    }),
  },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("stop" as const) }) },
);

/**
 * A mostly cooperative patient with realistic disruptions (flicker, lookahead frames,
 * vision errors, pauses). Unlike the chaotic generator, this one regularly reaches the
 * end of the procedure, so the completion invariants are actually exercised.
 */
const cooperativeArb: fc.Arbitrary<Command> = fc.oneof(
  {
    weight: 20,
    arbitrary: fc.record({
      kind: fc.constant("frame" as const),
      target: fc.constant("current" as const),
      id: fc.constant(null),
      conf: fc.double({ min: 0.75, max: 1, noNaN: true }),
      dt: fc.integer({ min: 500, max: 1_500 }),
      latency: fc.integer({ min: 100, max: 600 }),
      jitter: fc.constant(0),
    }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant("frame" as const),
      target: fc.constantFrom("next" as const, "random" as const),
      id: fc.option(fc.constantFrom(...ALL_IDS), { nil: null }),
      conf: fc.double({ min: 0, max: 1, noNaN: true }),
      dt: fc.integer({ min: 500, max: 1_500 }),
      latency: fc.integer({ min: 100, max: 600 }),
      jitter: fc.integer({ min: -1, max: 0 }),
    }),
  },
  {
    weight: 6,
    arbitrary: fc.record({
      kind: fc.constant("say" as const),
      target: fc.constant("current" as const),
      id: fc.constantFrom(...ALL_IDS),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant("tick" as const),
      dt: fc.integer({ min: 0, max: 2_000 }),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("error" as const),
      dt: fc.integer({ min: 500, max: 2_000 }),
    }),
  },
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constantFrom("start" as const, "resume" as const, "resume" as const),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constantFrom("pause" as const, "call_nurse" as const, "start_practice" as const),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("skip_ahead" as const),
      offset: fc.integer({ min: 1, max: 3 }),
      n: fc.integer({ min: 1, max: 4 }),
    }),
  },
);

function currentId(state: EngineState, offset = 0): StepId | null {
  const run = state.run;
  return run?.steps[run.index + offset]?.id ?? null;
}

/** Turns an abstract command into a concrete engine input, given the clock and state. */
function toInput(
  cmd: Exclude<Command, { kind: "skip_ahead" }>,
  state: EngineState,
  clock: { t: number; seq: number },
): EngineInput {
  switch (cmd.kind) {
    case "frame": {
      clock.t += cmd.dt;
      clock.seq += 1;
      const id =
        cmd.target === "current"
          ? currentId(state)
          : cmd.target === "next"
            ? currentId(state, 1)
            : cmd.id;
      return {
        type: "frame",
        at: clock.t,
        seq: clock.seq + cmd.jitter,
        capturedAt: clock.t - cmd.latency,
        result: { observedStepId: id, confidence: cmd.conf },
      };
    }
    case "error":
      clock.t += cmd.dt;
      clock.seq += 1;
      return { type: "frame_error", at: clock.t, seq: clock.seq, kind: "timeout" };
    case "say": {
      const id = cmd.target === "current" ? (currentId(state) ?? cmd.id) : cmd.id;
      return { type: "verbal_confirm", at: clock.t, stepId: id, method: "voice" };
    }
    case "tick":
      clock.t += cmd.dt;
      return { type: "tick", at: clock.t };
    case "pause":
    case "resume":
    case "call_nurse":
      return { type: cmd.kind, at: clock.t, source: "voice" };
    case "start":
    case "start_practice":
      return { type: cmd.kind, at: clock.t };
    case "stop":
      return { type: "stop", at: clock.t, by: "patient" };
  }
}

function checkInvariants(
  prev: EngineState,
  input: EngineInput,
  next: EngineState,
  eventsLength: number,
) {
  // Terminal states absorb everything.
  if (isTerminal(prev)) {
    expect(next).toBe(prev);
    expect(eventsLength).toBe(0);
    return;
  }

  // Only an explicit resume leaves a pause for a running state.
  if (prev.status === "paused" && (next.status === "active" || next.status === "practice")) {
    expect(input.type).toBe("resume");
  }

  // Events are numbered consecutively across the whole session.
  expect(next.nextEventSeq).toBe(prev.nextEventSeq + eventsLength);

  if (next.status === "stopped") expect(next.stopReason).not.toBeNull();

  const run = next.run;
  if (!run) return;
  run.steps.forEach((step, i) => {
    const p = run.progress[i];
    if (!p) throw new Error("progress missing");
    // A critical step is never silently skipped: skipping one stops the procedure.
    if (step.critical) expect(p.status).not.toBe("missed");
    // Steps resolve strictly in order.
    if (i < run.index) expect(["confirmed", "missed"]).toContain(p.status);
    if (i > run.index) expect(p.status).toBe("pending");
  });

  // Completion implies every critical step was confirmed.
  if (next.status === "completed") {
    run.steps.forEach((step, i) => {
      if (step.critical) expect(run.progress[i]?.status).toBe("confirmed");
    });
  }
}

/** Runs one command sequence, checking invariants after every transition. */
function simulate(commands: readonly Command[]): EngineState {
  let state = deepFreeze(createEngineState(DEMO_STEPS, PRACTICE_STEPS));
  const clock = { t: 1_000_000, seq: 0 };
  const apply = (input: EngineInput) => {
    const { state: next, events } = transition(state, input, DEFAULT_ENGINE_CONFIG);
    checkInvariants(state, input, next, events.length);
    state = deepFreeze(next);
  };
  for (const cmd of commands) {
    if (cmd.kind !== "skip_ahead") {
      apply(toInput(cmd, state, clock));
      continue;
    }
    const target = currentId(state, cmd.offset);
    for (let i = 0; i < cmd.n; i++) {
      clock.t += 1_000;
      clock.seq += 1;
      apply({
        type: "frame",
        at: clock.t,
        seq: clock.seq,
        capturedAt: clock.t - 300,
        result: { observedStepId: target, confidence: 0.95 },
      });
    }
  }
  return state;
}

describe("engine invariants (property-based)", () => {
  it("hold for chaotic input sequences", () => {
    fc.assert(
      fc.property(fc.array(commandArb, { minLength: 1, maxLength: 250 }), (commands) => {
        simulate(commands);
      }),
      { numRuns: 500 },
    );
  });

  it("hold for a mostly cooperative patient, who regularly finishes or is stopped", () => {
    let completed = 0;
    let criticalMisses = 0;
    fc.assert(
      fc.property(fc.array(cooperativeArb, { minLength: 50, maxLength: 300 }), (commands) => {
        const final = simulate(commands);
        if (final.status === "completed") completed += 1;
        if (final.stopReason?.kind === "critical_miss") criticalMisses += 1;
      }),
      { numRuns: 500 },
    );
    // Guard against a vacuous test: these outcomes must actually be reached.
    expect(completed).toBeGreaterThan(0);
    expect(criticalMisses).toBeGreaterThan(0);
  });
});
