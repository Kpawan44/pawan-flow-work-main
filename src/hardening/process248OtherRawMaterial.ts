/**
 * Process 248 — optional Other Raw Material add-on for production Job Cards.
 * Wire issue remains the compulsory RM path. Other RM is never required.
 * Does not convert PCS to KG.
 */

import { displayUnitLabel, isWireRawMaterial, normalizeDeptName, normalizeItemCode } from "./process1Purchase";

export { displayUnitLabel };

export type OtherRawMaterialRow = {
  id: string;
  materialCode: string;
  materialName?: string;
  quantity: number;
  unit: string;
};

export function isOtherRawMaterialIssueMovement(mov: {
  isIssueRequest?: unknown;
  fromDepartment?: string;
  toDepartment?: string;
  processDetails?: any;
} | null | undefined): boolean {
  if (!mov?.isIssueRequest) return false;
  if (!mov.processDetails?.isOtherRawMaterialIssue) return false;
  return (
    normalizeDeptName(mov.fromDepartment) === "incoming store" &&
    normalizeDeptName(mov.toDepartment) === "production"
  );
}

export function assertOtherRawMaterialIssueInput(input: {
  fromDepartment?: string;
  toDepartment?: string;
  isIssueRequest?: unknown;
  quantity?: number;
  unit?: string;
  requestedUnit?: string;
  processDetails?: any;
}): { ok: true } | { ok: false; error: string } {
  if (!input.isIssueRequest || !input.processDetails?.isOtherRawMaterialIssue) {
    return { ok: true };
  }
  if (normalizeDeptName(input.fromDepartment) !== "incoming store") {
    return { ok: false, error: "Other Raw Material must be issued from Incoming Store. Wire issue is unchanged at Raw Material Store." };
  }
  if (normalizeDeptName(input.toDepartment) !== "production") {
    return { ok: false, error: "Other Raw Material must be issued to a Production Job Card." };
  }
  if (
    isWireRawMaterial({
      isWire: input.processDetails?.isWire,
      rawMaterialKind: input.processDetails?.rawMaterialKind,
      processDetails: input.processDetails
    })
  ) {
    return { ok: false, error: "Wire must be issued through the existing Raw Material Store Wire issue process." };
  }
  const code = normalizeItemCode(input.processDetails?.rawMaterialCode);
  if (!code || code === "-") {
    return { ok: false, error: "Other Raw Material issue requires a material code." };
  }
  const qty = Number(input.quantity || 0);
  if (!(qty > 0) || !Number.isFinite(qty)) {
    return { ok: false, error: "Quantity must be a positive number." };
  }
  return { ok: true };
}

export function canIssueOtherRawMaterialQty(
  availableStock: number,
  requestedQty: number,
  unit?: string | null
): { ok: boolean; error?: string } {
  const avail = Number(availableStock);
  const req = Number(requestedQty);
  const unitLabel = displayUnitLabel(unit);
  if (!(req > 0) || !Number.isFinite(req)) {
    return { ok: false, error: "Quantity must be a positive number." };
  }
  if (!Number.isFinite(avail) || req > avail) {
    return {
      ok: false,
      error: `Cannot issue ${req} ${unitLabel}; available Other RM stock is ${avail} ${unitLabel}.`
    };
  }
  return { ok: true };
}

function matchesOtherRmCode(
  m: { jobCardNo?: string; processDetails?: any; itemCode?: string },
  code: string
): boolean {
  const target = normalizeItemCode(code);
  if (!target || target === "-") return false;
  const raw = normalizeItemCode(m.processDetails?.rawMaterialCode);
  const item = normalizeItemCode(m.itemCode);
  const jc = String(m.jobCardNo || "").trim().toUpperCase();
  return raw === target || item === target || jc === "STOCK-IN-" + target || jc === target;
}

/** Incoming Store SKU stock for Other RM. Does not use Raw Material Store Wire stock. */
export function computeIncomingStoreOtherRmStock(
  openingQty: number,
  movements: Array<{
    fromDepartment?: string;
    toDepartment?: string;
    isIssueRequest?: boolean;
    issueStatus?: string;
    accepted?: boolean;
    quantity?: number;
    requestedQty?: number;
    jobCardNo?: string;
    itemCode?: string;
    processDetails?: any;
  }> = [],
  code: string
): number {
  const totalPurchased = (movements || [])
    .filter(
      (m) =>
        normalizeDeptName(m.toDepartment) === "incoming store" &&
        normalizeDeptName(m.fromDepartment) === "purchase" &&
        m.accepted &&
        matchesOtherRmCode(m, code)
    )
    .reduce((sum, m) => sum + Number(m.quantity || 0), 0);

  const totalIssued = (movements || [])
    .filter((m) => {
      if (!isOtherRawMaterialIssueMovement(m)) return false;
      const status = String(m.issueStatus || "").toLowerCase();
      if (status === "rejected" || status === "cancelled") return false;
      return matchesOtherRmCode(m, code);
    })
    .reduce((sum, m) => sum + Number(m.quantity || 0), 0);

  return Math.max(0, Number(openingQty || 0) + totalPurchased - totalIssued);
}

