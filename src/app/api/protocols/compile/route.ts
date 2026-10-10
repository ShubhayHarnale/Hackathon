import { z } from "zod";
import { getProtocolCompiler } from "@/protocol/server";

const BodySchema = z.object({
  title: z.string().max(120).optional(),
  text: z.string().min(1).max(20_000),
});

/** Compiles pasted procedure text into a draft protocol. Never saves or publishes. */
export async function POST(request: Request) {
  const body = BodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json(
      { ok: false, error: "Send { text } with the procedure text." },
      { status: 400 },
    );
  }
  const compiler = getProtocolCompiler();
  const result = await compiler.compile(body.data, { signal: request.signal });
  return Response.json({ ...result, compiler: compiler.name }, { status: result.ok ? 200 : 422 });
}
