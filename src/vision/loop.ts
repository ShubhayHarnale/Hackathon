import type { EngineInput, FrameResult } from "@/engine";
import type { CapturedFrame } from "./capture";
import { FrameBuffer } from "./capture";
import type { FrameContext } from "./context";
import { toFrameErrorKind } from "./errors";
import type { VisionProvider } from "./types";

export interface VisionLoopDeps {
  readonly provider: VisionProvider;
  readonly sessionId: string;
  /** Grabs a frame from the video. Null = no frame available (skipped, not an error). */
  readonly capture: () => Promise<Omit<CapturedFrame, "seq" | "capturedAt"> | null>;
  /** What to ask about now. Null = nothing to check (idle / finished). */
  readonly getContext: () => FrameContext | null;
  /** Feeds the result into the engine. */
  readonly dispatch: (input: EngineInput) => void;
  readonly now?: () => number;
  readonly intervalMs?: number;
  /** Observability hook (vision lab, logging). */
  readonly onResult?: (info: {
    seq: number;
    latencyMs: number;
    result?: FrameResult;
    error?: string;
  }) => void;
}

/**
 * Captures ~1 frame/sec and checks it. Single-flight: if the previous check is still
 * running, the tick is skipped rather than queued, so slow responses never pile up.
 * Every attempt gets a monotonically increasing seq; the engine drops stale results.
 */
export class VisionLoop {
  readonly frames = new FrameBuffer(8);
  private seq = 0;
  private inFlight = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: VisionLoopDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  get running(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.deps.intervalMs ?? 1_000);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One capture-and-check cycle. Returns false if skipped. Exposed for tests. */
  async tick(): Promise<boolean> {
    if (this.inFlight) return false;
    const context = this.deps.getContext();
    if (!context) return false;

    this.inFlight = true;
    try {
      const capturedAt = this.now();
      const image = await this.deps.capture();
      if (!image) {
        this.deps.dispatch({
          type: "frame_error",
          at: this.now(),
          seq: ++this.seq,
          kind: "provider",
        });
        return false;
      }
      const seq = ++this.seq;
      this.frames.push({ ...image, seq, capturedAt });

      const startedAt = this.now();
      try {
        const result = await this.deps.provider.check({
          sessionId: this.deps.sessionId,
          seq,
          capturedAt,
          image: { mimeType: "image/jpeg", base64: image.base64 },
          currentStep: context.currentStep,
          upcomingSteps: context.upcomingSteps,
        });
        this.deps.onResult?.({ seq, latencyMs: this.now() - startedAt, result });
        this.deps.dispatch({ type: "frame", at: this.now(), seq, capturedAt, result });
      } catch (error) {
        const kind = toFrameErrorKind(error);
        this.deps.onResult?.({ seq, latencyMs: this.now() - startedAt, error: kind });
        this.deps.dispatch({ type: "frame_error", at: this.now(), seq, kind });
      }
      return true;
    } catch {
      this.deps.dispatch({
        type: "frame_error",
        at: this.now(),
        seq: ++this.seq,
        kind: "provider",
      });
      return false;
    } finally {
      this.inFlight = false;
    }
  }
}
