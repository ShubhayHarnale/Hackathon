import { publicEnv } from "@/lib/env";
import { LABELS, NOTES } from "@/patient/copy";
import { telHref } from "@/patient/screen";

/** Server-rendered dead end (bad link, finished session): one message and the nurse. */
export function SessionMessage({ heading, body }: { heading: string; body: string }) {
  const phone = publicEnv.NEXT_PUBLIC_TRIAL_NURSE_PHONE;
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-8 px-4 py-10">
      <h1 className="text-4xl font-bold">{heading}</h1>
      <p className="text-2xl">{body}</p>
      <a
        href={telHref(phone)}
        aria-label={`${LABELS.callNurse}, ${phone}`}
        className="flex min-h-16 items-center justify-center rounded-2xl bg-primary px-6 text-2xl font-bold text-primary-foreground"
      >
        {LABELS.callNurse}
      </a>
    </main>
  );
}

export function PatientLoading() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <p className="text-2xl" role="status">
        {NOTES.loading}
      </p>
    </main>
  );
}
