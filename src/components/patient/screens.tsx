"use client";

import { currentProgress, currentStep, type StopReason } from "@/engine";
import type { Correction, PatientSnapshot } from "@/patient/controller";
import { HEADINGS, LABELS, NOTES, stopReasonText } from "@/patient/copy";
import {
  awaitingDone,
  describeDuration,
  formatCountdown,
  progressDots,
  stepTimer,
  type DotStatus,
} from "@/patient/screen";
import type { Step } from "@/protocol/schema";
import { ISSUE_PHRASES, SCRIPTS, stopHeadline } from "@/voice/scripts";
import { BigButton, CallNurseLink, Lead, ScreenHeading } from "./ui";

export function WelcomeScreen({ title, onStart }: { title: string; onStart: () => void }) {
  return (
    <section className="flex flex-1 flex-col justify-center gap-8">
      <ScreenHeading>{HEADINGS.welcome}</ScreenHeading>
      <Lead>{SCRIPTS.welcome}</Lead>
      <p className="text-xl text-muted">{title}</p>
      <BigButton onClick={onStart}>{LABELS.start}</BigButton>
    </section>
  );
}

export function PermissionsScreen({
  scripted = false,
  requesting,
  onAllow,
}: {
  scripted?: boolean;
  requesting: boolean;
  onAllow: () => void;
}) {
  return (
    <section className="flex flex-1 flex-col justify-center gap-8">
      <ScreenHeading>{scripted ? "Try the demo" : HEADINGS.permissions}</ScreenHeading>
      <Lead>
        {scripted
          ? "This demo uses simulated camera checks. No camera or microphone permission is needed. Use the buttons to control the procedure."
          : SCRIPTS.permissions}
      </Lead>
      <BigButton onClick={onAllow} disabled={requesting}>
        {scripted ? "Continue with simulated checks" : LABELS.allow}
      </BigButton>
    </section>
  );
}

export function CameraDeniedScreen({
  phone,
  onRetry,
  onCall,
}: {
  phone: string;
  onRetry: () => void;
  onCall: () => void;
}) {
  return (
    <section className="flex flex-1 flex-col justify-center gap-6" role="alert">
      <ScreenHeading>{HEADINGS.cameraDenied}</ScreenHeading>
      <Lead>{NOTES.cameraDenied}</Lead>
      <BigButton onClick={onRetry}>{LABELS.tryAgain}</BigButton>
      <p className="text-xl">{NOTES.cameraDeniedHelp}</p>
      <CallNurseLink phone={phone} onCall={onCall} variant="danger" />
    </section>
  );
}

export function CameraCheckScreen({
  snapshot,
  step,
  voiceNote,
}: {
  snapshot: PatientSnapshot;
  step: Step | undefined;
  /** Why voice commands won't work, if they won't. */
  voiceNote: string | null;
}) {
  const run = snapshot.engine.run;
  const hands = snapshot.lastFrame?.handsVisible;
  return (
    <section className="flex flex-col gap-5">
      <ScreenHeading>{HEADINGS.cameraCheck}</ScreenHeading>
      <p className="text-xl">{SCRIPTS.practiceIntro}</p>
      <CorrectionBanner correction={snapshot.correction} />
      <div aria-live="polite" aria-atomic="true" className="flex flex-col gap-2">
        {run && step && (
          <>
            <p className="text-xl font-bold text-muted">
              {HEADINGS.practice} {run.index + 1} / {run.steps.length}
            </p>
            <p className="text-3xl font-bold">{step.instruction}</p>
            <p className="text-2xl">{step.spokenPrompt}</p>
          </>
        )}
      </div>
      {hands !== undefined && (
        <p
          className={`rounded-xl px-4 py-3 text-2xl font-bold ${hands ? "bg-surface text-success" : "bg-warning-bg text-warning-fg"}`}
        >
          {hands ? `✓ ${NOTES.handsSeen}` : NOTES.handsNotSeen}
        </p>
      )}
      {voiceNote && <p className="text-xl text-muted">{voiceNote}</p>}
    </section>
  );
}

export function ReadyScreen({ onStart }: { onStart: () => void }) {
  return (
    <section className="flex flex-1 flex-col justify-center gap-8">
      <ScreenHeading>{HEADINGS.ready}</ScreenHeading>
      <Lead>{SCRIPTS.practiceDone}</Lead>
      <BigButton onClick={onStart}>{LABELS.startProcedure}</BigButton>
    </section>
  );
}

export function StepScreen({
  snapshot,
  step,
  onDone,
  onRepeat,
}: {
  snapshot: PatientSnapshot;
  step: Step | undefined;
  onDone: () => void;
  onRepeat: () => void;
}) {
  const { engine } = snapshot;
  const run = engine.run;
  const engineStep = currentStep(engine);
  const progress = currentProgress(engine);
  if (!run || !engineStep || !step || !progress) return null;
  const correction = snapshot.correction?.stepId === step.id ? snapshot.correction : null;

  return (
    <section className="flex flex-col gap-5">
      <ProgressDots
        dots={progressDots(engine)}
        label={NOTES.stepOf(run.index + 1, run.steps.length)}
      />
      <CorrectionBanner correction={correction} />
      {/* The current step is announced when it changes; the timer below is not. */}
      <div aria-live="polite" aria-atomic="true" className="flex flex-col gap-3">
        <ScreenHeading>{step.instruction}</ScreenHeading>
        <p className="text-2xl leading-snug">{step.spokenPrompt}</p>
      </div>
      <StepTimerView snapshot={snapshot} />
      {awaitingDone(engine) && (
        <div className="flex flex-col gap-3">
          <p className="text-xl">{SCRIPTS.sayDone}</p>
          <BigButton onClick={onDone}>{LABELS.done}</BigButton>
        </div>
      )}
      <BigButton onClick={onRepeat} variant="secondary">
        {LABELS.repeat}
      </BigButton>
    </section>
  );
}

