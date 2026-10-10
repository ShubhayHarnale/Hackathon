import { z } from "zod";
import { ISSUE_CODES, type FrameResult } from "@/engine";
import type { StepContext, VisionCheckRequest } from "./types";

/**
 * Prompt and structured-output schema for one frame check. The model only classifies:
 * it picks one of the offered step ids (or "none") and an issue code from a fixed list.
 * It never writes text that reaches the patient.
 */

export const VISION_SYSTEM_INSTRUCTION = `You check single frames from a phone camera while a person performs a step-by-step procedure at home.

For each frame, decide which ONE of the listed steps the frame shows the person doing right now.
- Choose only from the listed step ids, or "none" if the frame shows none of them or you are unsure.
- confidence is your probability (0 to 1) that your choice is correct. Use low values when the view is unclear.
- issue: pick the camera problem that most prevents checking the step, or "none".
- handsVisible: whether at least one hand is clearly visible.
Judge only what is visible. Do not guess from what step should come next.`;

const NONE = "none";

export function visionCandidates(
  request: Pick<VisionCheckRequest, "currentStep" | "upcomingSteps">,
): StepContext[] {
  return [request.currentStep, ...request.upcomingSteps];
}

/** JSON schema for the model's answer, with the step ids constrained to the candidates. */
export function visionResponseSchema(candidateIds: readonly string[]) {
  const ids = [NONE, ...candidateIds] as [string, ...string[]];
  return z.object({
    observedStepId: z.enum(ids),
    confidence: z.number().min(0).max(1),
    issue: z.enum([NONE, ...ISSUE_CODES] as [string, ...string[]]),
    handsVisible: z.boolean(),
  });
}

export function buildVisionPrompt(
  request: Pick<VisionCheckRequest, "currentStep" | "upcomingSteps">,
): string {
  const describe = (s: StepContext) =>
    `- id "${s.id}": ${s.instruction}. Looks like: ${s.successCriteria}`;
  const upcoming = request.upcomingSteps.length
    ? `\nLater steps (the person may have skipped ahead):\n${request.upcomingSteps.map(describe).join("\n")}`
    : "";
  return `Expected step right now:\n${describe(request.currentStep)}${upcoming}\n\nWhich step does this frame show?`;
}

/**
 * Parses and sanitises the model's JSON. Unknown ids become null, confidence is clamped,
 * and anything malformed throws (the caller reports it as a provider error).
 */
export function parseVisionOutput(text: string, candidateIds: readonly string[]): FrameResult {
  const parsed: unknown = JSON.parse(text);
  const raw = z
    .object({
      observedStepId: z.string().nullable().optional(),
      confidence: z.number(),
      issue: z.string().nullable().optional(),
      handsVisible: z.boolean().optional(),
    })
    .parse(parsed);

  const id =
    raw.observedStepId && candidateIds.includes(raw.observedStepId) ? raw.observedStepId : null;
  const issue = ISSUE_CODES.find((code) => code === raw.issue);
  return {
    observedStepId: id,
    confidence: clamp01(raw.confidence),
    ...(issue ? { issue } : {}),
    ...(raw.handsVisible !== undefined ? { handsVisible: raw.handsVisible } : {}),
  };
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), 1) : 0;
}
