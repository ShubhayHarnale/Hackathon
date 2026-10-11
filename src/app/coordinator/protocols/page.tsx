import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { StatusBadge } from "@/components/coordinator/StatusBadge";
import { getRepository } from "@/persistence/server";

export default function ProtocolsPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <p className="font-mono text-sm font-bold tracking-[0.14em] text-accent uppercase">
            Study team
          </p>
          <h1 className="text-5xl font-semibold tracking-tight">Protocols</h1>
          <p className="text-lg text-muted">
            Plain-text procedures, compiled into reviewed steps. Sessions run the latest published
            version.
          </p>
        </div>
        <Link
          href="/coordinator/protocols/new"
          className="flex min-h-12 items-center rounded-2xl bg-primary px-6 text-lg font-bold text-primary-foreground shadow-lift hover:brightness-110"
        >
          New protocol
        </Link>
      </div>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        <ProtocolList />
      </Suspense>
    </main>
  );
}

async function ProtocolList() {
  await connection();
  const protocols = await getRepository().listProtocols();
  if (protocols.length === 0) {
    return (
      <div className="rounded-3xl border-2 border-dashed border-border bg-surface px-6 py-12 text-center text-lg text-muted">
        No protocols yet.
      </div>
    );
  }
  return (
    <ul className="grid gap-4 md:grid-cols-2">
      {protocols.map((record) => {
        const critical = record.protocol.steps.filter((s) => s.critical).length;
        return (
          <li
            key={record.id}
            className="group relative flex flex-col gap-4 rounded-3xl border-2 border-hairline bg-surface p-6 shadow-soft transition-shadow hover:shadow-lift"
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-2xl font-semibold tracking-tight">
                <Link
                  href={`/coordinator/protocols/${record.id}`}
                  className="after:absolute after:inset-0 after:rounded-3xl group-hover:text-primary"
                >
                  {record.protocol.title}
                </Link>
              </h2>
              <StatusBadge status={record.status} />
            </div>
            <dl className="flex flex-wrap gap-x-6 gap-y-2 text-base">
              <div>
                <dt className="text-sm text-muted">Steps</dt>
                <dd className="font-mono text-lg font-bold">{record.protocol.steps.length}</dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Critical</dt>
                <dd className={`font-mono text-lg font-bold ${critical > 0 ? "text-danger" : ""}`}>
                  {critical}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted">Version</dt>
                <dd className="font-mono text-lg font-bold">v{record.version}</dd>
              </div>
            </dl>
            <ol className="flex gap-1" aria-hidden="true">
              {record.protocol.steps.map((s) => (
                <li
                  key={s.id}
                  className={`h-1.5 flex-1 rounded-full ${s.critical ? "bg-danger" : "bg-surface-2"}`}
                />
              ))}
            </ol>
          </li>
        );
      })}
    </ul>
  );
}
