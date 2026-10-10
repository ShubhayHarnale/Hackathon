import { z } from "zod";
import { ISSUE_CODES, type EngineEvent } from "@/engine";
import { FrameResultSchema } from "@/vision/schema";

/**
 * Wire formats for the patient APIs. The client sends engine events exactly as the engine
 * emitted them; the server re-validates every field before anything reaches the
 * repository, so malformed data cannot enter the repository. This validates shape, not event provenance.
 */

const StepId = z.string().min(1).max(64);
const Seq = z.number().int().nonnegative();

const base = {
  eventSeq: Seq,
  at: z.number().finite(),
  run: z.enum(["practice", "real"]).nullable(),
};

const CommandSource = z.enum(["button", "voice"]);
const NeedsHumanCause = z.enum([
  "too_many_unmatched_frames",
  "too_many_attempts",
  "step_timeout",
  "vision_outage",
  "hold_interrupted",
]);
const CriticalMissCause = z.enum(["skipped", "hold_released_early"]);

export const StopReasonSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("critical_miss"),
    missedStepId: StepId,
    observedStepId: StepId,
    cause: CriticalMissCause,
  }),
  z.object({ kind: z.literal("needs_human"), stepId: StepId.nullable(), cause: NeedsHumanCause }),
  z.object({ kind: z.literal("ended"), by: z.enum(["patient", "coordinator", "system"]) }),
]);

const event = <T extends z.ZodRawShape>(shape: T) => z.object({ ...base, ...shape });

export const EngineEventSchema = z.discriminatedUnion("type", [
  event({ type: z.literal("practice_started") }),
  event({ type: z.literal("practice_completed") }),
  event({ type: z.literal("run_started") }),
  event({ type: z.literal("step_activated"), stepId: StepId, index: Seq }),
  event({
    type: z.literal("step_observed"),
    stepId: StepId,
    holding: z.boolean(),
    evidenceSeq: Seq,
  }),
  event({
    type: z.literal("step_confirmed"),
    stepId: StepId,
    methods: z.array(z.enum(["visual", "hold", "voice", "tap", "wait"])).max(5),
    evidenceSeq: Seq.nullable(),
    activeMs: z.number().nonnegative(),
  }),
  event({ type: z.literal("correction"), stepId: StepId, issue: z.enum(ISSUE_CODES) }),
  event({ type: z.literal("hold_interrupted"), stepId: StepId, attempts: Seq }),
  event({ type: z.literal("step_missed"), stepId: StepId, observedStepId: StepId }),
  event({
    type: z.literal("flagged"),
    stepId: StepId.nullable(),
    flag: z.enum(["skipped", "interrupted_hold", "nurse_called"]),
  }),
  event({
    type: z.literal("paused"),
    source: z.enum(["button", "voice", "system"]),
    reason: z.enum(["user", "nurse_called", "vision_unavailable"]),
  }),
  event({ type: z.literal("resumed"), source: CommandSource }),
  event({ type: z.literal("nurse_called"), source: CommandSource }),
  event({ type: z.literal("vision_degraded"), consecutiveErrors: Seq }),
  event({ type: z.literal("vision_recovered") }),
  event({
    type: z.literal("critical_miss"),
    missedStepId: StepId,
    observedStepId: StepId,
    cause: CriticalMissCause,
    evidenceSeq: Seq,
  }),
  event({ type: z.literal("needs_human"), stepId: StepId.nullable(), cause: NeedsHumanCause }),
  event({ type: z.literal("completed") }),
  event({ type: z.literal("stopped"), reason: StopReasonSchema }),
]);

// Compile-time guard: whatever the schema accepts can be stored as an EngineEvent.
// If the engine's event union changes, this line stops compiling until the schema follows.
const _schemaMatchesEngine: (e: z.infer<typeof EngineEventSchema>) => EngineEvent = (e) => e;
void _schemaMatchesEngine;

export const MAX_EVENTS_PER_BATCH = 100;

export const EventsBodySchema = z.object({
  events: z.array(EngineEventSchema).min(1).max(MAX_EVENTS_PER_BATCH),
});
export type EventsBody = z.infer<typeof EventsBodySchema>;

/** A 640px JPEG at q0.7 is ~40-80 KB; this leaves plenty of room. */
export const MAX_EVIDENCE_BASE64 = 2_000_000;

export const EvidenceBodySchema = z.object({
  stepId: StepId,
  evidenceSeq: Seq,
  capturedAt: z.number().finite(),
  jpegBase64: z.string().min(4).max(MAX_EVIDENCE_BASE64),
  visionResult: FrameResultSchema.nullable().default(null),
});
export type EvidenceBody = z.input<typeof EvidenceBodySchema>;

export const CreateSessionBodySchema = z.object({
  participantId: z.string().min(1).max(64),
  protocolId: z.string().min(1).max(64),
  mode: z.enum(["live", "replay", "mock"]).default("live"),
});
