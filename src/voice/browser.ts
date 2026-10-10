import { parseCommand } from "./commands";
import type { Utterance, VoiceErrorKind, VoiceListenHandlers, VoiceProvider } from "./types";

/*
 * Browser Web Speech provider: speechSynthesis out, SpeechRecognition in.
 *
 * Nothing here touches `window` at import time, so it's safe to import from server
 * code; `createBrowserVoiceProvider()` must run in the browser (e.g. in an effect or a
 * click handler) and returns a silent provider during SSR.
 *
 * Browser support (2026):
 * - Chrome / Edge (desktop + Android): speak and listen. Recognition runs on Google's
 *   servers, so it needs a network; it ends by itself every minute or so and on
 *   silence, so we restart it.
 * - Safari (macOS + iOS): speak and listen (webkitSpeechRecognition). On iOS, a running
 *   recognizer puts the audio session in record mode and speech comes out quiet or not
 *   at all, so on iOS we stop listening while speaking and start again after.
 * - Firefox: speak only (recognition is behind a flag). Every voice command also has a
 *   button, so this degrades to buttons.
 */

// --- Minimal Web Speech typings (not in TypeScript's lib.dom) --------------------------

interface RecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}
interface RecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: RecognitionAlternative | undefined;
}
export interface RecognitionResultEvent {
  readonly resultIndex: number;
  readonly results: {
    readonly length: number;
    readonly [index: number]: RecognitionResult | undefined;
  };
}
export interface RecognitionErrorEvent {
  readonly error: string;
  readonly message?: string;
}
export interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export type RecognitionConstructor = new () => Recognition;

export interface VoiceLike {
  readonly name: string;
  readonly lang: string;
  readonly localService: boolean;
  readonly default: boolean;
}

