"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PRACTICE_STEPS } from "@/demo";
import {
  EngineRunner,
  currentStep as engineCurrentStep,
  type EngineEvent,
  type EngineState,
  type FrameResult,
} from "@/engine";
import type { Protocol, Step } from "@/protocol/schema";
import {
  SCENARIOS,
  ScriptedVisionProvider,
  VisionLoop,
  captureVideoFrame,
  createHttpVisionProvider,
  frameContext,
  isScenarioName,
  type ScenarioName,
} from "@/vision";

type Source = "scripted" | "camera" | "file";

interface FrameLog {
  seq: number;
  latencyMs: number;
  result?: FrameResult;
  error?: string;
}

export function VisionLab({
  protocols,
  serverVision,
}: {
  protocols: readonly Protocol[];
  serverVision: string;
}) {
  const [protocolId, setProtocolId] = useState(protocols[0]?.id ?? "");
  const [source, setSource] = useState<Source>("scripted");
  const [scenario, setScenario] = useState<ScenarioName>("happy");
  const [autoConfirm, setAutoConfirm] = useState(true);
  const [state, setState] = useState<EngineState | null>(null);
  const [events, setEvents] = useState<EngineEvent[]>([]);
  const [frames, setFrames] = useState<FrameLog[]>([]);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const runnerRef = useRef<EngineRunner | null>(null);
  const loopRef = useRef<VisionLoop | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const protocol = protocols.find((p) => p.id === protocolId) ?? null;
  const stepsById = useMemo(() => {
    const map = new Map<string, Step>();
    for (const s of [...PRACTICE_STEPS, ...(protocol?.steps ?? [])]) map.set(s.id, s);
    return map;
  }, [protocol]);

  const teardown = useCallback(() => {
    loopRef.current?.stop();
    loopRef.current = null;
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    runnerRef.current = null;
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => () => (teardown(), stopCamera()), [teardown, stopCamera]);

  async function startCamera() {
    setMediaError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (error) {
      setMediaError(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Camera permission was denied. Allow camera access in the browser and try again."
          : "Couldn't start the camera on this device.",
      );
    }
  }

  function onFile(file: File | undefined) {
    if (!file) return;
    stopCamera();
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    const url = URL.createObjectURL(file);
    setFileUrl(url);
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.src = url;
    }
  }

  function start(practice: boolean) {
    if (!protocol) return;
    teardown();
    setEvents([]);
    setFrames([]);

    const runner = new EngineRunner({ steps: protocol.steps, practiceSteps: PRACTICE_STEPS });
    runnerRef.current = runner;
    runner.subscribe((evts, s) => {
      setState(s);
      setEvents((prev) => [...evts.toReversed(), ...prev].slice(0, 60));
      if (!autoConfirm) return;
      // Scripted vision can't speak: confirm spoken steps for it, as a patient would.
      for (const e of evts) {
        if (e.type !== "step_activated") continue;
        const step = stepsById.get(e.stepId);
        if (step && step.verification !== "visual") {
          setTimeout(
            () =>
              runner.dispatch({
                type: "verbal_confirm",
                at: Date.now(),
                stepId: e.stepId,
                method: "tap",
              }),
            1500,
          );
        }
      }
    });

    const provider =
      source === "scripted"
        ? new ScriptedVisionProvider(scenario, [...PRACTICE_STEPS, ...protocol.steps])
        : createHttpVisionProvider();
    const loop = new VisionLoop({
      provider,
      sessionId: `lab-${crypto.randomUUID()}`,
      capture: async () => {
        if (source === "scripted") return { base64: "", width: 0, height: 0 };
        const video = videoRef.current;
        const canvas = canvasRef.current;
        return video && canvas ? captureVideoFrame(video, canvas) : null;
      },
      getContext: () => frameContext(runner.state, stepsById),
      dispatch: (input) => runner.dispatch(input),
      onResult: (info) => setFrames((prev) => [info, ...prev].slice(0, 30)),
    });
    loopRef.current = loop;

    runner.dispatch({ type: practice ? "start_practice" : "start", at: Date.now() });
    setState(runner.state);
    tickRef.current = setInterval(() => runner.dispatch({ type: "tick", at: Date.now() }), 250);
    loop.start();
    if (source === "file") void videoRef.current?.play();
  }

  const send = (type: "pause" | "resume" | "call_nurse") =>
    runnerRef.current?.dispatch({ type, at: Date.now(), source: "button" });

  const current = state ? engineCurrentStep(state) : null;
  const currentStep = current ? stepsById.get(current.id) : undefined;
  const progress = state?.run?.progress[state.run.index];
  const holdLeft =
    progress?.status === "holding" && current?.timerSeconds
      ? Math.max(0, current.timerSeconds - Math.floor(progress.holdMs / 1000))
      : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <section className="flex flex-col gap-4" aria-label="Setup">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 font-bold">
            Protocol
            <select
              value={protocolId}
              onChange={(e) => setProtocolId(e.target.value)}
              className="rounded-lg border-2 border-border bg-background px-2 py-2"
            >
              {protocols.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 font-bold">
            Vision source
            <select
              value={source}
              onChange={(e) => {
                const next = e.target.value as Source;
                setSource(next);
                setAutoConfirm(next === "scripted");
                if (next === "camera") void startCamera();
                else stopCamera();
              }}
              className="rounded-lg border-2 border-border bg-background px-2 py-2"
            >
              <option value="scripted">Scripted scenario (no camera)</option>
              <option value="camera">Camera → server vision ({serverVision})</option>
              <option value="file">Video file (replay) → server vision ({serverVision})</option>
            </select>
          </label>
          {source === "scripted" && (
            <label className="flex flex-col gap-1 font-bold sm:col-span-2">
              Scenario
              <select
                value={scenario}
                onChange={(e) => isScenarioName(e.target.value) && setScenario(e.target.value)}
                className="rounded-lg border-2 border-border bg-background px-2 py-2"
              >
                {Object.entries(SCENARIOS).map(([name, label]) => (
                  <option key={name} value={name}>
                    {name}: {label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {source === "file" && (
            <label className="flex flex-col gap-1 font-bold sm:col-span-2">
              Video file
              <input type="file" accept="video/*" onChange={(e) => onFile(e.target.files?.[0])} />
            </label>
          )}
          <label className="flex items-center gap-2 sm:col-span-2">
            <input
              type="checkbox"
              checked={autoConfirm}
              onChange={(e) => setAutoConfirm(e.target.checked)}
              className="size-5"
            />
            Auto-confirm spoken steps after 1.5 s
          </label>
        </div>
        {mediaError && (
          <p role="alert" className="font-bold text-danger">
            {mediaError}
          </p>
        )}
        <video
          ref={videoRef}
          playsInline
          muted
          className={`aspect-video w-full rounded-xl bg-surface object-contain ${source === "camera" ? "-scale-x-100" : ""} ${source === "scripted" ? "hidden" : ""}`}
        />
        <canvas ref={canvasRef} className="hidden" />
        {serverVision === "mock" && source !== "scripted" && (
          <p className="rounded-lg bg-warning-bg px-3 py-2 text-warning-fg">
            Server vision is the mock (it always sees the current step). Set VISION_PROVIDER=gemini
            and GEMINI_API_KEY to test real frames.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <LabButton onClick={() => start(false)} primary>
            Start run
          </LabButton>
          <LabButton onClick={() => start(true)}>Start practice</LabButton>
          <LabButton onClick={() => send("pause")}>Pause</LabButton>
          <LabButton onClick={() => send("resume")}>Resume</LabButton>
          <LabButton
            onClick={() =>
              current &&
              runnerRef.current?.dispatch({
                type: "verbal_confirm",
                at: Date.now(),
                stepId: current.id,
                method: "tap",
              })
            }
          >
            Say “done”
          </LabButton>
          <LabButton onClick={() => send("call_nurse")}>Call nurse</LabButton>
        </div>
      </section>

      <section className="flex flex-col gap-4" aria-label="Live state" aria-live="polite">
        <div className="rounded-xl border-2 border-border p-4">
          <p className="text-sm uppercase tracking-wide text-muted">Engine</p>
          <p className="text-2xl font-bold">
            {state?.status ?? "not started"}
            {state?.stopReason && <span className="text-danger"> · {describeStop(state)}</span>}
          </p>
          {currentStep && (
            <p className="mt-2 text-xl">
              Step {currentStep.order}: {currentStep.instruction}
              {currentStep.critical && (
                <span className="ml-2 rounded-full bg-danger px-2 text-sm font-bold text-danger-foreground">
                  Critical
                </span>
              )}
            </p>
          )}
          {progress && (
            <p className="mt-1 text-muted">
              streak {progress.matchStreak} · unmatched {progress.unmatchedFrames} ·{" "}
              {progress.status}
              {holdLeft !== null && (
                <strong className="text-foreground"> · hold {holdLeft}s left</strong>
              )}
            </p>
          )}
          {state?.run && (
            <ol className="mt-3 flex flex-wrap gap-1" aria-label="Step progress">
              {state.run.progress.map((p) => (
                <li
                  key={p.stepId}
                  title={`${p.stepId}: ${p.status}`}
                  className={`size-4 rounded-full border-2 ${
                    p.status === "confirmed"
                      ? "border-success bg-success"
                      : p.status === "missed"
                        ? "border-danger bg-danger"
                        : p.status === "pending"
                          ? "border-border"
                          : "border-primary bg-primary"
                  }`}
                />
              ))}
            </ol>
          )}
        </div>

        <div className="rounded-xl border-2 border-border p-4">
          <p className="mb-2 text-sm uppercase tracking-wide text-muted">Frames (latest first)</p>
          <ul className="max-h-48 overflow-auto font-mono text-sm">
            {frames.map((f) => (
              <li key={f.seq}>
                #{f.seq} {f.latencyMs}ms{" "}
                {f.error ? (
                  <span className="text-danger">error: {f.error}</span>
                ) : (
                  <>
                    {f.result?.observedStepId ?? "none"} @{f.result?.confidence.toFixed(2)}
                    {f.result?.issue && (
                      <span className="text-warning-fg"> [{f.result.issue}]</span>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border-2 border-border p-4">
          <p className="mb-2 text-sm uppercase tracking-wide text-muted">Events (latest first)</p>
          <ul className="max-h-72 overflow-auto font-mono text-sm">
            {events.map((e) => (
              <li
                key={e.eventSeq}
                className={
                  e.type === "critical_miss" || e.type === "needs_human"
                    ? "font-bold text-danger"
                    : ""
                }
              >
                {e.eventSeq} {e.type} {"stepId" in e && e.stepId ? e.stepId : ""}
                {"issue" in e ? ` ${e.issue}` : ""}
                {"cause" in e ? ` (${e.cause})` : ""}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

function describeStop(state: EngineState): string {
  const r = state.stopReason;
  if (!r) return "";
  if (r.kind === "critical_miss") return `critical miss: ${r.missedStepId} (${r.cause})`;
  if (r.kind === "needs_human") return `needs human: ${r.cause}`;
  return `ended by ${r.by}`;
}

function LabButton({
  children,
  onClick,
  primary = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-11 rounded-lg px-4 font-bold ${primary ? "bg-primary text-primary-foreground" : "border-2 border-border"}`}
    >
      {children}
    </button>
  );
}
