import Link from "next/link";
import { Wordmark } from "@/components/brand";
import { DashboardNav } from "@/components/coordinator/DashboardNav";

export default function CoordinatorLayout({ children }: LayoutProps<"/coordinator">) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="sticky top-0 z-20 border-b border-hairline bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-3">
          <Link href="/" aria-label="Witness home">
            <Wordmark suffix="Study team" />
          </Link>
          <DashboardNav />
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden items-center gap-2 rounded-full bg-warning-bg px-3 py-1 text-sm font-bold text-warning-fg md:inline-flex">
              <span aria-hidden="true" className="size-2 rounded-full bg-warning-fg" />
              Synthetic data only
            </span>
            <Link
              href="/demo"
              className="rounded-full border-2 border-border bg-surface px-4 py-1.5 text-sm font-bold hover:border-foreground"
            >
              Patient demo ↗
            </Link>
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
