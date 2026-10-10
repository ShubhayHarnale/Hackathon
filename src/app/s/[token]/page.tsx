import { Suspense } from "react";
import { DemoBanner } from "@/components/DemoBanner";

// Patient flow (mobile). Phase 4 replaces this placeholder with the step-by-step UI.
export default function PatientSessionPage({ params }: PageProps<"/s/[token]">) {
  return (
    <div className="flex flex-1 flex-col">
      <DemoBanner />
      <main className="flex flex-1 flex-col items-center justify-center gap-8 px-6 py-10 text-center">
        <h1 className="text-4xl font-bold">Welcome</h1>
        <p className="max-w-md text-2xl">
          We will guide you through your procedure one step at a time.
        </p>
        {/* Params are runtime data under Cache Components, so they render inside Suspense. */}
        <Suspense fallback={null}>
          {params.then(({ token }) => (
            <p className="text-lg text-muted">Session link: {token}</p>
          ))}
        </Suspense>
        <button
          type="button"
          disabled
          className="min-h-16 w-full max-w-sm rounded-2xl bg-primary px-8 text-3xl font-bold text-primary-foreground disabled:opacity-60"
        >
          Start
        </button>
        <p className="text-lg text-muted">Coming in Phase 4.</p>
      </main>
    </div>
  );
}
