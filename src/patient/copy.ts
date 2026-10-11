import type { StopReason } from "@/engine";
import { NEEDS_HUMAN_REASON, SCRIPTS } from "@/voice/scripts";
import type { VisionFailureKind } from "@/vision";

export const VISION_FAILURE_NOTES: Record<VisionFailureKind, string> = {
  camera:
    "The camera isn't providing new frames. Keep this page open and the camera running. You can retry the camera below.",
  timeout: "Camera checks are taking too long. Keep this page open while we retry.",
  network:
    "The connection to camera checking was interrupted. Check your internet connection while we retry.",
  rate_limited:
    "The camera checking service is temporarily busy. We're waiting for it to become available.",
  provider:
    "The camera checking service couldn't complete the checks. We're retrying the connection.",
};

/**
 * On-screen labels and the few sentences the patient screens need that aren't spoken
 * scripts yet. Everything spoken or explanatory comes from `@/voice/scripts`; this file
 * only adds button labels, headings and screen-only notes, kept in one place so they can
 * be reviewed (and moved into scripts.ts) together.
 */
export const LABELS = {
  start: "Start",
  allow: "Allow camera and microphone",
  startProcedure: "Start my procedure",
  pause: "Pause",
  continue: "Continue",
  callNurse: "Call my nurse",
  callNurseNow: "Call my nurse now",
  repeat: "Repeat",
  done: "Done",
  tryAgain: "Try again",
} as const;

/** What to expect, shown on the welcome screen. */
export const WELCOME_POINTS = [
  { title: "One step at a time", body: "Each step appears on its own, in large text." },
  { title: "I'll talk you through it", body: "Listen, or read along. Tap Repeat any time." },
  { title: "Help is one tap away", body: "Pause or call your study nurse whenever you need." },
] as const;

export const HEADINGS = {
  welcome: "Welcome",
  permissions: "Camera and microphone",
  cameraCheck: "Camera check",
  practice: "Practice",
  ready: "Ready to start",
  paused: "Paused",
  nursePaused: "Contact your nurse",
  visionUnavailable: "Paused",
  completed: "All done",
  cameraDenied: "I can't use the camera",
  linkNotWorking: "This link isn't working",
  sessionEnded: "This session has ended",
} as const;

export const NOTES = {
  cameraDenied:
    "The camera is turned off for this page. To turn it on, tap the camera or lock icon next to the web address, choose Allow, then tap Try again.",
  cameraDeniedHelp: "If that doesn't work, call your study nurse.",
  micDenied: "The microphone is off. You can use the buttons on the screen instead.",
  voiceCommandsOff:
    "Voice commands aren't available here. You can use the buttons on the screen instead.",
  scriptedCamera: "Demo mode: the camera check is simulated.",
  offline:
    "No internet connection. Please stay on this page. Your progress will be sent when you're back online.",
  handsSeen: "I can see your hands.",
  handsNotSeen: "I can't see your hands yet.",
  linkNotWorking: "Please call your study nurse for a new link.",
  sessionEnded: "If you need help, call your study nurse.",
  loading: "Loading…",
  stepOf: (n: number, total: number) => `Step ${n} of ${total}`,
  holdFor: (duration: string) => `Hold for ${duration}`,
  holdLeft: (duration: string) => `${duration} left`,
  waitLeft: (duration: string) => `Please wait: ${duration} left`,
} as const;

/** Plain-language reason for the stop screen (no clinical judgement). */
export function stopReasonText(
  reason: StopReason,
  instructionFor: (stepId: string) => string | undefined,
): string {
  switch (reason.kind) {
    case "critical_miss": {
      const instruction = instructionFor(reason.missedStepId);
      const what =
        reason.cause === "hold_released_early"
          ? "The hold ended before the time was up."
          : instruction
            ? `I didn't see this step: ${instruction}.`
            : "I didn't see an important step.";
      return `${what} ${SCRIPTS.stopCriticalMiss}`;
    }
    case "needs_human":
      return `${NEEDS_HUMAN_REASON[reason.cause]} ${SCRIPTS.stopNeedsHuman}`;
    case "ended":
      return SCRIPTS.stopEnded;
  }
}
