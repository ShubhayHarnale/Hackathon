import { publicEnv } from "@/lib/env";
import { createBrowserVoiceProvider } from "./browser";
import { createGeminiLiveVoiceProvider, type GeminiLiveVoiceOptions } from "./gemini-live";
import type { VoiceProvider } from "./types";

/**
 * The voice provider selected by NEXT_PUBLIC_VOICE_PROVIDER (default: browser speech).
 * Call in the browser (an effect or a click handler); during SSR it returns a silent
 * provider.
 */
export function createVoiceProvider(
  kind: "browser" | "gemini-live" = publicEnv.NEXT_PUBLIC_VOICE_PROVIDER,
  options: GeminiLiveVoiceOptions = {},
): VoiceProvider {
  return kind === "gemini-live"
    ? createGeminiLiveVoiceProvider(options)
    : createBrowserVoiceProvider(options);
}
