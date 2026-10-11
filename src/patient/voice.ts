import {
  createVoiceCoach,
  createVoiceProvider,
  type VoiceCoach,
  type VoiceLogEntry,
  type VoiceProvider,
} from "@/voice";
import type { PatientController } from "./controller";

/** `listening`: voice commands work. `speak_only`: prompts are spoken; use the buttons. */
export type VoiceStatus = "off" | "listening" | "speak_only";

export interface PatientVoiceDeps {
  readonly createProvider?: () => VoiceProvider;
  readonly onStatus?: (status: VoiceStatus) => void;
  readonly onLog?: (entry: VoiceLogEntry) => void;
}

/**
 * The patient app's voice: a Phase 5 VoiceCoach attached to the PatientController.
 * The coach hears every engine event batch through `addEngineListener`, sends its
 * commands through `controller.dispatch` (so the screen follows), and the Repeat button
 * reaches it through `onRepeat`.
 *
 * Two steps, because of browser rules: `prime()` from a tap unlocks speech on mobile;
 * `start()` once the microphone question has been answered. A denied microphone still
 * gets spoken prompts, just no listening.
 */
export class PatientVoice {
  private provider: VoiceProvider | null = null;
  private coach: VoiceCoach | null = null;
  private detach: (() => void)[] = [];
  private status: VoiceStatus = "off";
  /** Whether the coach may listen (set by `start` from the microphone answer). */
  private listenAllowed = false;
  /** Read each step aloud (on) or speak only when something needs attention (off). */
  private narrate = false;

  constructor(
    private readonly controller: PatientController,
    private readonly deps: PatientVoiceDeps = {},
  ) {}

  get current(): VoiceStatus {
    return this.status;
  }

  /** Call from a tap. Creates the provider and coach (silent until `start`). */
  prime(): void {
    this.ensure().provider.prime?.();
  }

  get narrating(): boolean {
    return this.narrate;
  }

  /** Call from a tap (so mobile browsers allow speech). Turns step narration on or off. */
  setNarration(on: boolean): void {
    this.narrate = on;
    const { provider, coach } = this.ensure();
    provider.prime?.();
    coach.setQuiet(!on);
  }

  /** Starts speaking, and listening if the microphone is allowed. Idempotent. */
  start(micAllowed: boolean): void {
    const { provider, coach } = this.ensure();
    if (coach.active) return;
    this.listenAllowed = micAllowed && provider.capabilities.listen;
    coach.start();
    this.setStatus(this.listenAllowed ? "listening" : "speak_only");
    // Started mid-run (e.g. after a retry): say where the patient is.
    if (this.controller.runner.state.status !== "idle") coach.repeat();
  }

  dispose(): void {
    for (const off of this.detach) off();
    this.detach = [];
    this.coach?.dispose();
    this.provider?.dispose();
    this.coach = null;
    this.provider = null;
    this.setStatus("off");
  }

  private ensure(): { provider: VoiceProvider; coach: VoiceCoach } {
    if (this.provider && this.coach) return { provider: this.provider, coach: this.coach };
    const inner = (this.deps.createProvider ?? createVoiceProvider)();
    // Listening is gated on the microphone answer, so a denied mic never prompts again.
    const provider: VoiceProvider = {
      name: inner.name,
      capabilities: inner.capabilities,
      speak: (u) => inner.speak(u),
      cancel: () => inner.cancel(),
      prime: () => inner.prime?.(),
      startListening: (handlers) => {
        if (this.listenAllowed) inner.startListening(handlers);
      },
      stopListening: () => inner.stopListening(),
      dispose: () => inner.dispose(),
    };
    const controller = this.controller;
    const coach = createVoiceCoach({
      provider,
      // Off by default: speak up only when something needs attention (or on Repeat).
      // The participant can turn step narration on with "Read steps aloud".
      quiet: !this.narrate,
      // Normal steps wait for a problem to persist; critical steps are corrected at once.
      patience: true,
      stepsById: controller.stepsById,
      dispatch: (input) => controller.dispatch(input),
      now: () => Date.now(),
      getState: () => controller.runner.state,
      onLog: (entry) => {
        if (
          entry.kind === "error" &&
          (entry.error === "permission_denied" || entry.error === "not_supported")
        ) {
          this.setStatus("speak_only");
        }
        this.deps.onLog?.(entry);
      },
    });
    this.detach = [
      controller.addEngineListener(coach.handleEvents),
      controller.onRepeat(() => coach.repeat()),
    ];
    this.provider = provider;
    this.coach = coach;
    return { provider, coach };
  }

  private setStatus(status: VoiceStatus): void {
    if (status === this.status) return;
    this.status = status;
    this.deps.onStatus?.(status);
  }
}
