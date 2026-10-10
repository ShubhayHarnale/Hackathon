import type { SupabaseClient } from "@supabase/supabase-js";
import type { EngineEvent, FrameResult, StopReason } from "@/engine";
import type { AlertKind, AlertRecipient, NotifyResult } from "@/escalation";
import type { Protocol } from "@/protocol/schema";
import { hashToken, newToken } from "./tokens";
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

/**
 * Supabase (Postgres + Storage) repository, used with PERSISTENCE=supabase. Server-only:
 * it runs with the secret key, which bypasses RLS (the browser never gets a key). The
 * database enforces the same rules as the memory repository: append-only step events,
 * immutable published protocols, one draft per protocol. See supabase/migrations.
 */

const BUCKET = "evidence";
const SIGNED_URL_SECONDS = 300;

// --- Row shapes and mappers (exported for tests) ----------------------------------------

export interface ParticipantRow {
  id: string;
  display_name: string;
  trial_number: string;
  trusted_contact_name: string | null;
  trusted_contact_phone: string | null;
  trusted_contact_consented: boolean;
}

export interface ProtocolRow {
  id: string;
  version: number;
  status: "draft" | "published";
  source_text: string | null;
  protocol: Protocol;
  created_at: string;
  published_at: string | null;
}

export interface SessionRow {
  id: string;
  participant_id: string;
  protocol_id: string;
  protocol_version: number;
  mode: SessionRecord["mode"];
  status: SessionRecord["status"];
  stop_reason: StopReason | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
}

export interface EventRow {
  session_id: string;
  event_seq: number;
  type: string;
  step_id: string | null;
  run: "practice" | "real" | null;
  occurred_at: string;
  recorded_at?: string;
  event: EngineEvent;
}

export interface EvidenceRow {
  id: string;
  session_id: string;
  step_id: string;
  seq: number;
  captured_at: string;
  storage_path: string;
  vision_result: FrameResult | null;
}

export interface AlertRow {
  dedupe_key: string | null;
  delivery: NotifyResult | null;
  id: string;
  session_id: string;
  kind: AlertKind;
  recipient: AlertRecipient;
  message: string;
  status: AlertStatus;
  created_at: string;
  reviewed_at: string | null;
}

export interface FlagReviewRow {
  session_id: string;
  event_seq: number;
  reviewed_at: string;
  note: string | null;
}

const toIso = (ms: number) => new Date(ms).toISOString();
const fromIso = (iso: string) => Date.parse(iso);
const fromIsoOrNull = (iso: string | null) => (iso === null ? null : Date.parse(iso));

export const mapParticipant = (r: ParticipantRow): ParticipantRecord => ({
  id: r.id,
  displayName: r.display_name,
  trialNumber: r.trial_number,
  trustedContact:
    r.trusted_contact_name && r.trusted_contact_phone
      ? {
          name: r.trusted_contact_name,
          phone: r.trusted_contact_phone,
          consented: r.trusted_contact_consented,
        }
      : null,
});

export const participantRow = (p: ParticipantRecord): ParticipantRow => ({
  id: p.id,
  display_name: p.displayName,
  trial_number: p.trialNumber,
  trusted_contact_name: p.trustedContact?.name ?? null,
  trusted_contact_phone: p.trustedContact?.phone ?? null,
  trusted_contact_consented: p.trustedContact?.consented ?? false,
});

export const mapProtocol = (r: ProtocolRow): ProtocolRecord => ({
  id: r.id,
  version: r.version,
  status: r.status,
  sourceText: r.source_text,
  protocol: r.protocol,
  createdAt: fromIso(r.created_at),
  publishedAt: fromIsoOrNull(r.published_at),
});

export const mapSession = (r: SessionRow): SessionRecord => ({
  id: r.id,
  participantId: r.participant_id,
  protocolId: r.protocol_id,
  protocolVersion: r.protocol_version,
  mode: r.mode,
  status: r.status,
  stopReason: r.stop_reason,
  createdAt: fromIso(r.created_at),
  startedAt: fromIsoOrNull(r.started_at),
  endedAt: fromIsoOrNull(r.ended_at),
});

