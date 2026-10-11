import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { PatientLoading } from "@/components/patient/SessionMessage";
import { DEFAULT_DEMO_PROTOCOL_ID, DEMO_PROTOCOLS, DEMO_PARTICIPANTS } from "@/demo";
import { serverEnv } from "@/lib/env";
import { SCENARIOS } from "@/vision/mock";

export const metadata = { title: "Try Witness | Witness" };
const field = "min-h-12 w-full rounded-lg border-2 border-border bg-background p-3";

function ProcedureField({ advanced = false }: { advanced?: boolean }) {
  return (
    <label className="flex flex-col gap-2">
      {advanced ? "Test procedure" : "Procedure"}
      <select name="protocol" defaultValue={DEFAULT_DEMO_PROTOCOL_ID} className={field}>
        {DEMO_PROTOCOLS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function DemoPage() {
  return (
    <Suspense fallback={<PatientLoading />}>
      <DemoContent />
    </Suspense>
  );
}

async function DemoContent() {
  await connection();
  const gemini = serverEnv().VISION_PROVIDER === "gemini";
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 py-10">
      <Link href="/" className="text-primary underline">
        ← Witness
      </Link>
      <h1 className="text-4xl font-bold">Try Witness</h1>
      <p className="text-xl">
        Follow the voice coach, one step at a time. Witness checks what your camera sees as you go
        and stops the procedure if it detects a skipped critical step.
      </p>
      <section aria-label="What you need" className="flex flex-col gap-3">
        <h2 className="text-2xl font-bold">Just your hands and a camera</h2>
        <p className="text-xl">
          Prop up your phone or laptop in good light with both hands in view. The demo asks you to
          show two open hands, give a thumbs-up, then hold a fist for five verified seconds. Keep
          each gesture visible until Witness confirms it.
        </p>
        <p className="text-base text-muted">
          {gemini
            ? "Live camera checks use Gemini. Your actions determine the result; you do not choose an outcome."
            : "This environment uses mock vision: camera checks are simulated. Configure Gemini for real recognition."}{" "}
          This is a training procedure with synthetic participants, not medical guidance. Selected
          evidence frames and the session record are saved for the study team. Notifications are
          simulated; no texts or automatic calls are sent.
        </p>
      </section>
      <form action="/s/demo" method="get" className="flex flex-col gap-5 text-xl">
        <input type="hidden" name="vision" value="server" />
        <ProcedureField />
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
        <button className="min-h-16 rounded-xl bg-primary px-5 font-bold text-primary-foreground">
          Start live camera demo
        </button>
      </form>
      <Link href="/coordinator" className="min-h-12 text-xl text-primary underline">
        Open the study team dashboard →
      </Link>
      <details className="rounded-xl border-2 border-border p-4">
        <summary className="min-h-12 cursor-pointer text-xl font-bold">
          Developer test tools
        </summary>
        <p className="my-4 text-base text-muted">
          Scripted tests simulate outcomes and do not test recognition. Recorded video uses the
          configured server vision provider. These tools are separate from the live demo.
        </p>
        <form action="/s/demo" method="get" className="flex flex-col gap-5 text-xl">
          <ProcedureField advanced />
          <label className="flex flex-col gap-2">
            Test source
            <select name="vision" className={field}>
              <option value="replay">Recorded video — choose a local file</option>
              <option value="scripted">Scripted test — simulated checks</option>
            </select>
          </label>
          <label className="flex flex-col gap-2">
            Scripted scenario (scripted tests only)
            <select name="scenario" className={field}>
              {Object.entries(SCENARIOS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button className="min-h-16 rounded-xl border-2 border-primary px-5 font-bold text-primary">
            Launch a fresh test session
          </button>
        </form>
      </details>
    </main>
  );
}
