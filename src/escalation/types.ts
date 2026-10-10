export type AlertKind = "critical_miss" | "needs_human" | "no_response" | "nurse_called";

export type AlertRecipient =
  | { readonly kind: "study_team" }
  | { readonly kind: "trusted_contact"; readonly name: string; readonly phone: string };

export interface AlertMessage {
  readonly sessionId: string;
  readonly participantId: string;
  readonly kind: AlertKind;
  readonly recipient: AlertRecipient;
  /** App-authored text. Flags and records only; never medical advice. */
  readonly message: string;
  readonly createdAt: number;
}

export type NotifyResult =
  | { readonly ok: true; readonly channel: "mock" | "sms" | "voice_call"; readonly ref?: string }
  | { readonly ok: false; readonly error: string };

/**
 * Delivers alerts. The hackathon build ships a mock that records the alert and shows it
 * on the dashboard; a real SMS/telephony provider plugs in behind this interface.
 */
export interface NotifierProvider {
  readonly name: string;
  notify(alert: AlertMessage): Promise<NotifyResult>;
}
