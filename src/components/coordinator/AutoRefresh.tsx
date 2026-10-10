"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-renders the server page every `ms` while the tab is visible (live session view). */
export function AutoRefresh({ ms = 3000, limit }: { ms?: number; limit?: number }) {
  const router = useRouter();
  useEffect(() => {
    let count = 0;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") {
        router.refresh();
        count += 1;
        if (limit !== undefined && count >= limit) clearInterval(id);
      }
    }, ms);
    return () => clearInterval(id);
  }, [router, ms, limit]);
  return null;
}
