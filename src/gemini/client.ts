import "server-only";
import { GoogleGenAI } from "@google/genai";
import { serverEnv } from "@/lib/env";

let client: GoogleGenAI | null | undefined;

/**
 * Server-only Gemini client. Returns `null` when no API key is configured so callers
 * fall back to their mock provider.
 *
 * Calls that go through the Interactions API must pass `store: false`: Google stores
 * interactions server-side by default, and nothing from a session should be retained.
 */
export function getGeminiClient(): GoogleGenAI | null {
  if (client !== undefined) return client;
  const apiKey = serverEnv().GEMINI_API_KEY;
  client = apiKey ? new GoogleGenAI({ apiKey }) : null;
  return client;
}
