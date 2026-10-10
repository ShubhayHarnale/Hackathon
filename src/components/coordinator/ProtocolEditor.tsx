"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { z } from "zod";
import type { LintWarning } from "@/protocol/compiler";
import { lintProtocol } from "@/protocol/lint";
import { normalizeProtocol } from "@/protocol/normalize";
import { ProtocolSchema, type Protocol, type Step, type Verification } from "@/protocol/schema";

const SAMPLE = `1. Wash your hands with soap and water.
2. Read the name on the pen label out loud.
3. Check the expiry date on the label.
4. (critical) Clean the injection site on your thigh with an alcohol swab.
5. Pull the cap off the pen.
6. Place the pen against your thigh at 90 degrees.
7. (critical) Press and hold the pen down for 10 seconds.
8. Lift the pen away from your thigh.
9. Put the used pen in the sharps container.`;

type EditableStep = Omit<Step, "timerSeconds"> & { timerSeconds?: number | undefined };
type CompileResponse =
  | { ok: true; protocol: Protocol; warnings: LintWarning[]; compiler: string }
  | { ok: false; error: string; compiler?: string };

const inputClass =
  "w-full rounded-lg border-2 border-border bg-background px-3 py-2 text-base focus:border-primary";

export function ProtocolEditor({
  initialProtocol,
  initialText,
}: {
  initialProtocol: Protocol | null;
  initialText: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialProtocol?.title ?? "");
  const [text, setText] = useState(initialText);
  const [protocol, setProtocol] = useState<Protocol | null>(initialProtocol);
  const [status, setStatus] = useState<"idle" | "compiling" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);
  const [compilerName, setCompilerName] = useState<string | null>(null);

  // Re-validate on every edit, after the same deterministic normalisation the server uses.
  const validation = useMemo(() => {
    if (!protocol) return null;
    return ProtocolSchema.safeParse(normalizeProtocol(protocol, title));
  }, [protocol, title]);
  const warnings = validation?.success ? lintProtocol(validation.data) : [];

  async function compile() {
    setStatus("compiling");
    setError(null);
    try {
      const res = await fetch("/api/protocols/compile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, ...(title.trim() ? { title } : {}) }),
      });
      const data = (await res.json()) as CompileResponse;
      setCompilerName(data.compiler ?? null);
      if (data.ok) {
        setProtocol(data.protocol);
        setTitle(data.protocol.title);
      } else {
        setError(data.error);
      }
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setStatus("idle");
    }
  }

  async function save() {
    if (!validation?.success) return;
    setStatus("saving");
    setError(null);
    const res = await fetch("/api/protocols", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ protocol: validation.data, sourceText: text || null }),
    });
    if (res.ok) {
      const { record } = (await res.json()) as { record: { id: string } };
      router.push(`/coordinator/protocols/${record.id}`);
    } else {
      setError("Save failed. Check the steps and try again.");
      setStatus("idle");
    }
  }

  function updateStep(index: number, patch: Partial<EditableStep>) {
    setProtocol((p) =>
      p ? { ...p, steps: p.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)) } : p,
    );
  }

  function moveStep(index: number, delta: -1 | 1) {
    setProtocol((p) => {
      if (!p) return p;
      const steps = [...p.steps];
      const target = index + delta;
      const a = steps[index];
      const b = steps[target];
      if (!a || !b) return p;
      steps[index] = b;
      steps[target] = a;
      return { ...p, steps: steps.map((s, i) => ({ ...s, order: i + 1 })) };
    });
  }

  function removeStep(index: number) {
    setProtocol((p) =>
      p
        ? {
            ...p,
            steps: p.steps.filter((_, i) => i !== index).map((s, i) => ({ ...s, order: i + 1 })),
          }
        : p,
    );
  }

  function addStep() {
    setProtocol((p) => {
      const base: Protocol = p ?? {
        id: "new-protocol",
        title: title || "New protocol",
        isDemo: false,
        steps: [],
      };
      const n = base.steps.length + 1;
      const step: Step = {
        id: `step-${n}`,
        order: n,
        instruction: "",
        spokenPrompt: "",
        successCriteria: "",
        critical: false,
        verification: "visual",
      };
      return { ...base, steps: [...base.steps, step] };
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="source-heading" className="flex flex-col gap-3">
        <h2 id="source-heading" className="text-xl font-bold">
          1. Procedure text
        </h2>
        <label className="flex flex-col gap-1 font-bold">
          Title
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 font-bold">
          Instructions (one step per line works best)
          <textarea
            className={`${inputClass} min-h-48 font-mono text-sm`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={SAMPLE}
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={compile}
            disabled={status !== "idle" || !text.trim()}
            className="min-h-11 rounded-lg bg-primary px-5 text-lg font-bold text-primary-foreground disabled:opacity-50"
          >
            {status === "compiling" ? "Compiling…" : "Compile into steps"}
          </button>
          {!text && (
            <button
              type="button"
              onClick={() => setText(SAMPLE)}
              className="text-primary underline"
            >
              Use the demo autoinjector text
            </button>
          )}
          {compilerName && <span className="text-sm text-muted">Compiler: {compilerName}</span>}
        </div>
      </section>

      {error && (
        <p
          role="alert"
          className="whitespace-pre-wrap rounded-lg border-2 border-danger px-4 py-3 font-bold text-danger"
        >
          {error}
        </p>
      )}

      {protocol && (
        <section aria-labelledby="review-heading" className="flex flex-col gap-4">
          <h2 id="review-heading" className="text-xl font-bold">
            2. Review the steps
          </h2>
          <label className="flex max-w-sm flex-col gap-1 font-bold">
            Protocol id
            <input
              className={inputClass}
              value={protocol.id}
              onChange={(e) => setProtocol({ ...protocol, id: e.target.value })}
            />
          </label>
          {warnings.length > 0 && (
            <ul className="flex flex-col gap-1 rounded-lg border-2 border-warning-fg bg-warning-bg px-4 py-3 text-warning-fg">
              {warnings.map((w, i) => (
                <li key={i}>⚠ {w.message}</li>
              ))}
            </ul>
          )}
          <ol className="flex flex-col gap-4">
            {protocol.steps.map((step, i) => (
              <StepEditor
                key={`${step.id}-${i}`}
                step={step}
                index={i}
                count={protocol.steps.length}
                onChange={(patch) => updateStep(i, patch)}
                onMove={(d) => moveStep(i, d)}
                onRemove={() => removeStep(i)}
              />
            ))}
          </ol>
          <button
            type="button"
            onClick={addStep}
            className="self-start text-lg text-primary underline"
          >
            + Add a step
          </button>

          {validation && !validation.success && (
            <pre
              role="alert"
              className="whitespace-pre-wrap rounded-lg border-2 border-danger px-4 py-3 text-sm text-danger"
            >
              {z.prettifyError(validation.error)}
            </pre>
          )}
          <div>
            <button
              type="button"
              onClick={save}
              disabled={status !== "idle" || !validation?.success}
              className="min-h-11 rounded-lg bg-primary px-5 text-lg font-bold text-primary-foreground disabled:opacity-50"
            >
              {status === "saving" ? "Saving…" : "3. Save as draft"}
            </button>
            <p className="mt-2 text-sm text-muted">You can publish from the next page.</p>
          </div>
        </section>
      )}
    </div>
  );
}

function StepEditor({
  step,
  index,
  count,
  onChange,
  onMove,
  onRemove,
}: {
  step: EditableStep;
  index: number;
  count: number;
  onChange: (patch: Partial<EditableStep>) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const n = index + 1;
  return (
    <li className="flex flex-col gap-3 rounded-xl border-2 border-border p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-lg font-bold">Step {n}</span>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={step.critical}
            onChange={(e) => onChange({ critical: e.target.checked })}
            className="size-5"
          />
          Critical
        </label>
        <label className="flex items-center gap-2">
          Confirmed by
          <select
            value={step.verification}
            onChange={(e) => onChange({ verification: e.target.value as Verification })}
            className="rounded-lg border-2 border-border bg-background px-2 py-1"
          >
            <option value="visual">Camera</option>
            <option value="verbal">Spoken / tap</option>
            <option value="visual+verbal">Camera + spoken</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          Timer (s)
          <input
            type="number"
            min={1}
            max={3600}
            value={step.timerSeconds ?? ""}
            onChange={(e) =>
              onChange({ timerSeconds: e.target.value ? Number(e.target.value) : undefined })
            }
            className="w-24 rounded-lg border-2 border-border bg-background px-2 py-1"
          />
        </label>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            aria-label={`Move step ${n} up`}
            className="min-h-10 min-w-10 rounded-lg border-2 border-border disabled:opacity-30"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={index === count - 1}
            aria-label={`Move step ${n} down`}
            className="min-h-10 min-w-10 rounded-lg border-2 border-border disabled:opacity-30"
          >
            ↓
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove step ${n}`}
            className="min-h-10 rounded-lg border-2 border-danger px-3 text-danger"
          >
            Remove
          </button>
        </div>
      </div>
      <label className="flex flex-col gap-1 font-bold">
        On-screen instruction
        <input
          className={inputClass}
          value={step.instruction}
          onChange={(e) => onChange({ instruction: e.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1 font-bold">
        Spoken prompt
        <textarea
          className={inputClass}
          rows={2}
          value={step.spokenPrompt}
          onChange={(e) => onChange({ spokenPrompt: e.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1 font-bold">
        What the camera should see
        <textarea
          className={inputClass}
          rows={2}
          value={step.successCriteria}
          onChange={(e) => onChange({ successCriteria: e.target.value })}
        />
      </label>
    </li>
  );
}
