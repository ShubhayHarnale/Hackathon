import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_PROTOCOLS, PRACTICE_STEPS } from "@/demo";
import { SCRIPTS } from "@/voice/scripts";
import { FakeVoiceProvider, flush } from "@/voice/test-utils";
import { PatientController } from "./controller";
import { EvidenceUploader } from "./evidence";
import { EventOutbox } from "./outbox";
import { PatientVoice, type VoiceStatus } from "./voice";

const protocol = DEMO_PROTOCOLS.find((p) => p.id === "mock-autoinjector")!;

function setup() {
  const controller = new PatientController({
    sessionId: "voice-test",
    steps: protocol.steps,
    practiceSteps: PRACTICE_STEPS,
    vision: { kind: "scripted", scenario: "happy" },
    capture: async () => ({ base64: "/9j/frame", width: 1, height: 1 }),
    outbox: new EventOutbox({ send: async () => "ok" }),
    evidence: new EvidenceUploader({ send: async () => "ok" }),
  });
  const provider = new FakeVoiceProvider();
  const statuses: VoiceStatus[] = [];
  const voice = new PatientVoice(controller, {
    createProvider: () => provider,
    onStatus: (s) => statuses.push(s),
  });
  return { controller, provider, voice, statuses };
}

/** Advances to the next step that needs a spoken "done" (read-label). */
async function untilVerbalStep(controller: PatientController) {
  for (let i = 0; i < 80; i++) {
    const run = controller.runner.state.run;
    const step = run?.steps[run.index];
    if (step && step.verification !== "visual") return step.id;
    await vi.advanceTimersByTimeAsync(250);
  }
  throw new Error("no verbal step reached");
}

describe("PatientVoice", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("primes on the tap and stays silent until started", () => {
    const { controller, provider, voice } = setup();
    voice.prime();
    expect(provider.primed).toBe(true);
    controller.startPractice();
    expect(provider.spoken).toHaveLength(0);
    expect(provider.listening).toBe(false);
    controller.dispose();
  });

  it("speaks engine events and drives the engine (and the screen) by voice", async () => {
    const { controller, provider, voice, statuses } = setup();
    voice.prime();
    voice.start(true);
    expect(provider.listening).toBe(true);
    expect(statuses).toEqual(["listening"]);

    controller.start();
    expect(provider.texts()[0]).toContain(protocol.steps[0]!.spokenPrompt);

    provider.hear("pause");
    expect(controller.getSnapshot().engine.status).toBe("paused");
    expect(controller.getSnapshot().engine.pause?.source).toBe("voice");
    provider.hear("continue");
    expect(controller.getSnapshot().engine.status).toBe("active");

    const stepId = await untilVerbalStep(controller);
    provider.hear("done");
    const confirmed = controller.runner.state.run?.progress.find((p) => p.stepId === stepId);
    expect(confirmed?.verbalOk).toBe(true);
    expect(confirmed?.methods).toContain("voice");

    provider.hear("call my nurse");
    expect(controller.getSnapshot().engine.pause?.reason).toBe("nurse_called");
    voice.dispose();
    controller.dispose();
  });

  it("wires the Repeat button to the coach", async () => {
    const { controller, provider, voice } = setup();
    voice.prime();
    voice.start(true);
    controller.start();
    await provider.finishAll();
    const before = provider.spoken.length;
    controller.command("repeat", "button");
    await flush();
    expect(provider.spoken.length).toBeGreaterThan(before);
    expect(provider.texts().at(-1)).toContain(protocol.steps[0]!.spokenPrompt);
    voice.dispose();
    controller.dispose();
  });

  it("still speaks, without listening, when the microphone is denied", () => {
    const { controller, provider, voice, statuses } = setup();
    voice.prime();
    voice.start(false);
    expect(provider.listening).toBe(false);
    expect(statuses).toEqual(["speak_only"]);
    controller.startPractice();
    expect(provider.texts()).toContain(SCRIPTS.practiceIntro);
    voice.dispose();
    controller.dispose();
  });

  it("falls back to speak-only when listening fails for good", () => {
    const { voice, provider, statuses, controller } = setup();
    voice.prime();
    voice.start(true);
    provider.fail("permission_denied");
    expect(statuses).toEqual(["listening", "speak_only"]);
    voice.dispose();
    controller.dispose();
  });

  it("detaches from the controller on dispose", async () => {
    const { controller, provider, voice } = setup();
    voice.prime();
    voice.start(true);
    voice.dispose();
    expect(provider.disposed).toBe(true);
    const before = provider.spoken.length;
    controller.start();
    controller.command("repeat", "button");
    await flush();
    expect(provider.spoken.length).toBe(before);
    controller.dispose();
  });
});