export const eventRow = (sessionId: string, e: EngineEvent): EventRow => ({
  session_id: sessionId,
  event_seq: e.eventSeq,
  type: e.type,
  step_id: "stepId" in e ? e.stepId : null,
  run: e.run,
  occurred_at: toIso(e.at),
  event: e,
});

export const mapEvent = (r: EventRow): StoredEvent => ({
  sessionId: r.session_id,
  event: r.event,
  recordedAt: fromIso(r.recorded_at ?? r.occurred_at),
});

export const mapEvidence = (r: EvidenceRow): EvidenceFrameRecord => ({
  id: r.id,
  sessionId: r.session_id,
  stepId: r.step_id,
  seq: r.seq,
  capturedAt: fromIso(r.captured_at),
  storagePath: r.storage_path,
  visionResult: r.vision_result,
});

export const mapAlert = (r: AlertRow): AlertRecord => ({
  dedupeKey: r.dedupe_key,
  delivery: r.delivery,
  id: r.id,
  sessionId: r.session_id,
  kind: r.kind,
  recipient: r.recipient,
  message: r.message,
  status: r.status,
  createdAt: fromIso(r.created_at),
  reviewedAt: fromIsoOrNull(r.reviewed_at),
});

export const mapFlagReview = (r: FlagReviewRow): FlagReview => ({
  sessionId: r.session_id,
  eventSeq: r.event_seq,
  reviewedAt: fromIso(r.reviewed_at),
  note: r.note,
});

export function sessionPatchRow(
  patch: Partial<Pick<SessionRecord, "status" | "stopReason" | "startedAt" | "endedAt">>,
): Partial<SessionRow> {
  const row: Partial<SessionRow> = {};
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.stopReason !== undefined) row.stop_reason = patch.stopReason;
  if (patch.startedAt !== undefined)
    row.started_at = patch.startedAt === null ? null : toIso(patch.startedAt);
  if (patch.endedAt !== undefined)
    row.ended_at = patch.endedAt === null ? null : toIso(patch.endedAt);
  return row;
}

// --- Repository -------------------------------------------------------------------------

interface Result<T> {
  data: T | null;
  error: { message: string } | null;
}

function must<T>(result: Result<T>, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  if (result.data === null) throw new Error(`${what}: no data`);
  return result.data;
}

export class SupabaseRepository implements Repository {
  constructor(private readonly db: SupabaseClient) {}

  // Participants

  async listParticipants() {
    const rows = must<ParticipantRow[]>(
      await this.db.from("participants").select("*").order("id"),
      "list participants",
    );
    return rows.map(mapParticipant);
  }

  async getParticipant(id: string) {
    const rows = must<ParticipantRow[]>(
      await this.db.from("participants").select("*").eq("id", id),
      "get participant",
    );
    return rows[0] ? mapParticipant(rows[0]) : null;
  }

  // Protocols

  private async versions(id: string): Promise<ProtocolRow[]> {
    return must<ProtocolRow[]>(
      await this.db.from("protocols").select("*").eq("id", id).order("version"),
      "get protocol",
    );
  }

  async listProtocols() {
    const rows = must<ProtocolRow[]>(
      await this.db.from("protocols").select("*").order("version"),
      "list protocols",
    );
    const latest = new Map<string, ProtocolRow>();
    for (const row of rows) latest.set(row.id, row); // ascending, so the last one wins
    return [...latest.values()].map(mapProtocol).sort((a, b) => b.createdAt - a.createdAt);
  }

  async getProtocol(id: string, version?: number) {
    const rows = await this.versions(id);
    const row = version === undefined ? rows.at(-1) : rows.find((r) => r.version === version);
    return row ? mapProtocol(row) : null;
  }

  async getLatestPublishedProtocol(id: string) {
    const row = (await this.versions(id)).filter((r) => r.status === "published").at(-1);
    return row ? mapProtocol(row) : null;
  }

