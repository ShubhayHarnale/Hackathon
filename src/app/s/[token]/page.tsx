import { connection } from "next/server";
import { Suspense } from "react";
import { PatientApp } from "@/components/patient/PatientApp";
import { PatientLoading, SessionMessage } from "@/components/patient/SessionMessage";
import { HEADINGS, NOTES } from "@/patient/copy";
import { getRepository } from "@/persistence/server";
import { loadPatientSession, visionFromQuery } from "@/patient/server";

// Patient flow (mobile), reached through the unguessable session link.
export default function PatientSessionPage({ params, searchParams }: PageProps<"/s/[token]">) {
  return (
    <div className="flex flex-1 flex-col">
      {/* Params are runtime data under Cache Components, so they render inside Suspense. */}
      <Suspense fallback={<PatientLoading />}>
        {Promise.all([params, searchParams]).then(([{ token }, query]) => (
          <PatientSession token={token} query={query} />
        ))}
      </Suspense>
    </div>
  );
}

async function PatientSession({
  token,
  query,
}: {
  token: string;
  query: Record<string, string | string[] | undefined>;
}) {
  await connection();
  const data = await loadPatientSession(token);
  if (!data) {
    return <SessionMessage heading={HEADINGS.linkNotWorking} body={NOTES.linkNotWorking} />;
  }
  const { session, protocol } = data;
  if (session.status === "completed" || session.status === "stopped") {
    return <SessionMessage heading={HEADINGS.sessionEnded} body={NOTES.sessionEnded} />;
  }
  if (session.status !== "created" || (await getRepository().listEvents(session.id)).length > 0) {
    return (
      <SessionMessage
        heading="This session has already started"
        body="Return to the original open page. If it was closed, ask your study team for a new link. Do not repeat the procedure on your own."
      />
    );
  }
  return (
    <PatientApp
      token={token}
      sessionId={session.id}
      protocol={protocol.protocol}
      vision={visionFromQuery(query, session.mode)}
    />
  );
}
