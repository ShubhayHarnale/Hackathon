import { z } from "zod";
import { getRepository } from "@/persistence/server";

const BodySchema = z.object({
  eventSeq: z.number().int().nonnegative(),
  note: z.string().trim().max(500).optional(),
});

/** Marks one flagged event as reviewed by the study team. Idempotent. */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/coordinator/sessions/[id]/flags">,
) {
  const { id } = await ctx.params;
  const body = BodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Send { eventSeq }." }, { status: 400 });

  const repo = getRepository();
  if (!(await repo.getSession(id))) return Response.json({ error: "not_found" }, { status: 404 });
  const events = await repo.listEvents(id);
  if (!events.some((e) => e.event.eventSeq === body.data.eventSeq)) {
    return Response.json({ error: "no such event" }, { status: 404 });
  }
  const review = await repo.markFlagReviewed(id, body.data.eventSeq, body.data.note || null);
  return Response.json({ review });
}
