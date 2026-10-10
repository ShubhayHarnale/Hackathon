import Link from "next/link";

// Session list and timelines arrive in Phase 6.
export default function CoordinatorPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-8 py-10">
      <h1 className="text-3xl font-bold">Sessions</h1>
      <p className="text-lg text-muted">
        Session list and step timelines arrive in Phase 6. Meanwhile, manage{" "}
        <Link href="/coordinator/protocols" className="text-primary underline">
          protocols
        </Link>{" "}
        or try the{" "}
        <Link href="/coordinator/vision-lab" className="text-primary underline">
          vision lab
        </Link>
        .
      </p>
    </main>
  );
}
