/**
 * Process 328 — Item ↔ Other Raw Material Linkage
 * Item Master controlled linkage between finished items and Other Raw Materials.
 * Deterministic document key: {NORMALIZED_ITEM_CODE}__{NORMALIZED_OTHER_RM_CODE}
 * Wire is strictly excluded.
 */

import { SimpleStore } from "./commitMaterialMovement";
import { isWireRawMaterial, normalizeItemCode } from "./process1Purchase";

export interface ItemOtherRawMaterialLink {
  id?: string;
  itemCode: string;
  itemName?: string;
  otherRawMaterialCode: string;
  otherRawMaterialName?: string;
  active: boolean;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export function buildItemOtherRmLinkDocId(
  itemCode: string | undefined | null,
  otherRmCode: string | undefined | null
): string {
  const normItem = normalizeItemCode(itemCode);
  const normRm = normalizeItemCode(otherRmCode);
  return `${normItem}__${normRm}`;
}

export function validateItemOtherRmLinkInput(input: {
  itemCode?: string | null;
  otherRawMaterialCode?: string | null;
  itemName?: string | null;
  otherRawMaterialName?: string | null;
  active?: boolean;
}):
  | {
      ok: true;
      data: {
        itemCode: string;
        otherRawMaterialCode: string;
        itemName: string;
        otherRawMaterialName: string;
        active: boolean;
      };
    }
  | { ok: false; error: string } {
  const normItem = normalizeItemCode(input.itemCode);
  if (!normItem || normItem === "-") {
    return { ok: false, error: "Finished item code is required and must not be empty or '-'." };
  }
  const normRm = normalizeItemCode(input.otherRawMaterialCode);
  if (!normRm || normRm === "-") {
    return { ok: false, error: "Other Raw Material code is required and must not be empty or '-'." };
  }
  if (
    isWireRawMaterial({
      isWire: false,
      rawMaterialKind: "Wire",
      processDetails: { rawMaterialCode: normRm, isWire: true }
    }) ||
    normRm === "WIRE" ||
    normRm.startsWith("RM-WIRE") ||
    normRm.includes("WIRE")
  ) {
    return {
      ok: false,
      error: "Wire cannot be linked as an Other Raw Material. Wire is managed through Raw Material Store."
    };
  }

  return {
    ok: true,
    data: {
      itemCode: normItem,
      otherRawMaterialCode: normRm,
      itemName: String(input.itemName || normItem).trim(),
      otherRawMaterialName: String(input.otherRawMaterialName || normRm).trim(),
      active: input.active !== false
    }
  };
}

export function canManageItemOtherRmLinks(
  actor: { role?: string; department?: string } | null | undefined
): boolean {
  if (!actor) return false;
  const role = String(actor.role || "").toLowerCase();
  const dept = String(actor.department || "").toLowerCase();
  if (
    role === "super_admin" ||
    role === "admin" ||
    role === "manager" ||
    role === "purchase" ||
    dept === "admin" ||
    dept === "management" ||
    dept === "purchase"
  ) {
    return true;
  }
  return false;
}

export async function assertItemOtherRmLinkActive(
  store: SimpleStore,
  itemCode: string | undefined | null,
  rawMaterialCode: string | undefined | null
): Promise<{ ok: true; link: ItemOtherRawMaterialLink } | { ok: false; error: string }> {
  const normItem = normalizeItemCode(itemCode);
  if (!normItem || normItem === "-") {
    return {
      ok: false,
      error: "Finished item code is missing or invalid on Job Card for Other Raw Material issue."
    };
  }
  const normRm = normalizeItemCode(rawMaterialCode);
  if (!normRm || normRm === "-") {
    return { ok: false, error: "Other Raw Material code is required for issue." };
  }

  const docId = buildItemOtherRmLinkDocId(normItem, normRm);
  let doc: ItemOtherRawMaterialLink | null = await store.get("mfr_item_other_rm_links", docId);

  if (!doc) {
    const list = await store.list("mfr_item_other_rm_links");
    doc =
      (list || []).find(
        (l: any) =>
          normalizeItemCode(l?.itemCode) === normItem &&
          normalizeItemCode(l?.otherRawMaterialCode) === normRm
      ) || null;
  }

  if (!doc || doc.active === false) {
    return {
      ok: false,
      error: `Other Raw Material "${rawMaterialCode}" is not actively linked to finished item "${itemCode}". Linkage must be configured in Item Master before issue.`
    };
  }

  return { ok: true, link: doc };
}

export async function upsertItemOtherRmLink(
  store: SimpleStore,
  input: {
    itemCode: string;
    otherRawMaterialCode: string;
    itemName?: string;
    otherRawMaterialName?: string;
    active?: boolean;
  },
  actor: { userId?: string; userName?: string; role?: string; department?: string },
  nowIso = new Date().toISOString()
): Promise<{ ok: true; link: ItemOtherRawMaterialLink } | { ok: false; error: string }> {
  const val = validateItemOtherRmLinkInput(input);
  if (val.ok === false) return { ok: false, error: val.error };

  const docId = buildItemOtherRmLinkDocId(val.data.itemCode, val.data.otherRawMaterialCode);
  const existing: ItemOtherRawMaterialLink | null = await store.get("mfr_item_other_rm_links", docId);

  const link: ItemOtherRawMaterialLink = {
    id: docId,
    itemCode: val.data.itemCode,
    itemName: val.data.itemName || existing?.itemName || val.data.itemCode,
    otherRawMaterialCode: val.data.otherRawMaterialCode,
    otherRawMaterialName:
      val.data.otherRawMaterialName || existing?.otherRawMaterialName || val.data.otherRawMaterialCode,
    active: val.data.active,
    createdAt: existing?.createdAt || nowIso,
    createdBy: existing?.createdBy || actor.userName || actor.userId || "System",
    updatedAt: nowIso,
    updatedBy: actor.userName || actor.userId || "System"
  };

  await store.set("mfr_item_other_rm_links", docId, link);
  return { ok: true, link };
}

export function filterLinkedOtherRmCatalog(
  catalog: Array<{ code: string; name: string; availableStock: number; unit: string }>,
  links: ItemOtherRawMaterialLink[],
  itemCode?: string | null
): Array<{ code: string; name: string; availableStock: number; unit: string }> {
  const normItem = normalizeItemCode(itemCode);
  if (!normItem || normItem === "-") return [];
  const activeLinkedCodes = new Set(
    (links || [])
      .filter((l) => l.active !== false && normalizeItemCode(l.itemCode) === normItem)
      .map((l) => normalizeItemCode(l.otherRawMaterialCode))
  );
  return (catalog || []).filter(
    (item) => activeLinkedCodes.has(normalizeItemCode(item.code)) && Number(item.availableStock) > 0
  );
}
