import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ProtocolSchema, requiresVerbalConfirm, type Protocol } from "./schema";

const valid: Protocol = {
  id: "demo-pen",
  title: "Demo pen",
  isDemo: true,
  steps: [
    {
      id: "wash-hands",
      order: 1,
      instruction: "Wash your hands",
      spokenPrompt: "Please wash your hands.",
      successCriteria: "Hands being washed under running water",
      critical: false,
      verification: "visual",
      timerSeconds: 20,
    },
    {
      id: "read-label",
      order: 2,
      instruction: "Read the pen label aloud",
      spokenPrompt: "Read the label on the pen out loud.",
      successCriteria: "Pen label facing the camera",
      critical: false,
      verification: "verbal",
    },
  ],
};

describe("ProtocolSchema", () => {
  it("accepts a valid protocol", () => {
    expect(ProtocolSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects duplicate step ids and out-of-order steps", () => {
    const [first] = valid.steps;
    const bad = { ...valid, steps: [first, { ...first, order: 3 }] };
    const result = ProtocolSchema.safeParse(bad);
    expect(result.success).toBe(false);
    const messages = result.error?.issues.map((i) => i.message) ?? [];
    expect(messages).toContain("duplicate step id");
    expect(messages.some((m) => m.startsWith("steps must be ordered"))).toBe(true);
  });

  it("rejects ids that aren't slugs", () => {
    const bad = { ...valid, id: "Demo Pen" };
    expect(ProtocolSchema.safeParse(bad).success).toBe(false);
  });

  it("derives requiresVerbalConfirm from verification", () => {
    expect(requiresVerbalConfirm({ verification: "visual" })).toBe(false);
    expect(requiresVerbalConfirm({ verification: "verbal" })).toBe(true);
    expect(requiresVerbalConfirm({ verification: "visual+verbal" })).toBe(true);
  });

  it("converts to JSON Schema for Gemini structured output", () => {
    const json = z.toJSONSchema(ProtocolSchema, { io: "input" });
    expect(json).toMatchObject({ type: "object" });
  });
});