  async saveProtocolDraft(protocol: Protocol, sourceText: string | null) {
    const latest = (await this.versions(protocol.id)).at(-1);
    if (latest?.status === "draft") {
      const rows = must<ProtocolRow[]>(
        await this.db
          .from("protocols")
          .update({ protocol, source_text: sourceText, created_at: new Date().toISOString() })
          .eq("id", protocol.id)
          .eq("version", latest.version)
          .select(),
        "update draft",
      );
      return mapProtocol(rows[0]!);
    }
    const rows = must<ProtocolRow[]>(
      await this.db
        .from("protocols")
        .insert({
          id: protocol.id,
          version: (latest?.version ?? 0) + 1,
          status: "draft",
          protocol,
          source_text: sourceText,
        })
        .select(),
      "insert draft",
    );
    return mapProtocol(rows[0]!);
  }

  async publishProtocol(id: string, version: number) {
    const existing = await this.getProtocol(id, version);
    if (!existing) throw new Error(`protocol ${id} v${version} not found`);
    if (existing.status === "published") return existing;
    const rows = must<ProtocolRow[]>(
      await this.db
        .from("protocols")
        .update({ status: "published", published_at: new Date().toISOString() })
        .eq("id", id)
        .eq("version", version)
        .select(),
      "publish protocol",
    );
    return mapProtocol(rows[0]!);
  }

  // Sessions

  async createSession(input: NewSession) {
    const protocol = await this.getLatestPublishedProtocol(input.protocolId);
    if (!protocol) throw new Error(`protocol ${input.protocolId} has no published version`);
    if (!(await this.getParticipant(input.participantId))) {
      throw new Error(`participant ${input.participantId} not found`);
    }
    const token = newToken();
    const rows = must<SessionRow[]>(
      await this.db
        .from("sessions")
        .insert({
          participant_id: input.participantId,
          protocol_id: protocol.id,
          protocol_version: protocol.version,
          token_hash: await hashToken(token),
          mode: input.mode,
        })
        .select(),
      "create session",
    );
    return { session: mapSession(rows[0]!), token };
  }

  async getSession(id: string) {
    const rows = must<SessionRow[]>(
      await this.db.from("sessions").select("*").eq("id", id),
      "get session",
    );
    return rows[0] ? mapSession(rows[0]) : null;
  }

  async getSessionByToken(token: string) {
    const rows = must<SessionRow[]>(
      await this.db
        .from("sessions")
        .select("*")
        .eq("token_hash", await hashToken(token)),
      "get session by token",
    );
    return rows[0] ? mapSession(rows[0]) : null;
  }

