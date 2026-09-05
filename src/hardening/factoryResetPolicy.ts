import { OPERATIONAL_RESET_COLLECTIONS } from "./constants";

export function operationalCollectionsForFactoryReset(): string[] {
  return [...OPERATIONAL_RESET_COLLECTIONS];
}

export function isProtectedSuperAdmin(user: { role?: string; active?: boolean } | null | undefined): boolean {
  return String(user?.role || "").toLowerCase() === "super_admin";
}

export function shouldDeleteUserOnFactoryReset(user: { role?: string } | null | undefined): boolean {
  return !isProtectedSuperAdmin(user);
}

export function shouldTombstoneUserOnFactoryReset(user: { role?: string } | null | undefined): boolean {
  return shouldDeleteUserOnFactoryReset(user);
}
