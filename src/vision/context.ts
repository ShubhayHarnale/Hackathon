import { isTerminal, type EngineState } from "@/engine";
import type { Step } from "@/protocol/schema";
import { DEFAULT_LOOKAHEAD, type StepContext } from "./types";

export interface FrameContext {
  readonly currentStep: StepContext;
  readonly upcomingSteps: readonly StepContext[];
}

function toContext(step: Step): StepContext {
  return { id: step.id, instruction: step.instruction, successCriteria: step.successCriteria };
}

/**
 * What to ask the vision model about right now: the current step plus a lookahead
 * window (so skips are visible). Null when there's nothing to check (idle or finished).
 */
export function frameContext(
  state: EngineState,
  stepsById: ReadonlyMap<string, Step>,
  lookahead = DEFAULT_LOOKAHEAD,
): FrameContext | null {
  const run = state.run;
  if (!run || isTerminal(state)) return null;
  const pick = (i: number) => {
    const id = run.steps[i]?.id;
    const step = id ? stepsById.get(id) : undefined;
    return step ? toContext(step) : null;
  };
  const currentStep = pick(run.index);
  if (!currentStep) return null;
  const upcomingSteps: StepContext[] = [];
  for (let i = run.index + 1; i <= run.index + lookahead; i++) {
    const s = pick(i);
    if (s) upcomingSteps.push(s);
  }
  return { currentStep, upcomingSteps };
}
