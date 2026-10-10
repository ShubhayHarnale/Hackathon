import { afterEach, describe, expect, it, vi } from "vitest";

const create = vi.fn();
vi.mock("@/gemini/client", () => ({
  getGeminiClient: () => (process.env.TEST_NO_CLIENT ? null : { authTokens: { create } }),
}));

async function post(headers: Record<string, string> = {}) {
  const { POST } = await import("./route");
  return POST(new Request("http://test/api/voice/token", { method: "POST", headers }));
}

describe("POST /api/voice/token", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    create.mockReset();
    delete process.env.TEST_NO_CLIENT;
  });

  it("is off unless NEXT_PUBLIC_VOICE_PROVIDER=gemini-live", async () => {
    vi.stubEnv("NEXT_PUBLIC_VOICE_PROVIDER", "browser");
    const res = await post();
    expect(res.status).toBe(404);
    expect(create).not.toHaveBeenCalled();
  });

  it("returns 503 without a Gemini key", async () => {
    vi.stubEnv("NEXT_PUBLIC_VOICE_PROVIDER", "gemini-live");
    process.env.TEST_NO_CLIENT = "1";
    expect((await post()).status).toBe(503);
  });

  it("mints a single-use token locked to the Live model and config", async () => {
    vi.stubEnv("NEXT_PUBLIC_VOICE_PROVIDER", "gemini-live");
    create.mockResolvedValue({ name: "auth_tokens/abc" });
    const res = await post({ "x-forwarded-for": "10.0.0.1" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ token: "auth_tokens/abc", model: "gemini-3.8-live" });
    expect(res.headers.get("cache-control")).toBe("no-store");

    const { config } = create.mock.calls[0]![0];
    expect(config.uses).toBe(1);
    expect(config.liveConnectConstraints.model).toBe("gemini-3.8-live");
    expect(config.liveConnectConstraints.config.tools[0].functionDeclarations).toHaveLength(5);
    const expires = Date.parse(config.expireTime) - Date.now();
    expect(expires).toBeGreaterThan(0);
    expect(expires).toBeLessThanOrEqual(30 * 60_000);
    expect(Date.parse(config.newSessionExpireTime) - Date.now()).toBeLessThanOrEqual(60_000);
  });

  it("rate-limits one client", async () => {
    vi.stubEnv("NEXT_PUBLIC_VOICE_PROVIDER", "gemini-live");
    create.mockResolvedValue({ name: "auth_tokens/x" });
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++)
      statuses.push((await post({ "x-forwarded-for": "10.9.9.9" })).status);
    expect(statuses.slice(0, 4)).toEqual([200, 200, 200, 200]);
    expect(statuses.at(-1)).toBe(429);
  });

  it("maps provider failures to 502", async () => {
    vi.stubEnv("NEXT_PUBLIC_VOICE_PROVIDER", "gemini-live");
    create.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await post({ "x-forwarded-for": "10.1.1.1" })).status).toBe(502);
  });

  it("does not issue a Live token to an anonymous hosted visitor", async () => {
    vi.stubEnv("NEXT_PUBLIC_VOICE_PROVIDER", "gemini-live");
    vi.stubEnv("COORDINATOR_PASSCODE", "readiness-passcode");
    expect((await post()).status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });
});
