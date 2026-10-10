import "server-only";
import { serverEnv } from "@/lib/env";

/**
 * Gemini model IDs, all overridable via env. Defaults checked against the Gemini API
 * models page (Oct 2026): `gemini-3.8-flash` compiles protocols, `gemini-3.5-flash-lite` checks
 * frames (3.8 Flash measured 7-20s or 503 per frame; Flash-Lite ~0.8s), `gemini-3.8-live` voice.
 */
export function geminiModels() {
  const env = serverEnv();
  return {
    compiler: env.GEMINI_COMPILER_MODEL,
    vision: env.GEMINI_VISION_MODEL,
    live: env.GEMINI_LIVE_MODEL,
  } as const;
}
