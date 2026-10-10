import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-3">
        <h1 className="text-4xl font-bold">Witness</h1>
        <p className="text-xl text-muted">
          Step-by-step camera and voice coaching for at-home trial procedures, with a time-stamped
          record for the study team.
        </p>
        <p className="text-lg text-muted">
          Hackathon demo. Synthetic data only. The app flags and records; a human makes every
          medical decision.
        </p>
      </header>
      <nav className="flex flex-col gap-4 sm:flex-row">
        <Link
          href="/demo"
          className="flex min-h-14 items-center justify-center rounded-xl bg-primary px-6 text-xl font-bold text-primary-foreground"
        >
          Patient demo
        </Link>
        <Link
          href="/coordinator"
          className="flex min-h-14 items-center justify-center rounded-xl border-2 border-border px-6 text-xl font-bold"
        >
          Coordinator dashboard
        </Link>
      </nav>
    </main>
  );
}
