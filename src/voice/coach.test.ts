import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_PROTOCOLS, PRACTICE_STEPS } from "@/demo";
import { Sim } from "@/engine/test-utils";
import type { EngineInput, StepId } from "@/engine";
import type { Step } from "@/protocol/schema";
import { createVoiceCoach, type VoiceCoach, type VoiceLogEntry } from "./coach";
import { COUNTDOWN_WORDS, ISSUE_PHRASES, SCRIPTS } from "./scripts";
import { FakeVoiceProvider, flush } from "./test-utils";

const protocol = DEMO_PROTOCOLS.find((p) => p.id === "mock-autoinjector")!;
const stepsById = new Map<StepId, Step>(
  [...PRACTICE_STEPS, ...protocol.steps].map((s) => [s.id, s]),
);
const prompt = (id: StepId) => stepsById.get(id)!.spokenPrompt;

describe("VoiceCoach on the mock autoinjector protocol", () => {
  let sim: Sim;
  let voice: FakeVoiceProvider;
  let coach: VoiceCoach;
  let dispatched: EngineInput[];
  let log: VoiceLogEntry[];

  beforeEach(() => {
    sim = new Sim(protocol.steps, { practiceSteps: PRACTICE_STEPS });
    voice = new FakeVoiceProvider();
    dispatched = [];
    log = [];
    coach = createVoiceCoach({
      provider: voice,
      stepsById,
      dispatch: (input) => {
        dispatched.push(input);
        return sim.runner.dispatch(input);
      },
      now: () => sim.t,
      getState: () => sim.runner.state,
      onLog: (entry) => log.push(entry),
    });
    sim.runner.subscribe(coach.handleEvents);
    coach.start();
  });

  afterEach(() => {
    coach.dispose();
    vi.useRealTimers();
  });

  /** Confirms every step until `target` is the current step. */
  async function advanceTo(target: StepId) {
    while (sim.current !== target) {
      const step = stepsById.get(sim.current!)!;
      if (step.verification !== "verbal") sim.frames(step.id, 3);
      if (step.verification !== "visual") sim.say(step.id, "tap");
      await voice.finishAll();
    }
  }

  const last = () => voice.spoken.at(-1);

  it("starts listening and primes speech on start", () => {
    expect(voice.listening).toBe(true);
    expect(voice.primed).toBe(true);
  });

  it("speaks the first step's reviewed prompt when the run starts", () => {
    sim.start();
    expect(voice.texts()).toEqual([prompt("wash-hands")]);
    expect(voice.spoken[0]).toMatchObject({ key: "step:wash-hands", priority: "prompt" });
  });

  it("says 'Good.' when a step is confirmed, then the next prompt with how to confirm it", async () => {
    sim.start();
    await voice.finish();
    sim.frames("wash-hands", 3);
    await voice.finishAll();
    expect(voice.texts().slice(1)).toEqual([
      SCRIPTS.stepDone,
      `${prompt("read-label")} ${SCRIPTS.sayDone}`,
    ]);
  });

  it("'done' confirms the current verbal step through the engine", async () => {
    sim.start();
    await advanceTo("read-label");
    voice.hear("I'm done");
    expect(dispatched.at(-1)).toEqual({
      type: "verbal_confirm",
      at: sim.t,
      stepId: "read-label",
      method: "voice",
    });
    expect(sim.current).toBe("check-expiry");
    expect(sim.progress("read-label").methods).toEqual(["voice"]);
  });

  it("'checked' counts on a visual+verbal step, which still needs the camera", async () => {
    sim.start();
    await advanceTo("check-expiry");
    voice.hear("checked");
    expect(sim.current).toBe("check-expiry");
    expect(sim.progress("check-expiry").verbalOk).toBe(true);
    sim.frames("check-expiry", 3);
    expect(sim.current).toBe("clean-site");
  });

  it("'done' never advances a step that the camera must confirm", async () => {
    sim.start();
    await advanceTo("clean-site");
    voice.hear("done");
    voice.hear("yes");
    expect(dispatched).toEqual([]);
    expect(sim.current).toBe("clean-site");
    expect(log.filter((e) => e.kind === "command").map((e) => "outcome" in e && e.outcome)).toEqual(
      ["ignored: step is confirmed by camera", "ignored: step is confirmed by camera"],
    );
  });

  it("'done' is ignored while paused or before a run", () => {
    voice.hear("done");
    sim.start();
    sim.pause();
    voice.hear("done");
    expect(dispatched).toEqual([]);
  });

  it("speaks corrections from the issue codes, with a cooldown", async () => {
    sim.start();
    await voice.finish();
    sim.frame(null, { issue: "too_dark" });
    expect(last()).toMatchObject({ text: ISSUE_PHRASES.too_dark, priority: "correction" });
    await voice.finish();
    sim.frame(null, { issue: "too_dark" }); // 1 s later: still in the cooldown
    sim.frame(null, { issue: "too_dark" });
    expect(voice.texts().filter((t) => t === ISSUE_PHRASES.too_dark)).toHaveLength(1);
    sim.t += 6000;
    sim.frame(null, { issue: "too_dark" });
    expect(voice.texts().filter((t) => t === ISSUE_PHRASES.too_dark)).toHaveLength(2);
  });

  it("drops a correction queued for a step that's already done", async () => {
    sim.start();
    sim.frame("wash-hands", { issue: "too_far" }); // queued behind the prompt
    sim.frames("wash-hands", 2); // confirms; read-label starts
    await voice.finishAll();
    expect(voice.texts()).not.toContain(ISSUE_PHRASES.too_far);
    expect(voice.texts().at(-1)).toBe(`${prompt("read-label")} ${SCRIPTS.sayDone}`);
  });

  it("'wait' pauses the engine at once, and 'continue' resumes and repeats the step", async () => {
    sim.start();
    voice.hear("wait");
    expect(dispatched.at(-1)).toEqual({ type: "pause", at: sim.t, source: "voice" });
    expect(sim.status).toBe("paused");
    expect(voice.cancels).toBe(1); // the prompt was cut off
    expect(last()?.text).toBe(SCRIPTS.paused);
    await voice.finish();

    voice.hear("I'm ready");
    expect(dispatched.at(-1)).toEqual({ type: "resume", at: sim.t, source: "voice" });
    expect(sim.status).toBe("active");
    await voice.finishAll();
    expect(voice.texts().slice(-2)).toEqual([SCRIPTS.resumed, prompt("wash-hands")]);
  });

  it("a bare 'stop' pauses; 'hold on' does nothing", async () => {
    sim.start();
    await advanceTo("press-hold");
    voice.hear("hold on");
    voice.hear("press and hold");
    expect(dispatched).toEqual([]);
    voice.hear("stop");
    expect(sim.status).toBe("paused");
  });

  it("pausing twice in a row still says 'Paused' both times", async () => {
    sim.start();
    voice.hear("pause");
    await voice.finishAll();
    voice.hear("continue");
    await voice.finishAll();
    voice.hear("pause");
    expect(last()?.text).toBe(SCRIPTS.paused);
  });

  it("'call my nurse' calls the nurse and pauses", async () => {
    sim.start();
    voice.hear("call my nurse");
    expect(dispatched.at(-1)).toEqual({ type: "call_nurse", at: sim.t, source: "voice" });
    expect(sim.status).toBe("paused");
    expect(sim.state.pause?.reason).toBe("nurse_called");
    await voice.finishAll();
    expect(voice.texts().at(-1)).toBe(SCRIPTS.nurseCalled);
    expect(voice.texts()).not.toContain(SCRIPTS.paused);
  });

  it("'repeat' re-speaks the current prompt, even inside the cooldown", async () => {
    sim.start();
    await voice.finish();
    voice.hear("say that again");
    expect(last()?.text).toBe(prompt("wash-hands"));
    await voice.finish();
    voice.hear("what?");
    expect(voice.texts().filter((t) => t === prompt("wash-hands"))).toHaveLength(3);
  });

  it("'repeat' while paused repeats how to resume", async () => {
    sim.start();
    voice.hear("pause");
    await voice.finishAll();
    coach.repeat();
    expect(last()?.text).toBe(SCRIPTS.paused);
  });

  it("announces a hold and counts down the last seconds", async () => {
    vi.useFakeTimers();
    sim.start();
    await advanceTo("press-hold");
    sim.frames("press-hold", 3);
    expect(last()?.text).toBe(SCRIPTS.holdStarted);
    await voice.finish();

    sim.tick(6000);
    vi.advanceTimersByTime(200);
    expect(last()?.text).toBe(SCRIPTS.holdStarted); // 4 s left: not yet

    for (const n of [3, 2, 1]) {
      sim.tick(1000);
      vi.advanceTimersByTime(200);
      expect(last()?.text).toBe(COUNTDOWN_WORDS[n]);
      await voice.finish();
    }
    sim.tick(1000);
    await voice.finishAll();
    expect(voice.texts().slice(-2)).toEqual([SCRIPTS.holdDone, prompt("remove-pen")]);
    expect(sim.current).toBe("remove-pen");
  });

  it("stops counting when the hold is paused", async () => {
    vi.useFakeTimers();
    sim.start();
    await advanceTo("press-hold");
    sim.frames("press-hold", 3);
    await voice.finish();
    sim.pause();
    await voice.finishAll();
    sim.tick(9000);
    vi.advanceTimersByTime(1000);
    expect(voice.texts().some((t) => Object.values(COUNTDOWN_WORDS).includes(t))).toBe(false);
  });

  it("a skipped critical step interrupts everything with the urgent stop line", async () => {
    sim.start();
    await advanceTo("clean-site");
    sim.frame("clean-site", { issue: "too_dark" });
    sim.frames("remove-cap", 3); // skips the critical clean-site
    expect(sim.status).toBe("stopped");
    expect(last()).toMatchObject({ text: SCRIPTS.stopCriticalMiss, priority: "urgent" });
    expect(voice.cancels).toBeGreaterThan(0);
    await voice.finishAll();
    expect(last()?.text).toBe(SCRIPTS.stopCriticalMiss);
    expect(voice.texts().filter((t) => t.startsWith("Please stop"))).toHaveLength(1);
  });

  it("an interrupted critical hold routes to the nurse with one stop line", async () => {
    sim.start();
    await advanceTo("press-hold");
    sim.frames("press-hold", 3);
    sim.tick(2000);
    sim.frames(null, 3);
    expect(sim.status).toBe("stopped");
    await voice.finishAll();
    expect(last()?.text).toBe(SCRIPTS.stopNeedsHuman);
    expect(voice.texts()).not.toContain(expect.stringContaining(SCRIPTS.holdInterrupted));
  });

  it("vision outage pauses with the vision line, then needs_human stops", async () => {
    sim.start();
    await voice.finish();
    for (let i = 0; i < 5; i++) sim.error();
    expect(sim.status).toBe("paused");
    expect(last()?.text).toBe(SCRIPTS.visionUnavailable);
    sim.tick(30_000);
    expect(sim.status).toBe("stopped");
    expect(last()).toMatchObject({ text: SCRIPTS.stopNeedsHuman, priority: "urgent" });
  });

  it("ending the session speaks the ended line", () => {
    sim.start();
    sim.send({ type: "stop", at: sim.t, by: "coordinator" });
    expect(last()).toMatchObject({ text: SCRIPTS.stopEnded, priority: "urgent" });
  });

  it("completes the whole procedure by voice and only ever says reviewed text", async () => {
    sim.startPractice();
    for (const s of PRACTICE_STEPS) {
      sim.frames(s.id, 3);
      await voice.finishAll();
    }
    sim.start();
    for (const step of protocol.steps) {
      if (step.verification !== "verbal") sim.frames(step.id, 3);
      if (step.timerSeconds) sim.tick(step.timerSeconds * 1000);
      if (step.verification !== "visual") voice.hear("done");
      await voice.finishAll();
    }
    expect(sim.status).toBe("completed");
    expect(last()?.text).toBe(SCRIPTS.completed);
    expect(voice.texts()[0]).toBe(SCRIPTS.practiceIntro);
    expect(voice.texts()).toContain(SCRIPTS.practiceDone);

    // Everything spoken is an app script, a countdown word, or a step's reviewed prompt.
    const allowed = new Set<string>([
      ...Object.values(SCRIPTS),
      ...Object.values(ISSUE_PHRASES),
      ...Object.values(COUNTDOWN_WORDS),
    ]);
    for (const step of stepsById.values()) {
      allowed.add(step.spokenPrompt);
      allowed.add(`${step.spokenPrompt} ${SCRIPTS.sayDone}`);
      allowed.add(`${SCRIPTS.holdInterrupted} ${step.spokenPrompt}`);
    }
    for (const text of voice.texts()) expect(allowed).toContain(text);
  });

  it("stop() goes quiet and ignores commands; start() resumes", async () => {
    sim.start();
    coach.stop();
    expect(voice.listening).toBe(false);
    const spoken = voice.spoken.length;
    sim.frames("wash-hands", 3);
    coach.handleCommand("pause");
    expect(voice.spoken).toHaveLength(spoken);
    expect(dispatched).toEqual([]);
    coach.start();
    expect(voice.listening).toBe(true);
    voice.hear("pause");
    expect(sim.status).toBe("paused");
  });

  it("logs what it heard, did and said", async () => {
    sim.start();
    voice.hear("the weather is nice");
    voice.hear("pause");
    voice.fail("network", "offline");
    await flush();
    const kinds = log.map((e) => e.kind);
    expect(kinds).toContain("spoken");
    expect(log).toContainEqual(
      expect.objectContaining({ kind: "heard", transcript: "the weather is nice" }),
    );
    expect(log).toContainEqual(
      expect.objectContaining({ kind: "command", command: "pause", outcome: "pause" }),
    );
    expect(log).toContainEqual(
      expect.objectContaining({ kind: "error", error: "network", detail: "offline" }),
    );
  });
});

describe("VoiceCoach without listening", () => {
  it("still speaks when the browser can't listen", () => {
    const voice = new FakeVoiceProvider();
    Object.assign(voice, { capabilities: { speak: true, listen: false } });
    const sim = new Sim(protocol.steps);
    const coach = createVoiceCoach({
      provider: voice,
      stepsById,
      dispatch: (i) => sim.runner.dispatch(i),
      now: () => sim.t,
    });
    sim.runner.subscribe(coach.handleEvents);
    coach.start();
    expect(voice.listening).toBe(false);
    sim.start();
    expect(voice.texts()).toEqual([prompt("wash-hands")]);
  });
});
