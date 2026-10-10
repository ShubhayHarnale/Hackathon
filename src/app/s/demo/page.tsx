import { connection } from "next/server";
import { Suspense } from "react";
import { PatientApp } from "@/components/patient/PatientApp";
import { PatientLoading } from "@/components/patient/SessionMessage";
import { visionFromQuery } from "@/patient/server";
import { getRepository } from "@/persistence/server";

const DEMO_PARTICIPANT = "p-001";
const DEMO_PROTOCOL = "mock-autoinjector";

/**
 * One-tap demo: a fresh session for the demo participant and the mock autoinjector on
 * every visit. Scripted vision by default (no camera needed); `?vision=server` uses the
 * camera, `?scenario=<name>` picks a scripted scenario.
 */
export default function DemoSessionPage({ searchParams }: PageProps<"/s/demo">) {
  return (
    <div className="flex flex-1 flex-col">
      <Suspense fallback={<PatientLoading />}>
        {searchParams.then((query) => (
          <DemoSession query={query} />
        ))}
      </Suspense>
    </div>
  );
}

async function DemoSession({ query }: { query: Record<string, string | string[] | undefined> }) {
  await connection();
  const vision = visionFromQuery(query, "mock");
  const repo = getRepository();
  const { session, token } = await repo.createSession({
    participantId: DEMO_PARTICIPANT,
    protocolId: DEMO_PROTOCOL,
    mode: vision.kind === "server" ? "live" : "mock",
  });
  const protocol = await repo.getProtocol(session.protocolId, session.protocolVersion);
  if (!protocol) throw new Error(`demo protocol ${DEMO_PROTOCOL} is missing`);
  return (
    <PatientApp token={token} sessionId={session.id} protocol={protocol.protocol} vision={vision} />
  );
}
