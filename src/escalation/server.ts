import "server-only";
import { serverEnv } from "@/lib/env";
import { mockNotifier } from "./mock";
import type { NotifierProvider } from "./types";

export function getNotifier(): NotifierProvider {
  switch (serverEnv().NOTIFIER) {
    case "mock":
      return mockNotifier;
  }
}
