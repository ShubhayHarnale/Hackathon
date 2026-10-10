import type { LintWarning } from "./compiler";
import type { Protocol } from "./schema";

/**
 * Review warnings for the coordinator. Non-blocking: the study team decides. The app
 * itself never gives dosing advice, so any dose or amount language in a step is
 * highlighted for a human to check before publishing.
 */

const DOSING_PATTERNS: readonly RegExp[] = [
  /\b\d+(\.\d+)?\s?(mg|mcg|µg|g|ml|mL|cc|units?|iu|IU|puffs?|tablets?|drops?)\b/i,
  /\b(dose|dosage|dosing|double up|extra dose|missed dose|overdose)\b/i,
  /\b(increase|decrease|adjust|reduce)\b.*\b(amount|medication|insulin|dose)\b/i,
];

const MULTI_ACTION = /\b(and then|then|after that|afterwards)\b|;/i;
const LONG_INSTRUCTION_CHARS = 120;

export function lintProtocol(protocol: Protocol): LintWarning[] {
  const warnings: LintWarning[] = [];

  for (const step of protocol.steps) {
    const text = `${step.instruction} ${step.spokenPrompt}`;
    if (DOSING_PATTERNS.some((re) => re.test(text))) {
      warnings.push({
        stepId: step.id,
        code: "dosing_language",
        message: `Step ${step.order} mentions a dose or amount. The app never gives dosing advice; confirm this wording with the study team.`,
      });
    }
    if (MULTI_ACTION.test(step.instruction)) {
      warnings.push({
        stepId: step.id,
        code: "multiple_actions",
        message: `Step ${step.order} may contain more than one action. One action per step is easier to follow and to verify.`,
      });
    }
    if (step.instruction.length > LONG_INSTRUCTION_CHARS) {
      warnings.push({
        stepId: step.id,
        code: "long_instruction",
        message: `Step ${step.order}'s on-screen text is long. Keep it short; put detail in the spoken prompt.`,
      });
    }
  }

  if (!protocol.steps.some((s) => s.critical)) {
    warnings.push({
      stepId: null,
      code: "no_critical_steps",
      message:
        "No step is marked critical, so a skipped step will be flagged but never stop the procedure.",
    });
  }
  return warnings;
}
