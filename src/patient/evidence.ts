import type { FrameResult } from "@/engine";
import { outcomeForStatus, retryDelay, type SendOutcome } from "./outbox";
import type { EvidenceBody } from "./schema";

export type SendEvidence = (body: EvidenceBody) => Promise<SendOutcome>;

export interface EvidenceUploaderOptions {
  readonly send: SendEvidence;
  readonly maxAttempts?: number;
  readonly retryBaseMs?: number;
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
}

/**
 * Uploads evidence frames in the background: a few retries, then gives up quietly.
 * The event log is the record; a missing frame must never hold up the patient.
 */
export class EvidenceUploader {
  private readonly uploaded = new Set<string>();
  private readonly opts: Required<EvidenceUploaderOptions>;

  constructor(options: EvidenceUploaderOptions) {
    this.opts = {
      maxAttempts: 3,
      retryBaseMs: 2_000,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      ...options,
    };
  }

  /** Queues one frame. Repeat calls for the same step and frame are ignored. */
  upload(frame: {
    stepId: string;
    seq: number;
    capturedAt: number;
    base64: string;
    visionResult: FrameResult | null;
  }): void {
    if (!frame.base64) return; // nothing captured (no camera and no placeholder)
    const key = `${frame.stepId}:${frame.seq}`;
    if (this.uploaded.has(key)) return;
    this.uploaded.add(key);
    const body: EvidenceBody = {
      stepId: frame.stepId,
      evidenceSeq: frame.seq,
      capturedAt: frame.capturedAt,
      jpegBase64: frame.base64,
      visionResult: frame.visionResult,
    };
    void this.attempt(body, 1);
  }

  private async attempt(body: EvidenceBody, n: number): Promise<void> {
    let outcome: SendOutcome;
    try {
      outcome = await this.opts.send(body);
    } catch {
      outcome = "retry";
    }
    if (outcome === "retry" && n < this.opts.maxAttempts) {
      this.opts.setTimer(
        () => void this.attempt(body, n + 1),
        retryDelay(n, this.opts.retryBaseMs, 30_000),
      );
    }
  }
}

export function httpSendEvidence(token: string, fetchImpl: typeof fetch = fetch): SendEvidence {
  return async (body) => {
    try {
      const res = await fetchImpl(`/api/patient/${encodeURIComponent(token)}/evidence`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return outcomeForStatus(res.status);
    } catch {
      return "retry";
    }
  };
}
