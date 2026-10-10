import type { EngineEvent, FrameResult, Millis, StepId, StopReason } from "@/engine";
import type { AlertKind, AlertRecipient, NotifyResult } from "@/escalation";
import type { Protocol } from "@/protocol";

/** Synthetic participants only: display name and trial number, no PHI. */
export interface ParticipantRecord {
  readonly id: string;
  readonly displayName: string;
  readonly trialNumber: string;
  readonly trustedContact: {
    readonly name: string;
    readonly phone: string;
    /** Given during setup. Without it the trusted contact is never notified. */
    readonly consented: boolean;
  } | null;
}

export type ProtocolStatus = "draft" | "published";

export interface ProtocolRecord {
  readonly id: string;
  readonly version: number;
  readonly status: ProtocolStatus;
  readonly sourceText: string | null;
  readonly protocol: Protocol;
  readonly createdAt: Millis;
  readonly publishedAt: Millis | null;
}

export type SessionMode = "live" | "replay" | "mock";
export type SessionStatus = "created" | "practice" | "active" | "paused" | "completed" | "stopped";

export interface SessionRecord {
  readonly id: string;
  readonly participantId: string;
  readonly protocolId: string;
  readonly protocolVersion: number;
  readonly mode: SessionMode;
  readonly status: SessionStatus;
  readonly stopReason: StopReason | null;
  readonly createdAt: Millis;
  readonly startedAt: Millis | null;
  readonly endedAt: Millis | null;
}

export interface StoredEvent {
  readonly sessionId: string;
  readonly event: EngineEvent;
  /** Server receive time; `event.at` is the client's clock. */
  readonly recordedAt: Millis;
}

export interface EvidenceFrameRecord {
  readonly id: string;
  readonly sessionId: string;
  readonly stepId: StepId;
  readonly seq: number;
  readonly capturedAt: Millis;
  readonly storagePath: string;
  readonly visionResult: FrameResult | null;
}

export type AlertStatus = "open" | "reviewed";

/**
 * A study-team review of one flagged event (critical miss, skipped step, nurse called...).
 * Flags themselves are derived from the append-only event log; only the review is stored.
 */
export interface FlagReview {
  readonly sessionId: string;
  readonly eventSeq: number;
  readonly reviewedAt: Millis;
  readonly note: string | null;
}

export interface AlertRecord {
  readonly dedupeKey: string | null;
  readonly delivery: NotifyResult | null;
  readonly id: string;
  readonly sessionId: string;
  readonly kind: AlertKind;
  readonly recipient: AlertRecipient;
  readonly message: string;
  readonly status: AlertStatus;
  readonly createdAt: Millis;
  readonly reviewedAt: Millis | null;
}

export type NewAlert = Omit<
  AlertRecord,
  "id" | "status" | "reviewedAt" | "delivery" | "dedupeKey"
> & {
  readonly dedupeKey?: string;
};

export interface NewSession {
  readonly participantId: string;
  readonly protocolId: string;
  readonly mode: SessionMode;
}

/**
 * Data access. Implementations: in-memory (default, no setup) and Supabase.
 * Step events are append-only; `appendEvents` is idempotent on (sessionId, eventSeq).
 */
export interface Repository {
  listParticipants(): Promise<readonly ParticipantRecord[]>;
  getParticipant(id: string): Promise<ParticipantRecord | null>;

  listProtocols(): Promise<readonly ProtocolRecord[]>;
  /** A specific version, or the latest version (draft or published) when omitted. */
  getProtocol(id: string, version?: number): Promise<ProtocolRecord | null>;
  /** What new sessions run: the latest published version. */
  getLatestPublishedProtocol(id: string): Promise<ProtocolRecord | null>;
  saveProtocolDraft(protocol: Protocol, sourceText: string | null): Promise<ProtocolRecord>;
  publishProtocol(id: string, version: number): Promise<ProtocolRecord>;

  /** Returns the session and the raw link token (only its hash is stored). */
  createSession(input: NewSession): Promise<{ session: SessionRecord; token: string }>;
  getSession(id: string): Promise<SessionRecord | null>;
  getSessionByToken(token: string): Promise<SessionRecord | null>;
  listSessions(): Promise<readonly SessionRecord[]>;
  updateSession(
    id: string,
    patch: Partial<Pick<SessionRecord, "status" | "stopReason" | "startedAt" | "endedAt">>,
  ): Promise<SessionRecord>;

  appendEvents(sessionId: string, events: readonly EngineEvent[]): Promise<void>;
  listEvents(sessionId: string): Promise<readonly StoredEvent[]>;

  saveEvidenceFrame(
    frame: Omit<EvidenceFrameRecord, "id" | "storagePath">,
    jpeg: Uint8Array,
  ): Promise<EvidenceFrameRecord>;
  listEvidenceFrames(sessionId: string): Promise<readonly EvidenceFrameRecord[]>;
  /** Short-lived URL for a private evidence frame. */
  getEvidenceUrl(frame: EvidenceFrameRecord): Promise<string>;

  createAlert(alert: NewAlert): Promise<AlertRecord>;
  recordAlertDelivery(id: string, delivery: NotifyResult): Promise<void>;
  listAlerts(filter?: {
    sessionId?: string;
    status?: AlertStatus;
  }): Promise<readonly AlertRecord[]>;
  markAlertReviewed(id: string): Promise<AlertRecord>;

  listFlagReviews(sessionId: string): Promise<readonly FlagReview[]>;
  /** Idempotent: reviewing an already-reviewed flag keeps the first review. */
  markFlagReviewed(sessionId: string, eventSeq: number, note?: string | null): Promise<FlagReview>;
}
