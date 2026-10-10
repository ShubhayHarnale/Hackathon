import "server-only";
import { getGeminiClient } from "@/gemini/client";
import { geminiModels } from "@/gemini/models";
import { serverEnv } from "@/lib/env";
import { createGeminiVisionProvider } from "./gemini";
import { alwaysCurrentVisionProvider } from "./mock";
import { TokenBucketLimiter } from "./rate-limit";
import type { VisionProvider } from "./types";

/** The provider selected by VISION_PROVIDER. Server-only. */
export function getVisionProvider(): VisionProvider {
  if (serverEnv().VISION_PROVIDER === "gemini") {
    const client = getGeminiClient();
    if (client) return createGeminiVisionProvider({ client, model: geminiModels().vision });
  }
  return alwaysCurrentVisionProvider;
}

const globalForLimiter = globalThis as unknown as { __witnessVisionLimiter?: TokenBucketLimiter };

/** ~1 frame/sec per session with a small burst. Per-instance (see roadmap). */
export function visionRateLimiter(): TokenBucketLimiter {
  globalForLimiter.__witnessVisionLimiter ??= new TokenBucketLimiter(4, 2);
  return globalForLimiter.__witnessVisionLimiter;
}
