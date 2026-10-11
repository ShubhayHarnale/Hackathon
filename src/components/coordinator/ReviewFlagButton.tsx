"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ReviewFlagButton({ sessionId, eventSeq }: { sessionId: string; eventSeq: number }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");

  async function review() {
    setState("busy");
    const res = await fetch(`/api/coordinator/sessions/${sessionId}/flags`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventSeq }),
    });
    setState(res.ok ? "idle" : "error");
    if (res.ok) router.refresh();
  }

  return (
    <button
      type="button"
      onClick={review}
      disabled={state === "busy"}
      className="min-h-11 whitespace-nowrap rounded-xl border-2 border-border bg-surface px-4 font-bold shadow-soft hover:border-foreground disabled:opacity-50"
    >
      {state === "busy" ? "Saving…" : state === "error" ? "Retry" : "Mark reviewed"}
    </button>
  );
}
