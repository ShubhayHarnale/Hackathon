import type { NotifyResult } from "@/escalation";
import { sessionPatchFor } from "@/patient/session-status";
import type { EngineEvent } from "@/engine";
import type { Protocol } from "@/protocol/schema";
import type {
  AlertRecord,
  AlertStatus,
  EvidenceFrameRecord,
  FlagReview,
  NewSession,
  NewAlert,
  ParticipantRecord,
  ProtocolRecord,
  Repository,
  SessionRecord,
  StoredEvent,
} from "./types";
import { hashToken, newToken } from "./tokens";

export interface MemorySeed {
  readonly participants?: readonly ParticipantRecord[];
  /** Seeded as published version 1. */
  readonly protocols?: readonly Protocol[];
  readonly now?: () => number;
}

/**
 * In-memory repository: the default, so the app runs with no database. Data lives for
 * the life of the server process. Mirrors the Supabase rules: step events are
 * append-only and idempotent on (sessionId, eventSeq); published protocols are immutable.
 */
export class MemoryRepository implements Repository {
  private readonly now: () => number;
  private readonly participants = new Map<string, ParticipantRecord>();
  /** protocolId -> versions, ascending. */
  private readonly protocols = new Map<string, ProtocolRecord[]>();
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly sessionTokens = new Map<string, string>(); // tokenHash -> sessionId
  private readonly events = new Map<string, Map<number, StoredEvent>>();
  private readonly frames = new Map<string, { record: EvidenceFrameRecord; jpeg: Uint8Array }>();
  private readonly alerts = new Map<string, AlertRecord>();
  private readonly flagReviews = new Map<string, FlagReview>(); // `${sessionId}:${eventSeq}`

  constructor(seed: MemorySeed = {}) {
    this.now = seed.now ?? (() => Date.now());
    for (const p of seed.participants ?? []) this.participants.set(p.id, p);
    for (const protocol of seed.protocols ?? []) {
      const at = this.now();
      this.protocols.set(protocol.id, [
        {
          id: protocol.id,
          version: 1,
          status: "published",
          sourceText: null,
          protocol,
          createdAt: at,
          publishedAt: at,
        },
      ]);
    }
  }

  // --- Participants --------------------------------------------------------------------

  async listParticipants() {
    return [...this.participants.values()];
  }

  async getParticipant(id: string) {
    return this.participants.get(id) ?? null;
  }

  // --- Protocols -----------------------------------------------------------------------

