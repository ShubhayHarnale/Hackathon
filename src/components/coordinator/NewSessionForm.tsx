"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Option {
  readonly id: string;
  readonly label: string;
}

/** Creates a patient session and shows its link (the raw token is only shown here, once). */
export function NewSessionForm({
  participants,
  protocols,
}: {
  participants: readonly Option[];
  protocols: readonly Option[];
}) {
  const router = useRouter();
  const [participantId, setParticipantId] = useState(participants[0]?.id ?? "");
  const [protocolId, setProtocolId] = useState(protocols[0]?.id ?? "");
  const [mode, setMode] = useState<"live" | "mock">("mock");
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    setCopied(false);
    const res = await fetch("/api/coordinator/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ participantId, protocolId, mode }),
    });
    const data = (await res.json().catch(() => ({}))) as { link?: string; error?: string };
    setBusy(false);
    if (!res.ok || !data.link) {
      setError(data.error ?? "Couldn't create the session.");
      return;
    }
    setLink(data.link);
    router.refresh();
  }

  const select = "rounded-lg border-2 border-border bg-background px-2 py-2";
  return (
    <section
      aria-labelledby="new-session"
      className="flex flex-col gap-3 rounded-xl border-2 border-border p-4"
    >
      <h2 id="new-session" className="text-xl font-bold">
        New session link
      </h2>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 font-bold">
          Participant
          <select
            value={participantId}
            onChange={(e) => setParticipantId(e.target.value)}
            className={select}
          >
            {participants.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 font-bold">
          Protocol
          <select
            value={protocolId}
            onChange={(e) => setProtocolId(e.target.value)}
            className={select}
          >
            {protocols.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 font-bold">
          Vision
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value === "live" ? "live" : "mock")}
            className={select}
          >
            <option value="mock">Demo (scripted, no camera)</option>
            <option value="live">Live camera</option>
          </select>
        </label>
        <button
          type="button"
          onClick={create}
          disabled={busy || !participantId || !protocolId}
          className="min-h-11 rounded-lg bg-primary px-5 text-lg font-bold text-primary-foreground disabled:opacity-50"
        >
          {busy ? "Creating…" : "Create link"}
        </button>
      </div>
      {error && (
        <p role="alert" className="font-bold text-danger">
          {error}
        </p>
      )}
      {link && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-surface p-3">
          <code className="break-all text-sm">{link}</code>
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(link).then(() => setCopied(true))}
            className="min-h-10 rounded-lg border-2 border-border px-3 font-bold"
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="font-bold text-primary underline"
          >
            Open patient view
          </a>
          <p className="w-full text-sm text-muted">
            The link is shown only once; it&apos;s stored as a hash.
          </p>
        </div>
      )}
    </section>
  );
}
