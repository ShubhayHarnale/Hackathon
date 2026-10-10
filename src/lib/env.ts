import { z } from "zod";

/**
 * Environment configuration, validated with Zod.
 *
 * Every external provider defaults to its mock, so the app runs with no keys at all.
 * Server values are parsed lazily (on first use) so `next build` never needs secrets.
 */

const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);
const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());

const ServerEnvSchema = z
  .object({
    VISION_PROVIDER: z.enum(["mock", "gemini"]).default("mock"),
    PROTOCOL_COMPILER: z.enum(["mock", "gemini"]).default("mock"),
    PERSISTENCE: z.enum(["memory", "supabase"]).default("memory"),
    NOTIFIER: z.enum(["mock"]).default("mock"),

    GEMINI_API_KEY: optionalString,
    GEMINI_COMPILER_MODEL: z.string().min(1).default("gemini-3.8-flash"),
    GEMINI_VISION_MODEL: z.string().min(1).default("gemini-3.8-flash"),
    GEMINI_LIVE_MODEL: z.string().min(1).default("gemini-3.8-live"),

    SUPABASE_URL: z.preprocess(emptyToUndefined, z.url().optional()),
    SUPABASE_SECRET_KEY: optionalString,

    COORDINATOR_PASSCODE: optionalString,
  })
  .superRefine((env, ctx) => {
    const needsGemini = env.VISION_PROVIDER === "gemini" || env.PROTOCOL_COMPILER === "gemini";
    if (needsGemini && !env.GEMINI_API_KEY) {
      ctx.addIssue({
        code: "custom",
        path: ["GEMINI_API_KEY"],
        message: "GEMINI_API_KEY is required when a Gemini provider is selected",
      });
    }
    if (env.PERSISTENCE === "supabase" && (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY)) {
      ctx.addIssue({
        code: "custom",
        path: ["PERSISTENCE"],
        message: "SUPABASE_URL and SUPABASE_SECRET_KEY are required when PERSISTENCE=supabase",
      });
    }
  });

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = ServerEnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid server environment:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

let cachedServerEnv: ServerEnv | undefined;

/** Server-side env. Never import this from a client component. */
export function serverEnv(): ServerEnv {
  cachedServerEnv ??= parseServerEnv(process.env);
  return cachedServerEnv;
}

const PublicEnvSchema = z.object({
  /** The trial's 24/7 study nurse line. Synthetic 555 number by default. */
  NEXT_PUBLIC_TRIAL_NURSE_PHONE: z.string().min(3).default("+1-555-0100"),
  NEXT_PUBLIC_VOICE_PROVIDER: z.enum(["browser", "gemini-live"]).default("browser"),
});

export type PublicEnv = z.infer<typeof PublicEnvSchema>;

/**
 * Client-safe env. Next.js only inlines `process.env.NEXT_PUBLIC_*` when accessed by
 * literal name, so each key is listed explicitly.
 */
export const publicEnv: PublicEnv = PublicEnvSchema.parse({
  NEXT_PUBLIC_TRIAL_NURSE_PHONE: emptyToUndefined(process.env.NEXT_PUBLIC_TRIAL_NURSE_PHONE),
  NEXT_PUBLIC_VOICE_PROVIDER: emptyToUndefined(process.env.NEXT_PUBLIC_VOICE_PROVIDER),
});
