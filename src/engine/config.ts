import type { EngineConfig } from "./types";

/**
 * Defaults assume ~1 frame/sec. The same 3-frame evidence bar applies to confirming a
 * step and to detecting a skip, so a single misread frame can neither advance nor stop
 * a procedure.
 */
export const DEFAULT_ENGINE_CONFIG: EngineConfig = {
  confirmStreak: 3,
  skipStreak: 3,
  minConfidence: 0.7,
  maxUnmatchedFrames: 25,
  maxAttempts: 3,
  maxStepSeconds: 240,
  holdBreakFrames: 3,
  maxConsecutiveVisionErrors: 5,
  visionOutageMs: 30_000,
};

export function resolveEngineConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  return { ...DEFAULT_ENGINE_CONFIG, ...overrides };
}
