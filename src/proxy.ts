import { NextResponse, type NextRequest } from "next/server";
import { COORDINATOR_COOKIE, isCoordinatorAuthorized } from "@/lib/coordinator-auth";

/** Gates the coordinator dashboard and its APIs behind COORDINATOR_PASSCODE (if set). */
export async function proxy(request: NextRequest) {
  const passcode = process.env.COORDINATOR_PASSCODE || undefined;
  const cookie = request.cookies.get(COORDINATOR_COOKIE)?.value;
  if (await isCoordinatorAuthorized(passcode, cookie)) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const login = new URL("/coordinator-login", request.url);
  login.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    "/coordinator/:path*",
    "/coordinator",
    "/api/protocols/:path*",
    "/api/coordinator/:path*",
  ],
};
