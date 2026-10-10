/**
 * Per-key token bucket. In-memory, so it limits per server instance; a production
 * deployment needs a shared store (see PRODUCTION_ROADMAP). Clock is injected for tests.
 */
export class TokenBucketLimiter {
  private readonly buckets = new Map<string, { tokens: number; updatedAt: number }>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly now: () => number = () => Date.now(),
    private readonly maxKeys = 10_000,
  ) {}

  /** Takes one token for `key`. Returns false when the caller should be throttled. */
  take(key: string): boolean {
    const t = this.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, updatedAt: t };
    const refill = ((t - bucket.updatedAt) / 1000) * this.refillPerSecond;
    bucket.tokens = Math.min(this.capacity, bucket.tokens + refill);
    bucket.updatedAt = t;

    if (!this.buckets.has(key) && this.buckets.size >= this.maxKeys) {
      const oldest = this.buckets.keys().next().value;
      if (oldest !== undefined) this.buckets.delete(oldest);
    }
    this.buckets.set(key, bucket);

    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }
}
