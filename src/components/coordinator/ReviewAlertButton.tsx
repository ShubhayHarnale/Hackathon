"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ReviewAlertButton({ sessionId, alertId }: { sessionId: string; alertId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function review() {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch(`/api/coordinator/sessions/${sessionId}/alerts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alertId }),
      });
      if (!res.ok) throw new Error("Review failed");
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={() => void review()}
        className="min-h-11 rounded-xl border-2 border-border bg-surface px-4 font-bold shadow-soft hover:border-foreground disabled:opacity-60"
      >
        {busy ? "Saving…" : "Review alert"}
      </button>
      {error && (
        <p role="alert" className="text-danger">
          Could not save. Try again.
        </p>
      )}
    </div>
  );
}
