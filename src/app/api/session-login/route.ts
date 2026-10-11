import { NextResponse } from "next/server";
import { COORDINATOR_COOKIE, coordinatorCookieValue } from "@/lib/coordinator-auth";
import { serverEnv } from "@/lib/env";

/** Coordinator passcode sign-in (form POST). Sets an httpOnly cookie and redirects. */
export async function POST(request: Request) {
  const form = await request.formData();
  const passcode = String(form.get("passcode") ?? "");
  const nextParam = String(form.get("next") ?? "/coordinator");
  // Only allow redirects back into the dashboard.
  const next = nextParam.startsWith("/coordinator") ? nextParam : "/coordinator";

  const expected = serverEnv().COORDINATOR_PASSCODE;
  if (expected && passcode !== expected) {
    const query = new URLSearchParams({ next, error: "1" });
    return new NextResponse(null, {
      status: 303,
      headers: { Location: `/coordinator-login?${query}` },
    });
  }

  // Netlify can expose an internal deploy hostname in request.url. A relative redirect
  // keeps the browser on its public origin, where this host-only cookie was set.
  const response = new NextResponse(null, { status: 303, headers: { Location: next } });
  if (expected) {
    response.cookies.set(COORDINATOR_COOKIE, await coordinatorCookieValue(expected), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 12,
    });
  }
  return response;
}
