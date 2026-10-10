import { describe, expect, it } from "vitest";
import {
  LIVE_FUNCTIONS,
  LiveCommandGate,
  commandForFunction,
  floatToPcm16Base64,
  liveConnectConfig,
} from "./gemini-live-config";
import type { VoiceCommand } from "./types";

function gate() {
  const got: [VoiceCommand, string][] = [];
  const g = new LiveCommandGate((c, t) => got.push([c, t]));
  return { g, got };
}

describe("Live config", () => {
  it("declares exactly one function per command, with no parameters", () => {
    const config = liveConnectConfig();
    const tools = config.tools as { functionDeclarations: { name: string }[] }[];
    const names = tools[0]!.functionDeclarations.map((f) => f.name);
    expect(names.sort()).toEqual(Object.values(LIVE_FUNCTIONS).sort());
    expect(config.inputAudioTranscription).toEqual({});
    expect(config.temperature).toBe(0);
    expect(String(config.systemInstruction)).toMatch(/never answer/i);
  });

  it("maps function names back to commands", () => {
    for (const [command, name] of Object.entries(LIVE_FUNCTIONS)) {
      expect(commandForFunction(name)).toBe(command);
    }
    expect(commandForFunction("give_dose")).toBeNull();
    expect(commandForFunction(undefined)).toBeNull();
  });
});

describe("LiveCommandGate", () => {
  it("accepts cautious commands straight from the model", () => {
    const { g, got } = gate();
    g.onTranscription("I feel a bit");
    expect(g.onFunctionCall("call_study_nurse")).toBe(true);
    expect(g.onFunctionCall("pause_procedure")).toBe(true);
    expect(got).toEqual([
      ["call_nurse", "I feel a bit"],
      ["pause", "I feel a bit"],
    ]);
  });

  it("accepts an advancing command only when the transcript agrees", () => {
    const { g, got } = gate();
    g.onTranscription("I'm done");
    expect(g.onFunctionCall("confirm_step_done")).toBe(true);
    expect(got).toEqual([["done", "I'm done"]]);
  });

  it("holds an advancing call until the transcript arrives", () => {
    const { g, got } = gate();
    expect(g.onFunctionCall("confirm_step_done")).toBe(false);
    expect(got).toEqual([]);
    g.onTranscription(" finished");
    expect(got).toEqual([["done", "finished"]]);
  });

  it("drops an advancing call the transcript contradicts", () => {
    const { g, got } = gate();
    g.onTranscription("I'm not done yet");
    expect(g.onFunctionCall("confirm_step_done")).toBe(false);
    g.onTranscription(" sorry");
    g.onTurnComplete();
    expect(got).toEqual([]);
  });

  it("drops a held call at the end of the turn", () => {
    const { g, got } = gate();
    g.onFunctionCall("continue_procedure");
    expect(g.onTurnComplete()).toBe("");
    g.onTranscription("continue");
    expect(got).toEqual([]);
  });

  it("falls back to the app's parser when the model calls nothing", () => {
    const { g, got } = gate();
    g.onTranscription("say that again");
    expect(g.onTurnComplete()).toBe("say that again");
    expect(got).toEqual([["repeat", "say that again"]]);
  });

  it("doesn't double-fire when the model already called a function", () => {
    const { g, got } = gate();
    g.onTranscription("wait");
    g.onFunctionCall("pause_procedure");
    g.onTurnComplete();
    expect(got).toEqual([["pause", "wait"]]);
  });

  it("ignores unknown functions", () => {
    const { g, got } = gate();
    expect(g.onFunctionCall("increase_dose")).toBe(false);
    g.onTurnComplete();
    expect(got).toEqual([]);
  });
});

describe("floatToPcm16Base64", () => {
  it("encodes little-endian 16-bit PCM and clamps", () => {
    const b64 = floatToPcm16Base64(new Float32Array([0, 1, -1, 2, -2]));
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    const samples = [0, 1, 2, 3, 4].map((i) => view.getInt16(i * 2, true));
    expect(samples).toEqual([0, 32767, -32768, 32767, -32768]);
  });
});
