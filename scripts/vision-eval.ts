/** Offline Gemini + engine evaluation. See READINESS.md for annotations and recording setup. */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { DEMO_PROTOCOLS } from "@/demo";
import { evaluateRecording } from "@/vision/evaluation";
import { createGeminiVisionProvider } from "@/vision/gemini";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const { values } = parseArgs({
  options: {
    protocol: { type: "string", default: "mock-autoinjector" },
    frames: { type: "string" },
    labels: { type: "string" },
    model: { type: "string" },
    output: { type: "string" },
    "frame-interval-ms": { type: "string", default: "1000" },
    "expect-outcome": { type: "string" },
  },
});
function fail(message: string): never {
  const key = process.env.GEMINI_API_KEY;
  console.error(key ? message.split(key).join("[redacted]") : message);
  process.exit(1);
}
const Annotation = z.union([
  z.string(),
  z.object({
    observedStepId: z.string(),
    atMs: z.number().nonnegative().optional(),
    commands: z
      .array(
        z.union([
          z.object({ type: z.literal("done"), stepId: z.string() }),
          z.object({ type: z.enum(["pause", "resume"]) }),
        ]),
      )
      .optional(),
  }),
]);

async function main() {
  if (!process.env.GEMINI_API_KEY) fail("GEMINI_API_KEY is not set (add it to .env.local).");
  if (!values.frames) fail("Pass --frames <dir> containing frame JPEGs and labels.json.");
  const interval = Number(values["frame-interval-ms"]);
  if (!Number.isFinite(interval) || interval <= 0) fail("Frame interval must be positive.");
  const expected = values["expect-outcome"];
  if (expected && !["completed", "critical_miss", "needs_human"].includes(expected))
    fail("Expected outcome must be completed, critical_miss, or needs_human.");
  const protocol = DEMO_PROTOCOLS.find((p) => p.id === values.protocol);
  if (!protocol) fail(`Unknown protocol ${values.protocol}.`);
  const labels = z
    .record(z.string(), Annotation)
    .parse(JSON.parse(readFileSync(values.labels ?? join(values.frames, "labels.json"), "utf8")));
  const files = readdirSync(values.frames)
    .filter((f) => /\.jpe?g$/i.test(f))
    .sort();
  if (!files.length) fail("No JPEG frames found.");
  if (files.some((f) => !(f in labels)))
    fail("Every extracted frame needs a label; do not silently omit difficult frames.");
  if (Object.keys(labels).some((f) => !files.includes(f)))
    fail("Labels reference missing JPEG frames.");
  const frames = files.map((file, index) => {
    const label = labels[file]!;
    return typeof label === "string"
      ? { file, atMs: index * interval, observedStepId: label }
      : { file, ...label, atMs: label.atMs ?? index * interval };
  });
  const model = values.model ?? process.env.GEMINI_VISION_MODEL ?? "gemini-3.5-flash-lite";
  const report = await evaluateRecording({
    protocol,
    frames,
    provider: createGeminiVisionProvider({
      client: new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }),
      model,
    }),
    readImage: async (file) => readFileSync(join(values.frames!, file)).toString("base64"),
  });
  const result = {
    ...report,
    model,
    timeoutMs: 4000,
    evaluationType: "offline-engine-replay; not browser playback or clinical validation",
  };
  if (values.output) writeFileSync(values.output, JSON.stringify(result, null, 2) + "\n");
  const pct = (n: number | null) => (n === null ? "n/a" : `${(100 * n).toFixed(1)}%`);
  console.log(
    JSON.stringify(
      {
        protocol: report.protocolId,
        model,
        frames: report.totalFrames,
        attempted: report.attemptedFrames,
        errors: report.errors,
        accuracy: pct(report.accuracy),
        currentStepRecall: pct(report.currentStepRecall),
        falseLaterRate: pct(report.falseLaterRate),
        latencyP50Ms: report.latencyP50Ms,
        latencyP95Ms: report.latencyP95Ms,
        outcome: report.outcome,
        stopReason: report.stopReason,
      },
      null,
      2,
    ),
  );
  const actual = report.stopReason?.kind ?? report.outcome;
  if (report.errors || (expected && expected !== actual)) process.exitCode = 1;
}
main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
