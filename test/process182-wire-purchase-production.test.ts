import { MemoryStore } from "../src/hardening/memoryStore";
import { commitMaterialMovementTx } from "../src/hardening/commitMaterialMovement";
import { acceptMaterialMovementTx } from "../src/hardening/resolveMaterialMovement";
import { computeRmRuntimeStock } from "../src/hardening/rmSkuMaster";
import {
  resolveInitialPurchaseRoute,
  RAW_MATERIAL_STORE,
  INCOMING_STORE,
  createPurchaseCreationFingerprint,
  validatePurchaseReceiptInput
} from "../src/hardening/process1Purchase";
import { createPurchaseJobInwardTx } from "../src/hardening/purchaseJobCardCreate";
import {
  unproducedOrderQty,
  productionSendAvailable,
  getAcceptedRawMaterialIssuedQty,
  shouldBlockPendingDuplicateRoute
} from "../src/hardening/process2Manufacturing";

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
    allowedDepartments: [dept],
    accessList: [dept]
  };
}

async function wirePurchase(store: MemoryStore, qty: number, operationId: string, billNo = "INV-WIRE-1000") {
  return commitMaterialMovementTx(store, {
    operationId,
    jobCardNo: "STOCK-IN-RM-WIRE-8MM",
    fromDepartment: "Purchase",
    toDepartment: RAW_MATERIAL_STORE,
    quantity: qty,
    processDetails: {
      rawMaterialCode: "RM-WIRE-8MM",
      itemCode: "RM-WIRE-8MM",
      isWire: true,
      rawMaterialKind: "Wire",
      materialType: "Raw Material",
      supplierName: "Wire Mills",
      billNo
    },
    extra: { itemCode: "RM-WIRE-8MM", itemName: "Wire 8mm", isWire: true },
    actor: actor("Purchase")
  });
}

async function acceptRm(store: MemoryStore, movementId: string, operationId: string) {
  return acceptMaterialMovementTx(store, {
    operationId,
    movementId,
    actor: actor("Raw Material Store")
  });
}

