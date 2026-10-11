import { connection } from "next/server";
import { Suspense } from "react";
import { VisionLab } from "@/components/coordinator/VisionLab";
import { serverEnv } from "@/lib/env";
import { getRepository } from "@/persistence/server";
import type { Protocol } from "@/protocol/schema";

export default function VisionLabPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-8 py-10">
      <h1 className="text-5xl font-semibold tracking-tight">Vision lab</h1>
      <p className="text-lg text-muted">
        Runs the full pipeline (camera or video file → vision → step engine) so you can test a
        protocol and tune the vision prompt. Use the scripted scenarios to see each safety path
        without a camera or API key.
      </p>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <LabLoader />
      </Suspense>
    </main>
  );
}

async function LabLoader() {
  await connection();
  const repo = getRepository();
  const records = await repo.listProtocols();
  const published = await Promise.all(records.map((r) => repo.getLatestPublishedProtocol(r.id)));
  const protocols = published.flatMap((r): Protocol[] => (r ? [r.protocol] : []));
  return <VisionLab protocols={protocols} serverVision={serverEnv().VISION_PROVIDER} />;
}
