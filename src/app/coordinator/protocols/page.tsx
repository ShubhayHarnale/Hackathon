import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { StatusBadge } from "@/components/coordinator/StatusBadge";
import { getRepository } from "@/persistence/server";

export default function ProtocolsPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-8 py-10">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-bold">Protocols</h1>
        <Link
          href="/coordinator/protocols/new"
          className="flex min-h-11 items-center rounded-lg bg-primary px-5 text-lg font-bold text-primary-foreground"
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
  if (protocols.length === 0) return <p className="text-lg text-muted">No protocols yet.</p>;
  return (
    <table className="w-full border-collapse text-left text-lg">
      <thead>
        <tr className="border-b-2 border-border">
          <th className="py-2 pr-4">Title</th>
          <th className="py-2 pr-4">Steps</th>
          <th className="py-2 pr-4">Critical</th>
          <th className="py-2 pr-4">Version</th>
          <th className="py-2">Status</th>
        </tr>
      </thead>
      <tbody>
        {protocols.map((record) => (
          <tr key={record.id} className="border-b border-border/40">
            <td className="py-3 pr-4">
              <Link
                href={`/coordinator/protocols/${record.id}`}
                className="font-bold text-primary underline"
              >
                {record.protocol.title}
              </Link>
            </td>
            <td className="py-3 pr-4">{record.protocol.steps.length}</td>
            <td className="py-3 pr-4">{record.protocol.steps.filter((s) => s.critical).length}</td>
            <td className="py-3 pr-4">v{record.version}</td>
            <td className="py-3">
              <StatusBadge status={record.status} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
