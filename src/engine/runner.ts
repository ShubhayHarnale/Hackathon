import { resolveEngineConfig } from "./config";
import { transition } from "./reducer";
import { createEngineState, type EngineState } from "./state";
import type { EngineConfig, EngineEvent, EngineInput, EngineStep } from "./types";

export type EngineListener = (events: readonly EngineEvent[], state: EngineState) => void;

export interface EngineRunnerOptions {
  readonly steps: readonly EngineStep[];
  readonly practiceSteps?: readonly EngineStep[];
  readonly config?: Partial<EngineConfig>;
}

/**
 * Holds the current engine state and fans events out to subscribers (UI, voice, logging).
 * Still I/O-free: callers supply inputs, including the time on each one.
 */
export class EngineRunner {
  readonly config: EngineConfig;
  private current: EngineState;
  private readonly listeners = new Set<EngineListener>();

  constructor(options: EngineRunnerOptions) {
    this.config = resolveEngineConfig(options.config);
    this.current = createEngineState(options.steps, options.practiceSteps);
  }

  get state(): EngineState {
    return this.current;
  }

  dispatch(input: EngineInput): readonly EngineEvent[] {
    const { state, events } = transition(this.current, input, this.config);
    this.current = state;
    if (events.length > 0) {
      for (const listener of this.listeners) listener(events, state);
    }
    return events;
  }

  subscribe(listener: EngineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
