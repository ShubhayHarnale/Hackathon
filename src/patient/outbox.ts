import type { EngineEvent } from "@/engine";
import { MAX_EVENTS_PER_BATCH } from "./schema";

/**
 * What a send attempt achieved. `retry` keeps the batch queued (network down, server
 * busy); `drop` discards it (the server rejected it for good, e.g. a dead link), so one
 * bad batch can't wedge the queue forever.
 */
export type SendOutcome = "ok" | "retry" | "drop";

export type SendEvents = (events: readonly EngineEvent[]) => Promise<SendOutcome>;

export interface OutboxOptions {
  readonly send: SendEvents;
  /** Debounce before sending, so a burst of events goes as one request. */
  readonly flushDelayMs?: number;
  readonly maxBatch?: number;
  readonly retryBaseMs?: number;
  readonly retryMaxMs?: number;
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

/** Events that matter to the study team right away: send without waiting. */
const URGENT = new Set<EngineEvent["type"]>([
  "critical_miss",
  "needs_human",
  "stopped",
  "completed",
  "nurse_called",
]);

/** Exponential backoff with a ceiling: base, 2x base, 4x base ... max. */
export function retryDelay(attempt: number, baseMs: number, maxMs: number): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
}

/**
 * Batches engine events and posts them in order, retrying with backoff. Never throws and
 * never blocks the caller: the UI pushes and moves on. One request in flight at a time;
 * the server is idempotent on eventSeq, so a retry after a lost response is harmless.
 */
export class EventOutbox {
  private readonly queue: EngineEvent[] = [];
  private readonly seen = new Set<number>();
  private inFlight = false;
  private timer: unknown = null;
  private failures = 0;
  private disposed = false;
  private readonly opts: Required<Omit<OutboxOptions, "send">> & { send: SendEvents };

  constructor(options: OutboxOptions) {
    this.opts = {
      flushDelayMs: 300,
      maxBatch: MAX_EVENTS_PER_BATCH,
      retryBaseMs: 1_000,
      retryMaxMs: 15_000,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      ...options,
    };
  }

  /** Events waiting to be confirmed by the server. */
  get pending(): number {
    return this.queue.length;
  }

  /** Consecutive failed sends (0 when the last send succeeded). */
  get failureCount(): number {
    return this.failures;
  }

  /** The unsent events, oldest first (for a last-chance beacon on page hide). */
  peek(): readonly EngineEvent[] {
    return [...this.queue];
  }

  push(events: readonly EngineEvent[]): void {
    if (this.disposed) return;
    let urgent = false;
    for (const e of events) {
      if (this.seen.has(e.eventSeq)) continue;
      this.seen.add(e.eventSeq);
      this.queue.push(e);
      urgent ||= URGENT.has(e.type);
    }
    if (this.queue.length === 0) return;
    // While backing off, keep waiting unless something urgent arrived.
    if (this.failures > 0 && !urgent) return;
    this.schedule(urgent ? 0 : this.opts.flushDelayMs);
  }

  /** Sends now (e.g. when the browser comes back online). */
  flushSoon(): void {
    if (this.queue.length > 0) this.schedule(0);
  }

  /** Sends everything queued, one batch at a time. Resolves when done or on failure. */
  async flush(): Promise<void> {
    this.cancelTimer();
    if (this.inFlight || this.disposed) return;
    while (this.queue.length > 0 && !this.disposed) {
      const batch = this.queue.slice(0, this.opts.maxBatch);
      this.inFlight = true;
      let outcome: SendOutcome;
      try {
        outcome = await this.opts.send(batch);
      } catch {
        outcome = "retry";
      } finally {
        this.inFlight = false;
      }
      if (outcome === "retry") {
        this.failures += 1;
        this.schedule(retryDelay(this.failures, this.opts.retryBaseMs, this.opts.retryMaxMs));
        return;
      }
      this.failures = 0;
      this.queue.splice(0, batch.length);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimer();
  }

  private schedule(ms: number): void {
    if (this.disposed) return;
    this.cancelTimer();
    this.timer = this.opts.setTimer(() => {
      this.timer = null;
      void this.flush();
    }, ms);
  }

  private cancelTimer(): void {
    if (this.timer !== null) this.opts.clearTimer(this.timer);
    this.timer = null;
  }
}

/** Maps an HTTP status to what the outbox should do with the batch. */
export function outcomeForStatus(status: number): SendOutcome {
  if (status >= 200 && status < 300) return "ok";
  if (status === 408 || status === 429 || status >= 500) return "retry";
  return "drop";
}

/** Posts a batch to the patient events route. Network failures are retried. */
export function httpSendEvents(token: string, fetchImpl: typeof fetch = fetch): SendEvents {
  return async (events) => {
    try {
      const res = await fetchImpl(`/api/patient/${encodeURIComponent(token)}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ events }),
        keepalive: true,
      });
      return outcomeForStatus(res.status);
    } catch {
      return "retry";
    }
  };
}
