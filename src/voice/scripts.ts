import type { IssueCode, NeedsHumanCause } from "@/engine";

/**
 * Every sentence the patient sees or hears outside the protocol's own step text.
 * App-authored, plain language, no medical advice. Shared by the patient screens
 * (on-screen text) and the voice coach (spoken), so they always say the same thing.
 */

/** Spoken/shown when a frame has a camera problem. Keyed by the vision issue code. */
export const ISSUE_PHRASES: Record<IssueCode, string> = {
  hands_not_visible: "I can't see your hands. Please move them into view of the camera.",
  pen_not_visible: "I can't see the pen. Please hold it where the camera can see it.",
  too_dark: "It's a bit dark. Please turn on a light or move somewhere brighter.",
  too_far: "Please move a little closer to the camera.",
  too_close: "Please move back a little from the camera.",
  camera_blocked: "Something is covering the camera. Please check it's clear.",
  wrong_angle: "Please turn so the camera can see what you're doing.",
  unclear: "I can't quite see. Please hold still for a moment.",
};

export const SCRIPTS = {
  welcome: "Hello. I'll guide you through your procedure one step at a time.",
  permissions:
    "I need to use your camera to see each step, and your microphone so you can talk to me. Camera frames are sent for checking. Evidence frames are saved for your study team.",
  practiceIntro: "Let's do a quick practice first, so I know the camera can see you.",
  practiceDone: "Great, the camera can see you. When you're ready, we'll start.",
  holdStarted: "Hold it there. I'll count the time for you.",
  holdDone: "Done. You can stop holding.",
  holdInterrupted: "I couldn't see the hold, so the timer has stopped.",
  stepDone: "Good.",
  sayDone: 'Say "done" when you have finished, or tap the Done button.',
  paused: 'Paused. Say "continue" or tap Continue when you\'re ready.',
  resumed: "Okay, let's carry on.",
  nurseCalled: "Please tap Call my nurse to open your phone and place the call.",
  visionUnavailable:
    "I'm having trouble checking the camera, so I've paused. Say \"continue\" to try again.",
  completed: "All done. Thank you. Your study team will see that you finished.",
  stopCriticalMiss: "Please stop. Do not continue. Call your study nurse now.",
  stopNeedsHuman: "Please stop here. Your study nurse will help you with the next step.",
  stopEnded: "We've stopped. If you need help, call your study nurse.",
} as const;

/** Spoken in the last seconds of a hold. Indexed by seconds left (1..5). */
export const COUNTDOWN_WORDS: Readonly<Record<number, string>> = {
  1: "One.",
  2: "Two.",
  3: "Three.",
  4: "Four.",
  5: "Five.",
};

/** The stop screen's main line. The number comes from NEXT_PUBLIC_TRIAL_NURSE_PHONE. */
export function stopHeadline(nursePhone: string): string {
  return `Stop. Call your study nurse at ${nursePhone}.`;
}

/** Why the procedure stopped, in plain language (no clinical judgement). */
export const NEEDS_HUMAN_REASON: Record<NeedsHumanCause, string> = {
  too_many_unmatched_frames: "I couldn't see this step clearly enough to check it.",
  too_many_attempts: "This step was interrupted a few times.",
  step_timeout: "This step took longer than expected.",
  vision_outage: "I lost the connection needed to check your steps.",
  hold_interrupted: "I couldn't see the pen being held for the full time.",
};
