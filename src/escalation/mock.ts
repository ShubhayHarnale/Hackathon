import type { NotifierProvider } from "./types";

/** No external side effects. Repeated delivery has the same synthetic receipt. */
export const mockNotifier: NotifierProvider = {
  name: "mock",
  async notify(alert) {
    return {
      ok: true,
      channel: "mock",
      ref: `mock:${alert.sessionId}:${alert.kind}:${alert.recipient.kind}:${alert.createdAt}`,
    };
  },
};
