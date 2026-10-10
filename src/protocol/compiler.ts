import type { Protocol } from "./schema";

export interface CompileInput {
  readonly title?: string | undefined;
  /** Plain-text procedure instructions pasted by a coordinator. */
  readonly text: string;
}

/** Non-blocking issues shown to the coordinator during review (e.g. dosing language). */
export interface LintWarning {
  readonly stepId: string | null;
  readonly code: "dosing_language" | "multiple_actions" | "no_critical_steps" | "long_instruction";
  readonly message: string;
}

export type CompileResult =
  | { readonly ok: true; readonly protocol: Protocol; readonly warnings: readonly LintWarning[] }
  | { readonly ok: false; readonly error: string; readonly raw?: string | undefined };

/**
 * Turns procedure text into a draft protocol. Output is always a draft: a coordinator
 * reviews and publishes it; compilation never publishes anything.
 */
export interface ProtocolCompiler {
  readonly name: string;
  compile(input: CompileInput, opts?: { signal?: AbortSignal }): Promise<CompileResult>;
}
