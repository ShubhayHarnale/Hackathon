/**
 * Vision eval: measures how well the vision prompt recognises steps on recorded frames.
 *
 *   ffmpeg -i take1.mp4 -vf fps=1,scale=640:-1 eval/take1/frame_%04d.jpg
 *   # write eval/take1/labels.json: { "frame_0001.jpg": "wash-hands", "frame_0002.jpg": "none", ... }
 *   npm run vision:eval -- --protocol mock-autoinjector --frames eval/take1
 *
 * Each frame is checked with the "current step" set to the most recent labelled step, the
 * same context the engine would give it. Reports accuracy, false-skip rate (the number
 * that causes wrong stops) and latency. Needs GEMINI_API_KEY (reads .env.local).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { GoogleGenAI } from "@google/genai";
import { DEMO_PROTOCOLS } from "@/demo";
import type { Protocol, Step } from "@/protocol/schema";
import { createGeminiVisionProvider } from "@/vision/gemini";
import { DEFAULT_LOOKAHEAD, type StepContext } from "@/vision/types";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const { values } = parseArgs({
  options: {
    protocol: { type: "string", default: "mock-autoinjector" },
    frames: { type: "string" },
    labels: { type: "string" },
    model: { type: "string" },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) fail("GEMINI_API_KEY is not set (add it to .env.local).");
if (!values.frames) fail("Pass --frames <dir> containing frame JPEGs and labels.json.");

const protocol = DEMO_PROTOCOLS.find((p) => p.id === values.protocol);
if (!protocol)
  fail(
    `Unknown protocol "${values.protocol}". Known: ${DEMO_PROTOCOLS.map((p) => p.id).join(", ")}`,
  );

const labelsPath = values.labels ?? join(values.frames, "labels.json");
if (!existsSync(labelsPath))
  fail(`No labels file at ${labelsPath}. See the header of this script.`);
const labels = JSON.parse(readFileSync(labelsPath, "utf8")) as Record<string, string>;
const files = readdirSync(values.frames)
  .filter((f) => /\.jpe?g$/i.test(f) && f in labels)
  .sort();
if (files.length === 0) fail(`No labelled .jpg frames found in ${values.frames}.`);

const ids = new Set(protocol.steps.map((s) => s.id));
for (const [file, label] of Object.entries(labels)) {
  if (label !== "none" && !ids.has(label)) fail(`${file}: unknown step id "${label}"`);
}

const ctx = (s: Step): StepContext => ({
  id: s.id,
  instruction: s.instruction,
  successCriteria: s.successCriteria,
});
const provider = createGeminiVisionProvider({
  client: new GoogleGenAI({ apiKey }),
  model: values.model ?? process.env.GEMINI_VISION_MODEL ?? "gemini-3.8-flash",
  timeoutMs: 15_000,
});

async function main(protocol: Protocol, framesDir: string) {
  let currentIndex = 0;
  let correct = 0;
  let onCurrent = 0;
  let onCurrentCorrect = 0;
  let falseLater = 0;
  let errors = 0;
  const latencies: number[] = [];
  const mistakes: string[] = [];

  for (const [i, file] of files.entries()) {
    const label = labels[file]!;
    const labelIndex = protocol.steps.findIndex((s) => s.id === label);
    if (labelIndex >= 0) currentIndex = labelIndex;
    const current = protocol.steps[currentIndex]!;
    const upcoming = protocol.steps.slice(currentIndex + 1, currentIndex + 1 + DEFAULT_LOOKAHEAD);

    const started = performance.now();
    try {
      const result = await provider.check({
        sessionId: "eval",
        seq: i + 1,
        capturedAt: Date.now(),
        image: {
          mimeType: "image/jpeg",
          base64: readFileSync(join(framesDir, file)).toString("base64"),
        },
        currentStep: ctx(current),
        upcomingSteps: upcoming.map(ctx),
      });
      latencies.push(performance.now() - started);
      const predicted = result.confidence >= 0.7 ? (result.observedStepId ?? "none") : "none";
      if (predicted === label) correct++;
      else
        mistakes.push(
          `${file}: expected ${label}, got ${predicted} @${result.confidence.toFixed(2)}${result.issue ? ` [${result.issue}]` : ""}`,
        );
      if (label === current.id) {
        onCurrent++;
        if (predicted === label) onCurrentCorrect++;
        if (upcoming.some((s) => s.id === predicted)) falseLater++;
      }
      process.stdout.write(predicted === label ? "." : "x");
    } catch (error) {
      errors++;
      process.stdout.write("E");
      mistakes.push(`${file}: error ${(error as Error).message}`);
    }
  }

  const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "n/a");
  const sorted = [...latencies].sort((a, b) => a - b);
  const p = (q: number) =>
    sorted.length ? `${Math.round(sorted[Math.floor(q * (sorted.length - 1))]!)}ms` : "n/a";

  console.log(`\n\nProtocol: ${protocol.title} · frames: ${files.length} · errors: ${errors}`);
  console.log(`Accuracy (confidence >= 0.7):        ${pct(correct, files.length - errors)}`);
  console.log(`Current-step recall:                 ${pct(onCurrentCorrect, onCurrent)}`);
  console.log(`False "later step" rate (skip risk): ${pct(falseLater, onCurrent)}`);
  console.log(`Latency p50 / p95:                   ${p(0.5)} / ${p(0.95)}`);
  if (mistakes.length) console.log(`\nMistakes:\n  ${mistakes.slice(0, 40).join("\n  ")}`);
}

main(protocol, values.frames).catch((error: unknown) => fail(String(error)));