interface SynthUtterance {
  text: string;
  rate: number;
  pitch: number;
  lang: string;
  voice: unknown;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

interface Synth {
  speak(utterance: SynthUtterance): void;
  cancel(): void;
  resume(): void;
  getVoices(): readonly VoiceLike[];
  readonly paused: boolean;
  addEventListener?(type: "voiceschanged", listener: () => void): void;
  removeEventListener?(type: "voiceschanged", listener: () => void): void;
}

/** The parts of `window` this provider uses. Injected in tests. */
export interface SpeechWindow {
  speechSynthesis?: Synth;
  SpeechSynthesisUtterance?: new (text: string) => SynthUtterance;
  SpeechRecognition?: RecognitionConstructor;
  webkitSpeechRecognition?: RecognitionConstructor;
  isSecureContext?: boolean;
  navigator?: { userAgent?: string; platform?: string; maxTouchPoints?: number };
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

// --- Pure helpers ----------------------------------------------------------------------

export interface BrowserVoiceSupport {
  readonly speak: boolean;
  readonly listen: boolean;
  /** iOS/iPadOS: stop the recognizer while speaking (see the file comment). */
  readonly ios: boolean;
}

export function detectBrowserVoiceSupport(win: SpeechWindow | undefined): BrowserVoiceSupport {
  if (!win) return { speak: false, listen: false, ios: false };
  const speak =
    typeof win.speechSynthesis === "object" &&
    win.speechSynthesis !== null &&
    typeof win.SpeechSynthesisUtterance === "function";
  const recognition = win.SpeechRecognition ?? win.webkitSpeechRecognition;
  // The microphone is only available in a secure context (HTTPS or localhost).
  const listen = typeof recognition === "function" && win.isSecureContext !== false;
  const nav = win.navigator ?? {};
  const ios =
    /iP(hone|ad|od)/.test(nav.userAgent ?? "") ||
    (nav.platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1);
  return { speak, listen, ios };
}

const NATURAL = /natural|neural|premium|enhanced|wavenet/i;
const KNOWN_GOOD =
  /^(samantha|ava|allison|susan|karen|daniel|moira|serena|google us english|google uk english female)\b|microsoft (aria|jenny|guy|sonia|libby)/i;
/** macOS novelty voices. Never use these for patients. */
const NOVELTY =
  /^(albert|bad news|bahh|bells|boing|bubbles|cellos|wobble|good news|jester|organ|superstar|trinoids|whisper|zarvox|fred|junior|ralph|kathy|princess|deranged|hysterical|grandma|grandpa|eddy|flo|reed|rocko|sandy|shelley)\b/i;

/** Picks a calm, natural-sounding English voice, or null to use the browser default. */
export function pickVoice(voices: readonly VoiceLike[], lang = "en-US"): VoiceLike | null {
  const want = lang.toLowerCase().replace("_", "-");
  let best: VoiceLike | null = null;
  let bestScore = -Infinity;
  for (const voice of voices) {
    const vlang = voice.lang.toLowerCase().replace("_", "-");
    if (!vlang.startsWith("en")) continue;
    if (NOVELTY.test(voice.name)) continue;
    let score = 0;
    if (vlang === want) score += 10;
    if (NATURAL.test(voice.name)) score += 8;
    if (KNOWN_GOOD.test(voice.name)) score += 4;
    if (voice.localService) score += 1;
    if (voice.default) score += 1;
    if (score > bestScore) {
      best = voice;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Maps a SpeechRecognition error code to a VoiceErrorKind. Returns null for the
 * harmless ones (silence, our own abort) that just mean "restart".
 */
export function mapRecognitionError(code: string): VoiceErrorKind | null {
  switch (code) {
    case "no-speech":
    case "aborted":
      return null;
    case "not-allowed":
    case "service-not-allowed":
      return "permission_denied";
    case "audio-capture":
    case "language-not-supported":
    case "bad-grammar":
      return "not_supported";
    case "network":
      return "network";
    default:
      return "unknown";
  }
}

/** Errors after which restarting is pointless until the user changes something. */
const FATAL_ERRORS = new Set<VoiceErrorKind>(["permission_denied", "not_supported"]);

// --- Provider --------------------------------------------------------------------------

export interface BrowserVoiceOptions {
  /** Speaking rate; slightly slow for older listeners. Default 0.9. */
  readonly rate?: number;
  /** BCP 47 language for speech and recognition. Default "en-US". */
  readonly lang?: string;
  /** Keep ignoring what's heard for this long after speech ends (room echo). Default 600 ms. */
  readonly echoTailMs?: number;
  /** For tests. Defaults to the global `window`. */
  readonly window?: SpeechWindow;
  /** For tests. Defaults to `Date.now`. */
  readonly now?: () => number;
}

const RESTART_DELAY_MS = 250;
const MAX_RESTART_DELAY_MS = 8000;
/** A recognizer that ends sooner than this counts as a failed start (backs off). */
const QUICK_END_MS = 1000;

export function createBrowserVoiceProvider(options: BrowserVoiceOptions = {}): VoiceProvider {
  const win: SpeechWindow | undefined =
    options.window ??
    (typeof window === "undefined" ? undefined : (window as unknown as SpeechWindow));
  const support = detectBrowserVoiceSupport(win);
  const now = options.now ?? (() => Date.now());
  const rate = options.rate ?? 0.9;
  const lang = options.lang ?? "en-US";
  const echoTailMs = options.echoTailMs ?? 600;

  // Speaking
  let voices: readonly VoiceLike[] = [];
  let voice: VoiceLike | null = null;
  let speaking: { utterance: SynthUtterance; settle: () => void } | null = null;
  let mutedUntil = 0;

  // Listening
  let handlers: VoiceListenHandlers | null = null;
  let recognition: Recognition | null = null;
  let startedAt = 0;
  let quickEnds = 0;
  let restartTimer: unknown = null;
  let lastError: VoiceErrorKind | null = null;

  const synth = support.speak ? win?.speechSynthesis : undefined;
  const loadVoices = () => {
    voices = synth?.getVoices() ?? [];
    voice = pickVoice(voices, lang);
  };
  if (synth) {
    loadVoices();
    synth.addEventListener?.("voiceschanged", loadVoices);
  }

  // --- Speech out ----------------------------------------------------------------------

  function speak(u: Utterance): Promise<void> {
    const Utter = win?.SpeechSynthesisUtterance;
    if (!synth || !Utter || !win) return Promise.resolve();
    if (voices.length === 0) loadVoices();

    return new Promise<void>((resolve) => {
      const utterance = new Utter(u.text);
      utterance.rate = rate;
      utterance.pitch = 1;
      utterance.lang = voice?.lang ?? lang;
      if (voice) utterance.voice = voice;

      let watchdog: unknown = null;
      const settle = () => {
        win.clearTimeout(watchdog);
        if (speaking?.utterance === utterance) {
          speaking = null;
          mutedUntil = now() + echoTailMs;
          if (support.ios) scheduleRestart(echoTailMs);
        }
        resolve();
      };
      utterance.onend = settle;
      utterance.onerror = settle;
      // Chrome sometimes never fires `end`; don't let that wedge the queue.
      const words = u.text.split(/\s+/).length;
      watchdog = win.setTimeout(settle, (words * 500) / rate + 4000);

      speaking = { utterance, settle };
      mutedUntil = Number.POSITIVE_INFINITY;
      if (support.ios) pauseRecognition();
      if (synth.paused) synth.resume();
      synth.speak(utterance);
    });
  }

  function cancel(): void {
    const current = speaking;
    synth?.cancel();
    current?.settle();
  }

  /** Speaks a silent utterance during a tap, which unlocks speech on iOS Safari. */
  function prime(): void {
    const Utter = win?.SpeechSynthesisUtterance;
    if (!synth || !Utter) return;
    const unlock = new Utter("");
    unlock.rate = rate;
    synth.speak(unlock);
  }

  // --- Speech in -----------------------------------------------------------------------

  const isMuted = () => speaking !== null || now() < mutedUntil;

  function startListening(next: VoiceListenHandlers): void {
    if (!support.listen) {
      next.onError?.("not_supported", "speech recognition is not available in this browser");
      return;
    }
    handlers = next;
    lastError = null;
    quickEnds = 0;
    if (!(support.ios && speaking)) startRecognition();
  }

  function startRecognition(): void {
    const Ctor = win?.SpeechRecognition ?? win?.webkitSpeechRecognition;
    if (!Ctor || !handlers || recognition) return;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.lang = lang;
    rec.onresult = (event) => onResult(event);
    rec.onerror = (event) => onError(event.error, event.message);
    rec.onend = () => {
      if (recognition !== rec) return;
      recognition = null;
      const lived = now() - startedAt;
      quickEnds = lived < QUICK_END_MS ? quickEnds + 1 : 0;
      const delay = Math.min(MAX_RESTART_DELAY_MS, RESTART_DELAY_MS * 2 ** quickEnds);
      if (!(support.ios && speaking)) scheduleRestart(delay);
    };
    recognition = rec;
    startedAt = now();
    try {
      rec.start();
    } catch {
      // InvalidStateError (already started) or a blocked start: try again shortly.
      recognition = null;
      scheduleRestart(RESTART_DELAY_MS * 4);
    }
  }

  function scheduleRestart(delay: number): void {
    if (!win || !handlers || restartTimer !== null) return;
    restartTimer = win.setTimeout(() => {
      restartTimer = null;
      if (handlers && !(support.ios && speaking)) startRecognition();
    }, delay);
  }

  function pauseRecognition(): void {
    const rec = recognition;
    recognition = null;
    rec?.abort();
  }

  function onResult(event: RecognitionResultEvent): void {
    if (!handlers) return;
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (!result?.isFinal) continue;
      const transcript = result[0]?.transcript.trim() ?? "";
      // Anything heard while we speak (or just after) is probably ourselves.
      if (transcript === "" || isMuted()) continue;
      lastError = null;
      handlers.onTranscript?.(transcript);
      const command = parseCommand(transcript);
      if (command) handlers.onCommand(command, transcript);
    }
  }

  function onError(code: string, message?: string): void {
    const kind = mapRecognitionError(code);
    if (!kind || !handlers) return;
    const current = handlers;
    if (FATAL_ERRORS.has(kind)) stopListening();
    // Report each problem once, not on every automatic restart.
    if (kind === lastError) return;
    lastError = kind;
    current.onError?.(kind, message || code);
  }

  function stopListening(): void {
    handlers = null;
    if (restartTimer !== null) win?.clearTimeout(restartTimer);
    restartTimer = null;
    pauseRecognition();
  }

  return {
    name: "browser",
    capabilities: { speak: support.speak, listen: support.listen },
    speak,
    cancel,
    prime,
    startListening,
    stopListening,
    dispose() {
      stopListening();
      cancel();
      synth?.removeEventListener?.("voiceschanged", loadVoices);
    },
  };
}
