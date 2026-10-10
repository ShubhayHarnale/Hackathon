import { z } from "zod";
import type { ParticipantRecord } from "@/persistence/types";
import { ProtocolSchema, type Protocol, type Step } from "@/protocol/schema";
import mockAutoinjector from "./protocols/mock-autoinjector.json";
import mockInhaler from "./protocols/mock-inhaler.json";
import mockNasalSpray from "./protocols/mock-nasal-spray.json";
import participantsJson from "./participants.json";

/**
 * Synthetic demo data, shared by the in-memory repository and the Supabase seed script.
 * Validated at load time so a bad edit fails loudly.
 */

export const DEMO_PROTOCOLS: readonly Protocol[] = [
  mockAutoinjector,
  mockNasalSpray,
  mockInhaler,
].map((p) => ProtocolSchema.parse(p));

const ParticipantSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  trialNumber: z.string(),
  trustedContact: z
    .object({ name: z.string(), phone: z.string(), consented: z.boolean() })
    .nullable(),
});

export const DEMO_PARTICIPANTS: readonly ParticipantRecord[] = z
  .array(ParticipantSchema)
  .parse(participantsJson);

/** Practice run before the real procedure: confirms the camera can see hands and the pen. */
export const PRACTICE_STEPS: readonly Step[] = [
  {
    id: "practice-show-hands",
    order: 1,
    instruction: "Show both hands to the camera",
    spokenPrompt: "Let's practice. Hold up both hands so the camera can see them.",
    successCriteria: "Two open hands are clearly visible in the frame.",
    critical: false,
    verification: "visual",
  },
  {
    id: "practice-show-pen",
    order: 2,
    instruction: "Hold the pen up to the camera",
    spokenPrompt: "Now hold the pen up so the camera can see it.",
    successCriteria: "A pen-shaped object is held up in one hand and clearly visible.",
    critical: false,
    verification: "visual",
  },
];
