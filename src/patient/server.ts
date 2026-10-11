import "server-only";
import { getRepository } from "@/persistence/server";
import type { ProtocolRecord, SessionRecord } from "@/persistence/types";
import { isScenarioName, type ScenarioName } from "@/vision";
import type { VisionConfig } from "./controller";

export interface PatientSessionData {
  readonly session: SessionRecord;
  readonly protocol: ProtocolRecord;
}

/** The session behind a link token, with the protocol version it was created against. */
export async function loadPatientSession(token: string): Promise<PatientSessionData | null> {
  const repo = getRepository();
  const session = await repo.getSessionByToken(token);
  if (!session) return null;
  const protocol = await repo.getProtocol(session.protocolId, session.protocolVersion);
  return protocol ? { session, protocol } : null;
}

type SearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Public demos use actual camera checks unless a developer tool is explicitly selected. */
export function demoVisionFromQuery(params: SearchParams): VisionConfig {
  const source = first(params.vision);
  return source === "scripted" || source === "replay"
    ? visionFromQuery(params, "mock")
    : { kind: "server" };
}

/**
 * Demo control from the query string: `?vision=scripted&scenario=<name>` (no camera
 * needed) or `?vision=server` (camera frames to /api/vision/check). Without one, mock
 * sessions use the happy scripted scenario and live sessions use server vision.
 */
export function visionFromQuery(
  params: SearchParams,
  fallback: SessionRecord["mode"],
): VisionConfig {
  // A live session cannot silently become a scripted/replay run via its URL.
  if (fallback === "live") return { kind: "server" };
  if (fallback === "replay") return { kind: "replay" };
  const vision = first(params.vision);
  if (vision === "replay") return { kind: "replay" };
  const scenarioParam = first(params.scenario);
  const scenario: ScenarioName =
    scenarioParam && isScenarioName(scenarioParam) ? scenarioParam : "happy";
  if (vision === "server") return { kind: "server" };
  if (vision === "scripted" || fallback === "mock") return { kind: "scripted", scenario };
  return { kind: "server" };
}
