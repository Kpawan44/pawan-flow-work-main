import { MemoryStore } from "../src/hardening/memoryStore";
import { commitMaterialMovementTx } from "../src/hardening/commitMaterialMovement";
import { acceptMaterialMovementTx } from "../src/hardening/resolveMaterialMovement";
import {
  finalizePackingBagLines,
  packingDetailsFromBagLines,
  lineTotalBagsTimesPcs
} from "../src/hardening/packingBagLines";
import { enterAdvancesField, shouldIgnoreDuplicateSubmit, preserveFailedSaveFields, tallyFormEnterAction } from "../src/hardening/tallyEntry";
import { applyTargetedLedgerPatch, ledgerGetRequestCount } from "../src/hardening/targetedLedgerPatch";
import { resolveCreateMovementOperationId } from "../src/hardening/movementOperationId";
import { createPurchaseInvoiceFingerprint } from "../src/hardening/process1Purchase";

let passed = 0;
let failed = 0;

function assert(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.error(`FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
}

function actor(dept: string) {
  return {
    userId: `u-${dept.toLowerCase().replace(/\s+/g, "-")}`,
    userName: `${dept} User`,
    role: "staff",
    department: dept,
    allowedDepartments: [dept, "Purchase", "Raw Material Store", "Incoming Store", "Production", "Packing", "Store"],
    accessList: []
  };
}

async function run() {
  assert("single-size packing 5×100=500", finalizePackingBagLines([{ bags: 5, pcsPerBag: 100 }], 5000).ok === true
    && (finalizePackingBagLines([{ bags: 5, pcsPerBag: 100 }], 5000) as any).grandTotal === 500
    && (finalizePackingBagLines([{ bags: 5, pcsPerBag: 100 }], 5000) as any).pcsPerBagOrBox === 100);

  const mixed = finalizePackingBagLines(
    [
      { bags: 6000, pcsPerBag: 2 },
      { bags: 5000, pcsPerBag: 1 },
      { bags: 2500, pcsPerBag: 1 }
    ],
    19500
  );
  assert("mixed-size packing grand total 19500", mixed.ok === true && mixed.ok && mixed.grandTotal === 19500);
  assert("mixed-size rollup boxCount", mixed.ok && mixed.boxCount === 13500);
  assert("mixed-size pcsPerBagOrBox is 0 (mixed)", mixed.ok && mixed.pcsPerBagOrBox === 0);
  assert("mixed-size example line 6000×2=12000", mixed.ok && mixed.lines[0].lineTotal === 12000);
  assert("lineTotal helper", lineTotalBagsTimesPcs(6000, 2) === 12000);

  const over = finalizePackingBagLines([{ bags: 10, pcsPerBag: 100 }], 500);
  assert("over-quantity packing rejected", over.ok === false);

  const rollup = packingDetailsFromBagLines(mixed as any);
  assert("print rollup keeps totalPcs", rollup.totalPcs === 19500 && rollup.bagLines.length === 3);

  assert("Enter advances unless last field", enterAdvancesField({ lastField: false }) === "advance");
  assert("Enter submits on last field", enterAdvancesField({ lastField: true }) === "submit");
  assert("IME composition ignored", enterAdvancesField({ isComposing: true, lastField: false }) === "ignore");

  const prevent = { called: false };
  const advance = tallyFormEnterAction(
    { key: "Enter", preventDefault: () => { prevent.called = true; } },
    { isLastField: false }
  );
  assert("tally Enter preventDefault when advancing", advance === "advance" && prevent.called);

  assert("double-click in-flight ignored", shouldIgnoreDuplicateSubmit({ inFlight: true, lastSubmitAtMs: 0, nowMs: 1000 }));
  assert("Enter-key debounce window", shouldIgnoreDuplicateSubmit({ inFlight: false, lastSubmitAtMs: 900, nowMs: 1000, windowMs: 400 }));
  assert("second save after window allowed", shouldIgnoreDuplicateSubmit({ inFlight: false, lastSubmitAtMs: 0, nowMs: 1000, windowMs: 400 }) === false);

  const kept = preserveFailedSaveFields({ billNo: "INV-1", qty: 10 }, false);
  assert("failed-save preserves fields", kept.billNo === "INV-1" && kept.qty === 10);
  const cleared = preserveFailedSaveFields({ billNo: "INV-1" }, true);
  assert("successful save clears entry snapshot", Object.keys(cleared).length === 0);

  const patched = applyTargetedLedgerPatch(
    {
      movements: [{ movementId: "M-1", quantity: 1, accepted: false }],
      jobCards: [{ jobCardNo: "JC-1", currentQty: 100, status: "Pending" }]
    },
    {
      movement: { movementId: "M-1", quantity: 1, accepted: true },
      jobCard: { jobCardNo: "JC-1", currentQty: 100, status: "In Process" }
    }
  );
  assert("targeted refresh updates only affected movement", patched.applied && patched.movements[0].accepted === true);
  assert("targeted refresh updates job status", patched.jobCards[0].status === "In Process");
  assert("baseline full refresh is 7 GETs", ledgerGetRequestCount("full-refresh") === 7);
  assert("optimized mutation is 0 list GETs", ledgerGetRequestCount("targeted") === 0);
  assert("ledger-only refresh is 2 GETs", ledgerGetRequestCount("ledger-only") === 2);

  const headerOp = resolveCreateMovementOperationId({ operationId: "op-from-header" });
  assert("X-Operation-Id / body operationId resolved", headerOp.ok && headerOp.operationId === "op-from-header");

  const inv = createPurchaseInvoiceFingerprint({
    billNo: "INV-205",
    supplierName: "Acme",
    itemCode: "WR-1",
    materialType: "Raw Material",
    isWire: true
  });
  assert("purchase invoice fingerprint requires bill", inv.ok === true);

  const store = new MemoryStore();
  const purchase1 = await commitMaterialMovementTx(store, {
    operationId: "op-p205-1",
    jobCardNo: "STOCK-IN-WR-1",
    fromDepartment: "Purchase",
    toDepartment: "Raw Material Store",
    quantity: 100,
    processDetails: {
      itemCode: "WR-1",
      isWire: true,
      rawMaterialKind: "Wire",
      materialType: "Raw Material",
      supplierName: "Acme",
      billNo: "INV-205"
    },
    extra: { itemCode: "WR-1", itemName: "Wire", isWire: true },
    actor: actor("Purchase")
  });
  assert("purchase invoice save succeeds", purchase1.success === true, purchase1.error);

  const purchaseDup = await commitMaterialMovementTx(store, {
    operationId: "op-p205-2",
    jobCardNo: "STOCK-IN-WR-1",
    fromDepartment: "Purchase",
    toDepartment: "Raw Material Store",
    quantity: 100,
    processDetails: {
      itemCode: "WR-1",
      isWire: true,
      rawMaterialKind: "Wire",
      materialType: "Raw Material",
      supplierName: "Acme",
      billNo: "INV-205"
    },
    extra: { itemCode: "WR-1", itemName: "Wire", isWire: true },
    actor: actor("Purchase")
  });
  assert("duplicate invoice rejected 409", purchaseDup.success === false && purchaseDup.statusCode === 409, purchaseDup.error);

  const sameOp = await commitMaterialMovementTx(store, {
    operationId: "op-p205-1",
    jobCardNo: "STOCK-IN-WR-1",
    fromDepartment: "Purchase",
    toDepartment: "Raw Material Store",
    quantity: 100,
    processDetails: {
      itemCode: "WR-1",
      isWire: true,
      rawMaterialKind: "Wire",
      materialType: "Raw Material",
      supplierName: "Acme",
      billNo: "INV-205"
    },
    extra: { itemCode: "WR-1", itemName: "Wire", isWire: true },
    actor: actor("Purchase")
  });
  assert("rapid save same operationId is idempotent", sameOp.success === true && sameOp.cached === true);

  if (purchase1.movement?.movementId) {
    const acc1 = await acceptMaterialMovementTx(store, {
      operationId: `op-accept-${purchase1.movement.movementId}`,
      movementId: purchase1.movement.movementId,
      actor: actor("Raw Material Store"),
      requireRawMaterialForProduction: false
    });
    assert("RM Store accept succeeds", acc1.success === true, acc1.error);
    const accDup = await acceptMaterialMovementTx(store, {
      operationId: `op-accept-${purchase1.movement.movementId}`,
      movementId: purchase1.movement.movementId,
      actor: actor("Raw Material Store"),
      requireRawMaterialForProduction: false
    });
    assert("double-click accept is idempotent", accDup.success === true && (accDup.cached === true || accDup.movement?.accepted === true));
  }

  console.log(`\nProcess 205: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
