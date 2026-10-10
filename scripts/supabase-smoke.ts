/** Writes one synthetic stopped session, or verifies it from a separate process.
 * Does not delete records or print link tokens, credentials, or signed URLs. */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { EngineRunner, type EngineEvent } from "@/engine";
import { mockNotifier } from "@/escalation/mock";
import { processEscalations } from "@/escalation/policy";
import { SupabaseRepository } from "@/persistence/supabase";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const { values } = parseArgs({
  options: {
    write: { type: "boolean", default: false },
    jpeg: { type: "string" },
    session: { type: "string" },
  },
});

async function main() {
  const url = process.env.SUPABASE_URL,
    key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key)
    throw new Error("Configure SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local first.");
  if (values.write === Boolean(values.session))
    throw new Error("Use --write --jpeg <synthetic.jpg> OR --session <id>.");
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const repo = new SupabaseRepository(db);
  let sessionId = values.session;
  if (values.write) {
    if (!values.jpeg) throw new Error("Pass --jpeg <synthetic.jpg>; no patient recordings.");
    const jpeg = readFileSync(values.jpeg);
    assert(jpeg[0] === 0xff && jpeg[1] === 0xd8 && jpeg[2] === 0xff, "Input must be a JPEG.");
    const protocol = await repo.getLatestPublishedProtocol("mock-autoinjector");
    assert(
      protocol?.protocol.isDemo,
      "Run npm run seed first; requires the synthetic autoinjector protocol.",
    );
    const { session, token } = await repo.createSession({
      participantId: "p-001",
      protocolId: protocol.id,
      mode: "mock",
    });
    sessionId = session.id;
    console.log(`Created synthetic readiness session: ${sessionId}`);
    assert.equal((await repo.getSessionByToken(token))?.id, sessionId);
    const runner = new EngineRunner({ steps: protocol.protocol.steps });
    const events: EngineEvent[] = [];
    const at = Date.now();
    events.push(...runner.dispatch({ type: "start", at }));
    // Synthetic repository fixture, not a model recognition test.
    for (let seq = 1; seq <= 3; seq++)
      events.push(
        ...runner.dispatch({
          type: "frame",
          seq,
          at: at + seq * 1000,
          capturedAt: at + seq * 1000,
          result: { observedStepId: "remove-cap", confidence: 1 },
        }),
      );
    assert.equal(runner.state.stopReason?.kind, "critical_miss");
    await repo.appendEvents(sessionId, events);
    await repo.appendEvents(sessionId, events); // retry must not duplicate events or regress status
    assert.equal((await repo.listEvents(sessionId)).length, events.length);
    await repo.saveEvidenceFrame(
      {
        sessionId,
        stepId: "clean-site",
        seq: 3,
        capturedAt: at + 3000,
        visionResult: { observedStepId: "remove-cap", confidence: 1 },
      },
      jpeg,
    );
    await processEscalations(repo, mockNotifier, session, events);
    await processEscalations(repo, mockNotifier, session, events);
    const alerts = await repo.listAlerts({ sessionId });
    assert.equal(alerts.length, 2);
    for (const alert of alerts) {
      const reviewed = await repo.markAlertReviewed(alert.id);
      assert.equal((await repo.markAlertReviewed(alert.id)).reviewedAt, reviewed.reviewedAt);
    }
    const critical = events.find((e) => e.type === "critical_miss")!;
    await repo.markFlagReviewed(sessionId, critical.eventSeq, "Synthetic readiness check");
    console.log(`Verify in a separate process: npm run supabase:smoke -- --session ${sessionId}`);
  }
  assert(sessionId);
  const session = await repo.getSession(sessionId);
  assert.equal(session?.mode, "mock");
  assert.equal(session?.status, "stopped");
  assert.equal(session?.stopReason?.kind, "critical_miss");
  assert((await repo.listEvents(sessionId)).some((e) => e.event.type === "critical_miss"));
  const frames = await repo.listEvidenceFrames(sessionId);
  assert.equal(frames.length, 1);
  const signedUrl = await repo.getEvidenceUrl(frames[0]!);
  const image = await fetch(signedUrl, { signal: AbortSignal.timeout(10_000) });
  assert(image.ok, `Signed evidence download failed: ${image.status}`);
  const bytes = new Uint8Array(await image.arrayBuffer());
  assert(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff);
  const bucket = await db.storage.getBucket("evidence");
  if (bucket.error) throw new Error(`Read evidence bucket: ${bucket.error.message}`);
  assert.equal(bucket.data.public, false);
  const alerts = await repo.listAlerts({ sessionId });
  assert.equal(alerts.length, 2);
  assert(alerts.every((a) => a.delivery?.ok && a.status === "reviewed"));
  assert.equal((await repo.listFlagReviews(sessionId)).length, 1);
  console.log(
    "PASS: persisted session/events, dedupe, private evidence + signed download, mock delivery, alert/flag reviews.",
  );
}
main().catch((error: unknown) => {
  let message = error instanceof Error ? error.message : String(error);
  for (const key of [process.env.SUPABASE_SECRET_KEY, process.env.GEMINI_API_KEY])
    if (key) message = message.split(key).join("[redacted]");
  console.error(message);
  process.exitCode = 1;
});
