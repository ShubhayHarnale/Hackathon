import type { Millis, StepId } from "@/engine";
import type { Utterance } from "./types";

/** An utterance plus the bookkeeping the queue needs. */
export interface QueuedUtterance extends Utterance {
  /**
   * The step this line belongs to. When the step changes, anything still queued for
   * another step is dropped, and a line for another step that's playing is cut off.
   * Leave unset for lines that stay valid across steps ("Good.", stop messages).
   */
  readonly stepId?: StepId | undefined;
  /** Drop the line if it would start playing more than this long after it was queued. */
  readonly maxWaitMs?: number | undefined;
}

export interface SpeechQueueOptions {
  /** Plays one utterance; resolves when it has finished or been cancelled. */
  readonly speak: (utterance: Utterance) => Promise<void>;
  /** Stops whatever is playing now. */
  readonly cancel: () => void;
  readonly now: () => Millis;
  /** The same key isn't spoken again within this window. Default 6000 ms. */
  readonly cooldownMs?: number;
  /** Called as each utterance starts playing. */
  readonly onStart?: (utterance: QueuedUtterance) => void;
}

export type EnqueueResult = "playing" | "queued" | "cooldown" | "duplicate" | "stale" | "disposed";

export interface EnqueueOptions {
  /** Skip the cooldown (an explicit "repeat"). Still never queues the same key twice. */
  readonly force?: boolean;
}

interface Entry {
  readonly utterance: QueuedUtterance;
  readonly queuedAt: Millis;
}

export const DEFAULT_SPEECH_COOLDOWN_MS = 6000;

/**
 * Plays app-authored lines one at a time.
 *
 * - `urgent` lines (stop messages) cut off whatever is playing and clear the queue.
 * - The same key is not repeated within the cooldown, and never queued twice.
 * - At most one correction waits at a time: a newer one replaces it.
 * - `setStep` drops lines that belong to a step that is no longer current.
 *
 * Pure logic: the clock and the speaker are injected.
 */
export class SpeechQueue {
  private readonly cooldownMs: number;
  private readonly pending: Entry[] = [];
  private playing: QueuedUtterance | null = null;
  /** Bumped whenever playback is cut off, so a late-settling `speak` is ignored. */
  private generation = 0;
  private readonly lastStarted = new Map<string, Millis>();
  private currentStep: StepId | null = null;
  private disposed = false;

  constructor(private readonly options: SpeechQueueOptions) {
    this.cooldownMs = options.cooldownMs ?? DEFAULT_SPEECH_COOLDOWN_MS;
  }

  get current(): QueuedUtterance | null {
    return this.playing;
  }

  get queued(): readonly QueuedUtterance[] {
    return this.pending.map((e) => e.utterance);
  }

  get isSpeaking(): boolean {
    return this.playing !== null;
  }

  enqueue(utterance: QueuedUtterance, options: EnqueueOptions = {}): EnqueueResult {
    if (this.disposed) return "disposed";
    const { key } = utterance;
    if (this.pending.some((e) => e.utterance.key === key)) return "duplicate";
    if (!options.force) {
      if (this.playing?.key === key) return "duplicate";
      const last = this.lastStarted.get(key);
      if (last !== undefined && this.options.now() - last < this.cooldownMs) return "cooldown";
    }
    if (utterance.stepId !== undefined && this.currentStep !== null) {
      // Lines for a step that's already over are stale before they start.
      if (utterance.stepId !== this.currentStep) return "stale";
    }

    const entry: Entry = { utterance, queuedAt: this.options.now() };
    if (utterance.priority === "urgent") {
      this.cutOff();
      this.pending.length = 0;
      this.pending.push(entry);
    } else if (utterance.priority === "correction") {
      const i = this.pending.findIndex((e) => e.utterance.priority === "correction");
      if (i >= 0) this.pending.splice(i, 1, entry);
      else this.pending.push(entry);
    } else {
      this.pending.push(entry);
    }
    this.pump();
    return this.playing === utterance ? "playing" : "queued";
  }

  /**
   * The engine moved to a new step: drop queued lines for other steps, and cut off a
   * playing line that belongs to another step.
   */
  setStep(stepId: StepId | null): void {
    this.currentStep = stepId;
    const isStale = (u: QueuedUtterance) => u.stepId !== undefined && u.stepId !== stepId;
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const entry = this.pending[i];
      if (entry && isStale(entry.utterance)) this.pending.splice(i, 1);
    }
    if (this.playing && isStale(this.playing)) {
      this.cutOff();
      this.pump();
    }
  }

  /** Stop speaking now and forget everything queued. Cooldowns are kept. */
  interrupt(): void {
    this.pending.length = 0;
    this.cutOff();
  }

  dispose(): void {
    this.interrupt();
    this.disposed = true;
  }

  private cutOff(): void {
    if (!this.playing) return;
    this.playing = null;
    this.generation += 1;
    this.options.cancel();
  }

  private pump(): void {
    if (this.playing || this.disposed) return;
    const now = this.options.now();
    let entry = this.pending.shift();
    while (entry && isExpired(entry, now)) entry = this.pending.shift();
    if (!entry) return;

    const { utterance } = entry;
    const generation = this.generation;
    this.playing = utterance;
    this.lastStarted.set(utterance.key, now);
    this.options.onStart?.(utterance);

    let settled: Promise<void>;
    try {
      settled = this.options.speak(utterance);
    } catch {
      settled = Promise.resolve();
    }
    void settled
      .catch(() => undefined)
      .then(() => {
        if (generation !== this.generation || this.playing !== utterance) return;
        this.playing = null;
        this.pump();
      });
  }
}

function isExpired(entry: Entry, now: Millis): boolean {
  const { maxWaitMs } = entry.utterance;
  return maxWaitMs !== undefined && now - entry.queuedAt > maxWaitMs;
}
