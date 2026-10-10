import "server-only";
import { DEMO_PARTICIPANTS, DEMO_PROTOCOLS } from "@/demo";
import { serverEnv } from "@/lib/env";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { MemoryRepository } from "./memory";
import { SupabaseRepository } from "./supabase";
import type { Repository } from "./types";

// Survives dev-server hot reloads, so data isn't wiped on every edit.
const globalForRepo = globalThis as unknown as {
  __witnessMemoryRepo?: MemoryRepository;
  __witnessSupabaseRepo?: SupabaseRepository;
};

function memoryRepository(): MemoryRepository {
  globalForRepo.__witnessMemoryRepo ??= new MemoryRepository({
    participants: DEMO_PARTICIPANTS,
    protocols: DEMO_PROTOCOLS,
  });
  return globalForRepo.__witnessMemoryRepo;
}

/** The repository selected by PERSISTENCE. Server-only. */
export function getRepository(): Repository {
  if (serverEnv().PERSISTENCE === "supabase") {
    const client = getSupabaseServerClient();
    if (!client)
      throw new Error("PERSISTENCE=supabase needs SUPABASE_URL and SUPABASE_SECRET_KEY.");
    globalForRepo.__witnessSupabaseRepo ??= new SupabaseRepository(client);
    return globalForRepo.__witnessSupabaseRepo;
  }
  return memoryRepository();
}

/** The memory repository, when selected (used by the evidence route). */
export function getMemoryRepository(): MemoryRepository | null {
  return serverEnv().PERSISTENCE === "memory" ? memoryRepository() : null;
}
