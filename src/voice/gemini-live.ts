import type { LiveServerMessage, Session } from "@google/genai";
import { createBrowserVoiceProvider, type BrowserVoiceOptions } from "./browser";
import {
  LIVE_API_VERSION,
  LiveCommandGate,
  floatToPcm16Base64,
  liveConnectConfig,
} from "./gemini-live-config";
import type { Utterance, VoiceErrorKind, VoiceListenHandlers, VoiceProvider } from "./types";

/*
 * Gemini Live voice provider (stretch; NEXT_PUBLIC_VOICE_PROVIDER=gemini-live).
 *
 * Listening goes through Gemini Live: microphone audio (16 kHz PCM16) streams to the
 * model, which recognises the five commands by function calling. Advancing commands
 * are cross-checked against the transcript (see LiveCommandGate).
 *
 * Speaking stays on the browser's speechSynthesis, reading the coach's text verbatim.
 * Live's own audio output is discarded, never played: a speech model can paraphrase,
 * and we can't verify its words before the patient hears them. That keeps the rule that
 * the patient never hears model-generated text.
 *
 * The browser never sees the API key: POST /api/voice/token mints a single-use ephemeral
 * token with this exact config locked in.
 */

export interface GeminiLiveVoiceOptions extends BrowserVoiceOptions {
  /** Token endpoint. Default "/api/voice/token". */
  readonly tokenUrl?: string;
  /** Logs Live transcripts and dropped model output. Default: console.info. */
  readonly log?: (message: string) => void;
}

interface TokenResponse {
  readonly token: string;
  readonly model: string;
}

const MIC_CHUNK_SAMPLES = 1600; // 100 ms at 16 kHz
const MAX_RECONNECTS = 3;
const ECHO_TAIL_MS = 600;

/** AudioWorklet that forwards mono Float32 frames to the main thread. */
const WORKLET_SOURCE = `
class WitnessMicTap extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("witness-mic-tap", WitnessMicTap);
`;

export function detectGeminiLiveSupport(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.isSecureContext !== false &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof AudioContext === "function" &&
    typeof AudioWorkletNode === "function" &&
    typeof WebSocket === "function"
  );
}

