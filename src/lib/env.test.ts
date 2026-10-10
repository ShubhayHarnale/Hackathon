import { describe, expect, it } from "vitest";
import { parseServerEnv } from "./env";

describe("parseServerEnv", () => {
  it("defaults every provider to its mock with no keys", () => {
    const env = parseServerEnv({});
    expect(env).toMatchObject({
      VISION_PROVIDER: "mock",
      PROTOCOL_COMPILER: "mock",
      PERSISTENCE: "memory",
      NOTIFIER: "mock",
      GEMINI_VISION_MODEL: "gemini-3.8-flash",
    });
    expect(env.GEMINI_API_KEY).toBeUndefined();
  });

  it("treats empty strings as unset", () => {
    expect(parseServerEnv({ GEMINI_API_KEY: "", SUPABASE_URL: "" }).SUPABASE_URL).toBeUndefined();
  });

  it("requires a Gemini key when a Gemini provider is selected", () => {
    expect(() => parseServerEnv({ VISION_PROVIDER: "gemini" })).toThrow(/GEMINI_API_KEY/);
  });

  it("requires Supabase credentials when PERSISTENCE=supabase", () => {
    expect(() => parseServerEnv({ PERSISTENCE: "supabase" })).toThrow(/SUPABASE_URL/);
  });
});
