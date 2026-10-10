import "server-only";
import type { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import type { FrameResult } from "@/engine";
import { VisionError } from "./errors";
import {
  VISION_SYSTEM_INSTRUCTION,
  buildVisionPrompt,
  parseVisionOutput,
  visionCandidates,
  visionResponseSchema,
} from "./prompt";
import type { VisionCheckRequest, VisionProvider } from "./types";

export interface GeminiVisionOptions {
  readonly client: GoogleGenAI;
  readonly model: string;
  /** Server-side budget per frame. The engine treats a timeout as a frame error. */
  readonly timeoutMs?: number;
}

/**
 * Per-frame step check with Gemini. Low media resolution and minimal thinking keep
 * latency near a second; the engine's 3-frame rule absorbs single misreads.
 */
export function createGeminiVisionProvider(options: GeminiVisionOptions): VisionProvider {
  const { client, model, timeoutMs = 4_000 } = options;
  return {
    name: "gemini",
    async check(
      request: VisionCheckRequest,
      opts?: { signal?: AbortSignal },
    ): Promise<FrameResult> {
      const candidateIds = visionCandidates(request).map((s) => s.id);
      const signal = opts?.signal
        ? AbortSignal.any([opts.signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs);

      let text: string;
      try {
        const response = await client.interactions.create(
          {
            model,
            // Frames are images of a person's body: never retained server-side by Google.
            store: false,
            system_instruction: VISION_SYSTEM_INSTRUCTION,
            input: [
              { type: "text", text: buildVisionPrompt(request) },
              {
                type: "image",
                data: request.image.base64,
                mime_type: request.image.mimeType,
                resolution: "low",
              },
            ],
            response_format: {
              type: "text",
              mime_type: "application/json",
              schema: z.toJSONSchema(visionResponseSchema(candidateIds)),
            },
            generation_config: { temperature: 0, thinking_level: "minimal" },
          },
          { timeout: timeoutMs, maxRetries: 0, fetchOptions: { signal } },
        );
        text = response.output_text ?? "";
      } catch (error) {
        if (signal.aborted) throw new VisionError("timeout");
        const status = (error as { status?: number }).status;
        if (status === 429) throw new VisionError("rate_limited");
        throw new VisionError("provider", error instanceof Error ? error.message : String(error));
      }

      try {
        return parseVisionOutput(text, candidateIds);
      } catch {
        throw new VisionError("provider", "Model returned malformed output");
      }
    },
  };
}
