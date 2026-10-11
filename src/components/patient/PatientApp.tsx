"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { DemoBanner } from "@/components/DemoBanner";
import { practiceStepsFor } from "@/demo";
import { currentStep } from "@/engine";
import { createVoiceProvider } from "@/voice";
import { publicEnv } from "@/lib/env";
import { PatientMedia } from "@/patient/capture";
import { LABELS, NOTES } from "@/patient/copy";
import { PatientController, type VisionConfig } from "@/patient/controller";
import { EvidenceUploader, httpSendEvidence } from "@/patient/evidence";
import { EventOutbox, httpSendEvents } from "@/patient/outbox";
import { PatientVoice, type VoiceStatus } from "@/patient/voice";
import { MAX_EVENTS_PER_BATCH } from "@/patient/schema";
import { canPause, deriveScreen, type MediaPermission, type UiPhase } from "@/patient/screen";
import type { Protocol } from "@/protocol/schema";
import {
  CameraCheckScreen,
  CameraDeniedScreen,
  CompletedScreen,
  PausedScreen,
  PermissionsScreen,
  ReadyScreen,
  StepScreen,
  StoppedScreen,
  VisionUnavailableScreen,
  WelcomeScreen,
} from "./screens";
import { BigButton, CallNurseLink, ScreenHeading } from "./ui";

export interface PatientAppProps {
  readonly token: string;
  readonly sessionId: string;
  readonly protocol: Protocol;
  readonly vision: VisionConfig;
}

/**
 * The patient flow (mobile): welcome -> permissions -> camera check and practice ->
 * the procedure, one step at a time -> done, or stop and call the nurse.
 * All logic lives in PatientController; this component renders its snapshot.
 */
