"use client";

import type { ReactNode } from "react";
import { WitnessMark } from "@/components/brand";
import { currentProgress, currentStep, type StopReason } from "@/engine";
import type { Correction, PatientSnapshot } from "@/patient/controller";
import {
  HEADINGS,
  LABELS,
  NOTES,
  VISION_FAILURE_NOTES,
  WELCOME_POINTS,
  stopReasonText,
} from "@/patient/copy";
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
import { BigButton, CallNurseLink, Eyebrow, Lead, Panel, ScreenHeading } from "./ui";

/** Centred, single-purpose screens (welcome, paused, done...). */
function Centered({ children, alert = false }: { children: ReactNode; alert?: boolean }) {
  return (
    <section
      className="stagger flex flex-1 flex-col justify-center gap-7 py-4"
      role={alert ? "alert" : undefined}
    >
      {children}
    </section>
  );
}

/** A large round emblem at the top of a centred screen. */
function Emblem({
  tone,
  children,
}: {
  tone: "primary" | "success" | "danger" | "plain";
  children: ReactNode;
}) {
  const TONE = {
    primary: "bg-primary-soft text-primary",
    success: "bg-success-soft text-success",
    danger: "bg-danger-soft text-danger",
    plain: "bg-surface-2 text-foreground",
  } as const;
  return (
    <div
      aria-hidden="true"
      className={`flex size-24 items-center justify-center rounded-full ${TONE[tone]}`}
    >
      {children}
    </div>
  );
}

export function WelcomeScreen({ title, onStart }: { title: string; onStart: () => void }) {
  return (
    <Centered>
      <WitnessMark className="size-16 motion-safe:animate-breathe" />
      <div className="flex flex-col gap-4">
        <ScreenHeading>{HEADINGS.welcome}</ScreenHeading>
        <Lead>{SCRIPTS.welcome}</Lead>
        <p className="inline-flex w-fit items-center gap-2 rounded-full border-2 border-hairline bg-surface px-4 py-1.5 text-lg font-bold">
          <span aria-hidden="true" className="size-2.5 rounded-full bg-primary" />
          {title}
        </p>
      </div>
      <ul className="flex flex-col gap-3" aria-label="What to expect">
        {WELCOME_POINTS.map((point, i) => (
          <li key={point.title} className="flex items-start gap-4">
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft font-mono text-lg font-bold text-primary"
            >
              {i + 1}
            </span>
            <div>
              <p className="text-xl font-bold">{point.title}</p>
              <p className="text-lg text-muted">{point.body}</p>
            </div>
          </li>
        ))}
      </ul>
      <BigButton onClick={onStart}>{LABELS.start}</BigButton>
    </Centered>
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
    <Centered>
      <Emblem tone="primary">
        <CameraIcon />
      </Emblem>
      <ScreenHeading>{scripted ? "Try the demo" : HEADINGS.permissions}</ScreenHeading>
      <Lead>
        {scripted
          ? "This demo uses simulated camera checks. No camera or microphone permission is needed. Use the buttons to control the procedure."
          : SCRIPTS.permissions}
      </Lead>
      {!scripted && (
        <Panel>
          <p className="text-lg">
            Prop your phone up so it can see your hands, in a well-lit spot. Your browser will ask
            once.
          </p>
        </Panel>
      )}
      <BigButton onClick={onAllow} disabled={requesting}>
        {scripted ? "Continue with simulated checks" : LABELS.allow}
      </BigButton>
    </Centered>
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
    <Centered alert>
      <Emblem tone="plain">
        <CameraIcon off />
      </Emblem>
      <ScreenHeading>{HEADINGS.cameraDenied}</ScreenHeading>
      <Lead>{NOTES.cameraDenied}</Lead>
      <BigButton onClick={onRetry}>{LABELS.tryAgain}</BigButton>
      <p className="text-xl">{NOTES.cameraDeniedHelp}</p>
      <CallNurseLink phone={phone} onCall={onCall} variant="danger" />
    </Centered>
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
    <section className="stagger flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Eyebrow>{HEADINGS.cameraCheck}</Eyebrow>
        <p className="text-xl">{SCRIPTS.practiceIntro}</p>
      </div>
      <CorrectionBanner correction={snapshot.correction} />
      <div aria-live="polite" aria-atomic="true" className="flex flex-col gap-3">
        {run && step && (
          <>
            <p className="w-fit rounded-full bg-primary-soft px-3 py-1 font-mono text-base font-bold text-primary">
              {HEADINGS.practice} {run.index + 1} / {run.steps.length}
            </p>
            <ScreenHeading>{step.instruction}</ScreenHeading>
            <CoachLine>{step.spokenPrompt}</CoachLine>
          </>
        )}
      </div>
      {hands !== undefined && (
        <p
          className={`flex items-center gap-3 rounded-2xl border-2 px-4 py-3 text-2xl font-bold ${
            hands
              ? "border-success/40 bg-success-soft text-success"
              : "border-warning-fg/40 bg-warning-bg text-warning-fg"
          }`}
        >
          <span aria-hidden="true">{hands ? "✓" : "…"}</span>
          {hands ? NOTES.handsSeen : NOTES.handsNotSeen}
        </p>
      )}
      {voiceNote && <p className="text-xl text-muted">{voiceNote}</p>}
    </section>
  );
}

