import { z } from "zod";
import { getRepository } from "@/persistence/server";
import { EvidenceBodySchema } from "@/patient/schema";

/** Decodes base64 and checks it is a JPEG (starts with the FF D8 FF marker). */
function decodeJpeg(base64: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null;
  const bytes = Uint8Array.from(Buffer.from(base64, "base64"));
  const isJpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return isJpeg ? bytes : null;
}

/**
 * Stores the frame that confirmed a step (or showed a critical miss) for the session
 * behind the link token. Saving the same step and frame twice is a no-op.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/patient/[token]/evidence">) {
  const { token } = await ctx.params;
  const repo = getRepository();
  const session = await repo.getSessionByToken(token);
  if (!session) return Response.json({ error: "not_found" }, { status: 404 });

  const body = EvidenceBodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json(
      { error: "bad_request", detail: z.prettifyError(body.error) },
      { status: 400 },
    );
  }
  const { stepId, evidenceSeq, capturedAt, jpegBase64, visionResult } = body.data;
  const jpeg = decodeJpeg(jpegBase64);
  if (!jpeg) return Response.json({ error: "not_a_jpeg" }, { status: 400 });

  const existing = (await repo.listEvidenceFrames(session.id)).find(
    (f) => f.stepId === stepId && f.seq === evidenceSeq,
  );
  if (existing) return Response.json({ ok: true, id: existing.id });

  const record = await repo.saveEvidenceFrame(
    { sessionId: session.id, stepId, seq: evidenceSeq, capturedAt, visionResult },
    jpeg,
  );
  return Response.json({ ok: true, id: record.id });
}
