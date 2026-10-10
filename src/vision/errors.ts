import type { FrameErrorKind } from "@/engine";

/** A failed frame check. The loop turns it into a `frame_error` engine input. */
export class VisionError extends Error {
  constructor(
    readonly kind: FrameErrorKind,
    message?: string,
  ) {
    super(message ?? kind);
    this.name = "VisionError";
  }
}

export function toFrameErrorKind(error: unknown): FrameErrorKind {
  if (error instanceof VisionError) return error.kind;
  if (
    error instanceof DOMException &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  ) {
    return "timeout";
  }
  if (error instanceof TypeError) return "network"; // fetch() network failure
  return "provider";
}
