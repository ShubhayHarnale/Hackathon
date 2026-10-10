import { z } from "zod";
import type { EngineStep } from "@/engine";

/**
 * Compiled protocol schema. Gemini structured output is generated from this schema
 * (`z.toJSONSchema`) and every compiled protocol is re-validated with it.
 *
 * Deviation from the original spec: `verification` replaces `requiresVerbalConfirm`
 * because some steps ("read the label aloud") can't be confirmed from camera frames at
 * all. `requiresVerbalConfirm(step)` derives the old flag.
 */

export const StepIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase letters, digits and dashes")
  .max(64);

export const VerificationSchema = z.enum(["visual", "verbal", "visual+verbal"]);

export const StepSchema = z.object({
  id: StepIdSchema,
  order: z.number().int().positive(),
  /** Short on-screen instruction, one action. */
  instruction: z.string().trim().min(1).max(200),
  /** What the voice coach says. Plain language, no dosing advice. */
  spokenPrompt: z.string().trim().min(1).max(400),
  /** Visual description of what a correct frame looks like (fed to the vision model). */
  successCriteria: z.string().trim().min(1).max(500),
  critical: z.boolean(),
  verification: VerificationSchema,
  timerSeconds: z.number().int().positive().max(3600).optional(),
});

export const ProtocolSchema = z
  .object({
    id: StepIdSchema,
    title: z.string().trim().min(1).max(120),
    /** Shown on every patient screen for demo protocols. */
    isDemo: z.boolean(),
    steps: z.array(StepSchema).min(1).max(30),
  })
  .superRefine((protocol, ctx) => {
    const seen = new Set<string>();
    protocol.steps.forEach((step, i) => {
      if (seen.has(step.id)) {
        ctx.addIssue({ code: "custom", path: ["steps", i, "id"], message: "duplicate step id" });
      }
      seen.add(step.id);
      if (step.order !== i + 1) {
        ctx.addIssue({
          code: "custom",
          path: ["steps", i, "order"],
          message: `steps must be ordered 1..n; expected ${i + 1}`,
        });
      }
    });
  });

export type Verification = z.infer<typeof VerificationSchema>;
export type Step = z.infer<typeof StepSchema>;
export type Protocol = z.infer<typeof ProtocolSchema>;

export function requiresVerbalConfirm(step: Pick<Step, "verification">): boolean {
  return step.verification !== "visual";
}

/** Compile-time check that a protocol step can be fed straight to the engine. */
export function toEngineSteps(protocol: Protocol): readonly EngineStep[] {
  return protocol.steps;
}
