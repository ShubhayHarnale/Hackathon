import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createBrowserVoiceProvider,
  detectBrowserVoiceSupport,
  mapRecognitionError,
  pickVoice,
  type Recognition,
  type RecognitionErrorEvent,
  type RecognitionResultEvent,
  type SpeechWindow,
  type VoiceLike,
} from "./browser";
import type { VoiceCommand, VoiceErrorKind } from "./types";

const v = (name: string, lang = "en-US", extra: Partial<VoiceLike> = {}): VoiceLike => ({
  name,
  lang,
  localService: false,
  default: false,
  ...extra,
});

describe("pickVoice", () => {
  it("prefers a natural en-US voice", () => {
    const voices = [
      v("Fred"),
      v("Alex"),
      v("Google US English"),
      v("Ava (Premium)"),
      v("Thomas", "fr-FR"),
    ];
    expect(pickVoice(voices)?.name).toBe("Ava (Premium)");
  });

  it("never picks a novelty or non-English voice", () => {
    expect(pickVoice([v("Zarvox"), v("Bad News"), v("Amélie", "fr-CA")])).toBeNull();
  });

  it("falls back to another English accent", () => {
    expect(pickVoice([v("Daniel", "en-GB"), v("Anna", "de-DE")])?.name).toBe("Daniel");
  });

  it("handles underscore language tags and empty lists", () => {
    expect(pickVoice([v("Samantha", "en_US")])?.name).toBe("Samantha");
    expect(pickVoice([])).toBeNull();
  });
});

describe("mapRecognitionError", () => {
  it("maps codes to kinds, and treats silence and aborts as harmless", () => {
    expect(mapRecognitionError("not-allowed")).toBe("permission_denied");
    expect(mapRecognitionError("service-not-allowed")).toBe("permission_denied");
    expect(mapRecognitionError("audio-capture")).toBe("not_supported");
    expect(mapRecognitionError("language-not-supported")).toBe("not_supported");
    expect(mapRecognitionError("network")).toBe("network");
    expect(mapRecognitionError("something-new")).toBe("unknown");
    expect(mapRecognitionError("no-speech")).toBeNull();
    expect(mapRecognitionError("aborted")).toBeNull();
  });
});

// --- A fake browser --------------------------------------------------------------------

class FakeUtterance {
  rate = 1;
  pitch = 1;
  lang = "";
  voice: unknown = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}

class FakeSynth {
  queue: FakeUtterance[] = [];
  paused = false;
  voices: VoiceLike[] = [v("Samantha"), v("Zarvox")];
  speak(u: FakeUtterance) {
    this.queue.push(u);
  }
  cancel() {
    const all = this.queue;
    this.queue = [];
    for (const u of all) u.onerror?.();
  }
  resume() {}
  getVoices() {
    return this.voices;
  }
  /** The first queued utterance finishes. */
  end() {
    const u = this.queue.shift();
    u?.onend?.();
  }
}

class FakeRecognition implements Recognition {
  static instances: FakeRecognition[] = [];
  continuous = false;
  interimResults = true;
  lang = "";
  maxAlternatives = 5;
  onresult: ((event: RecognitionResultEvent) => void) | null = null;
  onerror: ((event: RecognitionErrorEvent) => void) | null = null;
  onend: (() => void) | null = null;
  running = false;
  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {
    this.running = true;
  }
  stop() {
    this.end();
  }
  abort() {
    this.end();
  }
  end() {
    if (!this.running) return;
    this.running = false;
    this.onend?.();
  }
  hear(transcript: string, isFinal = true) {
    this.onresult?.({
      resultIndex: 0,
      results: { length: 1, 0: { isFinal, length: 1, 0: { transcript, confidence: 0.9 } } },
    });
  }
  fail(error: string) {
    this.onerror?.({ error });
  }
}