export function PatientApp({ token, sessionId, protocol, vision }: PatientAppProps) {
  const phone = publicEnv.NEXT_PUBLIC_TRIAL_NURSE_PHONE;
  const scripted = vision.kind === "scripted";
  const replay = vision.kind === "replay";
  const [replayFile, setReplayFile] = useState<string | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [phase, setPhase] = useState<UiPhase>("welcome");
  const [camera, setCamera] = useState<MediaPermission>("unknown");
  const [mic, setMic] = useState<MediaPermission>("unknown");
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>("off");
  const online = useOnline();

  const [{ controller, media, voice, attachVideo, attachCanvas }] = useState(() => {
    const media = new PatientMedia(scripted);
    const controller = new PatientController({
      sessionId,
      sessionToken: token,
      steps: protocol.steps,
      practiceSteps: practiceStepsFor(protocol),
      vision,
      capture: media.capture,
      outbox: new EventOutbox({ send: httpSendEvents(token) }),
      evidence: new EvidenceUploader({ send: httpSendEvidence(token) }),
    });
    media.label = () => currentStep(controller.runner.state)?.id ?? "";
    media.checkPausedReplay = () =>
      controller.runner.state.status === "paused" &&
      controller.runner.state.pause?.reason === "vision_unavailable";
    const voice = new PatientVoice(controller, {
      onStatus: setVoiceStatus,
      createProvider: () => createVoiceProvider(undefined, { sessionToken: token }),
    });
    return {
      controller,
      media,
      voice,
      attachVideo: media.setVideo,
      attachCanvas: media.setCanvas,
    };
  });
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const { engine } = snapshot;
  const screen = deriveScreen({ phase, camera, visionMode: vision.kind, engine });

  // Timers run only while mounted (StrictMode remounts are safe: both calls are idempotent).
  useEffect(() => {
    controller.resumeTimers();
    return () => controller.suspend();
  }, [controller]);

  // Voice (Phase 5): the coach is created on the first tap and started once the
  // microphone question is answered; see PatientVoice.
  useEffect(() => () => voice.dispose(), [voice]);

  usePersistenceLifecycle(controller, token);
  useWakeLock(
    engine.status === "practice" || engine.status === "active" || engine.status === "paused",
  );

  // Release the camera when leaving the page.
  useEffect(
    () => () => {
      media.stopStream();
      media.clearReplay();
    },
    [media],
  );

  useEffect(() => {
    if (!replay) return;
    if (engine.status !== "active") media.pauseReplay();
    else
      void media.playReplay().catch(() => {
        controller.command("pause", "button");
        setReplayError("The video could not play. Check that this browser supports the recording.");
      });
  }, [replay, engine.status, media, controller]);

  const requestMedia = useCallback(async () => {
    if (scripted) {
      setMic("unavailable");
      voice.start(false);
      setPhase("camera_check");
      controller.startPractice();
      return;
    }
    setCamera("requesting");
    const result = await requestCameraAndMic();
    await media.setStream(result.stream);
    setCamera(result.camera);
    setMic(result.mic);
    voice.start(result.mic === "granted");
    if (result.camera === "granted" || scripted) {
      setPhase("camera_check");
      if (controller.runner.state.status === "idle" && !controller.runner.state.practiceCompleted) {
        controller.startPractice();
      }
    }
  }, [controller, media, voice, scripted]);

  const callNurse = useCallback(() => controller.command("call_nurse", "button"), [controller]);
  const instructionFor = (stepId: string) => controller.step(stepId)?.instruction;
  const runStep = (() => {
    const s = currentStep(engine);
    return s ? controller.step(s.id) : undefined;
  })();

  const showCamera =
    screen.kind === "camera_check" ||
    screen.kind === "step" ||
    ((camera === "granted" || (replay && !!replayFile)) &&
      (screen.kind === "ready" ||
        screen.kind === "paused" ||
        screen.kind === "vision_unavailable")) ||
    (replay && screen.kind === "permissions");

  return (
    <div className="flex min-h-dvh flex-col">
      {(protocol.isDemo || scripted || replay) && <DemoBanner />}
      {(scripted || replay) && (
        <p className="bg-surface px-4 py-2 text-center text-xl font-bold">
          {replay ? "Recorded video replay" : "Scripted demo — simulated checks"}
        </p>
      )}
      {replayError && (
        <p role="alert" className="px-4 py-2 text-xl text-danger">
          {replayError}
        </p>
      )}
      {!online && (
        <p role="alert" className="bg-danger px-4 py-3 text-xl font-bold text-danger-foreground">
          {NOTES.offline}
        </p>
      )}

      <main
        className={`mx-auto w-full flex-1 gap-5 px-4 py-5 ${showCamera ? "grid content-start lg:max-w-6xl lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start lg:gap-8" : "flex max-w-xl flex-col"}`}
      >
        <CameraView
          attachVideo={attachVideo}
          visible={showCamera}
          live={camera === "granted" || (replay && !!replayFile)}
          replay={replay}
          onEnded={() => {
            if (replay && engine.status === "active") {
              setReplayError(
                "The recording ended before every step was verified. Use a longer recording in a new demo.",
              );
              controller.dispatch({ type: "stop", at: Date.now(), by: "system" });
            }
          }}
        />

        {screen.kind === "welcome" && (
          <WelcomeScreen
            title={protocol.title}
            onStart={() => {
              voice.prime(); // inside the tap, so mobile browsers allow speech later
              setPhase("permissions");
            }}
          />
        )}
        {screen.kind === "permissions" && !replay && (
          <PermissionsScreen
            scripted={scripted}
            requesting={camera === "requesting"}
            onAllow={() => void requestMedia()}
          />
        )}
        {screen.kind === "permissions" && replay && (
          <section className="flex flex-col gap-5">
            <ScreenHeading>Choose a recorded procedure</ScreenHeading>
            <p className="text-xl">
              Use a synthetic prop demonstration, starting at the first procedure step. The video
              stays on this device; sampled frames are sent for checking and evidence is saved for
              the study team.
            </p>
            <p className="text-xl">
              Replay uses the configured server vision provider. With the mock provider, all visual
              checks are simulated.
            </p>
            <label className="flex flex-col gap-2 text-xl font-bold">
              Video recording
              <input
                type="file"
                accept="video/*"
                className="min-h-16 w-full min-w-0 rounded-xl border-2 border-border p-3"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setReplayError(null);
                  void media
                    .setReplay(file)
                    .then(() => setReplayFile(file.name))
                    .catch(() =>
                      setReplayError("Could not load this recording. Choose another video."),
                    );
                }}
              />
            </label>
            {replayFile && <p className="break-words text-xl">Selected: {replayFile}</p>}
            <BigButton
              disabled={!replayFile}
              onClick={() => {
                voice.start(false);
                void media
                  .playReplay()
                  .then(() => controller.start())
                  .catch(() =>
                    setReplayError("This video cannot play. Try an MP4 or WebM recording."),
                  );
              }}
            >
              Start replay
            </BigButton>
          </section>
        )}
        {screen.kind === "camera_denied" && (
          <CameraDeniedScreen
            phone={phone}
            onRetry={() => void requestMedia()}
            onCall={callNurse}
          />
        )}
        {screen.kind === "camera_check" && (
          <CameraCheckScreen
            snapshot={snapshot}
            step={runStep}
            voiceNote={
              mic === "denied" || mic === "unavailable"
                ? NOTES.micDenied
                : voiceStatus === "speak_only"
                  ? NOTES.voiceCommandsOff
                  : null
            }
          />
        )}
        {screen.kind === "ready" && <ReadyScreen onStart={() => controller.start()} />}
        {screen.kind === "step" && (
          <StepScreen
            snapshot={snapshot}
            step={runStep}
            onDone={() => controller.command("done", "button")}
            onRepeat={() => controller.command("repeat", "button")}
          />
        )}
        {screen.kind === "paused" && (
          <PausedScreen
            reason={screen.reason}
            onContinue={() => controller.command("continue", "button")}
          />
        )}
        {screen.kind === "vision_unavailable" && (
          <VisionUnavailableScreen
            snapshot={snapshot}
            onRetryCamera={() => void requestMedia()}
            onContinue={() => controller.command("continue", "button")}
          />
        )}
        {screen.kind === "stopped" && (
          <StoppedScreen
            reason={screen.reason}
            phone={phone}
            instructionFor={instructionFor}
            onCall={callNurse}
          />
        )}
        {screen.kind === "completed" && <CompletedScreen />}
      </main>

      {/* Always reachable: Pause while running (a paused screen's main button is Continue),
          and the nurse on every screen (the stop and camera screens have their own big one). */}
      {screen.kind !== "stopped" && screen.kind !== "camera_denied" && (
        <nav
          aria-label="Help and controls"
          className="sticky bottom-0 border-t-2 border-border bg-background px-4 py-3"
        >
          <div className="mx-auto flex w-full max-w-xl gap-3">
            {canPause(engine) && (
              <BigButton
                variant="secondary"
                size="bar"
                onClick={() => controller.command("pause", "button")}
              >
                {LABELS.pause}
              </BigButton>
            )}
            <div className="flex flex-1 [&>a]:w-full">
              <CallNurseLink phone={phone} onCall={callNurse} size="bar" />
            </div>
          </div>
        </nav>
      )}
      <canvas ref={attachCanvas} className="hidden" aria-hidden="true" />
    </div>
  );
}

