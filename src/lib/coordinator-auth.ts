import { hashToken } from "@/persistence/tokens";

/**
 * Hackathon gate for the coordinator dashboard: a shared passcode from
 * COORDINATOR_PASSCODE, stored in an httpOnly cookie as a hash. When the env var is
 * unset the dashboard is open (local demo). Real auth (SSO, per-user roles, audit) is
 * on the production roadmap.
 */

export const COORDINATOR_COOKIE = "witness_coordinator";

export async function coordinatorCookieValue(passcode: string): Promise<string> {
  return hashToken(`witness-coordinator:${passcode}`);
}

export async function isCoordinatorAuthorized(
  passcode: string | undefined,
  cookieValue: string | undefined,
): Promise<boolean> {
  if (!passcode) return true;
  if (!cookieValue) return false;
  return cookieValue === (await coordinatorCookieValue(passcode));
}
