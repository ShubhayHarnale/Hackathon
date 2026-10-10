/** Commands a patient can say. Every one also has an on-screen button. */
export type VoiceCommand = "pause" | "continue" | "repeat" | "call_nurse" | "done";

export type UtterancePriority = "prompt" | "correction" | "urgent";

/**
 * Something the app says. Text always comes from app-authored scripts, never from a
 * model, so the voice layer can't give advice the study team didn't write.
 */
export interface Utterance {
  /** Dedupe key: the same key isn't repeated within the cooldown window. */
  readonly key: string;
  readonly text: string;
  /** `urgent` (stop messages) interrupts anything playing. */
  readonly priority: UtterancePriority;
}

export type VoiceErrorKind = "not_supported" | "permission_denied" | "network" | "unknown";

export interface VoiceListenHandlers {
  onCommand(command: VoiceCommand, transcript: string): void;
  onTranscript?(transcript: string): void;
  onError?(kind: VoiceErrorKind, detail?: string): void;
}

/**
 * Speech in and out. Implementations: browser Web Speech (default) and Gemini Live
 * (stretch). Listening is muted while speaking so the app doesn't hear itself.
 */
export interface VoiceProvider {
  readonly name: string;
  readonly capabilities: { readonly speak: boolean; readonly listen: boolean };
  speak(utterance: Utterance): Promise<void>;
  cancel(): void;
  startListening(handlers: VoiceListenHandlers): void;
  stopListening(): void;
  dispose(): void;
}