  async listSessions() {
    const rows = must<SessionRow[]>(
      await this.db
        .from("sessions")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200),
      "list sessions",
    );
    return rows.map(mapSession);
  }

  async updateSession(id: string, patch: Parameters<Repository["updateSession"]>[1]) {
    const rows = must<SessionRow[]>(
      await this.db.from("sessions").update(sessionPatchRow(patch)).eq("id", id).select(),
      "update session",
    );
    if (!rows[0]) throw new Error(`session ${id} not found`);
    return mapSession(rows[0]);
  }

  // Step events (append-only; duplicates ignored so client retries are safe)

  async appendEvents(sessionId: string, events: readonly EngineEvent[]) {
    if (events.length === 0) return;
    const { error } = await this.db.rpc("append_session_events", {
      p_session_id: sessionId,
      p_events: events.map((e) => eventRow(sessionId, e)),
    });
    if (error) throw new Error(`append events: ${error.message}`);
  }

  async listEvents(sessionId: string) {
    const rows = must<EventRow[]>(
      await this.db.from("step_events").select("*").eq("session_id", sessionId).order("event_seq"),
      "list events",
    );
    return rows.map(mapEvent);
  }

  // Evidence frames (private bucket + metadata row)

  async saveEvidenceFrame(
    frame: Omit<EvidenceFrameRecord, "id" | "storagePath">,
    jpeg: Uint8Array,
  ) {
    const path = `${frame.sessionId}/${frame.stepId}-${frame.seq}.jpg`;
    const upload = await this.db.storage
      .from(BUCKET)
      .upload(path, jpeg, { contentType: "image/jpeg", upsert: true });
    if (upload.error) throw new Error(`upload evidence: ${upload.error.message}`);
    const rows = must<EvidenceRow[]>(
      await this.db
        .from("evidence_frames")
        .upsert(
          {
            session_id: frame.sessionId,
            step_id: frame.stepId,
            seq: frame.seq,
            captured_at: toIso(frame.capturedAt),
            storage_path: path,
            vision_result: frame.visionResult,
          },
          { onConflict: "session_id,step_id,seq" },
        )
        .select(),
      "save evidence",
    );
    return mapEvidence(rows[0]!);
  }

  async listEvidenceFrames(sessionId: string) {
    const rows = must<EvidenceRow[]>(
      await this.db.from("evidence_frames").select("*").eq("session_id", sessionId).order("seq"),
      "list evidence",
    );
    return rows.map(mapEvidence);
  }

  async getEvidenceUrl(frame: EvidenceFrameRecord) {
    const result = await this.db.storage
      .from(BUCKET)
      .createSignedUrl(frame.storagePath, SIGNED_URL_SECONDS);
    if (result.error || !result.data)
      throw new Error(`sign evidence url: ${result.error?.message}`);
    return result.data.signedUrl;
  }

  // Alerts

  async createAlert(alert: NewAlert) {
    const key = alert.dedupeKey ?? crypto.randomUUID();
    const { error } = await this.db.from("alerts").upsert(
      {
        session_id: alert.sessionId,
        dedupe_key: key,
        kind: alert.kind,
        recipient: alert.recipient,
        message: alert.message,
        created_at: toIso(alert.createdAt),
      },
      { onConflict: "dedupe_key", ignoreDuplicates: true },
    );
    if (error) throw new Error(`create alert: ${error.message}`);
    const rows = must<AlertRow[]>(
      await this.db.from("alerts").select("*").eq("dedupe_key", key),
      "get alert",
    );
    return mapAlert(rows[0]!);
  }

  async recordAlertDelivery(id: string, delivery: NotifyResult) {
    const { error } = await this.db
      .from("alerts")
      .update({ delivery })
      .eq("id", id)
      .or("delivery.is.null,delivery->>ok.eq.false");
    if (error) throw new Error(`record delivery: ${error.message}`);
  }

  async listAlerts(filter: { sessionId?: string; status?: AlertStatus } = {}) {
    let query = this.db.from("alerts").select("*").order("created_at", { ascending: false });
    if (filter.sessionId) query = query.eq("session_id", filter.sessionId);
    if (filter.status) query = query.eq("status", filter.status);
    return must<AlertRow[]>(await query, "list alerts").map(mapAlert);
  }

  async markAlertReviewed(id: string) {
    const { error } = await this.db
      .from("alerts")
      .update({ status: "reviewed", reviewed_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "open");
    if (error) throw new Error(`review alert: ${error.message}`);
    const rows = must<AlertRow[]>(
      await this.db.from("alerts").select("*").eq("id", id),
      "get alert",
    );
    if (!rows[0]) throw new Error(`alert ${id} not found`);
    return mapAlert(rows[0]);
  }

  // Flag reviews

  async listFlagReviews(sessionId: string) {
    const rows = must<FlagReviewRow[]>(
      await this.db.from("flag_reviews").select("*").eq("session_id", sessionId),
      "list flag reviews",
    );
    return rows.map(mapFlagReview);
  }

  async markFlagReviewed(sessionId: string, eventSeq: number, note: string | null = null) {
    const { error } = await this.db
      .from("flag_reviews")
      .upsert(
        { session_id: sessionId, event_seq: eventSeq, note },
        { onConflict: "session_id,event_seq", ignoreDuplicates: true },
      );
    if (error) throw new Error(`review flag: ${error.message}`);
    const rows = must<FlagReviewRow[]>(
      await this.db
        .from("flag_reviews")
        .select("*")
        .eq("session_id", sessionId)
        .eq("event_seq", eventSeq),
      "get flag review",
    );
    return mapFlagReview(rows[0]!);
  }
}
