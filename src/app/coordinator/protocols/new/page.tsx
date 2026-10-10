import { connection } from "next/server";
import { Suspense } from "react";
import { ProtocolEditor } from "@/components/coordinator/ProtocolEditor";
import { getRepository } from "@/persistence/server";

export default function NewProtocolPage({ searchParams }: PageProps<"/coordinator/protocols/new">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-8 py-10">
      <h1 className="text-3xl font-bold">Create or edit a protocol</h1>
      <p className="text-lg text-muted">
        Paste the procedure text and compile it into steps. Review every step before saving: the
        compiler drafts, the study team decides.
      </p>
      <Suspense fallback={<p className="text-muted">Loading…</p>}>
        {searchParams.then(({ from }) => (
          <EditorLoader from={typeof from === "string" ? from : undefined} />
        ))}
      </Suspense>
    </main>
  );
}

async function EditorLoader({ from }: { from: string | undefined }) {
  await connection();
  const record = from ? await getRepository().getProtocol(from) : null;
  return (
    <ProtocolEditor
      initialProtocol={record?.protocol ?? null}
      initialText={record?.sourceText ?? ""}
    />
  );
}
