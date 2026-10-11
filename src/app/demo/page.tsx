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
const eyebrow = "font-mono text-sm font-bold tracking-[0.14em] uppercase";

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

/** Outcomes for the medical walkthrough; each maps to a scripted vision scenario. */
const WALKTHROUGH_OUTCOMES = [
  {
    scenario: "happy",
    title: "Done correctly",
    body: "Every step is confirmed, including the 10-second hold.",
  },
  {
    scenario: "skip-critical",
    title: "Skips a critical step",
    body: "The alcohol swab is skipped, so Witness stops and routes to the nurse.",
  },
  {
    scenario: "early-release",
    title: "Lifts the pen too early",
    body: "The hold ends before 10 seconds, so Witness stops the procedure.",
  },
] as const;

const AUTOINJECTOR = DEMO_PROTOCOLS.find((p) => p.id === "mock-autoinjector");

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
          <h1 className="text-5xl leading-[1.04] font-semibold tracking-tight sm:text-6xl">
            Try Witness
          </h1>
          <p className="text-xl leading-relaxed">
            Two ways to see it: walk through a mock at-home injection, or test the live camera
            checks with just your hands. Either way, Witness coaches one step at a time and stops
            the procedure if a critical step is missed.
          </p>

          {/* 1. The clinical story: a mock autoinjector with simulated camera checks. */}
          <section
            aria-labelledby="walkthrough-heading"
            className="flex flex-col gap-5 rounded-[2rem] border-2 border-primary/30 bg-surface p-6 shadow-lift sm:p-8"
          >
            <p className={`${eyebrow} text-primary`}>1 · Medical procedure walkthrough</p>
            <div className="flex flex-col gap-2">
              <h2 id="walkthrough-heading" className="text-3xl font-semibold tracking-tight">
                Mock autoinjector
              </h2>
              <p className="text-lg leading-relaxed">
                {AUTOINJECTOR?.steps.length ?? 9} steps of a self-injection: wash hands, read the
                label, clean the site, remove the cap, press and hold for 10 seconds, and dispose of
                the pen. Camera checks are simulated, so no camera or props are needed.
              </p>
            </div>
            <form action="/s/demo" method="get" className="flex flex-col gap-5">
              <input type="hidden" name="vision" value="scripted" />
              <input type="hidden" name="protocol" value="mock-autoinjector" />
              <input type="hidden" name="participant" value="p-001" />
              <fieldset className="flex flex-col gap-3">
                <legend className="mb-2 text-lg font-bold">What should happen?</legend>
                {WALKTHROUGH_OUTCOMES.map((o, i) => (
                  <label
                    key={o.scenario}
                    className="flex cursor-pointer items-start gap-3 rounded-2xl border-2 border-hairline bg-background p-4 has-[:checked]:border-primary has-[:checked]:bg-primary-soft"
                  >
                    <input
                      type="radio"
                      name="scenario"
                      value={o.scenario}
                      defaultChecked={i === 0}
                      className="mt-1 size-5 accent-[var(--primary)]"
                    />
                    <span>
                      <span className="block text-lg font-bold">{o.title}</span>
                      <span className="block text-base text-muted">{o.body}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <button className="flex min-h-16 items-center justify-center gap-2 rounded-[1.25rem] bg-primary px-5 text-xl font-bold text-primary-foreground shadow-lift hover:brightness-110">
                Start medical walkthrough
              </button>
              <p className="text-base text-muted">
                Tap Done on spoken steps. Then open the study team dashboard to see the
                session&apos;s timeline, evidence and flags.
              </p>
            </form>
          </section>
        </div>

        <div className="flex flex-col gap-6 lg:pt-4">
          {/* 2. The live AI: real camera checks with a safe, prop-free procedure. */}
          <form
            action="/s/demo"
            method="get"
            className="flex flex-col gap-5 rounded-[2rem] border-2 border-hairline bg-surface p-6 shadow-soft sm:p-8"
          >
            <p className={`${eyebrow} text-muted`}>2 · Live camera check (hands only)</p>
            <p className="text-lg leading-relaxed">
              {gemini
                ? "Real Gemini vision checks each step. "
                : "Camera checks are simulated here. "}
              Show two open hands, give a thumbs-up, then hold a fist for five verified seconds.
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
            <button className="flex min-h-16 items-center justify-center gap-2 rounded-[1.25rem] border-2 border-primary bg-surface px-5 text-xl font-bold text-primary hover:bg-primary-soft">
              Start live camera demo
            </button>
            <ul className="grid gap-2 text-base">
              {CHECKLIST.map(([title, body]) => (
                <li key={title}>
                  <span className="font-bold">{title}:</span>{" "}
                  <span className="text-muted">{body}</span>
                </li>
              ))}
            </ul>
          </form>

          <p className="text-base leading-relaxed text-muted">
            A training procedure with synthetic participants, not medical guidance. Selected
            evidence frames and the session record are saved for the study team. Notifications are
            simulated; no texts or automatic calls are sent.
          </p>

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
