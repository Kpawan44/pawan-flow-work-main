/**
 * Department Operations workbench filters.
 * Local, null-safe matching — no network or ledger side effects.
 */

export function normalizeFilterText(value: unknown): string {
  return (value ?? "").toString().trim().toLowerCase();
}

export function isAllFilterValue(value: unknown): boolean {
  const v = normalizeFilterText(value);
  return !v || v === "all";
}

export function uniqueTrimmedLabels(values: unknown[]): string[] {
  return Array.from(
    new Set(
      (values || [])
        .map((v) => (v ?? "").toString().trim())
        .filter(Boolean)
    )
  ).sort();
}

export function uniqueJobCardItemNames(jobCards: Array<{ itemName?: unknown }> = []): string[] {
  return uniqueTrimmedLabels(jobCards.map((j) => j?.itemName));
}

/** Existing Customer dropdown behavior: case-insensitive includes, All disables. */
export function jobCardMatchesSelectedCustomer(
  job: { partyName?: unknown } | null | undefined,
  selectedCustomer: unknown
): boolean {
  if (isAllFilterValue(selectedCustomer)) return true;
  return normalizeFilterText(job?.partyName).includes(normalizeFilterText(selectedCustomer));
}

/** Item Name dropdown: case-insensitive exact match on the selected label. */
export function jobCardMatchesSelectedItemName(
  job: { itemName?: unknown } | null | undefined,
  selectedItemName: unknown
): boolean {
  if (isAllFilterValue(selectedItemName)) return true;
  return normalizeFilterText(job?.itemName) === normalizeFilterText(selectedItemName);
}

export function jobCardMatchesCustomerAndItemName(
  job: { partyName?: unknown; itemName?: unknown } | null | undefined,
  selectedCustomer: unknown,
  selectedItemName: unknown
): boolean {
  return jobCardMatchesSelectedCustomer(job, selectedCustomer) && jobCardMatchesSelectedItemName(job, selectedItemName);
}