export function ReadyScreen({ onStart }: { onStart: () => void }) {
  return (
    <Centered>
      <Emblem tone="success">
        <CheckIcon />
      </Emblem>
      <ScreenHeading>{HEADINGS.ready}</ScreenHeading>
      <Lead>{SCRIPTS.practiceDone}</Lead>
      <BigButton onClick={onStart}>{LABELS.startProcedure}</BigButton>
    </Centered>
  );
}

/** What the voice coach says, set apart like a spoken line. */
function CoachLine({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-4 rounded-3xl border-2 border-hairline bg-surface px-5 py-4 shadow-soft">
      <span
        aria-hidden="true"
        className="mt-1 flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
      >
        <SpeakerIcon />
      </span>
      <p className="text-2xl leading-relaxed text-pretty">{children}</p>
    </div>
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
      <StepProgress
        dots={progressDots(engine)}
        label={NOTES.stepOf(run.index + 1, run.steps.length)}
        critical={step.critical}
      />
      <CorrectionBanner correction={correction} />
      {/* The current step is announced when it changes; the timer below is not. */}
      <div
        key={step.id}
        aria-live="polite"
        aria-atomic="true"
        className="stagger flex flex-col gap-4"
      >
        <ScreenHeading>{step.instruction}</ScreenHeading>
        <CoachLine>{step.spokenPrompt}</CoachLine>
      </div>
      <StepTimerView snapshot={snapshot} />
      {awaitingDone(engine) && (
        <div className="flex flex-col gap-3">
          <p className="text-xl">{SCRIPTS.sayDone}</p>
          <BigButton onClick={onDone}>{LABELS.done}</BigButton>
        </div>
      )}
      <BigButton onClick={onRepeat} variant="secondary">
        <RepeatIcon />
        {LABELS.repeat}
      </BigButton>
    </section>
  );
}

const RING = 2 * Math.PI * 52;

function StepTimerView({ snapshot }: { snapshot: PatientSnapshot }) {
  const timer = stepTimer(snapshot.engine);
  if (timer.kind === "none") return null;
  if (timer.kind === "hold_pending") {
    return (
      <Panel tone="primary">
        <p className="flex items-center gap-3 text-2xl font-bold text-primary">
          <span aria-hidden="true" className="font-mono text-3xl">
            {formatCountdown(timer.totalMs)}
          </span>
          {NOTES.holdFor(describeDuration(timer.totalMs))}
        </p>
      </Panel>
    );
  }
  const holding = timer.kind === "holding";
  const fraction = timer.totalMs > 0 ? timer.remainingMs / timer.totalMs : 0;
  return (
    <div className="flex items-center gap-5 rounded-3xl border-2 border-primary/30 bg-primary-soft px-5 py-4 shadow-soft">
      <div className="relative size-32 shrink-0">
        <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden="true">
          <circle cx="60" cy="60" r="52" fill="none" stroke="var(--surface)" strokeWidth="10" />
          <circle
            cx="60"
            cy="60"
            r="52"
            fill="none"
            stroke="var(--primary)"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={RING}
            strokeDashoffset={RING * (1 - fraction)}
            className="transition-[stroke-dashoffset] duration-300 ease-linear"
          />
        </svg>
        <span
          role="timer"
          aria-label={describeDuration(timer.remainingMs)}
          className="absolute inset-0 flex items-center justify-center font-mono text-4xl font-bold tabular-nums text-primary"
        >
          {formatCountdown(timer.remainingMs)}
        </span>
      </div>
      <p className="text-2xl font-bold leading-snug">
        {holding
          ? `${SCRIPTS.holdStarted} ${NOTES.holdLeft(describeDuration(timer.remainingMs))}`
          : NOTES.waitLeft(describeDuration(timer.remainingMs))}
      </p>
    </div>
  );
}