function fakeWindow(overrides: Partial<SpeechWindow> = {}) {
  const synth = new FakeSynth();
  const win: SpeechWindow = {
    speechSynthesis: synth,
    SpeechSynthesisUtterance: FakeUtterance,
    webkitSpeechRecognition: FakeRecognition,
    isSecureContext: true,
    navigator: {
      userAgent: "Mozilla/5.0 (Macintosh) Chrome/140",
      platform: "MacIntel",
      maxTouchPoints: 0,
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    ...overrides,
  };
  return { win, synth };
}

function listen(provider: ReturnType<typeof createBrowserVoiceProvider>) {
  const commands: VoiceCommand[] = [];
  const transcripts: string[] = [];
  const errors: VoiceErrorKind[] = [];
  provider.startListening({
    onCommand: (c) => commands.push(c),
    onTranscript: (t) => transcripts.push(t),
    onError: (k) => errors.push(k),
  });
  return { commands, transcripts, errors };
}

const rec = () => FakeRecognition.instances.at(-1)!;

describe("detectBrowserVoiceSupport", () => {
  it("is all-false during SSR", () => {
    expect(detectBrowserVoiceSupport(undefined)).toEqual({
      speak: false,
      listen: false,
      ios: false,
    });
  });

  it("detects Chrome-like, Firefox-like and insecure contexts", () => {
    expect(detectBrowserVoiceSupport(fakeWindow().win)).toMatchObject({
      speak: true,
      listen: true,
    });
    const firefox = fakeWindow({ webkitSpeechRecognition: undefined }).win;
    expect(detectBrowserVoiceSupport(firefox)).toMatchObject({ speak: true, listen: false });
    const insecure = fakeWindow({ isSecureContext: false }).win;
    expect(detectBrowserVoiceSupport(insecure)).toMatchObject({ speak: true, listen: false });
  });

  it("detects iOS, including iPadOS reporting as a Mac", () => {
    const iphone = fakeWindow({
      navigator: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0)" },
    });
    expect(detectBrowserVoiceSupport(iphone.win).ios).toBe(true);
    const ipad = fakeWindow({
      navigator: { userAgent: "Macintosh", platform: "MacIntel", maxTouchPoints: 5 },
    });
    expect(detectBrowserVoiceSupport(ipad.win).ios).toBe(true);
  });
});

