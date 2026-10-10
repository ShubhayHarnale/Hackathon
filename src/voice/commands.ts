import type { VoiceCommand } from "./types";

/**
 * Maps a speech transcript to one of the five patient commands, or null.
 *
 * Safety rules (the parser errs toward stopping, never toward advancing):
 * - "hold" never means pause. A step says "press and hold", and a patient repeating
 *   that instruction must not freeze the hold timer. So "hold on" is ignored too.
 * - A bare "stop" means **pause**. Pause is reversible (only an explicit "continue"
 *   resumes) and freezes every timer, which is what someone saying "stop" wants.
 *   Ignoring it would be worse, and ending the session is never a voice command.
 * - Commands that move the procedure forward (`continue`, `done`) are strict: short
 *   utterances only, no negation anywhere ("I'm not done"), no hedges ("almost done"),
 *   and not phrased as a question ("am I done", "should I continue").
 * - Commands that stop or slow things (`call_nurse`, `pause`, `repeat`) are lenient:
 *   they match anywhere in the sentence and are only cancelled by a negation right
 *   before them ("don't stop", "I don't need help").
 * - When a sentence holds more than one command, the most cautious wins:
 *   call_nurse > pause > repeat > continue > done.
 */

interface Rule {
  readonly command: VoiceCommand;
  /** Matched as whole words anywhere in the utterance. */
  readonly phrases: readonly string[];
  /** Matched only when they are the entire utterance. */
  readonly whole?: readonly string[];
  /** Advancing commands get the strict checks described above. */
  readonly advances: boolean;
}

/** In priority order: the first rule that matches wins. */
const RULES: readonly Rule[] = [
  {
    command: "call_nurse",
    phrases: [
      "call my nurse",
      "call the nurse",
      "call a nurse",
      "call nurse",
      "get my nurse",
      "nurse",
      "help",
    ],
    advances: false,
  },
  {
    command: "pause",
    phrases: [
      "pause",
      "wait",
      "stop for a moment",
      "stop",
      "hang on",
      "one moment",
      "just a moment",
      "one second",
      "just a second",
      "give me a moment",
      "give me a minute",
    ],
    advances: false,
  },
  {
    command: "repeat",
    phrases: [
      "repeat",
      "say that again",
      "say it again",
      "say again",
      "pardon",
      "come again",
      "what was that",
      "what did you say",
    ],
    whole: ["what", "sorry what", "what what", "huh", "sorry"],
    advances: false,
  },
  {
    command: "continue",
    phrases: ["continue", "resume", "go on", "im ready", "i am ready", "carry on", "keep going"],
    whole: ["ready", "ok ready", "okay ready"],
    advances: true,
  },
  {
    command: "done",
    phrases: ["done", "finished", "checked", "i did it", "ive done it", "i have done it"],
    whole: ["yes", "yes yes", "yes i have", "yes i did", "yes please", "yeah", "yep"],
    advances: true,
  },
];

/** Longest utterance (in words) that may trigger `continue` or `done`. */
const MAX_ADVANCE_WORDS = 6;

/** Any of these anywhere in the utterance blocks an advancing command. */
const NEGATIONS = new Set([
  "not",
  "no",
  "nope",
  "dont",
  "never",
  "cant",
  "cannot",
  "wont",
  "didnt",
  "havent",
  "hasnt",
  "isnt",
  "arent",
  "aint",
  "yet",
]);

/** Hedges and conditions that make an advancing phrase not a statement of fact. */
const HEDGES = new Set([
  "almost",
  "nearly",
  "soon",
  "when",
  "until",
  "after",
  "before",
  "if",
  "once",
  "maybe",
  "probably",
  "think",
  "should",
]);

const QUESTION_STARTS = new Set([
  "should",
  "shall",
  "can",
  "could",
  "do",
  "does",
  "did",
  "is",
  "am",
  "are",
  "may",
  "will",
  "what",
  "when",
  "how",
  "why",
  "have",
]);

/**
 * A negation directly before a lenient command cancels it: "don't stop",
 * "do not call the nurse", "I don't need help", "no need to pause". A bare "no" does
 * not ("no, wait!" is a pause).
 */
const DIRECT_NEGATION =
  /(?:^| )(?:(?:not|dont|never|cant|wont|didnt|shouldnt)(?: (?:need|want|have))?|no need)(?: (?:to|a|any|the|my|for))?$/;

export function normalizeTranscript(transcript: string): string {
  return transcript
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function parseCommand(transcript: string): VoiceCommand | null {
  const text = normalizeTranscript(transcript);
  if (text === "") return null;
  const words = text.split(" ");
  const isQuestion = transcript.includes("?") || QUESTION_STARTS.has(words[0] ?? "");

  for (const rule of RULES) {
    if (rule.whole?.includes(text) && !(rule.advances && transcript.includes("?"))) {
      return rule.command;
    }
    if (rule.advances) {
      if (words.length > MAX_ADVANCE_WORDS || isQuestion) continue;
      if (words.some((w) => NEGATIONS.has(w) || HEDGES.has(w))) continue;
    }
    if (matches(rule, words)) return rule.command;
  }
  return null;
}

function matches(rule: Rule, words: readonly string[]): boolean {
  // Longest phrases first, so "nurse" inside a negated "don't call the nurse" is
  // recognised as part of that negated phrase rather than matching on its own.
  const phrases = [...rule.phrases].sort((a, b) => b.length - a.length);
  const negated: Array<readonly [number, number]> = [];
  for (const phrase of phrases) {
    const parts = phrase.split(" ");
    for (const at of occurrences(words, parts)) {
      const end = at + parts.length;
      if (negated.some(([s, e]) => at >= s && end <= e)) continue;
      if (!rule.advances && DIRECT_NEGATION.test(words.slice(0, at).join(" "))) {
        negated.push([at, end]);
        continue;
      }
      return true;
    }
  }
  return false;
}

/** Start indexes of every whole-word occurrence of `phrase` in `words`. */
function occurrences(words: readonly string[], phrase: readonly string[]): number[] {
  const found: number[] = [];
  outer: for (let i = 0; i + phrase.length <= words.length; i++) {
    for (let j = 0; j < phrase.length; j++) {
      if (words[i + j] !== phrase[j]) continue outer;
    }
    found.push(i);
  }
  return found;
}
