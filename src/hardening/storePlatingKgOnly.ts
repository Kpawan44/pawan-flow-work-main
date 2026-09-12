/**
 * Process 210 — Store → Plating Unit material movements are KG-only.
 * No PCS, and no automatic PCS → KG conversion.
 */

import { normalizeDeptName } from "./process1Purchase";

export const STORE_PLATING_KG_ONLY_ERROR =
  "Store → Plating Unit movements must be entered in KG. PCS is not allowed for this route, and no PCS-to-KG conversion is performed.";

export const STORE_PLATING_KG_REQUIRED_ERROR =
  "Store → Plating Unit movements require an explicit KG unit. Missing or invalid units are rejected.";

function stripDeptAliases(value: string): string {
  return normalizeDeptName(value)
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Canonical Store (not Raw Material Store / Incoming Store). */
export function isCanonicalStoreDepartment(dept: string | undefined | null): boolean {
  const n = stripDeptAliases(String(dept || ""));
  if (!n) return false;
  if (n.includes("raw material")) return false;
  if (n.includes("incoming")) return false;
  return n === "store" || n === "storehouse" || n === "storehouse stock" || n === "finished goods store";
}

/** Canonical Plating Unit (Plating / Plating Unit / Surface Plating). */
export function isCanonicalPlatingUnitDepartment(dept: string | undefined | null): boolean {
  const n = stripDeptAliases(String(dept || ""));
  if (!n) return false;
  if (n === "packing" || n.includes("repack")) return false;
  return (
    n === "plating" ||
    n === "plating unit" ||
    n === "plating department" ||
    n === "surface plating" ||
    n === "replating"
  );
}

export function isStoreToPlatingUnitRoute(
  fromDepartment: string | undefined | null,
  toDepartment: string | undefined | null
): boolean {
  return isCanonicalStoreDepartment(fromDepartment) && isCanonicalPlatingUnitDepartment(toDepartment);
}

export function isStoreReplatingProcess(toProcess: string | undefined | null): boolean {
  return stripDeptAliases(String(toProcess || "")) === "replating";
}

/** KG / KGS → KG. PCS / pieces → PCS. Anything else null. */
export function classifyMovementUnit(raw: unknown): "KG" | "PCS" | null {
  const n = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  if (!n) return null;
  if (n === "KG" || n === "KGS" || n === "KILOGRAM" || n === "KILOGRAMS") return "KG";
  if (n === "PC" || n === "PCS" || n === "PIECE" || n === "PIECES") return "PCS";
  return null;
}

export function assertStoreToPlatingKgOnly(input: {
  fromDepartment?: string | null;
  toDepartment?: string | null;
  unit?: unknown;
  requestedUnit?: unknown;
  extraUnit?: unknown;
  processDetailsUnit?: unknown;
}): { ok: true; unit: "KGS" } | { ok: false; error: string } {
  if (!isStoreToPlatingUnitRoute(input.fromDepartment, input.toDepartment)) {
    return { ok: true, unit: "KGS" };
  }
  const classified = classifyMovementUnit(
    input.unit ?? input.requestedUnit ?? input.extraUnit ?? input.processDetailsUnit
  );
  if (classified == null) {
    return { ok: false, error: STORE_PLATING_KG_REQUIRED_ERROR };
  }
  if (classified === "PCS") {
    return { ok: false, error: STORE_PLATING_KG_ONLY_ERROR };
  }
  return { ok: true, unit: "KGS" };
}

export function assertStoreProcessTransferUnit(input: {
  toProcess?: string | null;
  unit?: unknown;
}): { ok: true; unit: string } | { ok: false; error: string } {
  if (!isStoreReplatingProcess(input.toProcess)) {
    const classified = classifyMovementUnit(input.unit);
    return { ok: true, unit: classified === "KG" ? "KGS" : classified === "PCS" ? "PCS" : String(input.unit || "PCS") };
  }
  return assertStoreToPlatingKgOnly({
    fromDepartment: "Store",
    toDepartment: "Plating",
    unit: input.unit
  });
}