describe("createBrowserVoiceProvider", () => {
  let t: number;
  beforeEach(() => {
    t = 0;
    FakeRecognition.instances = [];
    vi.useFakeTimers();
    return () => vi.useRealTimers();
  });

  it("is a silent no-op provider without a window (SSR)", async () => {
    const provider = createBrowserVoiceProvider();
    expect(provider.capabilities).toEqual({ speak: false, listen: false });
    await expect(
      provider.speak({ key: "a", text: "hi", priority: "prompt" }),
    ).resolves.toBeUndefined();
    const errors: VoiceErrorKind[] = [];
    provider.startListening({ onCommand: () => {}, onError: (k) => errors.push(k) });
    expect(errors).toEqual(["not_supported"]);
    provider.dispose();
  });

  it("speaks at a calm rate with the preferred voice, resolving when done", async () => {
    const { win, synth } = fakeWindow();
    const provider = createBrowserVoiceProvider({ window: win, now: () => t });
    let done = false;
    void provider
      .speak({ key: "a", text: "Hello there", priority: "prompt" })
      .then(() => (done = true));
    const u = synth.queue[0]!;
    expect(u.text).toBe("Hello there");
    expect(u.rate).toBe(0.9);
    expect(u.voice).toMatchObject({ name: "Samantha" });
    await Promise.resolve();
    expect(done).toBe(false);
    synth.end();
    await Promise.resolve();
    expect(done).toBe(true);
  });

  it("cancel resolves the current utterance", async () => {
    const { win } = fakeWindow();
    const provider = createBrowserVoiceProvider({ window: win, now: () => t });
    const p = provider.speak({ key: "a", text: "Long sentence", priority: "prompt" });
    provider.cancel();
    await expect(p).resolves.toBeUndefined();
  });

  it("a watchdog resolves speech if the browser never fires `end`", async () => {
    const { win } = fakeWindow();
    const provider = createBrowserVoiceProvider({ window: win, now: () => t });
    const p = provider.speak({ key: "a", text: "one two", priority: "prompt" });
    vi.advanceTimersByTime(10_000);
    await expect(p).resolves.toBeUndefined();
  });

  it("listens continuously and turns final transcripts into commands", () => {
    const { win } = fakeWindow();
    const provider = createBrowserVoiceProvider({ window: win, now: () => t });
    const heard = listen(provider);
    expect(rec()).toMatchObject({
      continuous: true,
      interimResults: false,
      lang: "en-US",
      running: true,
    });
    rec().hear("um, pause please");
    rec().hear("continue", false); // interim: ignored
    rec().hear("the weather");
    expect(heard.commands).toEqual(["pause"]);
    expect(heard.transcripts).toEqual(["um, pause please", "the weather"]);
  });

  it("ignores what it hears while speaking and just after", () => {
    const { win, synth } = fakeWindow();
    const provider = createBrowserVoiceProvider({ window: win, now: () => t, echoTailMs: 600 });
    const heard = listen(provider);
    void provider.speak({
      key: "s",
      text: "Please stop. Call your study nurse now.",
      priority: "urgent",
    });
    rec().hear("call your study nurse now");
    synth.end();
    t += 500;
    rec().hear("stop");
    t += 200;
    rec().hear("pause");
    expect(heard.commands).toEqual(["pause"]);
    expect(heard.transcripts).toEqual(["pause"]);
  });

  it("restarts recognition when it ends, backing off on quick failures", () => {
    const { win } = fakeWindow();
    const provider = createBrowserVoiceProvider({ window: win, now: () => t });
    listen(provider);
    t += 30_000;
    rec().end(); // a normal end after a long session
    vi.advanceTimersByTime(250);
    expect(FakeRecognition.instances).toHaveLength(2);
    expect(rec().running).toBe(true);

    rec().end(); // ended immediately: back off
    vi.advanceTimersByTime(250);
    expect(FakeRecognition.instances).toHaveLength(2);
    vi.advanceTimersByTime(250);
    expect(FakeRecognition.instances).toHaveLength(3);
  });

  it("stops for good on permission errors and reports each problem once", () => {
    const { win } = fakeWindow();
    const provider = createBrowserVoiceProvider({ window: win, now: () => t });
    const heard = listen(provider);
    rec().fail("no-speech");
    rec().fail("network");
    rec().fail("network");
    expect(heard.errors).toEqual(["network"]);
    rec().fail("not-allowed");
    expect(heard.errors).toEqual(["network", "permission_denied"]);
    vi.advanceTimersByTime(60_000);
    expect(FakeRecognition.instances).toHaveLength(1);
    expect(rec().running).toBe(false);
  });

  it("stopListening stops and doesn't restart", () => {
    const { win } = fakeWindow();
    const provider = createBrowserVoiceProvider({ window: win, now: () => t });
    listen(provider);
    provider.stopListening();
    vi.advanceTimersByTime(60_000);
    expect(FakeRecognition.instances).toHaveLength(1);
    expect(rec().running).toBe(false);
  });

  it("on iOS, stops the recognizer while speaking and restarts after", () => {
    const { win, synth } = fakeWindow({
      navigator: { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0)" },
    });
    const provider = createBrowserVoiceProvider({ window: win, now: () => t });
    listen(provider);
    expect(rec().running).toBe(true);
    void provider.speak({ key: "a", text: "Hello", priority: "prompt" });
    expect(rec().running).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(FakeRecognition.instances).toHaveLength(1);
    synth.end();
    vi.advanceTimersByTime(600);
    expect(FakeRecognition.instances).toHaveLength(2);
    expect(rec().running).toBe(true);
  });

  it("speak-only on Firefox: listening reports not_supported", () => {
    const { win } = fakeWindow({ webkitSpeechRecognition: undefined });
    const provider = createBrowserVoiceProvider({ window: win, now: () => t });
    expect(provider.capabilities).toEqual({ speak: true, listen: false });
    expect(listen(provider).errors).toEqual(["not_supported"]);
  });
});
