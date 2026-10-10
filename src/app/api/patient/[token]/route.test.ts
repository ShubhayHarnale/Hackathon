import { describe, expect, it } from "vitest";
import type { EngineEvent } from "@/engine";
import { getRepository } from "@/persistence/server";
import { POST as postEvents } from "./events/route";
import { POST as postEvidence } from "./evidence/route";
import { GET as listSessions, POST as createSession } from "../../coordinator/sessions/route";

async function newSession() {
  return getRepository().createSession({
    participantId: "p-001",
    protocolId: "mock-autoinjector",
    mode: "mock",
  });
}

const ctx = (token: string) => ({ params: Promise.resolve({ token }) });
const json = (url: string, body: unknown) =>
  new Request(url, { method: "POST", body: JSON.stringify(body) });

const events: EngineEvent[] = [
  { type: "run_started", eventSeq: 0, at: 1_000, run: "real" },
  { type: "step_activated", stepId: "wash-hands", index: 0, eventSeq: 1, at: 1_000, run: "real" },
  {
    type: "step_confirmed",
    stepId: "wash-hands",
    methods: ["visual"],
    evidenceSeq: 3,
    activeMs: 3_000,
    eventSeq: 2,
    at: 4_000,
    run: "real",
  },
];

const sendEvents = (token: string, body: unknown) =>
  postEvents(json(`http://test/api/patient/${token}/events`, body), ctx(token));
const sendEvidence = (token: string, body: unknown) =>
  postEvidence(json(`http://test/api/patient/${token}/evidence`, body), ctx(token));

// A tiny valid JPEG header is enough: the route checks the FF D8 FF marker.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]).toString("base64");

describe("POST /api/patient/[token]/events", () => {
  it("appends events and moves the session along", async () => {
    const { session, token } = await newSession();
    const res = await sendEvents(token, { events });
    expect(res.status).toBe(200);
    const repo = getRepository();
    expect((await repo.listEvents(session.id)).map((e) => e.event.eventSeq)).toEqual([0, 1, 2]);
    expect(await repo.getSession(session.id)).toMatchObject({ status: "active", startedAt: 1_000 });
  });

  it("is idempotent on eventSeq (retries don't duplicate)", async () => {
    const { session, token } = await newSession();
    await sendEvents(token, { events: events.slice(0, 2) });
    await sendEvents(token, { events });
    await sendEvents(token, { events });
    expect(await getRepository().listEvents(session.id)).toHaveLength(3);
  });

  it("records a stop with its reason and end time", async () => {
    const { session, token } = await newSession();
    const reason = {
      kind: "critical_miss",
      missedStepId: "clean-site",
      observedStepId: "remove-cap",
      cause: "skipped",
    } as const;
    await sendEvents(token, {
      events: [...events, { type: "stopped", reason, eventSeq: 3, at: 9_000, run: "real" }],
    });
    expect(await getRepository().getSession(session.id)).toMatchObject({
      status: "stopped",
      stopReason: reason,
      endedAt: 9_000,
    });
  });

  it("rejects a wrong token without touching any session", async () => {
    const res = await sendEvents("not-a-real-token", { events });
    expect(res.status).toBe(404);
  });

  it("rejects events the engine couldn't have produced", async () => {
    const { token } = await newSession();
    const bad = [{ type: "step_confirmed", stepId: "x", eventSeq: 0, at: 0, run: "real" }];
    expect((await sendEvents(token, { events: bad })).status).toBe(400);
    expect((await sendEvents(token, { events: [] })).status).toBe(400);
    expect((await sendEvents(token, { events: [{ type: "made_up", eventSeq: 0 }] })).status).toBe(
      400,
    );
  });
});

describe("POST /api/patient/[token]/evidence", () => {
  const body = { stepId: "wash-hands", evidenceSeq: 3, capturedAt: 3_000, jpegBase64: JPEG };

  it("stores a frame once per step and seq", async () => {
    const { session, token } = await newSession();
    const first = await sendEvidence(token, body);
    expect(first.status).toBe(200);
    const again = await sendEvidence(token, body);
    expect((await again.json()).id).toBe((await first.json()).id);
    const frames = await getRepository().listEvidenceFrames(session.id);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ stepId: "wash-hands", seq: 3, visionResult: null });
  });

  it("rejects wrong tokens, bad bodies and non-JPEG data", async () => {
    const { token } = await newSession();
    expect((await sendEvidence("nope", body)).status).toBe(404);
    expect((await sendEvidence(token, { ...body, evidenceSeq: -1 })).status).toBe(400);
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0]).toString("base64");
    expect((await sendEvidence(token, { ...body, jpegBase64: png })).status).toBe(400);
  });
});

describe("/api/coordinator/sessions", () => {
  it("creates a session and returns a working link", async () => {
    const res = await createSession(
      json("http://test.local/api/coordinator/sessions", {
        participantId: "p-002",
        protocolId: "mock-inhaler",
        mode: "live",
      }),
    );
    expect(res.status).toBe(201);
    const { sessionId, link } = await res.json();
    const token = new URL(link).pathname.split("/").at(-1)!;
    expect(link).toMatch(/^http:\/\/test\.local\/s\//);
    expect((await getRepository().getSessionByToken(token))?.id).toBe(sessionId);

    const list = await (await listSessions()).json();
    expect(list.sessions.some((s: { id: string }) => s.id === sessionId)).toBe(true);
  });

  it("rejects unknown participants and bad bodies", async () => {
    const url = "http://test.local/api/coordinator/sessions";
    const unknown = await createSession(
      json(url, { participantId: "nobody", protocolId: "mock-inhaler" }),
    );
    expect(unknown.status).toBe(404);
    expect((await createSession(json(url, { mode: "live" }))).status).toBe(400);
  });
});
