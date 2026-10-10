import { z } from "zod";
import { PRACTICE_STEPS } from "@/demo";
import { providerAccess } from "@/lib/provider-access";
import { getRepository } from "@/persistence/server";
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
  const access = await providerAccess(request, body.data.sessionId);
  if (!access.ok) return Response.json({ error: "unauthorized" }, { status: 401 });
  let checked = body.data;
  if (access.session) {
    const record = await getRepository().getProtocol(
      access.session.protocolId,
      access.session.protocolVersion,
    );
    if (!record) return Response.json({ error: "bad_request" }, { status: 400 });
    const known = new Map([...record.protocol.steps, ...PRACTICE_STEPS].map((s) => [s.id, s]));
    const current = known.get(checked.currentStep.id);
    const upcoming = checked.upcomingSteps.map((s) => known.get(s.id));
    if (!current || upcoming.some((s) => !s))
      return Response.json({ error: "bad_request" }, { status: 400 });
    checked = {
      ...checked,
      currentStep: current,
      upcomingSteps: upcoming.filter((s) => s !== undefined),
    };
  }
  if (
    !visionRateLimiter().take(
      access.session ? access.limiterKey : body.data.sessionId + access.limiterKey,
    )
  ) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  try {
    const result = await getVisionProvider().check(checked, { signal: request.signal });
    return Response.json(result);
  } catch (error) {
    const kind = error instanceof VisionError ? error.kind : "provider";
    if (kind === "provider") console.error("[vision] provider error", error);
    return Response.json({ error: kind }, { status: ERROR_STATUS[kind] });
  }
}
