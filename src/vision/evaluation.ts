import { EngineRunner, isTerminal, type EngineEvent, type FrameResult } from "@/engine";
import type { Protocol } from "@/protocol/schema";
import { frameContext } from "./context";
import { toFrameErrorKind } from "./errors";
import type { VisionProvider } from "./types";

export interface RecordingFrame {
  readonly file: string;
  readonly atMs: number;
  /** Human annotation used only for scoring, never to construct the model prompt. */
  readonly observedStepId: string;
  /** Explicit participant button actions; never inferred from the ground truth. */
  readonly commands?: readonly ({ type: "done"; stepId: string } | { type: "pause" | "resume" })[];
}

export interface EvaluationRow {
  readonly file: string;
  readonly atMs: number;
  readonly expectedStepId: string | null;
  readonly label: string;
  readonly predicted: string | null;
  readonly result?: FrameResult;
  readonly error?: string;
  readonly latencyMs?: number;
  readonly status: "checked" | "error" | "paused" | "terminal";
}

/** Offline engine replay: labels never select prompt context. Annotated timestamps
 * supply procedure time; this does not reproduce browser playback or wall-clock latency. */
export async function evaluateRecording(options: {
  protocol: Protocol;
  frames: readonly RecordingFrame[];
  provider: VisionProvider;
  readImage: (file: string) => Promise<string>;
}) {
  const { protocol, frames, provider, readImage } = options;
  const ids = new Set(protocol.steps.map((s) => s.id));
  let previousAt = -1;
  for (const frame of frames) {
    if (!Number.isFinite(frame.atMs) || frame.atMs < 0 || frame.atMs <= previousAt)
      throw new Error(`${frame.file}: timestamps must be nonnegative and strictly increasing`);
    if (frame.observedStepId !== "none" && !ids.has(frame.observedStepId))
      throw new Error(`${frame.file}: unknown label ${frame.observedStepId}`);
    for (const command of frame.commands ?? [])
      if (command.type === "done" && !ids.has(command.stepId))
        throw new Error(`${frame.file}: unknown confirmation step ${command.stepId}`);
    previousAt = frame.atMs;
  }
  const runner = new EngineRunner({ steps: protocol.steps });
  const events: EngineEvent[] = [];
  const dispatch = (input: Parameters<EngineRunner["dispatch"]>[0]) =>
    events.push(...runner.dispatch(input));
  dispatch({ type: "start", at: 0 });
  const byId = new Map(protocol.steps.map((s) => [s.id, s]));
  const rows: EvaluationRow[] = [];
  let correct = 0,
    attempted = 0,
    errors = 0,
    onCurrent = 0,
    onCurrentCorrect = 0,
    falseLater = 0;
  for (const [index, frame] of frames.entries()) {
    const at = frame.atMs;
    for (const command of frame.commands ?? []) {
      if (command.type === "done")
        dispatch({ type: "verbal_confirm", stepId: command.stepId, method: "tap", at });
      else dispatch({ type: command.type, source: "button", at });
    }
    dispatch({ type: "tick", at });
    const context = frameContext(runner.state, byId);
    const base = { file: frame.file, atMs: at, label: frame.observedStepId };
    if (isTerminal(runner.state) || !context || runner.state.status === "paused") {
      rows.push({
        ...base,
        expectedStepId: context?.currentStep.id ?? null,
        predicted: null,
        status: runner.state.status === "paused" ? "paused" : "terminal",
      });
      continue;
    }
    attempted++;
    const expectedStepId = context.currentStep.id;
    const labelIsCurrent = frame.observedStepId === expectedStepId;
    if (labelIsCurrent) onCurrent++;
    const started = performance.now();
    try {
      const result = await provider.check({
        sessionId: "recording-eval",
        seq: index + 1,
        capturedAt: at,
        image: { mimeType: "image/jpeg", base64: await readImage(frame.file) },
        ...context,
      });
      const predicted =
        result.confidence >= runner.config.minConfidence
          ? (result.observedStepId ?? "none")
          : "none";
      if (predicted === frame.observedStepId) correct++;
      if (labelIsCurrent && predicted === frame.observedStepId) onCurrentCorrect++;
      if (labelIsCurrent && context.upcomingSteps.some((s) => s.id === predicted)) falseLater++;
      rows.push({
        ...base,
        expectedStepId,
        predicted,
        result,
        status: "checked",
        latencyMs: performance.now() - started,
      });
      dispatch({ type: "frame", at, capturedAt: at, seq: index + 1, result });
    } catch (error) {
      errors++;
      rows.push({
        ...base,
        expectedStepId,
        predicted: null,
        status: "error",
        error: toFrameErrorKind(error),
        latencyMs: performance.now() - started,
      });
      dispatch({ type: "frame_error", at, seq: index + 1, kind: toFrameErrorKind(error) });
    }
  }
  const latency = rows
    .flatMap((r) => (r.latencyMs === undefined ? [] : [r.latencyMs]))
    .sort((a, b) => a - b);
  const ratio = (n: number, d: number) => (d ? n / d : null);
  const percentile = (q: number) =>
    latency.length ? latency[Math.max(0, Math.ceil(q * latency.length) - 1)]! : null;
  return {
    protocolId: protocol.id,
    provider: provider.name,
    totalFrames: frames.length,
    attemptedFrames: attempted,
    errors,
    accuracy: ratio(correct, attempted),
    currentStepRecall: ratio(onCurrentCorrect, onCurrent),
    falseLaterRate: ratio(falseLater, onCurrent),
    latencyP50Ms: percentile(0.5),
    latencyP95Ms: percentile(0.95),
    outcome: runner.state.status,
    stopReason: runner.state.stopReason,
    steps: runner.state.run?.progress.map((p) => ({ stepId: p.stepId, status: p.status })) ?? [],
    rows,
    events,
  };
}
