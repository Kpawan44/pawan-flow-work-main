export interface RmSkuSeed {
  code: string;
  name: string;
  category: string;
  availableStock: number;
  unit: string;
  location: string;
}

/** Existing hardcoded opening catalog — preserved as create-if-missing seed. */
export const INVENTORY_RAW_MATERIALS_SEED: RmSkuSeed[] = [
  { code: "EN8-R", name: "EN8 Carbon Steel Round Bars", category: "Alloy Steel", availableStock: 14500, unit: "KG", location: "Bin RM-101" },
  { code: "EN9-S", name: "EN9 Alloy Steel Square Rods", category: "Alloy Steel", availableStock: 8200, unit: "KG", location: "Bin RM-102" },
  { code: "MS-WC", name: "Mild Steel Wire Coils (High Carbon)", category: "Mild Steel", availableStock: 22000, unit: "KG", location: "Bin RM-204" },
  { code: "SS-304", name: "Stainless Steel Sheet Coils (Grade 304)", category: "Stainless Steel", availableStock: 6800, unit: "KG", location: "Bin RM-301" },
  { code: "HT-SB", name: "High-Tensile Steel Billets (HT-200)", category: "Alloy Steel", availableStock: 18300, unit: "KG", location: "Bin RM-105" },
  { code: "BR-HEX", name: "Brass Hexagonal Rods (C360)", category: "Copper Alloys", availableStock: 4100, unit: "KG", location: "Bin RM-402" },
  { code: "AL-6061", name: "Aluminum Extrusion Bars (6061-T6)", category: "Aluminum Alloys", availableStock: 9500, unit: "KG", location: "Bin RM-405" },
  { code: "CR-STEEL", name: "Cold Rolled Steel Sheets (1.2mm)", category: "Sheet Metal", availableStock: 11200, unit: "KG", location: "Bin RM-202" },
  { code: "FE-500", name: "Deformed Fe-500 Reinforcing Bars", category: "Carbon Steel", availableStock: 31000, unit: "KG", location: "Bin RM-208" }
];

export interface RmSkuMasterDoc {
  code: string;
  name: string;
  category: string;
  unit: string;
  location: string;
  openingQty: number;
  openingCapturedAt: string;
}

export function seedToMasterDoc(seed: RmSkuSeed, capturedAt: string): RmSkuMasterDoc {
  return {
    code: seed.code,
    name: seed.name,
    category: seed.category,
    unit: seed.unit,
    location: seed.location,
    openingQty: seed.availableStock,
    openingCapturedAt: capturedAt
  };
}

export function mergeCreateIfMissing(existing: RmSkuMasterDoc | null | undefined, incoming: RmSkuMasterDoc): RmSkuMasterDoc {
  if (!existing) return incoming;
  return {
    ...incoming,
    openingQty: existing.openingQty,
    openingCapturedAt: existing.openingCapturedAt
  };
}

export function computeRmRuntimeStock(
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
    processDetails?: any;
  }>,
  code: string
): number {
  const matchesCode = (m: (typeof movements)[0]) =>
    m.processDetails?.rawMaterialCode === code ||
    m.jobCardNo === "STOCK-IN-" + code ||
    m.jobCardNo === code;

  const totalIssued = movements
    .filter(
      (m) =>
        m.fromDepartment === "Raw Material Store" &&
        m.isIssueRequest &&
        m.issueStatus === "Issued" &&
        matchesCode(m)
    )
    .reduce((sum, m) => sum + (m.quantity || 0), 0);

  const totalPurchased = movements
    .filter(
      (m) =>
        m.toDepartment === "Raw Material Store" &&
        m.fromDepartment === "Purchase" &&
        m.accepted &&
        matchesCode(m)
    )
    .reduce((sum, m) => sum + (m.quantity || 0), 0);

  const totalRejected = movements
    .filter(
      (m) =>
        m.fromDepartment === "Raw Material Store" &&
        (m.issueStatus === "Rejected" || m.processDetails?.isWireRejection) &&
        (matchesCode(m) || m.jobCardNo?.startsWith("RM-REJECT-"))
    )
    .reduce((sum, m) => sum + (m.processDetails?.rejectedQty || m.quantity || m.requestedQty || 0), 0);

  return Math.max(0, openingQty + totalPurchased - totalIssued - totalRejected);
}
