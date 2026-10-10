import Link from "next/link";

const NAV = [
  { href: "/coordinator", label: "Sessions" },
  { href: "/coordinator/protocols", label: "Protocols" },
  { href: "/coordinator/vision-lab", label: "Vision lab" },
] as const;

export default function CoordinatorLayout({ children }: LayoutProps<"/coordinator">) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b-2 border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-6 px-8 py-4">
          <Link href="/coordinator" className="text-xl font-bold">
            Witness <span className="font-normal text-muted">· study team</span>
          </Link>
          <nav aria-label="Dashboard" className="flex gap-4 text-lg">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="underline-offset-4 hover:underline">
                {item.label}
              </Link>
            ))}
          </nav>
          <p className="ml-auto text-sm text-muted">Synthetic data only</p>
        </div>
      </header>
      {children}
    </div>
  );
}
