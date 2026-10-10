import type { Verification } from "./schema";

/**
 * Deterministic repair of model output before Zod validation. It fixes the mechanical
 * mistakes models make (ids, numbering, casing, stray whitespace, out-of-range timers)
 * but never invents content: missing text stays missing and fails validation.
 */

export function slugify(value: string, fallback: string): string {
  const slug = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug || fallback;
}

const VERIFICATIONS: readonly Verification[] = ["visual", "verbal", "visual+verbal"];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asText(value: unknown): string | undefined {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : undefined;
}

function asBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function normalizeVerification(step: Record<string, unknown>): Verification | undefined {
  const raw = asText(step.verification)?.toLowerCase().replace(/\s+/g, "");
  const match = VERIFICATIONS.find((v) => v === raw);
  if (match) return match;
  if (raw === "visual_verbal" || raw === "both" || raw === "visual-verbal") return "visual+verbal";
  // Legacy shape from the original spec.
  const verbal = asBool(step.requiresVerbalConfirm);
  if (verbal !== undefined) return verbal ? "visual+verbal" : "visual";
  return undefined;
}

function normalizeTimer(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(3600, Math.max(1, Math.round(n)));
}

/** Returns a candidate protocol object for Zod to validate. Never throws. */
export function normalizeProtocol(raw: unknown, fallbackTitle?: string): unknown {
  const root = asRecord(raw);
  if (!root) return raw;

  const title = asText(root.title) || fallbackTitle?.trim() || undefined;
  const rawSteps = Array.isArray(root.steps) ? root.steps : [];
  const ordered = rawSteps
    .map((s, i) => ({ step: asRecord(s), i }))
    .filter((x): x is { step: Record<string, unknown>; i: number } => x.step !== null)
    .sort((a, b) => {
      const ao = typeof a.step.order === "number" ? a.step.order : a.i + 1;
      const bo = typeof b.step.order === "number" ? b.step.order : b.i + 1;
      return ao - bo || a.i - b.i;
    });

  const usedIds = new Set<string>();
  const steps = ordered.map(({ step }, index) => {
    const instruction = asText(step.instruction);
    let id = slugify(asText(step.id) || instruction || "", `step-${index + 1}`);
    for (let n = 2; usedIds.has(id); n++) id = `${id.replace(/-\d+$/, "")}-${n}`;
    usedIds.add(id);

    const timerSeconds = normalizeTimer(step.timerSeconds);
    return {
      id,
      order: index + 1,
      instruction,
      spokenPrompt: asText(step.spokenPrompt) ?? instruction,
      successCriteria: asText(step.successCriteria),
      critical: asBool(step.critical) ?? false,
      verification: normalizeVerification(step),
      ...(timerSeconds !== undefined ? { timerSeconds } : {}),
    };
  });

  return {
    id: slugify(asText(root.id) || title || "", "protocol"),
    title,
    isDemo: asBool(root.isDemo) ?? false,
    steps,
  };
}
