import type { EngineEvent } from "@/engine";
import type { ParticipantRecord, Repository, SessionRecord } from "@/persistence/types";
import type { AlertKind, AlertMessage, NotifierProvider } from "./types";

const MESSAGES: Record<AlertKind, string> = {
  critical_miss:
    "An important procedure step could not be verified. The procedure stopped. Please review the session and contact the participant.",
  needs_human:
    "The procedure stopped because the app could not verify progress. Please review the session and contact the participant.",
  no_response:
    "A procedure step reached its time limit without confirmation. The procedure stopped. Please contact the participant; this does not establish a medical emergency.",
  nurse_called:
    "The participant requested their study nurse. This record does not confirm that a phone call connected.",
};

/** Practice never alerts. No-response means an engine step timeout, not a background monitor. */
export function alertsForEvent(
  session: SessionRecord,
  participant: ParticipantRecord,
  event: EngineEvent,
): AlertMessage[] {
  if (event.run === "practice") return [];
  let kind: AlertKind;
  if (event.type === "nurse_called") kind = "nurse_called";
  else if (event.run !== "real") return [];
  else if (event.type === "critical_miss") kind = "critical_miss";
  else if (event.type === "needs_human")
    kind = event.cause === "step_timeout" ? "no_response" : "needs_human";
  else return [];

  const base = {
    sessionId: session.id,
    participantId: participant.id,
    kind,
    message: MESSAGES[kind],
    createdAt: event.at,
  };
  const alerts: AlertMessage[] = [{ ...base, recipient: { kind: "study_team" } }];
  const contact = participant.trustedContact;
  if (kind !== "nurse_called" && contact?.consented) {
    alerts.push({
      ...base,
      recipient: { kind: "trusted_contact", name: contact.name, phone: contact.phone },
      message:
        "The participant's procedure stopped and their study team needs to help. Please ask them to contact their study nurse. This is a simulated demo notification.",
    });
  }
  return alerts;
}

/** Unique event/recipient keys survive retries and multiple server instances. */
export async function processEscalations(
  repo: Repository,
  notifier: NotifierProvider,
  session: SessionRecord,
  events: readonly EngineEvent[],
): Promise<void> {
  const participant = await repo.getParticipant(session.participantId);
  if (!participant) return;
  for (const event of events) {
    for (const message of alertsForEvent(session, participant, event)) {
      const alert = await repo.createAlert({
        ...message,
        dedupeKey: `${session.id}:${event.eventSeq}:${message.recipient.kind}`,
      });
      if (alert.delivery?.ok) continue;
      const result = await notifier
        .notify(message)
        .catch(() => ({ ok: false as const, error: "Notifier unavailable" }));
      await repo.recordAlertDelivery(alert.id, result);
      // A retryable response keeps the patient's outbox alive without blocking the UI.
      if (!result.ok) throw new Error("Alert delivery failed; retry the event batch");
    }
  }
}
