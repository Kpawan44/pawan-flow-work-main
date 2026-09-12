/**
 * Process 205 — packing: Bags × PCS per row, mixed bag sizes, grand total.
 * Rollup fields (boxCount, pcsPerBagOrBox, totalPcs) stay for print / QR / Set Packing.
 */

export type PackingBagLineInput = {
  bags: number;
  pcsPerBag: number;
};

export type PackingBagLine = PackingBagLineInput & {
  lineTotal: number;
};

export type PackingBagLinesOk = {
  ok: true;
  lines: PackingBagLine[];
  grandTotal: number;
  boxCount: number;
  pcsPerBagOrBox: number;
  totalPcs: number;
};

export type PackingBagLinesFail = {
  ok: false;
  error: string;
};

export function lineTotalBagsTimesPcs(bags: number, pcsPerBag: number): number {
  if (!Number.isFinite(bags) || !Number.isFinite(pcsPerBag)) return NaN;
  return bags * pcsPerBag;
}

export function parsePositiveInt(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) return raw;
  if (typeof raw === "string" && raw.trim()) {
    const n = Number(raw.trim());
    if (Number.isInteger(n) && n > 0) return n;
  }
  return null;
}

export function finalizePackingBagLines(
  rawLines: Array<{ bags?: unknown; pcsPerBag?: unknown }>,
  availableQty: number,
): PackingBagLinesOk | PackingBagLinesFail {
  if (!Array.isArray(rawLines) || rawLines.length === 0) {
    return { ok: false, error: "Add at least one bag-size row (No. of Bags × Quantity per Bag)." };
  }
  const lines: PackingBagLine[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    const bags = parsePositiveInt(rawLines[i]?.bags);
    const pcsPerBag = parsePositiveInt(rawLines[i]?.pcsPerBag);
    if (bags == null || pcsPerBag == null) {
      return {
        ok: false,
        error: `Row ${i + 1}: enter positive whole numbers for bags and quantity per bag.`,
      };
    }
    const lineTotal = lineTotalBagsTimesPcs(bags, pcsPerBag);
    if (!Number.isInteger(lineTotal) || lineTotal <= 0) {
      return { ok: false, error: `Row ${i + 1}: invalid Bags × PCS total.` };
    }
    lines.push({ bags, pcsPerBag, lineTotal });
  }
  const grandTotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  const cap = Number(availableQty);
  if (!Number.isFinite(cap) || cap <= 0) {
    return { ok: false, error: "Job quantity is unavailable for packing." };
  }
  if (grandTotal > cap) {
    return {
      ok: false,
      error: `Grand total ${grandTotal} PCS exceeds available/job quantity ${cap}.`,
    };
  }
  const boxCount = lines.reduce((s, l) => s + l.bags, 0);
  const distinctSizes = new Set(lines.map((l) => l.pcsPerBag));
  const pcsPerBagOrBox = distinctSizes.size === 1 ? lines[0].pcsPerBag : 0;
  return {
    ok: true,
    lines,
    grandTotal,
    boxCount,
    pcsPerBagOrBox,
    totalPcs: grandTotal,
  };
}

export function packingDetailsFromBagLines(
  finalized: PackingBagLinesOk,
): {
  boxCount: number;
  pcsPerBagOrBox: number;
  totalPcs: number;
  bagLines: PackingBagLine[];
} {
  return {
    boxCount: finalized.boxCount,
    pcsPerBagOrBox: finalized.pcsPerBagOrBox,
    totalPcs: finalized.totalPcs,
    bagLines: finalized.lines,
  };
}
