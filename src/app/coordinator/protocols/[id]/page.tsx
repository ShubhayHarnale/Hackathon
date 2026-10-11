import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PublishButton } from "@/components/coordinator/PublishButton";
import { StatusBadge } from "@/components/coordinator/StatusBadge";
import { StepsTable } from "@/components/coordinator/StepsTable";
import { getRepository } from "@/persistence/server";
import { lintProtocol } from "@/protocol/lint";

export default function ProtocolPage({ params }: PageProps<"/coordinator/protocols/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-8 py-10">
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        {params.then(({ id }) => (
          <ProtocolDetail id={id} />
        ))}
      </Suspense>
    </main>
  );
}

async function ProtocolDetail({ id }: { id: string }) {
  await connection();
  const record = await getRepository().getProtocol(id);
  if (!record) notFound();
  const warnings = lintProtocol(record.protocol);

  return (
    <>
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-5xl font-semibold tracking-tight">{record.protocol.title}</h1>
        <StatusBadge status={record.status} />
        <span className="text-muted">v{record.version}</span>
      </div>
      {record.protocol.isDemo && (
        <p className="rounded-lg bg-warning-bg px-4 py-2 font-bold text-warning-fg">
          Demo protocol: patients see a &quot;not medical guidance&quot; banner.
        </p>
      )}
      {warnings.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-lg border-2 border-warning-fg bg-warning-bg px-4 py-3 text-warning-fg">
          {warnings.map((w, i) => (
            <li key={i}>⚠ {w.message}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-3">
        {record.status === "draft" && <PublishButton id={record.id} version={record.version} />}
        <Link
          href={`/coordinator/protocols/new?from=${record.id}`}
          className="flex min-h-11 items-center rounded-lg border-2 border-border px-5 text-lg font-bold"
        >
          {record.status === "draft" ? "Edit draft" : "Edit as new version"}
        </Link>
      </div>
      <StepsTable steps={record.protocol.steps} />
    </>
  );
}
