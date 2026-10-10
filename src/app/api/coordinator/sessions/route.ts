import { z } from "zod";
import { CreateSessionBodySchema } from "@/patient/schema";
import { getRepository } from "@/persistence/server";

/**
 * Creates a patient session and returns its link. The raw token exists only in this
 * response (the repository stores its hash), so the link must be sent on from here.
 * Gated by the coordinator proxy.
 */
export async function POST(request: Request) {
  const body = CreateSessionBodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json(
      { error: "bad_request", detail: z.prettifyError(body.error) },
      { status: 400 },
    );
  }
  try {
    const { session, token } = await getRepository().createSession(body.data);
    const link = new URL(`/s/${token}`, request.url).toString();
    return Response.json({ sessionId: session.id, link }, { status: 201 });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 404 });
  }
}

/** Sessions, newest first, with how much of each one's record has arrived. */
export async function GET() {
  const repo = getRepository();
  const sessions = await repo.listSessions();
  const rows = await Promise.all(
    sessions.map(async (session) => ({
      ...session,
      eventCount: (await repo.listEvents(session.id)).length,
      evidenceCount: (await repo.listEvidenceFrames(session.id)).length,
    })),
  );
  return Response.json({ sessions: rows });
}
