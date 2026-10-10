import { describe, expect, it } from "vitest";
import { normalizeTranscript, parseCommand } from "./commands";
import type { VoiceCommand } from "./types";

function expectAll(command: VoiceCommand | null, transcripts: readonly string[]) {
  for (const t of transcripts) {
    expect(parseCommand(t), JSON.stringify(t)).toBe(command);
  }
}

describe("normalizeTranscript", () => {
  it("lowercases, drops apostrophes and punctuation, collapses spaces", () => {
    expect(normalizeTranscript("  I’m READY!!  ")).toBe("im ready");
    expect(normalizeTranscript("Don't   stop.")).toBe("dont stop");
    expect(normalizeTranscript("What?")).toBe("what");
  });
});

describe("parseCommand: synonyms", () => {
  it("pause", () => {
    expectAll("pause", [
      "pause",
      "Pause.",
      "wait",
      "Wait, wait",
      "stop for a moment",
      "please pause",
      "hang on",
      "one moment please",
      "give me a minute",
      "no, wait!",
    ]);
  });

  it("continue", () => {
    expectAll("continue", [
      "continue",
      "Resume",
      "go on",
      "I'm ready",
      "I am ready",
      "ready",
      "carry on",
      "okay, continue",
      "let's continue",
    ]);
  });

  it("repeat", () => {
    expectAll("repeat", [
      "repeat",
      "Repeat that please",
      "say that again",
      "could you say that again",
      "what?",
      "What",
      "sorry, what?",
      "pardon",
      "what did you say",
    ]);
  });

  it("call_nurse", () => {
    expectAll("call_nurse", [
      "call my nurse",
      "Call the nurse!",
      "help",
      "Help me",
      "nurse",
      "I need help",
      "please call my nurse now",
      "no no help",
      "I feel dizzy, I need the nurse",
    ]);
  });

  it("done", () => {
    expectAll("done", [
      "done",
      "Done.",
      "I'm done",
      "all done",
      "finished",
      "checked",
      "I did it",
      "yes",
      "Yes.",
      "yes I have",
      "okay done",
    ]);
  });
});

describe("parseCommand: deliberate choices", () => {
  it("a bare 'stop' means pause (reversible), never an end or a nurse call", () => {
    expectAll("pause", ["stop", "Stop!", "stop stop", "please stop"]);
  });

  it("'hold' never means pause: a step says 'press and hold'", () => {
    expectAll(null, ["hold", "hold on", "hold it", "I'm holding it", "press and hold", "holding"]);
  });

  it("the most cautious command wins when several are present", () => {
    expect(parseCommand("wait, I'm done")).toBe("pause");
    expect(parseCommand("stop, call the nurse")).toBe("call_nurse");
    expect(parseCommand("help, what?")).toBe("call_nurse");
    expect(parseCommand("say that again and continue")).toBe("repeat");
  });
});

describe("parseCommand: negatives", () => {
  it("ignores empty, filler and unrelated speech", () => {
    expectAll(null, [
      "",
      "   ",
      "...",
      "um",
      "okay",
      "the weather is nice today",
      "what time is it",
      "I'm reading the label",
      "the pen is blue",
    ]);
  });

  it("does not match inside other words", () => {
    expectAll(null, [
      "that was helpful",
      "it helps",
      "nursery",
      "weight",
      "stopper",
      "pausing music",
      "repeated",
      "readiness",
      "undone",
      "goon",
      "yesterday",
    ]);
  });

  it("never advances on negated, hedged or questioned speech", () => {
    expectAll(null, [
      "I'm not done",
      "not done yet",
      "no, not finished",
      "I haven't finished",
      "not yet",
      "almost done",
      "nearly finished",
      "I think I'm done",
      "am I done?",
      "is it done",
      "done?",
      "yes?",
      "should I continue",
      "can I continue?",
      "I'm not ready",
      "don't continue",
      "never resume",
      "I'll say done when I've finished",
      "I didn't do it",
    ]);
  });

  it("'yes' only confirms as a short answer on its own", () => {
    expectAll(null, [
      "yes the label says something",
      "yes I can see it but",
      "yesterday I was told",
    ]);
  });

  it("never advances on long sentences", () => {
    expectAll(null, [
      "my daughter said she was done with the shopping earlier",
      "I am going to go on holiday next week with my family",
    ]);
  });

  it("respects a negation directly before a cautious command", () => {
    expectAll(null, [
      "don't stop",
      "do not pause",
      "don't call the nurse",
      "do not call my nurse",
      "I don't need help",
      "I don't need any help",
      "no need to pause",
      "don't repeat that",
    ]);
  });

  it("a negated cautious phrase doesn't hide a separate command", () => {
    expect(parseCommand("don't stop, wait")).toBe("pause");
    expect(parseCommand("I don't need help, call the nurse")).toBe("call_nurse");
  });
});