export function createGeminiLiveVoiceProvider(options: GeminiLiveVoiceOptions = {}): VoiceProvider {
  const speech = createBrowserVoiceProvider(options);
  const now = options.now ?? (() => Date.now());
  const tokenUrl = options.tokenUrl ?? "/api/voice/token";
  const log = options.log ?? ((message: string) => console.info(`[voice:live] ${message}`));
  const listen = detectGeminiLiveSupport();

  let handlers: VoiceListenHandlers | null = null;
  let session: Session | null = null;
  let stream: MediaStream | null = null;
  let audio: AudioContext | null = null;
  let speaking = 0;
  let mutedUntil = 0;
  let reconnects = 0;
  /** Bumped by stopListening so a connect that finishes late is thrown away. */
  let generation = 0;
  let buffer = new Float32Array(MIC_CHUNK_SAMPLES);
  let buffered = 0;

  const muted = () => speaking > 0 || now() < mutedUntil;

  async function speak(u: Utterance): Promise<void> {
    speaking += 1;
    try {
      await speech.speak(u);
    } finally {
      speaking -= 1;
      mutedUntil = now() + ECHO_TAIL_MS;
    }
  }

  function fail(kind: VoiceErrorKind, detail: string): void {
    log(`error ${kind}: ${detail}`);
    handlers?.onError?.(kind, detail);
  }

  async function fetchToken(): Promise<TokenResponse> {
    const res = await fetch(tokenUrl, { method: "POST" });
    if (!res.ok) {
      const kind: VoiceErrorKind =
        res.status === 404 || res.status === 503 ? "not_supported" : "network";
      throw Object.assign(new Error(`token request failed (${res.status})`), { kind });
    }
    return (await res.json()) as TokenResponse;
  }

  async function connect(gen: number): Promise<void> {
    const { token, model } = await fetchToken();
    const { GoogleGenAI } = await import("@google/genai");
    if (gen !== generation) return;
    const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: LIVE_API_VERSION } });
    const gate = new LiveCommandGate((command, transcript) => {
      log(`command ${command} ← "${transcript}"`);
      handlers?.onCommand(command, transcript);
    });
    // Set once connect resolves; messages that arrive earlier (setup) don't need it.
    let live: Session | null = null;
    const opened = await ai.live.connect({
      model,
      config: liveConnectConfig(),
      callbacks: {
        onmessage: (message) => onMessage(message, gate, live),
        onerror: (event) => fail("network", event.message || "live connection error"),
        onclose: (event) => onClose(gen, event),
      },
    });
    if (gen !== generation) {
      opened.close();
      return;
    }
    live = opened;
    session = opened;
    reconnects = 0;
  }

  function onMessage(
    message: LiveServerMessage,
    gate: LiveCommandGate,
    live: Session | null,
  ): void {
    const content = message.serverContent;
    const heard = content?.inputTranscription?.text;
    if (heard && !muted()) gate.onTranscription(heard);
    if (content?.modelTurn?.parts?.length) log("model audio dropped (never played to the patient)");

    for (const call of message.toolCall?.functionCalls ?? []) {
      const accepted = !muted() && gate.onFunctionCall(call.name);
      log(`function ${call.name ?? "?"} ${accepted ? "accepted" : "held / ignored"}`);
      (live ?? session)?.sendToolResponse({
        functionResponses: [
          { id: call.id, name: call.name, response: { result: accepted ? "ok" : "ignored" } },
        ],
      });
    }

    if (content?.turnComplete) {
      const transcript = gate.onTurnComplete();
      if (transcript) {
        log(`heard "${transcript}"`);
        handlers?.onTranscript?.(transcript);
      }
    }
  }

  function onClose(gen: number, event: CloseEvent): void {
    if (gen !== generation || !handlers) return;
    session = null;
    log(`closed (${event.code} ${event.reason})`);
    if (reconnects >= MAX_RECONNECTS) {
      fail("network", "Live connection keeps closing");
      return;
    }
    reconnects += 1;
    setTimeout(
      () => {
        if (gen === generation && handlers) void connect(gen).catch(onConnectError);
      },
      500 * 2 ** reconnects,
    );
  }

  function onConnectError(error: unknown): void {
    const kind =
      typeof error === "object" && error !== null && "kind" in error
        ? (error.kind as VoiceErrorKind)
        : "network";
    fail(kind, error instanceof Error ? error.message : String(error));
  }

  async function startMicrophone(gen: number): Promise<void> {
    const media = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    if (gen !== generation) {
      media.getTracks().forEach((t) => t.stop());
      return;
    }
    stream = media;
    // The browser resamples the microphone to the context's 16 kHz rate.
    const context = new AudioContext({ sampleRate: 16_000 });
    audio = context;
    const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "text/javascript" }));
    try {
      await context.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const source = context.createMediaStreamSource(media);
    const tap = new AudioWorkletNode(context, "witness-mic-tap");
    tap.port.onmessage = (event: MessageEvent<Float32Array>) => onSamples(event.data);
    source.connect(tap);
  }

  function onSamples(samples: Float32Array): void {
    for (let i = 0; i < samples.length; i++) {
      buffer[buffered++] = samples[i] ?? 0;
      if (buffered < MIC_CHUNK_SAMPLES) continue;
      // Don't send the coach's own voice back to the model.
      if (session && !muted()) {
        session.sendRealtimeInput({
          audio: { data: floatToPcm16Base64(buffer), mimeType: "audio/pcm;rate=16000" },
        });
      }
      buffer = new Float32Array(MIC_CHUNK_SAMPLES);
      buffered = 0;
    }
  }

  function startListening(next: VoiceListenHandlers): void {
    if (!listen) {
      next.onError?.("not_supported", "Gemini Live needs microphone and AudioWorklet support");
      return;
    }
    stopListening();
    handlers = next;
    const gen = generation;
    startMicrophone(gen).catch((error: unknown) => {
      const denied = error instanceof DOMException && error.name === "NotAllowedError";
      fail(denied ? "permission_denied" : "not_supported", String(error));
      if (gen === generation) stopListening();
    });
    connect(gen).catch(onConnectError);
  }

  function stopListening(): void {
    generation += 1;
    handlers = null;
    session?.close();
    session = null;
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    void audio?.close().catch(() => undefined);
    audio = null;
    buffered = 0;
  }

  return {
    name: "gemini-live",
    capabilities: { speak: speech.capabilities.speak, listen },
    speak,
    cancel: () => speech.cancel(),
    prime: () => speech.prime?.(),
    startListening,
    stopListening,
    dispose() {
      stopListening();
      speech.dispose();
    },
  };
}
