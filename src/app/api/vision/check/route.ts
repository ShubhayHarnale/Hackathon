import { z } from "zod";
import { VisionError } from "@/vision/errors";
import { VisionCheckRequestSchema } from "@/vision/schema";
import { getVisionProvider, visionRateLimiter } from "@/vision/server";

const ERROR_STATUS = { timeout: 504, rate_limited: 429, network: 502, provider: 502 } as const;

/**
 * Checks one camera frame against the current step (and a few ahead). Returns a
 * FrameResult; failures return { error: kind } with a status the client maps back to a
 * frame_error. Frames are not stored here; evidence frames are uploaded separately.
 */
export async function POST(request: Request) {
  const body = VisionCheckRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json(
      { error: "bad_request", detail: z.prettifyError(body.error) },
      { status: 400 },
    );
  }
  if (!visionRateLimiter().take(body.data.sessionId)) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  try {
    const result = await getVisionProvider().check(body.data, { signal: request.signal });
    return Response.json(result);
  } catch (error) {
    const kind = error instanceof VisionError ? error.kind : "provider";
    if (kind === "provider") console.error("[vision] provider error", error);
    return Response.json({ error: kind }, { status: ERROR_STATUS[kind] });
  }
}
