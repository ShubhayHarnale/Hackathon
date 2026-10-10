import { z } from "zod";
import { getRepository } from "@/persistence/server";

const Body = z.object({ alertId: z.uuid() });

/** Coordinator proxy gates this route. Scope the alert to the requested session. */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/coordinator/sessions/[id]/alerts">,
) {
  const { id } = await ctx.params;
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Send { alertId }." }, { status: 400 });
  const repo = getRepository();
  const alert = (await repo.listAlerts({ sessionId: id })).find((a) => a.id === body.data.alertId);
  if (!alert) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ alert: await repo.markAlertReviewed(alert.id) });
}
