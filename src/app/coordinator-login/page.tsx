import { Suspense } from "react";

export default function CoordinatorLoginPage({ searchParams }: PageProps<"/coordinator-login">) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-3xl font-bold">Study team sign-in</h1>
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
                  className="min-h-12 rounded-lg border-2 border-border bg-background px-3 text-lg font-normal"
                />
              </label>
              {failed && (
                <p role="alert" className="text-lg font-bold text-danger">
                  That passcode didn&apos;t match.
                </p>
              )}
              <button
                type="submit"
                className="min-h-12 rounded-lg bg-primary px-6 text-lg font-bold text-primary-foreground"
              >
                Sign in
              </button>
            </form>
          );
        })}
      </Suspense>
    </main>
  );
}