function CameraView({
  attachVideo,
  visible,
  live,
  replay = false,
  onEnded,
}: {
  attachVideo: (el: HTMLVideoElement | null) => void;
  visible: boolean;
  live: boolean;
  replay?: boolean;
  onEnded: () => void;
}) {
  // The <video> stays mounted on every screen so the stream survives screen changes.
  return (
    <div className={visible ? "w-full min-w-0" : "hidden"}>
      <video
        ref={attachVideo}
        playsInline
        muted
        autoPlay={!replay}
        onEnded={onEnded}
        aria-label={replay ? "Recorded procedure preview" : "Your camera"}
        className={`aspect-[4/3] max-h-[65dvh] w-full ${replay ? "" : "-scale-x-100"} rounded-2xl bg-surface object-contain ${live ? "" : "hidden"}`}
      />
      {!live && visible && (
        <div className="flex min-h-20 items-center justify-center rounded-2xl border-2 border-dashed border-border bg-surface px-4 py-2 text-center text-xl text-muted">
          {NOTES.scriptedCamera}
        </div>
      )}
    </div>
  );
}

// --- Browser plumbing ----------------------------------------------------------------

interface MediaResult {
  stream: MediaStream | null;
  camera: MediaPermission;
  mic: MediaPermission;
}

const VIDEO: MediaTrackConstraints = { facingMode: "user" };

function cameraErrorState(error: unknown): MediaPermission {
  const name = error instanceof DOMException ? error.name : "";
  return name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable";
}

/**
 * Asks for camera and microphone together (one prompt). If that fails, retries with the
 * camera alone, so a denied or missing microphone still leaves buttons-only mode.
 * The microphone track is released straight away: only the permission is needed now.
 */
async function requestCameraAndMic(): Promise<MediaResult> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return { stream: null, camera: "unavailable", mic: "unavailable" };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: VIDEO, audio: true });
    stream.getAudioTracks().forEach((t) => t.stop());
    return { stream, camera: "granted", mic: "granted" };
  } catch (both) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: VIDEO, audio: false });
      return { stream, camera: "granted", mic: cameraErrorState(both) };
    } catch (videoOnly) {
      return { stream: null, camera: cameraErrorState(videoOnly), mic: "unknown" };
    }
  }
}

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

/**
 * Sends queued events as soon as the connection returns, and hands any still-unsent
 * events to sendBeacon when the page is hidden (tab closed, phone locked).
 */
function usePersistenceLifecycle(controller: PatientController, token: string) {
  useEffect(() => {
    const outbox = controller.outbox;
    const onOnline = () => outbox.flushSoon();
    const onHide = () => {
      const events = outbox.peek().slice(0, MAX_EVENTS_PER_BATCH);
      if (events.length === 0 || !navigator.sendBeacon) return;
      navigator.sendBeacon(
        `/api/patient/${encodeURIComponent(token)}/events`,
        new Blob([JSON.stringify({ events })], { type: "application/json" }),
      );
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pagehide", onHide);
    };
  }, [controller, token]);
}

/** Keeps the screen on while a run is going (best effort; not every browser has it). */
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        const next = await navigator.wakeLock.request("screen");
        if (cancelled) void next.release();
        else lock = next;
      } catch {
        // Denied or unsupported (e.g. low battery): the run continues without it.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, [active]);
}