export function getAcceptedOtherRawMaterialIssuedQty(
  job: { jobCardNo?: string; processType?: string },
  movements: Array<{
    jobCardNo?: string;
    fromDepartment?: string;
    toDepartment?: string;
    isIssueRequest?: unknown;
    accepted?: boolean;
    quantity?: number;
    processDetails?: any;
  }> = []
): number {
  if (!job || job.processType === "Purchase") return 0;
  const target = String(job.jobCardNo || "").toLowerCase();
  return (movements || [])
    .filter(
      (m) =>
        m &&
        String(m.jobCardNo || "").toLowerCase() === target &&
        isOtherRawMaterialIssueMovement(m) &&
        m.accepted === true
    )
    .reduce((sum, m) => sum + Number(m.quantity || 0), 0);
}

export function totalRawMaterialWeight(quantities: number[]): number {
  return (quantities || []).reduce((sum, q) => {
    const n = Number(q);
    return Number.isFinite(n) && n > 0 ? sum + n : sum;
  }, 0);
}

export function netProductionQty(totalRawMaterial: number, scrapQuantity: number): number {
  const total = Number(totalRawMaterial);
  const scrap = Number(scrapQuantity);
  if (!Number.isFinite(total) || total < 0) return 0;
  if (!Number.isFinite(scrap) || scrap < 0) return total;
  return Math.max(0, total - scrap);
}

export function otherRawMaterialRowsOptionalValid(rows: OtherRawMaterialRow[] | null | undefined): {
  ok: true;
} {
  void rows;
  return { ok: true };
}

export function addOtherRawMaterialRow(
  rows: OtherRawMaterialRow[] = [],
  row?: Partial<OtherRawMaterialRow>
): OtherRawMaterialRow[] {
  const id = row?.id || `orm-row-${rows.length + 1}-${Math.random().toString(36).slice(2, 6)}`;
  return [
    ...rows,
    {
      id,
      materialCode: String(row?.materialCode || ""),
      materialName: row?.materialName,
      quantity: Number(row?.quantity || 0),
      unit: row?.unit || "KG"
    }
  ];
}

export function removeOtherRawMaterialRow(rows: OtherRawMaterialRow[] = [], id: string): OtherRawMaterialRow[] {
  return (rows || []).filter((r) => r.id !== id);
}

export function otherRawMaterialSerializeKey(rawMaterialCode?: string): string | null {
  const code = normalizeItemCode(rawMaterialCode);
  if (!code || code === "-") return null;
  return `orm:${code}`;
}

export function listIncomingStoreOtherRmCatalog(
  movements: Array<{
    fromDepartment?: string;
    toDepartment?: string;
    accepted?: boolean;
    quantity?: number;
    jobCardNo?: string;
    itemCode?: string;
    itemName?: string;
    unit?: string;
    processDetails?: any;
    isIssueRequest?: boolean;
    issueStatus?: string;
  }> = []
): Array<{ code: string; name: string; availableStock: number; unit: string }> {
  const map = new Map<string, { code: string; name: string; unit: string }>();
  (movements || []).forEach((m) => {
    if (normalizeDeptName(m.toDepartment) !== "incoming store") return;
    if (normalizeDeptName(m.fromDepartment) !== "purchase") return;
    if (!m.accepted) return;
    if (
      isWireRawMaterial({
        isWire: m.processDetails?.isWire,
        rawMaterialKind: m.processDetails?.rawMaterialKind,
        processDetails: m.processDetails
      })
    ) {
      return;
    }
    const code = normalizeItemCode(m.processDetails?.rawMaterialCode || m.itemCode);
    if (!code || code === "-") return;
    if (!map.has(code)) {
      map.set(code, {
        code,
        name: String(m.processDetails?.rawMaterialName || m.itemName || code),
        unit: displayUnitLabel(m.unit || m.processDetails?.unit)
      });
    }
  });
  return Array.from(map.values()).map((item) => ({
    ...item,
    availableStock: computeIncomingStoreOtherRmStock(0, movements, item.code)
  }));
}
