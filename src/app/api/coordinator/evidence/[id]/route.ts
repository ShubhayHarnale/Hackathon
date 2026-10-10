import { getMemoryRepository } from "@/persistence/server";

/**
 * Serves an evidence frame from the in-memory repository (Supabase uses short-lived
 * signed URLs instead). Gated by the coordinator proxy; never cached.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/coordinator/evidence/[id]">) {
  const { id } = await ctx.params;
  const bytes = getMemoryRepository()?.getEvidenceBytes(id);
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store" },
  });
}
