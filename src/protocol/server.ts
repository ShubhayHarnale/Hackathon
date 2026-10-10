import "server-only";
import { getGeminiClient } from "@/gemini/client";
import { geminiModels } from "@/gemini/models";
import { serverEnv } from "@/lib/env";
import type { ProtocolCompiler } from "./compiler";
import { createGeminiProtocolCompiler } from "./gemini-compiler";
import { mockProtocolCompiler } from "./mock-compiler";

/** The compiler selected by PROTOCOL_COMPILER. Server-only. */
export function getProtocolCompiler(): ProtocolCompiler {
  if (serverEnv().PROTOCOL_COMPILER === "gemini") {
    const client = getGeminiClient();
    if (client) return createGeminiProtocolCompiler({ client, model: geminiModels().compiler });
  }
  return mockProtocolCompiler;
}
