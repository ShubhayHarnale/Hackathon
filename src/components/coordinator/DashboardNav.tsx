"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

const NAV = [
  {
    href: "/coordinator",
    label: "Sessions",
    match: (p: string) => p === "/coordinator" || p.startsWith("/coordinator/sessions"),
  },
  {
    href: "/coordinator/protocols",
    label: "Protocols",
    match: (p: string) => p.startsWith("/coordinator/protocols"),
  },
  {
    href: "/coordinator/vision-lab",
    label: "Vision lab",
    match: (p: string) => p.startsWith("/coordinator/vision-lab"),
  },
] as const;

/**
 * The pathname is request data under Cache Components, so the active state streams in
 * inside Suspense; the fallback is the same nav without a highlighted item.
 */
export function DashboardNav() {
  return (
    <Suspense fallback={<NavLinks pathname={null} />}>
      <ActiveNav />
    </Suspense>
  );
}

function ActiveNav() {
  return <NavLinks pathname={usePathname()} />;
}

function NavLinks({ pathname }: { pathname: string | null }) {
  return (
    <nav
      aria-label="Dashboard"
      className="flex gap-1 rounded-full border-2 border-hairline bg-surface p-1 shadow-soft"
    >
      {NAV.map((item) => {
        const active = pathname !== null && item.match(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-full px-4 py-1.5 text-base font-bold transition-colors ${
              active
                ? "bg-foreground text-background"
                : "text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
