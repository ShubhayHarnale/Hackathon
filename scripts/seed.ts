/**
 * Seeds a Supabase project with the synthetic demo data (participants and the demo
 * protocols, published as v1). Idempotent: safe to run again.
 *
 *   1. Apply supabase/migrations/*.sql (Supabase SQL editor, or `npx supabase db push`).
 *   2. Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local.
 *   3. npm run seed
 */
import { existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { DEMO_PARTICIPANTS, DEMO_PROTOCOLS } from "@/demo";
import { participantRow } from "@/persistence/supabase";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local.");
  const db = createClient(url, key, { auth: { persistSession: false } });

  const participants = await db
    .from("participants")
    .upsert(DEMO_PARTICIPANTS.map(participantRow), { onConflict: "id" });
  if (participants.error) throw new Error(`participants: ${participants.error.message}`);
  console.log(`participants: ${DEMO_PARTICIPANTS.length} upserted`);

  for (const protocol of DEMO_PROTOCOLS) {
    const existing = await db.from("protocols").select("version").eq("id", protocol.id).limit(1);
    if (existing.error) throw new Error(`protocols: ${existing.error.message}`);
    if (existing.data.length > 0) {
      console.log(`protocol ${protocol.id}: already present, left unchanged`);
      continue;
    }
    const now = new Date().toISOString();
    const inserted = await db.from("protocols").insert({
      id: protocol.id,
      version: 1,
      status: "published",
      protocol,
      source_text: null,
      published_at: now,
    });
    if (inserted.error) throw new Error(`protocol ${protocol.id}: ${inserted.error.message}`);
    console.log(`protocol ${protocol.id}: published v1`);
  }

  const bucket = await db.storage.getBucket("evidence");
  if (bucket.error) {
    const created = await db.storage.createBucket("evidence", {
      public: false,
      fileSizeLimit: 2 * 1024 * 1024,
      allowedMimeTypes: ["image/jpeg"],
    });
    if (created.error) throw new Error(`evidence bucket: ${created.error.message}`);
    console.log("storage: created private 'evidence' bucket");
  } else {
    console.log(`storage: 'evidence' bucket present (public: ${bucket.data.public})`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