  async listProtocols() {
    return [...this.protocols.values()]
      .map((versions) => versions.at(-1))
      .filter((r): r is ProtocolRecord => r !== undefined)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async getProtocol(id: string, version?: number) {
    const versions = this.protocols.get(id) ?? [];
    if (version === undefined) return versions.at(-1) ?? null;
    return versions.find((v) => v.version === version) ?? null;
  }

  async getLatestPublishedProtocol(id: string) {
    const versions = this.protocols.get(id) ?? [];
    return versions.filter((v) => v.status === "published").at(-1) ?? null;
  }

  async saveProtocolDraft(protocol: Protocol, sourceText: string | null) {
    const versions = this.protocols.get(protocol.id) ?? [];
    const latest = versions.at(-1);
    const record: ProtocolRecord = {
      id: protocol.id,
      // A draft is edited in place; a published version is immutable, so edits make a new one.
      version: latest?.status === "draft" ? latest.version : (latest?.version ?? 0) + 1,
      status: "draft",
      sourceText,
      protocol,
      createdAt: this.now(),
      publishedAt: null,
    };
    const next =
      latest?.status === "draft" ? [...versions.slice(0, -1), record] : [...versions, record];
    this.protocols.set(protocol.id, next);
    return record;
  }

  async publishProtocol(id: string, version: number) {
    const versions = this.protocols.get(id) ?? [];
    const index = versions.findIndex((v) => v.version === version);
    const existing = versions[index];
    if (!existing) throw new Error(`protocol ${id} v${version} not found`);
    if (existing.status === "published") return existing;
    const published: ProtocolRecord = { ...existing, status: "published", publishedAt: this.now() };
    this.protocols.set(
      id,
      versions.map((v, i) => (i === index ? published : v)),
    );
    return published;
  }

  // --- Sessions ------------------------------------------------------------------------

  async createSession(input: NewSession) {
    const protocol = await this.getLatestPublishedProtocol(input.protocolId);
    if (!protocol) throw new Error(`protocol ${input.protocolId} has no published version`);
    if (!this.participants.has(input.participantId)) {
      throw new Error(`participant ${input.participantId} not found`);
    }
    const token = newToken();
    const session: SessionRecord = {
      id: crypto.randomUUID(),
      participantId: input.participantId,
      protocolId: protocol.id,
      protocolVersion: protocol.version,
      mode: input.mode,
      status: "created",
      stopReason: null,
      createdAt: this.now(),
      startedAt: null,
      endedAt: null,
    };
    this.sessions.set(session.id, session);
    this.sessionTokens.set(await hashToken(token), session.id);
    return { session, token };
  }

  async getSession(id: string) {
    return this.sessions.get(id) ?? null;
  }

  async getSessionByToken(token: string) {
    const id = this.sessionTokens.get(await hashToken(token));
    return id ? (this.sessions.get(id) ?? null) : null;
  }

  async listSessions() {
    return [...this.sessions.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  async updateSession(
    id: string,
    patch: Partial<Pick<SessionRecord, "status" | "stopReason" | "startedAt" | "endedAt">>,
  ) {
    const existing = this.sessions.get(id);
    if (!existing) throw new Error(`session ${id} not found`);
    const updated = { ...existing, ...patch };
    this.sessions.set(id, updated);
    return updated;
  }

  // --- Step events (append-only) -------------------------------------------------------

  async appendEvents(sessionId: string, events: readonly EngineEvent[]) {
    if (!this.sessions.has(sessionId)) throw new Error(`session ${sessionId} not found`);
    const log = this.events.get(sessionId) ?? new Map<number, StoredEvent>();
    for (const event of events) {
      if (log.has(event.eventSeq)) continue; // idempotent retry
      log.set(event.eventSeq, { sessionId, event, recordedAt: this.now() });
    }
    this.events.set(sessionId, log);
    const session = this.sessions.get(sessionId)!;
    // Fold the canonical log, not the submitted batch: late retries cannot undo a resume.
    const patch = sessionPatchFor(
      { status: "created", startedAt: null, endedAt: null },
      [...log.values()].map((entry) => entry.event),
    );
    this.sessions.set(sessionId, {
      ...session,
      status: "created",
      startedAt: null,
      endedAt: null,
      stopReason: null,
      ...patch,
    });
  }

  async listEvents(sessionId: string) {
    return [...(this.events.get(sessionId)?.values() ?? [])].sort(
      (a, b) => a.event.eventSeq - b.event.eventSeq,
    );
  }

  // --- Evidence frames -----------------------------------------------------------------

  async saveEvidenceFrame(
    frame: Omit<EvidenceFrameRecord, "id" | "storagePath">,
    jpeg: Uint8Array,
  ) {
    const id = crypto.randomUUID();
    const record: EvidenceFrameRecord = {
      ...frame,
      id,
      storagePath: `memory/${frame.sessionId}/${id}.jpg`,
    };
    this.frames.set(id, { record, jpeg });
    return record;
  }

  async listEvidenceFrames(sessionId: string) {
    return [...this.frames.values()]
      .map((f) => f.record)
      .filter((r) => r.sessionId === sessionId)
      .sort((a, b) => a.seq - b.seq);
  }

  async getEvidenceUrl(frame: EvidenceFrameRecord) {
    return `/api/coordinator/evidence/${frame.id}`;
  }

  /** Memory-only: serves frame bytes for the evidence route. */
  getEvidenceBytes(id: string): Uint8Array | null {
    return this.frames.get(id)?.jpeg ?? null;
  }

  // --- Alerts --------------------------------------------------------------------------

  async createAlert(alert: NewAlert) {
    if (alert.dedupeKey) {
      const existing = [...this.alerts.values()].find((a) => a.dedupeKey === alert.dedupeKey);
      if (existing) return existing;
    }
    const record: AlertRecord = {
      ...alert,
      dedupeKey: alert.dedupeKey ?? null,
      delivery: null,
      id: crypto.randomUUID(),
      status: "open",
      reviewedAt: null,
    };
    this.alerts.set(record.id, record);
    return record;
  }

  async recordAlertDelivery(id: string, delivery: NotifyResult) {
    const existing = this.alerts.get(id);
    if (!existing) throw new Error(`alert ${id} not found`);
    if (!existing.delivery?.ok) this.alerts.set(id, { ...existing, delivery });
  }

  async listAlerts(filter: { sessionId?: string; status?: AlertStatus } = {}) {
    return [...this.alerts.values()]
      .filter((a) => (filter.sessionId ? a.sessionId === filter.sessionId : true))
      .filter((a) => (filter.status ? a.status === filter.status : true))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async markAlertReviewed(id: string) {
    const existing = this.alerts.get(id);
    if (!existing) throw new Error(`alert ${id} not found`);
    if (existing.status === "reviewed") return existing;
    const updated: AlertRecord = { ...existing, status: "reviewed", reviewedAt: this.now() };
    this.alerts.set(id, updated);
    return updated;
  }

  // --- Flag reviews --------------------------------------------------------------------

  async listFlagReviews(sessionId: string) {
    return [...this.flagReviews.values()].filter((r) => r.sessionId === sessionId);
  }

  async markFlagReviewed(sessionId: string, eventSeq: number, note: string | null = null) {
    const key = `${sessionId}:${eventSeq}`;
    const existing = this.flagReviews.get(key);
    if (existing) return existing;
    const review: FlagReview = { sessionId, eventSeq, reviewedAt: this.now(), note };
    this.flagReviews.set(key, review);
    return review;
  }
}
