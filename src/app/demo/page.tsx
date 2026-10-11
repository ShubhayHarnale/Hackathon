import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Wordmark } from "@/components/brand";
import { PatientLoading } from "@/components/patient/SessionMessage";
import { DEFAULT_DEMO_PROTOCOL_ID, DEMO_PROTOCOLS, DEMO_PARTICIPANTS } from "@/demo";
import { serverEnv } from "@/lib/env";
import { SCENARIOS } from "@/vision/mock";

export const metadata = { title: "Try Witness | Witness" };
const field =
  "min-h-14 w-full rounded-2xl border-2 border-border bg-surface px-4 text-lg font-normal shadow-soft focus:border-primary";
const labelClass = "flex flex-col gap-2 text-lg font-bold";

function ProcedureField({ advanced = false }: { advanced?: boolean }) {
  return (
    <label className={labelClass}>
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

const CHECKLIST = [
  ["Good light", "Face a window or a lamp, not away from it."],
  ["Both hands in view", "Prop your phone or laptop up, about an arm's length away."],
  ["Hold each gesture", "Keep it still until Witness confirms it."],
] as const;

async function DemoContent() {
  await connection();
  const gemini = serverEnv().VISION_PROVIDER === "gemini";
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-5 py-5">
        <Link href="/" aria-label="Witness home">
          <Wordmark />
        </Link>
        <Link
          href="/coordinator"
          className="rounded-full px-4 py-2 text-lg font-bold hover:bg-surface-2"
        >
          Study team →
        </Link>
      </header>

      <main className="mx-auto grid w-full max-w-5xl flex-1 gap-10 px-5 pt-4 pb-16 lg:grid-cols-[1fr_0.9fr]">
        <div className="stagger flex flex-col gap-6">
          <p className="w-fit rounded-full bg-primary-soft px-4 py-1.5 font-mono text-sm font-bold tracking-[0.12em] text-primary uppercase">
            {gemini ? "Live camera · Gemini vision" : "Mock vision"}
          </p>
          <h1 className="text-5xl leading-[1.04] font-semibold tracking-tight sm:text-6xl">
            Try Witness
          </h1>
          <p className="text-xl leading-relaxed">
            Follow the voice coach, one step at a time. Witness checks what your camera sees as you
            go and stops the procedure if it detects a skipped critical step.
          </p>
          <section aria-label="What you need" className="flex flex-col gap-4">
            <h2 className="text-3xl font-semibold tracking-tight">Just your hands and a camera</h2>
            <p className="text-lg leading-relaxed">
              The demo asks you to show two open hands, give a thumbs-up, then hold a fist for five
              verified seconds. Keep each gesture visible until Witness confirms it.
            </p>
            <ul className="grid gap-3 sm:grid-cols-3">
              {CHECKLIST.map(([title, body]) => (
                <li
                  key={title}
                  className="rounded-2xl border-2 border-hairline bg-surface p-4 shadow-soft"
                >
                  <p className="font-bold">{title}</p>
                  <p className="text-base text-muted">{body}</p>
                </li>
              ))}
            </ul>
            <p className="text-base leading-relaxed text-muted">
              {gemini
                ? "Live camera checks use Gemini. Your actions determine the result; you do not choose an outcome."
                : "This environment uses mock vision: camera checks are simulated. Configure Gemini for real recognition."}{" "}
              This is a training procedure with synthetic participants, not medical guidance.
              Selected evidence frames and the session record are saved for the study team.
              Notifications are simulated; no texts or automatic calls are sent.
            </p>
          </section>
        </div>

        <div className="flex flex-col gap-6 lg:pt-12">
          <form
            action="/s/demo"
            method="get"
            className="flex flex-col gap-5 rounded-[2rem] border-2 border-hairline bg-surface p-6 shadow-lift sm:p-8"
          >
            <p className="font-mono text-sm font-bold tracking-[0.14em] text-muted uppercase">
              Start a session
            </p>
            <input type="hidden" name="vision" value="server" />
            <ProcedureField />
            <label className={labelClass}>
              Participant
              <select name="participant" className={field}>
                {DEMO_PARTICIPANTS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName} —{" "}
                    {p.trustedContact?.consented
                      ? "contact consent given"
                      : "no contact notification"}
                  </option>
                ))}
              </select>
            </label>
            <button className="flex min-h-16 items-center justify-center gap-2 rounded-[1.25rem] bg-primary px-5 text-xl font-bold text-primary-foreground shadow-lift hover:brightness-110">
              Start live camera demo
            </button>
            <p className="text-base text-muted">
              Open it on a phone to get the full experience. Your browser will ask for the camera.
            </p>
          </form>

          <Link
            href="/coordinator"
            className="flex min-h-14 items-center justify-between rounded-2xl border-2 border-border bg-surface px-5 text-lg font-bold shadow-soft hover:border-foreground"
          >
            Open the study team dashboard →
          </Link>

          <details className="group rounded-2xl border-2 border-hairline bg-surface p-5">
            <summary className="flex min-h-12 cursor-pointer items-center justify-between text-lg font-bold">
              Developer test tools
              <span aria-hidden="true" className="transition-transform group-open:rotate-45">
                +
              </span>
            </summary>
            <p className="my-4 text-base text-muted">
              Scripted tests simulate outcomes and do not test recognition. Recorded video uses the
              configured server vision provider. These tools are separate from the live demo.
            </p>
            <form action="/s/demo" method="get" className="flex flex-col gap-5">
              <ProcedureField advanced />
              <label className={labelClass}>
                Test source
                <select name="vision" className={field}>
                  <option value="replay">Recorded video — choose a local file</option>
                  <option value="scripted">Scripted test — simulated checks</option>
                </select>
              </label>
              <label className={labelClass}>
                Scripted scenario (scripted tests only)
                <select name="scenario" className={field}>
                  {Object.entries(SCENARIOS).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <button className="min-h-14 rounded-[1.25rem] border-2 border-primary bg-surface px-5 text-lg font-bold text-primary hover:bg-primary-soft">
                Launch a fresh test session
              </button>
            </form>
          </details>
        </div>
      </main>
    </div>
  );
}
