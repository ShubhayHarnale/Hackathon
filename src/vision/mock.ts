import type { EngineStep, FrameResult, IssueCode } from "@/engine";
import { VisionError } from "./errors";
import type { VisionCheckRequest, VisionProvider } from "./types";

/**
 * Keyless vision providers. They ignore the image and answer from a script, so the full
 * pipeline (capture -> provider -> engine -> UI) can be demoed and tested offline.
 */

/** Always sees the current step clearly. The server-side default without a Gemini key. */
export const alwaysCurrentVisionProvider: VisionProvider = {
  name: "mock",
  async check(request) {
    return { observedStepId: request.currentStep.id, confidence: 0.92, handsVisible: true };
  },
};

export const SCENARIOS = {
  happy: "Everything goes right",
  flicker: "Noisy frames: the step is confirmed only after 3 clean frames in a row",
  "poor-camera": "Dark, unclear frames at the start of each step (shows corrections)",
  "skip-critical": "Skips the first critical step (stops with a critical miss)",
  "early-release": "Lifts the pen early during the hold (stops with a critical miss)",
  outage: "The vision service stops responding (pause, then route to a human)",
} as const;

export type ScenarioName = keyof typeof SCENARIOS;

export function isScenarioName(value: string): value is ScenarioName {
  return value in SCENARIOS;
}

const FLICKER: readonly ("current" | "none" | "next")[] = [
  "current",
  "none",
  "current",
  "next",
  "current",
  "current",
  "current",
];

/**
 * Deterministic scripted vision: answers depend on the scenario and on how many frames
 * have been seen for the current step.
 */
export class ScriptedVisionProvider implements VisionProvider {
  readonly name: string;
  private readonly framesPerStep = new Map<string, number>();
  private totalFrames = 0;

  constructor(
    readonly scenario: ScenarioName,
    private readonly steps: readonly EngineStep[],
  ) {
    this.name = `scripted:${scenario}`;
  }

  async check(request: VisionCheckRequest): Promise<FrameResult> {
    const current = request.currentStep.id;
    const n = (this.framesPerStep.get(current) ?? 0) + 1;
    this.framesPerStep.set(current, n);
    this.totalFrames += 1;

    const step = this.steps.find((s) => s.id === current);
    const next = request.upcomingSteps[0]?.id ?? null;
    const see = (id: string | null, confidence = 0.92, issue?: IssueCode): FrameResult => ({
      observedStepId: id,
      confidence,
      handsVisible: issue !== "hands_not_visible",
      ...(issue ? { issue } : {}),
    });

    switch (this.scenario) {
      case "happy":
        return see(current);
      case "flicker": {
        const pick = FLICKER[(n - 1) % FLICKER.length];
        return pick === "current"
          ? see(current)
          : pick === "next"
            ? see(next, 0.75)
            : see(null, 0.3);
      }
      case "poor-camera":
        if (n <= 2) return see(null, 0.2, "too_dark");
        if (n === 3) return see(null, 0.3, "hands_not_visible");
        return see(current);
      case "skip-critical": {
        const firstCritical = this.steps.find((s) => s.critical);
        return step && step.id === firstCritical?.id && next ? see(next) : see(current);
      }
      case "early-release":
        // Hold for 3 frames to start the hold, 2 more, then show the next step.
        return step?.timerSeconds !== undefined && n > 5 && next ? see(next) : see(current);
      case "outage":
        if (this.totalFrames > 6) throw new VisionError("timeout");
        return see(current);
    }
  }
}