/** "Step 3 of 9" with a segmented bar: done, skipped, current, still to do. */
function StepProgress({
  dots,
  label,
  critical,
}: {
  dots: readonly DotStatus[];
  label: string;
  critical: boolean;
}) {
  const SEGMENT: Record<DotStatus, string> = {
    done: "bg-success",
    missed: "bg-danger",
    current: "bg-primary motion-safe:animate-pulse",
    todo: "bg-surface-2",
  };
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Eyebrow>{label}</Eyebrow>
        {critical && (
          <span className="rounded-full border-2 border-danger/40 bg-danger-soft px-3 py-0.5 text-base font-bold text-danger">
            Important step
          </span>
        )}
      </div>
      <ol className="flex gap-1.5" aria-hidden="true">
        {dots.map((d, i) => (
          <li key={i} className={`h-2.5 flex-1 rounded-full ${SEGMENT[d]}`} />
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
        <p className="flex items-start gap-3 rounded-2xl border-2 border-warning-fg/50 bg-warning-bg px-4 py-3 text-2xl font-bold text-warning-fg motion-safe:animate-rise">
          <span aria-hidden="true">!</span>
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
    <Centered>
      <Emblem tone={reason === "nurse_called" ? "primary" : "plain"}>
        {reason === "nurse_called" ? <PhoneGlyph /> : <PauseIcon />}
      </Emblem>
      <ScreenHeading>
        {reason === "nurse_called" ? HEADINGS.nursePaused : HEADINGS.paused}
      </ScreenHeading>
      {reason === "nurse_called" && <Lead>{SCRIPTS.nurseCalled}</Lead>}
      <Lead>{SCRIPTS.paused}</Lead>
      <BigButton onClick={onContinue}>{LABELS.continue}</BigButton>
    </Centered>
  );
}

export function VisionUnavailableScreen({
  onContinue,
  onRetryCamera,
  snapshot,
}: {
  onContinue: () => void;
  onRetryCamera: () => void;
  snapshot: PatientSnapshot;
}) {
  const recovered = !snapshot.engine.vision.degraded && snapshot.visionError === null;
  return (
    <Centered alert>
      <Emblem tone={recovered ? "success" : "plain"}>
        {recovered ? <CheckIcon /> : <PauseIcon />}
      </Emblem>
      <ScreenHeading>{HEADINGS.visionUnavailable}</ScreenHeading>
      <Lead>{SCRIPTS.visionUnavailable}</Lead>
      <Panel tone={recovered ? "success" : "plain"}>
        <p className="text-xl font-bold">
          {recovered
            ? "Camera checks are working again. Tap Continue when you're ready."
            : snapshot.visionError
              ? VISION_FAILURE_NOTES[snapshot.visionError]
              : "We're reconnecting to camera checking."}
        </p>
      </Panel>
      <p className="text-xl text-muted">
        This pause is a checking problem; it does not mean you made a mistake.
      </p>
      {snapshot.visionError === "camera" && (
        <BigButton variant="secondary" onClick={onRetryCamera}>
          Retry camera
        </BigButton>
      )}
      <BigButton onClick={onContinue} disabled={!recovered}>
        {LABELS.continue}
      </BigButton>
    </Centered>
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
    <section
      className="stagger flex flex-1 flex-col justify-center gap-7 rounded-[2rem] border-2 border-danger/40 bg-danger-soft px-5 py-8 shadow-lift sm:px-8"
      role="alert"
    >
      <div
        aria-hidden="true"
        className="flex size-20 items-center justify-center rounded-full bg-danger text-danger-foreground"
      >
        <StopIcon />
      </div>
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
      <span className="text-[min(1em,7.5vw)] whitespace-nowrap">{phone}</span>
      {text.slice(at + phone.length)}
    </>
  );
}

export function CompletedScreen() {
  return (
    <Centered>
      <div
        aria-hidden="true"
        className="flex size-28 items-center justify-center rounded-full bg-success text-[var(--surface)] shadow-lift"
      >
        <svg viewBox="0 0 24 24" className="size-14" fill="none">
          <path
            d="m5 12.5 4.5 4.5L19 7.5"
            stroke="currentColor"
            strokeWidth="2.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <ScreenHeading>{HEADINGS.completed}</ScreenHeading>
      <Lead>{SCRIPTS.completed}</Lead>
    </Centered>
  );
}

// --- Icons (decorative) -------------------------------------------------------------

const ICON = "size-11";

function CameraIcon({ off = false }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={ICON} fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.8l1.4-2h6.6l1.4 2h1.8A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" />
      <circle cx="12" cy="13" r="3.6" />
      {off && <path d="M4 3.5 20.5 20" strokeLinecap="round" />}
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" className={ICON} fill="none" stroke="currentColor" strokeWidth="2.4">
      <path d="m5 12.5 4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" className={ICON} fill="currentColor">
      <rect x="6" y="5" width="4" height="14" rx="1.5" />
      <rect x="14" y="5" width="4" height="14" rx="1.5" />
    </svg>
  );
}

function PhoneGlyph() {
  return (
    <svg viewBox="0 0 24 24" className={ICON} fill="currentColor">
      <path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-10" fill="currentColor">
      <path d="M8.3 2h7.4L22 8.3v7.4L15.7 22H8.3L2 15.7V8.3z" />
      <rect x="7" y="10.6" width="10" height="2.8" rx="1" fill="var(--danger)" />
    </svg>
  );
}

function SpeakerIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 9.5v5h3.5L12 19V5L7.5 9.5z" fill="currentColor" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" />
    </svg>
  );
}

function RepeatIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-6 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      aria-hidden="true"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.7 5.6L4 15.5M4 20v-4.5h4.5" />
    </svg>
  );
}
