/**
 * Process 205 — merge one authoritative movement + job into local lists.
 * Does not replace full refresh for login / ALL_UPDATED / generation mismatch.
 */

export function upsertByKey<T>(list: T[], item: T, keyOf: (row: T) => string): T[] {
  const key = keyOf(item);
  if (!key) return list;
  const i = list.findIndex((x) => keyOf(x) === key);
  if (i < 0) return [item, ...list];
  const next = list.slice();
  next[i] = item;
  return next;
}

export function movementKey(m: { movementId?: string }): string {
  return String(m.movementId || "").trim();
}

export function jobCardKey(j: { jobCardNo?: string }): string {
  return String(j.jobCardNo || "").trim().toLowerCase();
}

export function applyTargetedLedgerPatch(
  state: { movements: any[]; jobCards: any[] },
  patch: { movement?: any; jobCard?: any; extraMovements?: any[] | null },
): {
  movements: any[];
  jobCards: any[];
  applied: boolean;
} {
  let movements = state.movements;
  let jobCards = state.jobCards;
  let applied = false;
  const extras = patch.extraMovements || [];
  const allMovements = [...extras, ...(patch.movement ? [patch.movement] : [])];
  for (const mov of allMovements) {
    if (mov && movementKey(mov)) {
      movements = upsertByKey(movements, mov, movementKey);
      applied = true;
    }
  }
  if (patch.jobCard && jobCardKey(patch.jobCard)) {
    jobCards = upsertByKey(jobCards, patch.jobCard, jobCardKey);
    applied = true;
  }
  return { movements, jobCards, applied };
}

/** Baseline vs optimized GETs after a floor mutation (code-path count, not live profiler). */
export function ledgerGetRequestCount(kind: "full-refresh" | "ledger-only" | "targeted"): number {
  if (kind === "full-refresh") return 7;
  if (kind === "ledger-only") return 2;
  return 0;
}
