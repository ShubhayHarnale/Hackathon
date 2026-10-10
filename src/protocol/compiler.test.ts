import { describe, expect, it, vi } from "vitest";
import type { GoogleGenAI } from "@google/genai";
import { DEMO_PROTOCOLS } from "@/demo";
import { createGeminiProtocolCompiler } from "./gemini-compiler";
import { lintProtocol } from "./lint";
import { mockCompile } from "./mock-compiler";
import { normalizeProtocol, slugify } from "./normalize";
import { runCompilePipeline, type GenerateRequest } from "./pipeline";
import { ProtocolSchema } from "./schema";

const AUTOINJECTOR_TEXT = `1. Wash your hands with soap and water.
2. Read the name on the pen label out loud.
3. Check the expiry date on the label.
4. (critical) Clean the injection site with an alcohol swab.
5. Pull the cap off the pen.
6. Place the pen against your thigh at 90 degrees.
7. (critical) Press and hold the pen down for 10 seconds.
8. Lift the pen away.
9. Put the used pen in the sharps container.`;

describe("normalizeProtocol", () => {
  it("fixes ids, numbering, order, whitespace and timers without inventing content", () => {
    const raw = {
      title: "  My   protocol ",
      steps: [
        {
          order: 2,
          id: "Step Two!",
          instruction: " second ",
          spokenPrompt: "two",
          successCriteria: "x",
          critical: "true",
          verification: "VISUAL",
          timerSeconds: "9999",
        },
        {
          order: 1,
          id: "",
          instruction: "First step",
          successCriteria: "y",
          critical: false,
          requiresVerbalConfirm: true,
        },
        {
          order: 3,
          id: "step-two",
          instruction: "third",
          spokenPrompt: "three",
          successCriteria: "z",
          critical: false,
          verification: "both",
          timerSeconds: -5,
        },
      ],
    };
    const result = ProtocolSchema.safeParse(normalizeProtocol(raw));
    expect(result.success).toBe(true);
    const p = result.data!;
    expect(p.id).toBe("my-protocol");
    expect(p.title).toBe("My protocol");
    expect(p.steps.map((s) => [s.id, s.order])).toEqual([
      ["first-step", 1],
      ["step-two", 2],
      ["step-two-2", 3],
    ]);
    expect(p.steps[0]).toMatchObject({ spokenPrompt: "First step", verification: "visual+verbal" });
    expect(p.steps[1]).toMatchObject({
      critical: true,
      verification: "visual",
      timerSeconds: 3600,
    });
    expect(p.steps[2]?.timerSeconds).toBeUndefined();
  });

  it("leaves missing content missing so validation fails", () => {
    const raw = {
      title: "T",
      steps: [{ instruction: "Do it", critical: false, verification: "visual" }],
    };
    expect(ProtocolSchema.safeParse(normalizeProtocol(raw)).success).toBe(false);
  });

  it("slugifies with a fallback", () => {
    expect(slugify("Clean the Site!", "x")).toBe("clean-the-site");
    expect(slugify("!!!", "fallback")).toBe("fallback");
  });
});

describe("lintProtocol", () => {
  it("flags dosing language, multi-action steps and protocols with no critical step", () => {
    const protocol = ProtocolSchema.parse(
      normalizeProtocol({
        title: "T",
        steps: [
          {
            instruction: "Inject 2 mL",
            spokenPrompt: "Inject 2 mL.",
            successCriteria: "x",
            critical: false,
            verification: "visual",
          },
          {
            instruction: "Open the box and then remove the pen",
            spokenPrompt: "p",
            successCriteria: "x",
            critical: false,
            verification: "visual",
          },
        ],
      }),
    );
    const codes = lintProtocol(protocol).map((w) => w.code);
    expect(codes).toEqual(["dosing_language", "multiple_actions", "no_critical_steps"]);
  });

  it("is quiet for the seeded demo autoinjector", () => {
    const demo = DEMO_PROTOCOLS.find((p) => p.id === "mock-autoinjector")!;
    expect(lintProtocol(demo)).toEqual([]);
  });
});

describe("mockCompile", () => {
  it("turns a numbered list into steps with critical markers, timers and verification", () => {
    const result = mockCompile({ title: "Mock autoinjector", text: AUTOINJECTOR_TEXT });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { steps } = result.protocol;
    expect(steps).toHaveLength(9);
    expect(steps.filter((s) => s.critical).map((s) => s.order)).toEqual([4, 7]);
    expect(steps[6]?.timerSeconds).toBe(10);
    expect(steps[1]?.verification).toBe("verbal");
    expect(steps[2]?.verification).toBe("visual+verbal");
    expect(steps[3]?.instruction).toBe("Clean the injection site with an alcohol swab");
  });

  it("rejects empty text", () => {
    expect(mockCompile({ text: "   " }).ok).toBe(false);
  });
});

describe("runCompilePipeline", () => {
  const good = JSON.stringify({
    title: "Pen",
    steps: [
      {
        id: "a",
        instruction: "Do A",
        spokenPrompt: "Do A.",
        successCriteria: "A visible",
        critical: true,
        verification: "visual",
      },
    ],
  });

  it("returns the validated draft on the first try", async () => {
    const generate = vi.fn(async () => good);
    const result = await runCompilePipeline({ text: "Do A" }, generate);
    expect(result.ok).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("makes exactly one repair attempt, passing the validation errors back", async () => {
    const calls: GenerateRequest[] = [];
    const generate = async (req: GenerateRequest) => {
      calls.push(req);
      return calls.length === 1 ? '{"title":"Pen","steps":[{"instruction":"Do A"}]}' : good;
    };
    const result = await runCompilePipeline({ text: "Do A" }, generate);
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.repair?.errors).toMatch(/steps/);
  });

  it("fails after a second invalid output and returns the raw output for debugging", async () => {
    const generate = vi.fn(async () => "not json");
    const result = await runCompilePipeline({ text: "Do A" }, generate);
    expect(result).toMatchObject({ ok: false, raw: "not json" });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("uses the coordinator's title when given", async () => {
    const result = await runCompilePipeline({ text: "Do A", title: "Study pen" }, async () => good);
    expect(result.ok && result.protocol.title).toBe("Study pen");
  });
});

describe("Gemini compiler", () => {
  it("calls the Interactions API with store:false and a JSON schema, and validates the output", async () => {
    const create = vi.fn(async () => ({
      output_text: JSON.stringify({
        title: "Pen",
        steps: [
          {
            id: "a",
            instruction: "Do A",
            spokenPrompt: "Do A.",
            successCriteria: "A",
            critical: false,
            verification: "visual",
          },
        ],
      }),
    }));
    const client = { interactions: { create } } as unknown as GoogleGenAI;
    const compiler = createGeminiProtocolCompiler({ client, model: "test-model" });
    const result = await compiler.compile({ text: "Do A" });

    expect(result.ok).toBe(true);
    const [params] = create.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(params).toMatchObject({
      model: "test-model",
      store: false,
      response_format: { type: "text", mime_type: "application/json" },
    });
  });

  it("returns an error result instead of throwing when the request fails", async () => {
    const client = {
      interactions: { create: vi.fn(async () => Promise.reject(new Error("boom"))) },
    } as unknown as GoogleGenAI;
    const result = await createGeminiProtocolCompiler({ client, model: "m" }).compile({
      text: "x",
    });
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("boom") });
  });
});
