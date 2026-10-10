import Link from "next/link";
import { DEMO_PROTOCOLS, DEMO_PARTICIPANTS } from "@/demo";
import { SCENARIOS } from "@/vision/mock";

export const metadata = { title: "Demo scenarios | Witness" };

export default function DemoPage() {
  const field = "min-h-12 w-full rounded-lg border-2 border-border bg-background p-3";
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 py-10">
      <Link href="/" className="text-primary underline">
        ← Witness
      </Link>
      <h1 className="text-4xl font-bold">Try Witness</h1>
      <p className="text-xl">
        Synthetic participants and prop procedures only. Every launch creates a new session and
        saves its record for the study team. Escalation notifications are simulated.
      </p>
      <form action="/s/demo" method="get" className="flex flex-col gap-5 text-xl">
        <label className="flex flex-col gap-2">
          Procedure
          <select name="protocol" className={field}>
            {DEMO_PROTOCOLS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2">
          Participant
          <select name="participant" className={field}>
            {DEMO_PARTICIPANTS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName} —{" "}
                {p.trustedContact?.consented ? "contact consent given" : "no contact notification"}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2">
          Source
          <select name="vision" className={field}>
            <option value="scripted">Scripted demo — no camera or keys</option>
            <option value="replay">Recorded video — choose a local file</option>
            <option value="server">Live camera</option>
          </select>
        </label>
        <label className="flex flex-col gap-2">
          Scripted scenario
          <select name="scenario" className={field}>
            {Object.entries(SCENARIOS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <p className="text-base text-muted">
          Scenarios apply to the scripted source. Replay and live camera use the configured server
          vision provider. With VISION_PROVIDER=mock, their checks are simulated too.
        </p>
        <button className="min-h-16 rounded-xl bg-primary px-5 font-bold text-primary-foreground">
          Launch a fresh demo
        </button>
      </form>
      <Link href="/coordinator" className="min-h-12 text-xl text-primary underline">
        Open the study team dashboard →
      </Link>
    </main>
  );
}
