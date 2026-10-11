import Link from "next/link";
import { Suspense } from "react";
import { Wordmark } from "@/components/brand";

export default function CoordinatorLoginPage({ searchParams }: PageProps<"/coordinator-login">) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-8 px-6 py-16">
      <Link href="/" aria-label="Witness home" className="w-fit">
        <Wordmark />
      </Link>
      <div className="flex flex-col gap-6 rounded-[2rem] border-2 border-hairline bg-surface p-8 shadow-lift">
        <div className="flex flex-col gap-2">
          <h1 className="text-4xl font-semibold tracking-tight">Study team sign-in</h1>
          <p className="text-base text-muted">
            Session records and evidence are only shown to the study team.
          </p>
        </div>
        <Suspense fallback={null}>
          {searchParams.then((params) => {
            const next = typeof params.next === "string" ? params.next : "/coordinator";
            const failed = params.error === "1";
            return (
              <form method="post" action="/api/session-login" className="flex flex-col gap-4">
                <input type="hidden" name="next" value={next} />
                <label className="flex flex-col gap-2 text-lg font-bold">
                  Passcode
                  <input
                    type="password"
                    name="passcode"
                    required
                    autoComplete="current-password"
                    className="min-h-14 rounded-2xl border-2 border-border bg-background px-4 text-lg font-normal focus:border-primary"
                  />
                </label>
                {failed && (
                  <p
                    role="alert"
                    className="rounded-xl bg-danger-soft px-4 py-2 text-lg font-bold text-danger"
                  >
                    That passcode didn&apos;t match.
                  </p>
                )}
                <button
                  type="submit"
                  className="min-h-14 rounded-2xl bg-primary px-6 text-lg font-bold text-primary-foreground shadow-lift hover:brightness-110"
                >
                  Sign in
                </button>
              </form>
            );
          })}
        </Suspense>
      </div>
      <p className="text-center text-sm text-muted">Synthetic data only · hackathon prototype</p>
    </main>
  );
}
