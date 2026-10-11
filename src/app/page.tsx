import Link from "next/link";
import { WitnessMark, Wordmark } from "@/components/brand";

const STEPS = [
  {
    n: "01",
    title: "Coach",
    body: "One step at a time, in large text and a calm voice. Built for older adults at home, with a button for every voice command.",
  },
  {
    n: "02",
    title: "Check",
    body: "The phone camera checks each step. A step counts only after three matching frames in a row, so one blurry frame never decides anything.",
  },
  {
    n: "03",
    title: "Record",
    body: "The study team gets a time-stamped timeline with evidence frames. A skipped critical step stops the procedure and routes to the nurse.",
  },
] as const;

const PRINCIPLES = [
  ["Flags and records. A human decides.", "Witness never makes a medical decision."],
  ["Stops when it isn't sure.", "Uncertainty pauses or stops; it never says “carry on”."],
  ["No model-written words.", "Patients only hear scripts the study team reviewed."],
  ["Never any dosing advice.", "Dose language in a protocol is flagged for review."],
] as const;

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-5">
        <Wordmark />
        <nav aria-label="Main" className="flex items-center gap-2 text-lg">
          <Link
            href="/coordinator"
            className="hidden rounded-full px-4 py-2 font-bold hover:bg-surface-2 sm:inline-block"
          >
            Study team
          </Link>
          <Link
            href="/demo"
            className="rounded-full bg-foreground px-5 py-2 font-bold text-background hover:opacity-90"
          >
            Try the demo
          </Link>
        </nav>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto grid w-full max-w-6xl items-center gap-16 px-6 pt-8 pb-24 lg:grid-cols-[1.1fr_0.9fr] lg:pt-16">
          <div className="stagger flex flex-col gap-7">
            <p className="w-fit rounded-full border-2 border-hairline bg-surface px-4 py-1.5 font-mono text-sm font-bold tracking-[0.12em] text-muted uppercase">
              For decentralized clinical trials
            </p>
            <h1 className="text-5xl leading-[1.02] font-semibold tracking-tight text-balance sm:text-6xl lg:text-7xl">
              Every at-home step, <em className="text-primary italic">seen</em> and confirmed.
            </h1>
            <p className="max-w-xl text-xl leading-relaxed text-muted">
              Witness coaches trial participants through at-home procedures with their phone camera
              and voice, and gives the study team a time-stamped record of each step.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                href="/demo"
                className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-primary px-7 text-xl font-bold text-primary-foreground shadow-lift hover:brightness-110"
              >
                Patient demo
                <span aria-hidden="true">→</span>
              </Link>
              <Link
                href="/coordinator"
                className="flex min-h-14 items-center justify-center rounded-2xl border-2 border-border bg-surface px-7 text-xl font-bold shadow-soft hover:border-foreground"
              >
                Coordinator dashboard
              </Link>
            </div>
            <p className="text-base text-muted">
              Hackathon demo · synthetic data only · not medical guidance
            </p>
          </div>

          <HeroVisual />
        </section>

        {/* How it works */}
        <section
          aria-labelledby="how-heading"
          className="border-y border-hairline bg-surface py-20"
        >
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-12 px-6">
            <div className="flex max-w-2xl flex-col gap-3">
              <p className="font-mono text-sm font-bold tracking-[0.14em] text-accent uppercase">
                How it works
              </p>
              <h2 id="how-heading" className="text-4xl font-semibold tracking-tight sm:text-5xl">
                A coach for the participant. A witness for the study team.
              </h2>
            </div>
            <ol className="grid gap-6 md:grid-cols-3">
              {STEPS.map((s) => (
                <li
                  key={s.n}
                  className="flex flex-col gap-4 rounded-3xl border-2 border-hairline bg-background p-7"
                >
                  <span className="font-mono text-lg font-bold text-primary">{s.n}</span>
                  <h3 className="font-display text-3xl font-semibold">{s.title}</h3>
                  <p className="text-lg leading-relaxed text-muted">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Safety */}
        <section aria-labelledby="safety-heading" className="py-20">
          <div className="mx-auto grid w-full max-w-6xl gap-12 px-6 lg:grid-cols-[0.8fr_1.2fr]">
            <div className="flex flex-col gap-3">
              <p className="font-mono text-sm font-bold tracking-[0.14em] text-accent uppercase">
                Safety by design
              </p>
              <h2 id="safety-heading" className="text-4xl font-semibold tracking-tight sm:text-5xl">
                Built to stop, not to guess.
              </h2>
              <p className="text-lg leading-relaxed text-muted">
                When Witness is unsure, it pauses or stops and sends the participant to a human. The
                study team reviews every flag.
              </p>
            </div>
            <ul className="grid gap-4 sm:grid-cols-2">
              {PRINCIPLES.map(([title, body]) => (
                <li
                  key={title}
                  className="flex gap-4 rounded-3xl border-2 border-hairline bg-surface p-6 shadow-soft"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary"
                  >
                    ✓
                  </span>
                  <div>
                    <p className="text-lg font-bold">{title}</p>
                    <p className="text-base text-muted">{body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="border-t border-hairline">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-base text-muted">
          <span className="inline-flex items-center gap-2">
            <WitnessMark className="size-6" /> Witness · hackathon prototype
          </span>
          <span>Synthetic participants only. Not a medical device. Not medical guidance.</span>
        </div>
      </footer>
    </div>
  );
}

/** A phone showing a live step, overlapped by the study team's record. Pure HTML/CSS. */
function HeroVisual() {
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-md pb-28 select-none">
      <div className="relative mx-auto w-[280px] rotate-[-2deg] sm:mr-4 rounded-[2.75rem] border-[10px] border-foreground bg-background p-4 shadow-lift sm:w-[300px]">
        <div className="mx-auto mb-3 h-1.5 w-16 rounded-full bg-surface-2" />
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] font-bold tracking-[0.14em] text-muted">
            STEP 7 OF 9
          </span>
          <span className="rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-bold text-danger">
            Important
          </span>
        </div>
        <div className="mt-2 flex gap-1">
          {[1, 1, 1, 1, 1, 1, 2, 0, 0].map((v, i) => (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-full ${v === 1 ? "bg-success" : v === 2 ? "bg-primary" : "bg-surface-2"}`}
            />
          ))}
        </div>
        <p className="mt-4 font-display text-[26px] leading-[1.05] font-semibold">
          Press and hold for 10 seconds
        </p>
        <div className="mt-4 flex items-center gap-3 rounded-2xl bg-primary-soft p-3">
          <div className="relative size-16 shrink-0">
            <svg viewBox="0 0 120 120" className="size-full -rotate-90">
              <circle cx="60" cy="60" r="50" fill="none" stroke="var(--surface)" strokeWidth="12" />
              <circle
                cx="60"
                cy="60"
                r="50"
                fill="none"
                stroke="var(--primary)"
                strokeWidth="12"
                strokeLinecap="round"
                strokeDasharray="314"
                strokeDashoffset="94"
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center font-mono text-xl font-bold text-primary">
              7
            </span>
          </div>
          <span className="text-sm leading-snug font-bold">
            Hold it there. I&apos;ll count for you.
          </span>
        </div>
        <div className="mt-4 grid grid-cols-[auto_1fr] gap-2">
          <span className="rounded-xl border-2 border-border px-3 py-2 text-xs font-bold">
            Pause
          </span>
          <span className="rounded-xl border-2 border-border px-3 py-2 text-center text-xs font-bold">
            Call my nurse
          </span>
        </div>
      </div>

      <div className="absolute bottom-0 left-0 w-[250px] rotate-[3deg] rounded-3xl border-2 border-hairline bg-surface p-4 shadow-lift sm:-left-4">
        <p className="font-mono text-[11px] font-bold tracking-[0.14em] text-muted">
          SESSION RECORD
        </p>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          {[
            ["00:12", "Wash your hands"],
            ["00:31", "Clean the site"],
            ["01:04", "Pull the cap off"],
          ].map(([t, label]) => (
            <li key={t} className="flex items-center gap-2">
              <span className="flex size-5 items-center justify-center rounded-full bg-success-soft text-[11px] text-success">
                ✓
              </span>
              <span className="font-mono text-xs text-muted">{t}</span>
              <span className="font-bold">{label}</span>
            </li>
          ))}
          <li className="mt-1 rounded-xl border-l-4 border-danger bg-danger-soft px-2 py-1.5 text-xs font-bold text-danger">
            CRITICAL · hold ended early → nurse
          </li>
        </ul>
      </div>
      <WitnessMark className="absolute -top-4 right-4 size-12 rotate-6 sm:right-10" />
    </div>
  );
}
