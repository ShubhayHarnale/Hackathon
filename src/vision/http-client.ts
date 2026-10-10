import type { FrameErrorKind, FrameResult } from "@/engine";
import { VisionError, toFrameErrorKind } from "./errors";
import { FrameResultSchema } from "./schema";
import type { VisionCheckRequest, VisionProvider } from "./types";

export interface HttpVisionOptions {
  readonly endpoint?: string;
  /** Client-side budget per frame (the server has its own, shorter one). */
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

const STATUS_KIND: Record<number, FrameErrorKind> = { 429: "rate_limited", 504: "timeout" };

/** Browser-side VisionProvider that calls our API route (which holds the Gemini key). */
export function createHttpVisionProvider(options: HttpVisionOptions = {}): VisionProvider {
  const { endpoint = "/api/vision/check", timeoutMs = 6_000, fetchImpl = fetch } = options;
  return {
    name: "http",
    async check(
      request: VisionCheckRequest,
      opts?: { signal?: AbortSignal },
    ): Promise<FrameResult> {
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = opts?.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
      let res: Response;
      try {
        res = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
          signal,
        });
      } catch (error) {
        throw new VisionError(timeout.aborted ? "timeout" : toFrameErrorKind(error));
      }
      if (!res.ok)
        throw new VisionError(STATUS_KIND[res.status] ?? "provider", `HTTP ${res.status}`);
      const body = FrameResultSchema.safeParse(await res.json().catch(() => null));
      if (!body.success) throw new VisionError("provider", "Malformed vision response");
      return body.data;
    },
  };
}
