import { afterEach, describe, expect, it, vi } from "vitest";
import { COORDINATOR_COOKIE, coordinatorCookieValue } from "@/lib/coordinator-auth";
import { POST } from "./route";

const passcode = "synthetic-coordinator-passcode";
vi.mock("@/lib/env", () => ({
  serverEnv: () => ({ COORDINATOR_PASSCODE: "synthetic-coordinator-passcode" }),
}));

const post = (code: string, next: string) =>
  POST(
    new Request("https://internal-deploy--witness.netlify.app/api/session-login", {
      method: "POST",
      body: new URLSearchParams({ passcode: code, next }),
    }),
  );

describe("coordinator sign-in behind a hosting proxy", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("keeps a successful redirect on the browser origin with a secure host-only cookie", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await post(passcode, "/coordinator/vision-lab");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/coordinator/vision-lab");
    expect(res.cookies.get(COORDINATOR_COOKIE)?.value).toBe(await coordinatorCookieValue(passcode));
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).not.toContain("Domain=");
  });

  it("keeps a failed sign-in on the browser origin and preserves its next path", async () => {
    const res = await post("incorrect", "/coordinator/vision-lab");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      "/coordinator-login?next=%2Fcoordinator%2Fvision-lab&error=1",
    );
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("does not redirect to an external destination supplied in the form", async () => {
    const res = await post(passcode, "https://untrusted.example/path");
    expect(res.headers.get("location")).toBe("/coordinator");
  });
});
