import { getGeminiClient } from "@/gemini/client";
import { geminiModels } from "@/gemini/models";
import { publicEnv } from "@/lib/env";
import { providerAccess } from "@/lib/provider-access";
import { TokenBucketLimiter } from "@/vision/rate-limit";
import { LIVE_API_VERSION, liveConnectConfig } from "@/voice/gemini-live-config";

const TOKEN_LIFETIME_MS = 30 * 60_000;
const NEW_SESSION_WINDOW_MS = 60_000;

const globalForLimiter = globalThis as unknown as {
  __witnessVoiceTokenLimiter?: TokenBucketLimiter;
};

/** A few tokens per client, refilling one a minute: enough for reconnects, not for abuse. */
function tokenLimiter(): TokenBucketLimiter {
  globalForLimiter.__witnessVoiceTokenLimiter ??= new TokenBucketLimiter(4, 1 / 60);
  return globalForLimiter.__witnessVoiceTokenLimiter;
}

/**
 * Mints a single-use, short-lived Gemini Live token for the browser, locked to
 * GEMINI_LIVE_MODEL and the app's Live config (command functions only). The API key
 * never leaves the server.
 *
 * Only enabled when NEXT_PUBLIC_VOICE_PROVIDER=gemini-live. Requires a patient link
 * token or coordinator access; rate-limited by session/coordinator address.
 */
export async function POST(request: Request) {
  if (publicEnv.NEXT_PUBLIC_VOICE_PROVIDER !== "gemini-live") {
    return Response.json({ error: "not_enabled" }, { status: 404 });
  }
  const access = await providerAccess(request);
  if (!access.ok) return Response.json({ error: "unauthorized" }, { status: 401 });
  const client = getGeminiClient();
  if (!client) return Response.json({ error: "not_configured" }, { status: 503 });

  if (!tokenLimiter().take(access.limiterKey)) {
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  const model = geminiModels().live;
  const now = Date.now();
  try {
    const token = await client.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(now + TOKEN_LIFETIME_MS).toISOString(),
        newSessionExpireTime: new Date(now + NEW_SESSION_WINDOW_MS).toISOString(),
        liveConnectConstraints: { model, config: liveConnectConfig() },
        httpOptions: { apiVersion: LIVE_API_VERSION },
      },
    });
    if (!token.name) throw new Error("no token in response");
    return Response.json(
      { token: token.name, model, expiresAt: now + TOKEN_LIFETIME_MS },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[voice] token error", error);
    return Response.json({ error: "provider" }, { status: 502 });
  }
}
