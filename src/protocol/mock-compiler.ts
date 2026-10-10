import type { CompileInput, CompileResult, ProtocolCompiler } from "./compiler";
import { lintProtocol } from "./lint";
import { normalizeProtocol } from "./normalize";
import { ProtocolSchema, type Verification } from "./schema";

/**
 * Keyless compiler: one step per numbered or bulleted line, with simple heuristics.
 * Good enough to demo the review flow offline; the Gemini compiler writes far better
 * spoken prompts and success criteria.
 *
 * Markers understood in the text: "(critical)" / "[critical]", "N seconds|minutes".
 */

const LIST_ITEM = /^\s*(?:\d+[.)]|[-*•])\s+(.*)$/;
const CRITICAL = /\(critical\)|\[critical\]|\bcritical\b:?/i;
const VERBAL = /\b(aloud|out loud|say|tell|read)\b/i;
const CHECK = /\b(check|confirm|make sure|verify)\b/i;
const DURATION = /\b(\d+)\s*(seconds?|secs?|minutes?|mins?)\b/i;

function verificationFor(text: string): Verification {
  if (VERBAL.test(text)) return CHECK.test(text) ? "visual+verbal" : "verbal";
  if (CHECK.test(text)) return "visual+verbal";
  return "visual";
}

export function mockCompile(input: CompileInput): CompileResult {
  const lines = input.text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const items = lines.map((l) => LIST_ITEM.exec(l)?.[1]).filter((x): x is string => !!x);
  const stepLines = items.length > 0 ? items : lines;
  if (stepLines.length === 0) return { ok: false, error: "Paste the procedure text first." };

  const steps = stepLines.map((line, i) => {
    const instruction = line.replace(CRITICAL, "").replace(/\s+/g, " ").trim().replace(/[.:]$/, "");
    const duration = DURATION.exec(line);
    const seconds = duration
      ? Number(duration[1]) * (duration[2]?.toLowerCase().startsWith("min") ? 60 : 1)
      : undefined;
    return {
      order: i + 1,
      instruction,
      spokenPrompt: `${instruction}.`,
      successCriteria: `The camera shows the person doing this: ${instruction.toLowerCase()}.`,
      critical: CRITICAL.test(line),
      verification: verificationFor(line),
      ...(seconds ? { timerSeconds: seconds } : {}),
    };
  });

  const title = input.title?.trim() || "Untitled protocol";
  const result = ProtocolSchema.safeParse(normalizeProtocol({ title, steps }, title));
  if (!result.success) {
    return { ok: false, error: "Couldn't turn this text into steps. Use one step per line." };
  }
  return { ok: true, protocol: result.data, warnings: lintProtocol(result.data) };
}

export const mockProtocolCompiler: ProtocolCompiler = {
  name: "mock",
  compile: async (input) => mockCompile(input),
};
