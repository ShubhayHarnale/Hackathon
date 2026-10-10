import type { FrameResult, Millis, StepId } from "@/engine";

/** What the vision model is told about a step. */
export interface StepContext {
  readonly id: StepId;
  readonly instruction: string;
  readonly successCriteria: string;
}

export interface VisionCheckRequest {
  readonly sessionId: string;
  readonly seq: number;
  readonly capturedAt: Millis;
  readonly image: { readonly mimeType: "image/jpeg"; readonly base64: string };
  readonly currentStep: StepContext;
  /**
   * The next few steps (lookahead window). Lets the model report a skip, which the
   * engine turns into a critical miss when a critical step is jumped over.
   */
  readonly upcomingSteps: readonly StepContext[];
}

/**
 * Classifies one camera frame against the current step and the steps after it.
 * Implementations: Gemini (server-side, via the API route) and scripted mocks.
 */
export interface VisionProvider {
  readonly name: string;
  check(request: VisionCheckRequest, opts?: { signal?: AbortSignal }): Promise<FrameResult>;
}

export const DEFAULT_LOOKAHEAD = 3;
