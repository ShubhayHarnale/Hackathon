import { z } from "zod";
import type { CompileInput, CompileResult } from "./compiler";
import { lintProtocol } from "./lint";
import { normalizeProtocol } from "./normalize";
import { ProtocolSchema } from "./schema";

/**
 * Shared compile pipeline for model-backed compilers:
 *   generate -> JSON.parse -> normalize -> Zod
 *   on failure: one repair round-trip with the validation errors -> normalize -> Zod
 * Output is always a draft for coordinator review.
 */

export interface GenerateRequest {
  readonly input: CompileInput;
  /** Present on the repair attempt: the previous output and why it was rejected. */
  readonly repair?: { readonly previousOutput: string; readonly errors: string } | undefined;
}

export type Generate = (request: GenerateRequest) => Promise<string>;

type Attempt =
  { ok: true; protocol: z.infer<typeof ProtocolSchema> } | { ok: false; errors: string };

function validate(raw: string, input: CompileInput): Attempt {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, errors: "Output was not valid JSON." };
  }
  const result = ProtocolSchema.safeParse(normalizeProtocol(parsed, input.title));
  if (result.success) return { ok: true, protocol: result.data };
  return { ok: false, errors: z.prettifyError(result.error) };
}

export async function runCompilePipeline(
  input: CompileInput,
  generate: Generate,
): Promise<CompileResult> {
  if (!input.text.trim()) return { ok: false, error: "Paste the procedure text first." };

  const first = await generate({ input });
  const attempt = validate(first, input);
  if (attempt.ok) return done(attempt.protocol, input);

  const second = await generate({
    input,
    repair: { previousOutput: first, errors: attempt.errors },
  });
  const retry = validate(second, input);
  if (retry.ok) return done(retry.protocol, input);

  return {
    ok: false,
    error: `The compiled protocol didn't pass validation after one repair attempt:\n${retry.errors}`,
    raw: second,
  };
}

function done(protocol: z.infer<typeof ProtocolSchema>, input: CompileInput): CompileResult {
  const titled = input.title?.trim() ? { ...protocol, title: input.title.trim() } : protocol;
  return { ok: true, protocol: titled, warnings: lintProtocol(titled) };
}
