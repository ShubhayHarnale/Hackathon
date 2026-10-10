// Test helpers for the voice layer. Imported only by *.test.ts files.
import { parseCommand } from "./commands";
import type { Utterance, VoiceErrorKind, VoiceListenHandlers, VoiceProvider } from "./types";

/** Lets microtasks (promise callbacks) run. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

/**
 * A provider whose speech finishes only when the test says so, and whose "microphone"
 * is driven by `hear()`.
 */
export class FakeVoiceProvider implements VoiceProvider {
  readonly name = "fake";
  readonly capabilities = { speak: true, listen: true };
  /** Every utterance that started playing, in order. */
  readonly spoken: Utterance[] = [];
  cancels = 0;
  listening = false;
  primed = false;
  disposed = false;
  private handlers: VoiceListenHandlers | null = null;
  private finishCurrent: (() => void) | null = null;

  speak(utterance: Utterance): Promise<void> {
    this.spoken.push(utterance);
    return new Promise((resolve) => {
      this.finishCurrent = resolve;
    });
  }

  /** The utterance currently playing finishes. */
  async finish(): Promise<void> {
    const done = this.finishCurrent;
    this.finishCurrent = null;
    done?.();
    await flush();
  }

  /** Finish everything, including lines queued behind the current one. */
  async finishAll(): Promise<void> {
    for (let i = 0; i < 50 && this.finishCurrent; i++) await this.finish();
  }

  cancel(): void {
    this.cancels += 1;
    const done = this.finishCurrent;
    this.finishCurrent = null;
    done?.();
  }

  prime(): void {
    this.primed = true;
  }

  startListening(handlers: VoiceListenHandlers): void {
    this.handlers = handlers;
    this.listening = true;
  }

  stopListening(): void {
    this.handlers = null;
    this.listening = false;
  }

  dispose(): void {
    this.stopListening();
    this.disposed = true;
  }

  /** Simulates the patient saying something. */
  hear(transcript: string): void {
    if (!this.handlers) return;
    this.handlers.onTranscript?.(transcript);
    const command = parseCommand(transcript);
    if (command) this.handlers.onCommand(command, transcript);
  }

  fail(kind: VoiceErrorKind, detail?: string): void {
    this.handlers?.onError?.(kind, detail);
  }

  texts(): string[] {
    return this.spoken.map((u) => u.text);
  }
}
