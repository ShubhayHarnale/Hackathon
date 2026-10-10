import { z } from "zod";
import { getRepository } from "@/persistence/server";
import { EventsBodySchema } from "@/patient/schema";
import { processEscalations } from "@/escalation/policy";
import { getNotifier } from "@/escalation/server";

/**
 * Appends engine events for the session behind the link token. Idempotent on eventSeq,
 * so the client can retry freely. Also moves the session's status, start and end times
 * and stop reason along with the events.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/patient/[token]/events">) {
  const { token } = await ctx.params;
  const repo = getRepository();
  const session = await repo.getSessionByToken(token);
  if (!session) return Response.json({ error: "not_found" }, { status: 404 });

  const body = EventsBodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json(
      { error: "bad_request", detail: z.prettifyError(body.error) },
      { status: 400 },
    );
  }

  await repo.appendEvents(session.id, body.data.events);
  // Revisit the canonical log on retries, including alerts whose delivery failed.
  await processEscalations(
    repo,
    getNotifier(),
    session,
    (await repo.listEvents(session.id)).map((e) => e.event),
  );
  return Response.json({ ok: true, accepted: body.data.events.length });
}
