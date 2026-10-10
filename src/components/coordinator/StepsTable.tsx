import type { Step } from "@/protocol/schema";

const VERIFICATION_LABEL: Record<Step["verification"], string> = {
  visual: "Camera",
  verbal: "Spoken / tap",
  "visual+verbal": "Camera + spoken",
};

/** Read-only view of a protocol's steps. */
export function StepsTable({ steps }: { steps: readonly Step[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {steps.map((step) => (
        <li key={step.id} className="rounded-xl border-2 border-border p-4">
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="text-lg font-bold">
              {step.order}. {step.instruction}
            </span>
            {step.critical && (
              <span className="rounded-full bg-danger px-2 py-0.5 text-sm font-bold text-danger-foreground">
                Critical
              </span>
            )}
            <span className="text-sm text-muted">{VERIFICATION_LABEL[step.verification]}</span>
            {step.timerSeconds !== undefined && (
              <span className="text-sm text-muted">⏱ {step.timerSeconds}s</span>
            )}
          </div>
          <p className="mt-2">
            <span className="font-bold">Says:</span> {step.spokenPrompt}
          </p>
          <p className="mt-1 text-muted">
            <span className="font-bold">Camera looks for:</span> {step.successCriteria}
          </p>
        </li>
      ))}
    </ol>
  );
}
