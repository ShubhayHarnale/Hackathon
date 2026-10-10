import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const run = (env: Record<string, string>) =>
  spawnSync(process.execPath, ["scripts/check-deploy.mjs"], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, NODE_ENV: "test", ...env },
  });
const configured = {
  PERSISTENCE: "supabase",
  SUPABASE_URL: "https://synthetic.supabase.co",
  SUPABASE_SECRET_KEY: "synthetic-secret-not-a-real-key",
  COORDINATOR_PASSCODE: "synthetic-long-passcode",
};
describe("hosted deployment configuration guard", () => {
  it("blocks missing hosted persistence without printing credential values", () => {
    const result = run({});
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("PERSISTENCE must be supabase");
    expect(result.stderr).toContain("SUPABASE_SECRET_KEY is missing");
  });
  it("accepts a configured mock demo", () => {
    const result = run(configured);
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).not.toContain(configured.SUPABASE_SECRET_KEY);
    expect(result.stdout + result.stderr).not.toContain(configured.COORDINATOR_PASSCODE);
  });
  it("requires a Gemini key when any Gemini provider is enabled", () => {
    expect(run({ ...configured, VISION_PROVIDER: "gemini" }).status).toBe(1);
    expect(run({ ...configured, NEXT_PUBLIC_VOICE_PROVIDER: "gemini-live" }).status).toBe(1);
    expect(
      run({ ...configured, VISION_PROVIDER: "gemini", GEMINI_API_KEY: "synthetic-key" }).status,
    ).toBe(0);
  });
  it("blocks an insecure URL and a short coordinator passcode", () => {
    const result = run({
      ...configured,
      SUPABASE_URL: "http://synthetic.supabase.co",
      COORDINATOR_PASSCODE: "short",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("HTTPS");
    expect(result.stderr).toContain("at least 16 characters");
  });
});
