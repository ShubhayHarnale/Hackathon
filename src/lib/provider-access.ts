import { NextRequest } from "next/server";
import { getRepository } from "@/persistence/server";
import type { SessionRecord } from "@/persistence/types";
import { COORDINATOR_COOKIE, isCoordinatorAuthorized } from "./coordinator-auth";

/** Patient link tokens authorize only their session; the signed-in coordinator can
 * use the lab. An unset passcode preserves the existing open local-demo behavior. */
export async function providerAccess(
  request: Request,
  sessionId?: string,
): Promise<{ ok: true; session: SessionRecord | null; limiterKey: string } | { ok: false }> {
  const authorization = request.headers.get("authorization");
  if (authorization !== null) {
    const token = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(authorization)?.[1];
    if (!token) return { ok: false };
    const session = await getRepository().getSessionByToken(token);
    if (
      !session ||
      (sessionId && session.id !== sessionId) ||
      ["completed", "stopped"].includes(session.status)
    )
      return { ok: false };
    return { ok: true, session, limiterKey: `session:${session.id}` };
  }
  const cookie = new NextRequest(request.url, { headers: request.headers }).cookies.get(
    COORDINATOR_COOKIE,
  )?.value;
  if (!(await isCoordinatorAuthorized(process.env.COORDINATOR_PASSCODE || undefined, cookie)))
    return { ok: false };
  const caller = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  return { ok: true, session: null, limiterKey: `coordinator:${caller}` };
}
