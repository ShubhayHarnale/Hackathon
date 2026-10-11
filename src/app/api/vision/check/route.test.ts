import { afterEach, describe, expect, it, vi } from "vitest";
import { getRepository } from "@/persistence/server";
import { POST } from "./route";

const body = (sessionId: string) => ({
  sessionId,
  seq: 1,
  capturedAt: 0,
  image: { mimeType: "image/jpeg", base64: "AAAA" },
  currentStep: { id: "wash-hands", instruction: "Wash", successCriteria: "Hands washing" },
  upcomingSteps: [],
});

const post = (payload: unknown) =>
  POST(
    new Request("http://test/api/vision/check", { method: "POST", body: JSON.stringify(payload) }),
  );

describe("POST /api/vision/check (mock provider)", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("returns a frame result", async () => {
    const res = await post(body("route-ok"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ observedStepId: "wash-hands" });
  });

  it("rejects malformed requests", async () => {
    const res = await post({ sessionId: "x" });
    expect(res.status).toBe(400);
  });

  it("authorizes the hands-only camera practice and rejects unrelated pen practice", async () => {
    vi.stubEnv("COORDINATOR_PASSCODE", "readiness-passcode");
    const created = await getRepository().createSession({
      participantId: "p-001",
      protocolId: "hands-only",
      mode: "live",
    });
    const check = (id: string) =>
      POST(
        new Request("http://test/api/vision/check", {
          method: "POST",
          headers: { authorization: `Bearer ${created.token}` },
          body: JSON.stringify({
            ...body(created.session.id),
            currentStep: { id, instruction: "untrusted", successCriteria: "untrusted" },
          }),
        }),
      );
    expect((await check("practice-show-one-hand")).status).toBe(200);
    expect((await check("practice-show-pen")).status).toBe(400);
    expect((await check("show-open-hands")).status).toBe(200);
  });

  it("rate-limits a session that sends too fast", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) statuses.push((await post(body("route-burst"))).status);
    expect(statuses).toContain(429);
    expect(statuses[0]).toBe(200);
  });

  it("requires credentials on a hosted configuration, binds tokens to sessions, and rejects unknown step context", async () => {
    vi.stubEnv("COORDINATOR_PASSCODE", "readiness-passcode");
    expect((await post(body("unauthorized"))).status).toBe(401);
    const created = await getRepository().createSession({
      participantId: "p-001",
      protocolId: "mock-autoinjector",
      mode: "replay",
    });
    const authenticated = (payload: unknown) =>
      POST(
        new Request("http://test/api/vision/check", {
          method: "POST",
          headers: { authorization: `Bearer ${created.token}` },
          body: JSON.stringify(payload),
        }),
      );
    expect((await authenticated(body("different-session"))).status).toBe(401);
    expect((await authenticated(body(created.session.id))).status).toBe(200);
    expect(
      (
        await authenticated({
          ...body(created.session.id),
          currentStep: { id: "invented", instruction: "invented", successCriteria: "invented" },
        })
      ).status,
    ).toBe(400);
  });
});
