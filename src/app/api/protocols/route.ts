import { z } from "zod";
import { getRepository } from "@/persistence/server";
import { lintProtocol } from "@/protocol/lint";
import { ProtocolSchema } from "@/protocol/schema";

const BodySchema = z.object({
  protocol: ProtocolSchema,
  sourceText: z.string().max(20_000).nullable().default(null),
});

/** Saves a reviewed protocol as a draft (a new version if the latest is published). */
export async function POST(request: Request) {
  const body = BodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return Response.json({ error: z.prettifyError(body.error) }, { status: 400 });
  }
  const record = await getRepository().saveProtocolDraft(body.data.protocol, body.data.sourceText);
  return Response.json({ record, warnings: lintProtocol(record.protocol) });
}
