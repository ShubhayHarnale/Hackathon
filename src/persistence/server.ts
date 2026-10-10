import "server-only";
import { DEMO_PARTICIPANTS, DEMO_PROTOCOLS } from "@/demo";
import { serverEnv } from "@/lib/env";
import { MemoryRepository } from "./memory";
import type { Repository } from "./types";

// Survives dev-server hot reloads, so data isn't wiped on every edit.
const globalForRepo = globalThis as unknown as { __witnessMemoryRepo?: MemoryRepository };

function memoryRepository(): MemoryRepository {
  globalForRepo.__witnessMemoryRepo ??= new MemoryRepository({
    participants: DEMO_PARTICIPANTS,
    protocols: DEMO_PROTOCOLS,
  });
  return globalForRepo.__witnessMemoryRepo;
}

/** The repository selected by PERSISTENCE. Server-only. */
export function getRepository(): Repository {
  const env = serverEnv();
  if (env.PERSISTENCE === "supabase") {
    // TODO(phase 6): SupabaseRepository.
    throw new Error("PERSISTENCE=supabase is not implemented yet; use PERSISTENCE=memory.");
  }
  return memoryRepository();
}

/** The memory repository, when selected (used by the evidence route). */
export function getMemoryRepository(): MemoryRepository | null {
  return serverEnv().PERSISTENCE === "memory" ? memoryRepository() : null;
}
