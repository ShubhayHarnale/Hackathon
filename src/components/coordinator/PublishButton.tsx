"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Publishing is always an explicit coordinator action; nothing auto-publishes. */
export function PublishButton({ id, version }: { id: string; version: number }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");

  async function publish() {
    if (
      !window.confirm(
        `Publish version ${version}? New sessions will use it, and it can't be edited.`,
      )
    )
      return;
    setState("busy");
    const res = await fetch(`/api/protocols/${encodeURIComponent(id)}/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version }),
    });
    setState(res.ok ? "idle" : "error");
    if (res.ok) router.refresh();
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={publish}
        disabled={state === "busy"}
        className="min-h-11 rounded-lg bg-success px-5 text-lg font-bold text-background disabled:opacity-60"
      >
        {state === "busy" ? "Publishing…" : "Publish"}
      </button>
      {state === "error" && (
        <span role="alert" className="font-bold text-danger">
          Publish failed.
        </span>
      )}
    </div>
  );
}
