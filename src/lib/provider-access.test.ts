import { afterEach, describe, expect, it, vi } from "vitest";
import { getRepository } from "@/persistence/server";
import { coordinatorCookieValue } from "./coordinator-auth";
import { providerAccess } from "./provider-access";

const request = (headers: Record<string, string> = {}) =>
  new Request("http://test/api/vision/check", { headers });
const session = () =>
  getRepository().createSession({
    participantId: "p-001",
    protocolId: "mock-autoinjector",
    mode: "replay",
  });
describe("provider authorization", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("blocks anonymous access when the coordinator passcode is configured", async () => {
    vi.stubEnv("COORDINATOR_PASSCODE", "readiness-passcode");
    expect(await providerAccess(request())).toEqual({ ok: false });
  });
  it("accepts a valid coordinator cookie and rejects a wrong one", async () => {
    vi.stubEnv("COORDINATOR_PASSCODE", "readiness-passcode");
    const value = await coordinatorCookieValue("readiness-passcode");
    expect((await providerAccess(request({ cookie: `witness_coordinator=${value}` }))).ok).toBe(
      true,
    );
    expect((await providerAccess(request({ cookie: "witness_coordinator=wrong" }))).ok).toBe(false);
  });
  it("preserves the keyless open local lab with no passcode", async () => {
    vi.stubEnv("COORDINATOR_PASSCODE", "");
    expect((await providerAccess(request())).ok).toBe(true);
  });
  it("authorizes only the session belonging to the link token", async () => {
    vi.stubEnv("COORDINATOR_PASSCODE", "readiness-passcode");
    const created = await session();
    const req = request({ authorization: `Bearer ${created.token}` });
    expect(await providerAccess(req, created.session.id)).toMatchObject({
      ok: true,
      session: { id: created.session.id },
      limiterKey: `session:${created.session.id}`,
    });
    expect(await providerAccess(req, "other-session")).toEqual({ ok: false });
  });
  it("invalid credentials never fall back to the open local coordinator", async () => {
    vi.stubEnv("COORDINATOR_PASSCODE", "");
    expect(await providerAccess(request({ authorization: "Bearer short" }))).toEqual({ ok: false });
    expect(await providerAccess(request({ authorization: `Bearer ${"x".repeat(40)}` }))).toEqual({
      ok: false,
    });
  });
  for (const status of ["completed", "stopped"] as const) {
    it(`does not authorize a ${status} patient session`, async () => {
      const created = await session();
      await getRepository().updateSession(created.session.id, { status });
      expect(await providerAccess(request({ authorization: `Bearer ${created.token}` }))).toEqual({
        ok: false,
      });
    });
  }
});
