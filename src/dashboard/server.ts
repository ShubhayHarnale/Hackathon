import "server-only";
import { getRepository } from "@/persistence/server";
import type {
  ParticipantRecord,
  ProtocolRecord,
  SessionRecord,
  StoredEvent,
} from "@/persistence/types";
import { buildTimeline, type Timeline } from "./timeline";

export interface SessionSummary {
  readonly session: SessionRecord;
  readonly participant: ParticipantRecord | null;
  readonly protocol: ProtocolRecord | null;
  readonly timeline: Timeline | null;
}

export interface SessionDetail extends SessionSummary {
  readonly events: readonly StoredEvent[];
  /** Evidence frame id -> URL (signed for Supabase, a gated route for memory). */
  readonly evidenceUrls: ReadonlyMap<string, string>;
}

async function summarise(session: SessionRecord): Promise<SessionDetail> {
  const repo = getRepository();
  const [participant, protocol, events, frames, reviews] = await Promise.all([
    repo.getParticipant(session.participantId),
    repo.getProtocol(session.protocolId, session.protocolVersion),
    repo.listEvents(session.id),
    repo.listEvidenceFrames(session.id),
    repo.listFlagReviews(session.id),
  ]);
  const timeline = protocol
    ? buildTimeline({ protocol: protocol.protocol, events, frames, reviews })
    : null;
  const evidenceUrls = new Map<string, string>();
  await Promise.all(
    frames.map(async (f) => evidenceUrls.set(f.id, await repo.getEvidenceUrl(f).catch(() => ""))),
  );
  return { session, participant, protocol, timeline, events, evidenceUrls };
}

export async function loadSessionList(): Promise<SessionSummary[]> {
  const sessions = await getRepository().listSessions();
  return Promise.all(sessions.map(summarise));
}

export async function loadSessionDetail(id: string): Promise<SessionDetail | null> {
  const session = await getRepository().getSession(id);
  return session ? summarise(session) : null;
}