function StepTimerView({ snapshot }: { snapshot: PatientSnapshot }) {
  const timer = stepTimer(snapshot.engine);
  if (timer.kind === "none") return null;
  if (timer.kind === "hold_pending") {
    return (
      <p className="rounded-xl bg-surface px-4 py-3 text-2xl font-bold">
        {NOTES.holdFor(describeDuration(timer.totalMs))}
      </p>
    );
  }
  const holding = timer.kind === "holding";
  return (
    <div className="flex items-center gap-5 rounded-xl bg-surface px-4 py-3">
      <span
        role="timer"
        aria-label={describeDuration(timer.remainingMs)}
        className={`min-w-24 text-center text-6xl font-bold tabular-nums ${holding ? "text-primary motion-safe:animate-pulse" : ""}`}
      >
        {formatCountdown(timer.remainingMs)}
      </span>
      <p className="text-2xl font-bold">
        {holding
          ? `${SCRIPTS.holdStarted} ${NOTES.holdLeft(describeDuration(timer.remainingMs))}`
          : NOTES.waitLeft(describeDuration(timer.remainingMs))}
      </p>
    </div>
  );
}

function ProgressDots({ dots, label }: { dots: readonly DotStatus[]; label: string }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xl font-bold text-muted">{label}</p>
      <ol className="flex flex-wrap gap-2" aria-hidden="true">
        {dots.map((d, i) => (
          <li
            key={i}
            className={`size-5 rounded-full border-[3px] ${
              d === "done"
                ? "border-success bg-success"
                : d === "missed"
                  ? "border-danger bg-danger"
                  : d === "current"
                    ? "border-primary bg-primary ring-4 ring-primary/30"
                    : "border-border"
            }`}
          />
        ))}
      </ol>
    </div>
  );
}

/** Always mounted, so screen readers announce a correction as soon as it appears. */
export function CorrectionBanner({ correction }: { correction: Correction | null }) {
  return (
    <div aria-live="assertive" aria-atomic="true">
      {correction && (
        <p className="rounded-xl border-4 border-warning-fg bg-warning-bg px-4 py-3 text-2xl font-bold text-warning-fg">
          {ISSUE_PHRASES[correction.issue]}
        </p>
      )}
    </div>
  );
}

export function PausedScreen({
  reason,
  onContinue,
}: {
  reason: "user" | "nurse_called";
  onContinue: () => void;
}) {
  return (
    <section className="flex flex-1 flex-col justify-center gap-8">
      <ScreenHeading>
        {reason === "nurse_called" ? HEADINGS.nursePaused : HEADINGS.paused}
      </ScreenHeading>
      {reason === "nurse_called" && <Lead>{SCRIPTS.nurseCalled}</Lead>}
      <Lead>{SCRIPTS.paused}</Lead>
      <BigButton onClick={onContinue}>{LABELS.continue}</BigButton>
    </section>
  );
}

export function VisionUnavailableScreen({ onContinue }: { onContinue: () => void }) {
  return (
    <section className="flex flex-1 flex-col justify-center gap-8" role="alert">
      <ScreenHeading>{HEADINGS.visionUnavailable}</ScreenHeading>
      <Lead>{SCRIPTS.visionUnavailable}</Lead>
      <BigButton onClick={onContinue}>{LABELS.continue}</BigButton>
    </section>
  );
}

export function StoppedScreen({
  reason,
  phone,
  instructionFor,
  onCall,
}: {
  reason: StopReason;
  phone: string;
  instructionFor: (stepId: string) => string | undefined;
  onCall: () => void;
}) {
  return (
    <section className="flex flex-1 flex-col justify-center gap-8" role="alert">
      <ScreenHeading className="text-danger">
        <NoWrapPhone text={stopHeadline(phone)} phone={phone} />
      </ScreenHeading>
      <Lead>{stopReasonText(reason, instructionFor)}</Lead>
      <CallNurseLink phone={phone} onCall={onCall} label={LABELS.callNurseNow} variant="danger" />
    </section>
  );
}

/** Keeps the number on one line (it would otherwise break at a hyphen). */
function NoWrapPhone({ text, phone }: { text: string; phone: string }) {
  const at = text.indexOf(phone);
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <span className="break-words">{phone}</span>
      {text.slice(at + phone.length)}
    </>
  );
}

export function CompletedScreen() {
  return (
    <section className="flex flex-1 flex-col justify-center gap-8">
      <p aria-hidden="true" className="text-8xl text-success">
        ✓
      </p>
      <ScreenHeading>{HEADINGS.completed}</ScreenHeading>
      <Lead>{SCRIPTS.completed}</Lead>
    </section>
  );
}
