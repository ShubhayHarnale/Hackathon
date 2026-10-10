import "server-only";
import type { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { CompileInput, CompileResult, ProtocolCompiler } from "./compiler";
import { runCompilePipeline, type GenerateRequest } from "./pipeline";
import { VerificationSchema } from "./schema";

/**
 * What the model is asked to produce. Ids and numbering are fixed up by `normalize`,
 * so the generation schema stays small and free of regex constraints.
 */
const GeneratedProtocolSchema = z.object({
  title: z.string(),
  steps: z.array(
    z.object({
      id: z.string().describe("short kebab-case id, e.g. clean-site"),
      instruction: z.string().describe("on-screen text: one short action, under 12 words"),
      spokenPrompt: z
        .string()
        .describe("what the voice coach says: plain, warm, at most two short sentences"),
      successCriteria: z
        .string()
        .describe("what a phone camera would see when this step is done correctly"),
      critical: z.boolean(),
      verification: VerificationSchema.describe(
        "visual: confirmable from camera frames; verbal: needs the person to say or confirm something; visual+verbal: both",
      ),
      timerSeconds: z
        .number()
        .int()
        .optional()
        .describe("only for steps the text says last a set time (holds or waits)"),
    }),
  ),
});

const RESPONSE_JSON_SCHEMA = z.toJSONSchema(GeneratedProtocolSchema, { io: "input" });

const SYSTEM_INSTRUCTION = `You convert a clinical-trial procedure, written as plain text, into structured steps for an app that coaches a participant through the procedure at home using their phone camera and voice.

Rules:
- One physical action per step, in the order given. Do not add, drop, merge or reorder actions.
- Copy the source's meaning exactly. Never add medical advice, dosing amounts, dose calculations or reassurance that is not in the source.
- spokenPrompt: plain language for an older adult, at most two short sentences.
- successCriteria: describe only what is visible to a camera (hands, objects, positions). If nothing is visible, say so and use verification "verbal".
- critical: true only when the source marks the step as critical/important, or skipping it would make the procedure unsafe (e.g. sterility, holding to deliver the full amount).
- timerSeconds: only when the source states a duration for that step.
A study coordinator reviews and edits your output before anything is shown to a participant.`;

function promptFor(request: GenerateRequest): string {
  const { input, repair } = request;
  const base = `${input.title ? `Protocol title: ${input.title}\n\n` : ""}Procedure text:\n"""\n${input.text}\n"""`;
  if (!repair) return base;
  return `${base}\n\nYour previous output was rejected by validation.\nPrevious output:\n${repair.previousOutput}\n\nValidation errors:\n${repair.errors}\n\nReturn corrected JSON only.`;
}

export interface GeminiCompilerOptions {
  readonly client: GoogleGenAI;
  readonly model: string;
  readonly timeoutMs?: number;
}

export function createGeminiProtocolCompiler(options: GeminiCompilerOptions): ProtocolCompiler {
  const { client, model, timeoutMs = 30_000 } = options;
  return {
    name: "gemini",
    async compile(input: CompileInput, opts?: { signal?: AbortSignal }): Promise<CompileResult> {
      try {
        return await runCompilePipeline(input, async (request) => {
          const response = await client.interactions.create(
            {
              model,
              // Nothing from this app is retained server-side by Google.
              store: false,
              system_instruction: SYSTEM_INSTRUCTION,
              input: promptFor(request),
              response_format: {
                type: "text",
                mime_type: "application/json",
                schema: RESPONSE_JSON_SCHEMA,
              },
              generation_config: { temperature: 0.2 },
            },
            {
              timeout: timeoutMs,
              maxRetries: 1,
              ...(opts?.signal ? { fetchOptions: { signal: opts.signal } } : {}),
            },
          );
          return response.output_text ?? "";
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, error: `Gemini request failed: ${message}` };
      }
    },
  };
}
