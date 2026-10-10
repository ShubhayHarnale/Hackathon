import { describe, expect, it, vi } from "vitest";
import type { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { DEMO_PROTOCOLS, PRACTICE_STEPS } from "@/demo";
import { EngineRunner, type EngineEvent, type FrameResult } from "@/engine";
import type { Step } from "@/protocol/schema";
import { FrameBuffer, scaleToFit } from "./capture";
import { frameContext } from "./context";
import { VisionError } from "./errors";
import { createGeminiVisionProvider } from "./gemini";
import { createHttpVisionProvider } from "./http-client";
import { VisionLoop } from "./loop";
import { SCENARIOS, ScriptedVisionProvider, type ScenarioName } from "./mock";
import { buildVisionPrompt, parseVisionOutput, visionResponseSchema } from "./prompt";
import { TokenBucketLimiter } from "./rate-limit";
import type { VisionCheckRequest, VisionProvider } from "./types";

const AUTOINJECTOR = DEMO_PROTOCOLS.find((p) => p.id === "mock-autoinjector")!;
const STEPS_BY_ID = new Map<string, Step>(
  [...PRACTICE_STEPS, ...AUTOINJECTOR.steps].map((s) => [s.id, s]),
);

const REQUEST: VisionCheckRequest = {
  sessionId: "s1",
  seq: 1,
  capturedAt: 0,
  image: { mimeType: "image/jpeg", base64: "AAAA" },
  currentStep: { id: "clean-site", instruction: "Clean", successCriteria: "Swab on thigh" },
  upcomingSteps: [{ id: "remove-cap", instruction: "Cap", successCriteria: "Cap off" }],
};

describe("prompt and output parsing", () => {
  it("constrains the answer to the candidate ids or none", () => {
    const schema = z.toJSONSchema(
      visionResponseSchema(["clean-site", "remove-cap"]),
    ) as unknown as {
      properties: { observedStepId: { enum: string[] } };
    };
    expect(schema.properties.observedStepId.enum).toEqual(["none", "clean-site", "remove-cap"]);
  });

  it("describes the current step and the lookahead window", () => {
    const prompt = buildVisionPrompt(REQUEST);
    expect(prompt).toContain('id "clean-site"');
    expect(prompt).toContain("skipped ahead");
    expect(prompt).toContain('id "remove-cap"');
  });

  it("sanitises model output", () => {
    const ids = ["clean-site", "remove-cap"];
    expect(
      parseVisionOutput(
        '{"observedStepId":"remove-cap","confidence":0.8,"issue":"none","handsVisible":true}',
        ids,
      ),
    ).toEqual({
      observedStepId: "remove-cap",
      confidence: 0.8,
      handsVisible: true,
    });
    expect(
      parseVisionOutput('{"observedStepId":"none","confidence":1.7,"issue":"too_dark"}', ids),
    ).toEqual({
      observedStepId: null,
      confidence: 1,
      issue: "too_dark",
    });
    // A step the model wasn't offered is treated as "nothing recognised".
    expect(
      parseVisionOutput('{"observedStepId":"sharps","confidence":0.9}', ids).observedStepId,
    ).toBeNull();
    expect(() => parseVisionOutput("not json", ids)).toThrow();
  });
});

describe("frameContext", () => {
  it("returns the current step plus up to 3 upcoming steps, or null when idle", () => {
    const runner = new EngineRunner({ steps: AUTOINJECTOR.steps });
    expect(frameContext(runner.state, STEPS_BY_ID)).toBeNull();
    runner.dispatch({ type: "start", at: 0 });
    const ctx = frameContext(runner.state, STEPS_BY_ID)!;
    expect(ctx.currentStep.id).toBe("wash-hands");
    expect(ctx.upcomingSteps.map((s) => s.id)).toEqual([
      "read-label",
      "check-expiry",
      "clean-site",
    ]);
  });
});

describe("capture helpers", () => {
  it("scales down to fit without upscaling", () => {
    expect(scaleToFit(1920, 1080, 640)).toEqual({ width: 640, height: 360 });
    expect(scaleToFit(320, 240, 640)).toEqual({ width: 320, height: 240 });
  });

  it("keeps the last N frames for evidence upload", () => {
    const buffer = new FrameBuffer(2);
    for (let seq = 1; seq <= 3; seq++)
      buffer.push({ seq, capturedAt: seq, base64: "", width: 1, height: 1 });
    expect(buffer.get(1)).toBeNull();
    expect(buffer.get(3)?.seq).toBe(3);
  });
});

describe("TokenBucketLimiter", () => {
  it("allows a burst, then refills over time, per key", () => {
    let t = 0;
    const limiter = new TokenBucketLimiter(2, 1, () => t);
    expect([limiter.take("a"), limiter.take("a"), limiter.take("a")]).toEqual([true, true, false]);
    expect(limiter.take("b")).toBe(true);
    t += 1000;
    expect(limiter.take("a")).toBe(true);
  });
});

describe("VisionLoop", () => {
  function setup(provider: VisionProvider) {
    let t = 1_000;
    const dispatched: string[] = [];
    const runner = new EngineRunner({ steps: AUTOINJECTOR.steps });
    runner.dispatch({ type: "start", at: t });
    const loop = new VisionLoop({
      provider,
      sessionId: "s",
      now: () => (t += 100),
      capture: async () => ({ base64: "x", width: 1, height: 1 }),
      getContext: () => frameContext(runner.state, STEPS_BY_ID),
      dispatch: (input) => {
        dispatched.push(input.type);
        runner.dispatch(input);
      },
    });
    return { loop, runner, dispatched };
  }

  it("is single-flight: a tick during an in-flight check is skipped", async () => {
    let release: (r: FrameResult) => void = () => {};
    const provider: VisionProvider = {
      name: "slow",
      check: () => new Promise<FrameResult>((resolve) => (release = resolve)),
    };
    const { loop } = setup(provider);
    const first = loop.tick();
    await Promise.resolve();
    expect(await loop.tick()).toBe(false);
    release({ observedStepId: null, confidence: 0 });
    expect(await first).toBe(true);
  });

  it("turns provider failures into frame_error inputs", async () => {
    const provider: VisionProvider = {
      name: "down",
      check: async () => Promise.reject(new VisionError("timeout")),
    };
    const { loop, dispatched, runner } = setup(provider);
    for (let i = 0; i < 5; i++) await loop.tick();
    expect(dispatched).toEqual(Array(5).fill("frame_error"));
    expect(runner.state.pause?.reason).toBe("vision_unavailable");
  });

  it("keeps captured frames so the confirming frame can be uploaded as evidence", async () => {
    const { loop, runner } = setup(new ScriptedVisionProvider("happy", AUTOINJECTOR.steps));
    const events: EngineEvent[] = [];
    runner.subscribe((e) => events.push(...e));
    for (let i = 0; i < 3; i++) await loop.tick();
    const confirmed = events.find((e) => e.type === "step_confirmed");
    expect(
      confirmed?.type === "step_confirmed" && loop.frames.get(confirmed.evidenceSeq!),
    ).toBeTruthy();
  });
});

/**
 * End-to-end on the demo protocol: scripted vision -> VisionLoop -> EngineRunner.
 * Spoken steps are confirmed the way a patient would (here: immediately).
 */
async function runScenario(scenario: ScenarioName, maxTicks = 200) {
  let t = 1_000_000;
  const runner = new EngineRunner({ steps: AUTOINJECTOR.steps });
  const events: EngineEvent[] = [];
  runner.subscribe((evts) => {
    events.push(...evts);
    for (const e of evts) {
      if (e.type === "step_activated" && STEPS_BY_ID.get(e.stepId)?.verification !== "visual") {
        queueMicrotask(() =>
          runner.dispatch({ type: "verbal_confirm", at: t, stepId: e.stepId, method: "voice" }),
        );
      }
    }
  });
  const loop = new VisionLoop({
    provider: new ScriptedVisionProvider(scenario, AUTOINJECTOR.steps),
    sessionId: "e2e",
    now: () => t,
    capture: async () => ({ base64: "", width: 0, height: 0 }),
    getContext: () => frameContext(runner.state, STEPS_BY_ID),
    dispatch: (input) => runner.dispatch(input),
  });
  runner.dispatch({ type: "start", at: t });
  for (
    let i = 0;
    i < maxTicks && (runner.state.status === "active" || runner.state.status === "paused");
    i++
  ) {
    t += 1_000;
    runner.dispatch({ type: "tick", at: t });
    await loop.tick();
    await Promise.resolve();
  }
  return { state: runner.state, types: events.map((e) => e.type) };
}

describe("scripted scenarios end to end", () => {
  it("covers every scenario", () => {
    expect(Object.keys(SCENARIOS).sort()).toEqual(
      ["early-release", "flicker", "happy", "outage", "poor-camera", "skip-critical"].sort(),
    );
  });

  it.each(["happy", "flicker", "poor-camera"] as const)(
    "%s completes the procedure",
    async (scenario) => {
      const { state, types } = await runScenario(scenario);
      expect(state.status).toBe("completed");
      expect(types.filter((t) => t === "step_confirmed")).toHaveLength(AUTOINJECTOR.steps.length);
      if (scenario === "poor-camera") expect(types).toContain("correction");
    },
  );

  it("skip-critical stops at the alcohol-swab step", async () => {
    const { state } = await runScenario("skip-critical");
    expect(state.stopReason).toMatchObject({
      kind: "critical_miss",
      missedStepId: "clean-site",
      cause: "skipped",
    });
  });

  it("early-release stops during the 10-second hold", async () => {
    const { state } = await runScenario("early-release");
    expect(state.stopReason).toMatchObject({
      kind: "critical_miss",
      missedStepId: "press-hold",
      cause: "hold_released_early",
    });
  });

  it("outage pauses, then routes to a human", async () => {
    const { state, types } = await runScenario("outage");
    expect(types).toContain("vision_degraded");
    expect(state.stopReason).toMatchObject({ kind: "needs_human", cause: "vision_outage" });
  });
});

describe("Gemini vision provider", () => {
  it("sends one low-resolution frame with store:false and minimal thinking", async () => {
    const create = vi.fn(async () => ({
      output_text:
        '{"observedStepId":"clean-site","confidence":0.9,"issue":"none","handsVisible":true}',
    }));
    const provider = createGeminiVisionProvider({
      client: { interactions: { create } } as unknown as GoogleGenAI,
      model: "m",
    });
    const result = await provider.check(REQUEST);
    expect(result).toEqual({ observedStepId: "clean-site", confidence: 0.9, handsVisible: true });
    const [params] = create.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(params).toMatchObject({
      store: false,
      generation_config: { thinking_level: "minimal", temperature: 0 },
      input: [{ type: "text" }, { type: "image", mime_type: "image/jpeg", resolution: "low" }],
    });
  });

  it("maps malformed output and rate limits to typed errors", async () => {
    const malformed = createGeminiVisionProvider({
      client: {
        interactions: { create: async () => ({ output_text: "nope" }) },
      } as unknown as GoogleGenAI,
      model: "m",
    });
    await expect(malformed.check(REQUEST)).rejects.toMatchObject({ kind: "provider" });

    const limited = createGeminiVisionProvider({
      client: {
        interactions: {
          create: async () => Promise.reject(Object.assign(new Error("429"), { status: 429 })),
        },
      } as unknown as GoogleGenAI,
      model: "m",
    });
    await expect(limited.check(REQUEST)).rejects.toMatchObject({ kind: "rate_limited" });
  });

  it("times out instead of hanging", async () => {
    const hang = createGeminiVisionProvider({
      client: {
        interactions: {
          create: (_p: unknown, o: { fetchOptions: { signal: AbortSignal } }) =>
            new Promise((_, reject) =>
              o.fetchOptions.signal.addEventListener("abort", () => reject(new Error("aborted"))),
            ),
        },
      } as unknown as GoogleGenAI,
      model: "m",
      timeoutMs: 20,
    });
    await expect(hang.check(REQUEST)).rejects.toMatchObject({ kind: "timeout" });
  });
});

describe("HTTP vision client", () => {
  const respond = (status: number, body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("returns the validated result", async () => {
    const client = createHttpVisionProvider({
      fetchImpl: respond(200, { observedStepId: "a", confidence: 0.9 }),
    });
    await expect(client.check(REQUEST)).resolves.toEqual({ observedStepId: "a", confidence: 0.9 });
  });

  it.each([
    [504, "timeout"],
    [429, "rate_limited"],
    [500, "provider"],
  ])("maps HTTP %i to %s", async (status, kind) => {
    const client = createHttpVisionProvider({ fetchImpl: respond(status, { error: "x" }) });
    await expect(client.check(REQUEST)).rejects.toMatchObject({ kind });
  });

  it("maps network failures", async () => {
    const fetchImpl = vi.fn(async () =>
      Promise.reject(new TypeError("fetch failed")),
    ) as unknown as typeof fetch;
    await expect(createHttpVisionProvider({ fetchImpl }).check(REQUEST)).rejects.toMatchObject({
      kind: "network",
    });
  });
});