async function run() {
  {
    const r = resolveInitialPurchaseRoute({
      materialType: "Raw Material",
      rawMaterialKind: "Wire",
      selectedDestination: INCOMING_STORE
    });
    assert("TEST 12 helper: Wire destination is RM Store", r.destination === RAW_MATERIAL_STORE && r.isWire === true);
    const other = resolveInitialPurchaseRoute({
      materialType: "Raw Material",
      rawMaterialKind: "Other",
      selectedDestination: RAW_MATERIAL_STORE
    });
    assert("TEST 12 Non-Wire purchase → Incoming Store", other.destination === INCOMING_STORE && other.isWire === false);
  }

  {
    const store = new MemoryStore();
    const send = await wirePurchase(store, 1000, "op-wire-1000");
    assert("TEST 1 purchase movement created pending", send.success === true && send.movement?.accepted === false);
    assert("TEST 1 unaccepted not in RM stock", computeRmRuntimeStock(0, [send.movement], "RM-WIRE-8MM") === 0);
    const acc = await acceptRm(store, send.movement.movementId, "acc-wire-1000");
    const moves = await store.list("mfr_movements");
    assert("TEST 1 Wire invoice 1000 → RM Store +1000", acc.success === true && computeRmRuntimeStock(0, moves, "RM-WIRE-8MM") === 1000);
    const incoming = moves.filter((m) => m.toDepartment === INCOMING_STORE);
    assert("TEST 1 no Incoming Store credit", incoming.length === 0);
  }

  {
    const store = new MemoryStore();
    const first = await wirePurchase(store, 1000, "op-retry-same");
    await acceptRm(store, first.movement.movementId, "acc-retry-same");
    const retry = await wirePurchase(store, 1000, "op-retry-same");
    const moves = await store.list("mfr_movements");
    assert("TEST 2 same operationId retry cached", retry.success === true && retry.cached === true);
    assert("TEST 2 no duplicate movement", moves.filter((m) => m.fromDepartment === "Purchase").length === 1);
    assert("TEST 2 stock still 1000", computeRmRuntimeStock(0, moves, "RM-WIRE-8MM") === 1000);
  }

  {
    const store = new MemoryStore();
    const first = await wirePurchase(store, 1000, "op-inv-a");
    await acceptRm(store, first.movement.movementId, "acc-inv-a");
    const dup = await wirePurchase(store, 1000, "op-inv-b");
    const moves = await store.list("mfr_movements");
    assert("TEST 3 same invoice different operationId rejected", dup.success === false && dup.statusCode === 409);
    assert("TEST 3 still one physical receipt", moves.filter((m) => m.fromDepartment === "Purchase").length === 1);
  }

  {
    const store = new MemoryStore();
    const [a, b] = await Promise.all([
      wirePurchase(store, 1000, "op-conc-a"),
      wirePurchase(store, 1000, "op-conc-b")
    ]);
    const ok = [a, b].filter((r) => r.success);
    const rejected = [a, b].filter((r) => !r.success);
    const moves = await store.list("mfr_movements");
    assert("TEST 4 concurrent same invoice only one receipt", ok.length === 1 && rejected.length === 1 && moves.length === 1);
  }

  {
    const store = new MemoryStore();
    await store.set("mfr_job_cards", "JC-WIRE-PROD", {
      jobCardNo: "JC-WIRE-PROD",
      orderQty: 1000,
      currentQty: 1000,
      currentDepartment: "Production",
      status: "Pending",
      processType: "Manufacturing",
      itemCode: "RM-WIRE-8MM",
      version: 1
    });
    const pin = await wirePurchase(store, 1000, "op-flow-in");
    await acceptRm(store, pin.movement.movementId, "acc-flow-in");
    let moves = await store.list("mfr_movements");
    assert("pre-issue RM 1000", computeRmRuntimeStock(0, moves, "RM-WIRE-8MM") === 1000);

    const issue = await commitMaterialMovementTx(store, {
      operationId: "op-issue-200",
      jobCardNo: "JC-WIRE-PROD",
      fromDepartment: "Raw Material Store",
      toDepartment: "Production",
      quantity: 200,
      isIssueRequest: true,
      requestedQty: 200,
      processDetails: { rawMaterialCode: "RM-WIRE-8MM" },
      actor: actor("Raw Material Store")
    });
    assert("TEST 5 / PARTIAL RM issue 200 created", issue.success === true, issue.error);

    const rmIssued = await acceptMaterialMovementTx(store, {
      operationId: "op-rm-issued-200",
      movementId: issue.movement.movementId,
      issueStatus: "Issued",
      actor: actor("Raw Material Store")
    });
    moves = await store.list("mfr_movements");
    assert("TEST 5 RM remaining 800 after issue", computeRmRuntimeStock(0, moves, "RM-WIRE-8MM") === 800);
    assert("TEST 5 issued not yet accepted by Production", rmIssued.movement?.issueStatus === "Issued" && rmIssued.movement?.accepted === false);
    const job = await store.get("mfr_job_cards", "JC-WIRE-PROD");
    assert("TEST 5 production available 0 before custody", getAcceptedRawMaterialIssuedQty(job, moves) === 0);

    const custody = await acceptMaterialMovementTx(store, {
      operationId: "op-prod-custody-200",
      movementId: issue.movement.movementId,
      actor: actor("Production")
    });
    moves = await store.list("mfr_movements");
    const jobAfter = await store.get("mfr_job_cards", "JC-WIRE-PROD");
    assert("TEST 5 RM Accept Custody sets accepted true", custody.success === true && custody.movement?.accepted === true);
    assert("TEST 5 production can consume 200", getAcceptedRawMaterialIssuedQty(jobAfter, moves) === 200);
    assert("TEST 5 productionSendAvailable 200", productionSendAvailable(jobAfter, moves, { compulsory: true }) === 200);

    const prod200 = await commitMaterialMovementTx(store, {
      operationId: "op-prod-200",
      jobCardNo: "JC-WIRE-PROD",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 200,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    const after200 = await store.get("mfr_job_cards", "JC-WIRE-PROD");
    moves = await store.list("mfr_movements");
    assert("TEST 5/6 produce 200", prod200.success === true, prod200.error);
    assert("TEST 6 remaining unproduced 800", unproducedOrderQty(after200, moves) === 800);
    assert("TEST 6 job stays at Production", after200.currentDepartment === "Production");

    const prod800 = await commitMaterialMovementTx(store, {
      operationId: "op-prod-800",
      jobCardNo: "JC-WIRE-PROD",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 800,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    assert("TEST 6/7 second 800 blocked until more RM accepted", prod800.success === false);

    const issueRest = await commitMaterialMovementTx(store, {
      operationId: "op-issue-800",
      jobCardNo: "JC-WIRE-PROD",
      fromDepartment: "Raw Material Store",
      toDepartment: "Production",
      quantity: 800,
      isIssueRequest: true,
      requestedQty: 800,
      processDetails: { rawMaterialCode: "RM-WIRE-8MM" },
      actor: actor("Raw Material Store")
    });
    await acceptMaterialMovementTx(store, {
      operationId: "op-rm-issued-800",
      movementId: issueRest.movement.movementId,
      issueStatus: "Issued",
      actor: actor("Raw Material Store")
    });
    await acceptMaterialMovementTx(store, {
      operationId: "op-prod-custody-800",
      movementId: issueRest.movement.movementId,
      actor: actor("Production")
    });
    const prod800b = await commitMaterialMovementTx(store, {
      operationId: "op-prod-800b",
      jobCardNo: "JC-WIRE-PROD",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 800,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    const done = await store.get("mfr_job_cards", "JC-WIRE-PROD");
    moves = await store.list("mfr_movements");
    assert("TEST 7 second production 800 after remaining RM issue", prod800b.success === true, prod800b.error);
    assert("TEST 7 remaining 0", unproducedOrderQty(done, moves) === 0);
    assert("TEST 7 relocates after last quantity", done.currentDepartment === "Heat Treatment" && done.status === "Pending Acceptance");
  }

  {
    const store = new MemoryStore();
    await store.set("mfr_job_cards", "JC-PARTIAL-PEND", {
      jobCardNo: "JC-PARTIAL-PEND",
      orderQty: 1000,
      currentQty: 1000,
      currentDepartment: "Production",
      status: "Pending",
      processType: "Manufacturing",
      version: 1
    });
    await store.set("mfr_movements", "rm-full", {
      movementId: "rm-full",
      jobCardNo: "JC-PARTIAL-PEND",
      fromDepartment: "Raw Material Store",
      toDepartment: "Production",
      isIssueRequest: true,
      issueStatus: "Issued",
      accepted: true,
      quantity: 1000
    });
    const first = await commitMaterialMovementTx(store, {
      operationId: "pend-200",
      jobCardNo: "JC-PARTIAL-PEND",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 200,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    const second = await commitMaterialMovementTx(store, {
      operationId: "pend-800",
      jobCardNo: "JC-PARTIAL-PEND",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 800,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    assert("TEST 8 first 200 pending ok", first.success === true);
    assert("TEST 8 second 800 while first pending allowed", second.success === true, second.error);
    const over = await commitMaterialMovementTx(store, {
      operationId: "pend-1",
      jobCardNo: "JC-PARTIAL-PEND",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 1,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    assert("TEST 9 Production over-completion rejected", over.success === false);
  }

  {
    const store = new MemoryStore();
    await store.set("mfr_job_cards", "JC-CONC", {
      jobCardNo: "JC-CONC",
      orderQty: 1000,
      currentQty: 1000,
      currentDepartment: "Production",
      status: "Pending",
      processType: "Manufacturing",
      version: 1
    });
    await store.set("mfr_movements", "rm-conc", {
      movementId: "rm-conc",
      jobCardNo: "JC-CONC",
      fromDepartment: "Raw Material Store",
      toDepartment: "Production",
      isIssueRequest: true,
      issueStatus: "Issued",
      accepted: true,
      quantity: 1000
    });
    const [x, y] = await Promise.all([
      commitMaterialMovementTx(store, {
        operationId: "c600a",
        jobCardNo: "JC-CONC",
        fromDepartment: "Production",
        toDepartment: "Heat Treatment",
        quantity: 600,
        requireRawMaterialForProduction: true,
        actor: actor("Production")
      }),
      commitMaterialMovementTx(store, {
        operationId: "c600b",
        jobCardNo: "JC-CONC",
        fromDepartment: "Production",
        toDepartment: "Heat Treatment",
        quantity: 600,
        requireRawMaterialForProduction: true,
        actor: actor("Production")
      })
    ]);
    const total = [x, y].filter((r) => r.success).reduce((s, r) => s + Number(r.movement?.quantity || 0), 0);
    assert("TEST 10 concurrent 600+600 total <= 1000", total <= 1000 && [x, y].some((r) => r.success) && [x, y].some((r) => !r.success));
  }

  {
    assert(
      "TEST 11 Store pending duplicate helper blocks",
      shouldBlockPendingDuplicateRoute(
        [{ jobCardNo: "JC-SD", fromDepartment: "Store", toDepartment: "Dispatch", accepted: false }],
        { jobCardNo: "JC-SD", fromDepartment: "Store", toDepartment: "Dispatch" }
      ) === true
    );
    const store = new MemoryStore();
    await store.set("mfr_job_cards", "JC-SD", {
      jobCardNo: "JC-SD",
      orderQty: 1000,
      currentQty: 1000,
      currentDepartment: "Store",
      status: "In Process",
      processType: "Manufacturing",
      version: 1
    });
    await store.set("mfr_movements", "st-in", {
      movementId: "st-in",
      jobCardNo: "JC-SD",
      fromDepartment: "Packing",
      toDepartment: "Store",
      accepted: true,
      quantity: 1000
    });
    const first = await commitMaterialMovementTx(store, {
      operationId: "sd-500",
      jobCardNo: "JC-SD",
      fromDepartment: "Store",
      toDepartment: "Dispatch",
      quantity: 500,
      actor: actor("Store")
    });
    const second = await commitMaterialMovementTx(store, {
      operationId: "sd-200",
      jobCardNo: "JC-SD",
      fromDepartment: "Store",
      toDepartment: "Dispatch",
      quantity: 200,
      actor: actor("Store")
    });
    assert("TEST 11 Store→Dispatch first ok", first.success === true);
    assert("TEST 11 Store→Dispatch pending duplicate rejected", second.success === false, second.error);
  }

  {
    const store = new MemoryStore();
    const created = await createPurchaseJobInwardTx(store, {
      jobCard: {
        jobCardNo: "PUR-OTHER-182",
        partyName: "Bar Supplier",
        itemName: "MS Bar",
        itemCode: "RM-BAR-12",
        materialType: "Raw Material",
        isWire: false,
        rawMaterialKind: "Other",
        orderQty: 500,
        currentQty: 500,
        processType: "Purchase",
        currentDepartment: RAW_MATERIAL_STORE,
        purchaseDetails: {
          supplierName: "Bar Supplier",
          billNo: "INV-BAR-500",
          receivedQty: 500,
          rejectionQty: 0
        }
      },
      actor: actor("Purchase"),
      operationId: "op-other-job"
    });
    assert("TEST 12 Other RM job created", created.success === true, created.error);
    assert("TEST 12 Other RM movement to Incoming Store", created.movement?.toDepartment === INCOMING_STORE);
    const retry = await createPurchaseJobInwardTx(store, {
      jobCard: {
        jobCardNo: "PUR-OTHER-182",
        partyName: "Bar Supplier",
        itemName: "MS Bar",
        itemCode: "RM-BAR-12",
        materialType: "Raw Material",
        isWire: false,
        rawMaterialKind: "Other",
        orderQty: 500,
        currentQty: 500,
        processType: "Purchase",
        currentDepartment: RAW_MATERIAL_STORE,
        purchaseDetails: {
          supplierName: "Bar Supplier",
          billNo: "INV-BAR-500",
          receivedQty: 500,
          rejectionQty: 0
        }
      },
      actor: actor("Purchase"),
      operationId: "op-other-job-2"
    });
    assert("TEST 12 Other RM identical job retry cached", retry.success === true && retry.cached === true);
    const conflict = await createPurchaseJobInwardTx(store, {
      jobCard: {
        jobCardNo: "PUR-OTHER-182",
        partyName: "Bar Supplier",
        itemName: "MS Bar",
        itemCode: "RM-BAR-12",
        materialType: "Raw Material",
        isWire: false,
        rawMaterialKind: "Other",
        orderQty: 400,
        currentQty: 400,
        processType: "Purchase",
        purchaseDetails: {
          supplierName: "Bar Supplier",
          billNo: "INV-BAR-500",
          receivedQty: 400,
          rejectionQty: 0
        }
      },
      actor: actor("Purchase"),
      operationId: "op-other-conflict"
    });
    assert("TEST 12 changed receipt fingerprint 409", conflict.success === false && conflict.statusCode === 409);

    const bad = validatePurchaseReceiptInput({
      partyName: "X",
      itemName: "Y",
      materialType: "Raw Material",
      currentQty: 10,
      purchaseDetails: { supplierName: "X", receivedQty: 0, billNo: "B1" }
    });
    assert("validatePurchaseReceiptInput rejects zero received", bad.ok === false);
    const fp = createPurchaseCreationFingerprint({
      jobCardNo: "PUR-1",
      partyName: "X",
      itemName: "Y",
      itemCode: "C1",
      materialType: "Raw Material",
      currentQty: 10,
      orderQty: 10,
      purchaseDetails: { supplierName: "X", billNo: "B1", receivedQty: 10 }
    });
    assert("createPurchaseCreationFingerprint stable", fp.includes("b1"));
  }

  {
    const store = new MemoryStore();
    const wireJob = await createPurchaseJobInwardTx(store, {
      jobCard: {
        jobCardNo: "PUR-WIRE-182",
        partyName: "Wire Mills",
        itemName: "Wire 8mm",
        itemCode: "RM-WIRE-8MM",
        materialType: "Raw Material",
        isWire: true,
        rawMaterialKind: "Wire",
        orderQty: 1000,
        currentQty: 1000,
        processType: "Purchase",
        currentDepartment: INCOMING_STORE,
        purchaseDetails: {
          supplierName: "Wire Mills",
          billNo: "INV-JOB-WIRE",
          receivedQty: 1000,
          rejectionQty: 0
        }
      },
      actor: actor("Purchase"),
      operationId: "op-wire-job"
    });
    assert("mobile/job Wire routes to RM Store via engine", wireJob.success === true && wireJob.movement?.toDepartment === RAW_MATERIAL_STORE, wireJob.error);
    assert("job Wire movement not auto-accepted", wireJob.movement?.accepted === false);
  }

  console.log(`\nProcess 182 tests: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
