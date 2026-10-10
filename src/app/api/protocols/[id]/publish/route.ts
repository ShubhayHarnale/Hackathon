import { z } from "zod";
import { getRepository } from "@/persistence/server";

const BodySchema = z.object({ version: z.number().int().positive() });

/** Publishes a draft version. Published versions are immutable; new sessions use them. */
export async function POST(request: Request, ctx: RouteContext<"/api/protocols/[id]/publish">) {
  const { id } = await ctx.params;
  const body = BodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Send { version }." }, { status: 400 });
  try {
    const record = await getRepository().publishProtocol(id, body.data.version);
    return Response.json({ record });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 404 });
  }
}
