import { WitnessMark } from "@/components/brand";
import { publicEnv } from "@/lib/env";
import { LABELS, NOTES } from "@/patient/copy";
import { telHref } from "@/patient/screen";

/** Server-rendered dead end (bad link, finished session): one message and the nurse. */
export function SessionMessage({ heading, body }: { heading: string; body: string }) {
  const phone = publicEnv.NEXT_PUBLIC_TRIAL_NURSE_PHONE;
  return (
    <main className="stagger mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-8 px-5 py-10">
      <WitnessMark className="size-14" />
      <h1 className="font-display text-[2.5rem] font-semibold leading-[1.08] tracking-tight">
        {heading}
      </h1>
      <p className="text-2xl leading-relaxed">{body}</p>
      <a
        href={telHref(phone)}
        aria-label={`${LABELS.callNurse}, ${phone}`}
        className="flex min-h-16 items-center justify-center rounded-[1.25rem] bg-primary px-6 text-2xl font-bold text-primary-foreground shadow-lift hover:brightness-110"
      >
        {LABELS.callNurse}
      </a>
    </main>
  );
}

export function PatientLoading() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-5 px-4 py-10">
      <WitnessMark className="size-14 motion-safe:animate-breathe" />
      <p className="text-2xl" role="status">
        {NOTES.loading}
      </p>
    </main>
  );
}
