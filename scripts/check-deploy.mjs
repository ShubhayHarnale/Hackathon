// Deployment guard: report missing configuration, never values or credentials.
const problems = [];
if (process.env.PERSISTENCE !== "supabase")
  problems.push("PERSISTENCE must be supabase for hosted sessions.");
try {
  const url = new URL(process.env.SUPABASE_URL ?? "");
  if (url.protocol !== "https:") problems.push("SUPABASE_URL must use HTTPS.");
} catch {
  problems.push("SUPABASE_URL is missing or invalid.");
}
if (!process.env.SUPABASE_SECRET_KEY) problems.push("SUPABASE_SECRET_KEY is missing.");
if ((process.env.COORDINATOR_PASSCODE ?? "").length < 16)
  problems.push("Set a COORDINATOR_PASSCODE of at least 16 characters.");
if (
  [process.env.VISION_PROVIDER, process.env.PROTOCOL_COMPILER].includes("gemini") ||
  process.env.NEXT_PUBLIC_VOICE_PROVIDER === "gemini-live"
) {
  if (!process.env.GEMINI_API_KEY)
    problems.push("GEMINI_API_KEY is required for the selected provider.");
}
if (problems.length) {
  console.error(
    "Deployment configuration incomplete:\n" + problems.map((p) => `- ${p}`).join("\n"),
  );
  process.exitCode = 1;
} else
  console.log(
    "Deployment configuration present. Hosted database and browser acceptance checks are still required.",
  );
