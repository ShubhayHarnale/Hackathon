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
  ["Good light", "Face a window or a lamp."],
  ["Both hands in view", "Prop your phone or laptop up, an arm's length away."],
  ["Hold each gesture", "Keep it still until Witness confirms it."],
] as const;

/**
 * One choice: start the live camera demo. Witness decides what happened from the camera;
 * the visitor never picks an outcome. Everything else is tucked into "More options".
 */
async function DemoContent() {
  await connection();
  const gemini = serverEnv().VISION_PROVIDER === "gemini";
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-2xl items-center justify-between gap-4 px-5 py-5">
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

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-5 pt-4 pb-16">
        <div className="stagger flex flex-col gap-5">
          <h1 className="text-5xl leading-[1.04] font-semibold tracking-tight sm:text-6xl">
            Try Witness
          </h1>
          <p className="text-xl leading-relaxed">
            Witness coaches you one step at a time and checks each step with your camera. If an
            important step is missed, it stops and tells you to call your nurse.
          </p>
        </div>

        <form
          action="/s/demo"
          method="get"
          className="flex flex-col gap-6 rounded-[2rem] border-2 border-hairline bg-surface p-6 shadow-lift sm:p-8"
        >
          <input type="hidden" name="vision" value="server" />
          <input type="hidden" name="protocol" value={DEFAULT_DEMO_PROTOCOL_ID} />
          <input type="hidden" name="participant" value="p-001" />
          <p className="text-xl leading-relaxed">
            You&apos;ll show two open hands, give a thumbs-up, then hold a fist for five seconds.
            {gemini ? " Gemini checks each step live." : ""}
          </p>
          <ul className="grid gap-2 text-lg">
            {CHECKLIST.map(([title, body]) => (
              <li key={title} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="mt-1.5 size-2.5 shrink-0 rounded-full bg-primary"
                />
                <span>
                  <span className="font-bold">{title}.</span>{" "}
                  <span className="text-muted">{body}</span>
                </span>
              </li>
            ))}
          </ul>
          <button className="flex min-h-16 items-center justify-center gap-2 rounded-[1.25rem] bg-primary px-5 text-2xl font-bold text-primary-foreground shadow-lift hover:brightness-110">
            Start live camera demo
          </button>
        </form>

        <Link
          href="/coordinator"
          className="flex min-h-14 items-center justify-between rounded-2xl border-2 border-border bg-surface px-5 text-lg font-bold shadow-soft hover:border-foreground"
        >
          Open the study team dashboard →
        </Link>

        <details className="group rounded-2xl border-2 border-hairline bg-surface p-5">
          <summary className="flex min-h-12 cursor-pointer items-center justify-between text-lg font-bold">
            More options (for testing)
            <span aria-hidden="true" className="transition-transform group-open:rotate-45">
              +
            </span>
          </summary>

          <div className="mt-5 flex flex-col gap-8">
            <form action="/s/demo" method="get" className="flex flex-col gap-5">
              <p className="text-base text-muted">
                Live camera with a different procedure or synthetic participant.
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
              <button className="min-h-14 rounded-[1.25rem] border-2 border-primary bg-surface px-5 text-lg font-bold text-primary hover:bg-primary-soft">
                Start with these options
              </button>
            </form>

            <form
              action="/s/demo"
              method="get"
              className="flex flex-col gap-5 border-t border-hairline pt-6"
            >
              <p className="text-base text-muted">
                No camera available? Scripted tests simulate the camera checks, so they show the
                flow but do not test recognition. Recorded video uses the server vision provider.
              </p>
              <ProcedureField advanced />
              <label className={labelClass}>
                Test source
                <select name="vision" className={field}>
                  <option value="scripted">Scripted test — simulated checks</option>
                  <option value="replay">Recorded video — choose a local file</option>
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
          </div>
        </details>

        <p className="text-base leading-relaxed text-muted">
          A training procedure with synthetic participants, not medical guidance. Selected evidence
          frames and the session record are saved for the study team. Notifications are simulated;
          no texts or automatic calls are sent.
        </p>
      </main>
    </div>
  );
}
