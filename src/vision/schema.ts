import { z } from "zod";
import { ISSUE_CODES } from "@/engine";

/** ~1.5 MB of base64 is far more than a 640px JPEG at q0.7 (~40-80 KB). */
const MAX_IMAGE_BASE64 = 2_000_000;

export const StepContextSchema = z.object({
  id: z.string().min(1).max(64),
  instruction: z.string().min(1).max(300),
  successCriteria: z.string().min(1).max(600),
});

export const VisionCheckRequestSchema = z.object({
  sessionId: z.string().min(1).max(128),
  seq: z.number().int().nonnegative(),
  capturedAt: z.number(),
  image: z.object({
    mimeType: z.literal("image/jpeg"),
    base64: z.string().min(1).max(MAX_IMAGE_BASE64),
  }),
  currentStep: StepContextSchema,
  upcomingSteps: z.array(StepContextSchema).max(5),
});

export const FrameResultSchema = z.object({
  observedStepId: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  issue: z.enum(ISSUE_CODES).optional(),
  handsVisible: z.boolean().optional(),
});
