import { MemoryStore } from "../src/hardening/memoryStore";
import { commitMaterialMovementTx } from "../src/hardening/commitMaterialMovement";
import {
  storeAuthoritativeOnHand,
  isEligibleForProductionOperationalQueue,
  isRoutedAwayFromProductionQueue
} from "../src/hardening/process2Manufacturing";
import {
  createDispatchStoreRequirementTx,
  issueStoreToDispatchTx,
  issueStoreItemToDispatchTx,
  issueDispatchStoreRequirementTx,
  calculateStoreAuthoritativeItemStock,
  calculateStoreJobCardAvailableStock,
  allocateItemStockAcrossJobCards,
  DISPATCH_STORE_ISSUE_COLLECTION,
  DISPATCH_STORE_REQUIREMENT_COLLECTION,
  createDispatchStoreIssueFingerprint
} from "../src/hardening/dispatchStoreIssue";
import { isLedgerCollectionBlockedFromClientSync } from "../src/hardening/clientLedgerGuards";
import {
  applyFactoryResetToStore,
  DISPATCH_STORE_UNIT_LEDGER_COLLECTIONS,
  liveFactoryDeleteAllPurgeCollections,
  liveFactoryResetPurgeCollections,
  operationalCollectionsForFactoryReset
} from "../src/hardening/factoryResetPolicy";

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

function dispatchActor() {
  return {
    userId: "u-disp",
    userName: "Dispatch User",
    role: "dispatch",
    department: "Dispatch",
    allowedDepartments: ["Dispatch"],
    accessList: ["Dispatch"]
  };
}

function storeActor() {
  return {
    userId: "u-store",
    userName: "Store User",
    role: "store",
    department: "Store",
    allowedDepartments: ["Store"],
    accessList: ["Store"]
  };
}

function adminActor() {
  return {
    userId: "u-admin",
    userName: "Admin User",
    role: "admin",
    department: "Admin",
    allowedDepartments: ["Admin"],
    accessList: ["Admin"]
  };
}

function unauthorizedActor() {
  return {
    userId: "u-unauth",
    userName: "Cutting User",
    role: "operator",
    department: "Cutting",
    allowedDepartments: ["Cutting"],
    accessList: ["Cutting"]
  };
}

async function seedJob(
  store: MemoryStore,
  jobCardNo = "JC-DS-1",
  opts?: {
    unit?: string;
    currentQty?: number;
    currentDept?: string;
    itemName?: string;
    itemCode?: string;
    boxCount?: number;
    totalPcs?: number;
    createdAt?: string;
  }
) {
  const unit = opts?.unit || "PCS";
  const qty = opts?.currentQty !== undefined ? opts.currentQty : 1000;
  const currentDept = opts?.currentDept || "Store";
  const itemName = opts?.itemName || "Widget";
  const itemCode = opts?.itemCode || "ITEM-1";
  const createdAt = opts?.createdAt || new Date().toISOString();

  await store.set("mfr_job_cards", jobCardNo, {
    jobCardNo,
    itemCode,
    itemName,
    orderQty: qty,
    currentQty: qty,
    currentDepartment: currentDept,
    unit,
    createdAt,
    packingDetails: {
      boxCount: opts?.boxCount !== undefined ? opts.boxCount : 10,
      totalPcs: opts?.totalPcs !== undefined ? opts.totalPcs : qty,
      packingType: "Standard Box"
    }
  });

  if (currentDept.toLowerCase() === "store") {
    await store.set("mfr_movements", `M-IN-${jobCardNo}`, {
      movementId: `M-IN-${jobCardNo}`,
      jobCardNo,
      fromDepartment: "Packing",
      toDepartment: "Store",
      quantity: qty,
      unit,
      accepted: true,
      processDetails: {
        boxCount: opts?.boxCount !== undefined ? opts.boxCount : 10,
        totalPcs: opts?.totalPcs !== undefined ? opts.totalPcs : qty,
        kgQty: unit === "KG" ? qty : 50
      },
      createdAt
    });
  }
}

let issueOpSeq = 0;
function nextIssueOp(label = "auto"): string {
  issueOpSeq += 1;
  return `dsi-test-${label}-${issueOpSeq}`;
}

async function run() {
  console.log("=== ITEM-CENTRIC STORE → DISPATCH 3-UNIT STOCK TEST SUITE ===");

  // SCENARIO 1: Single Job Card Store → Dispatch issue for PCS native
  {
    const store = new MemoryStore();
    await seedJob(store, "JC-DS-1", { unit: "PCS", currentQty: 500, boxCount: 10, totalPcs: 500 });
    const onHandBefore = storeAuthoritativeOnHand(await store.get("mfr_job_cards", "JC-DS-1"), await store.list("mfr_movements"));

    const issue = await issueStoreItemToDispatchTx(store, {
      itemName: "Widget",
      issuedBagQty: 2,
      issuedPcsQty: 100,
      issuedKgQty: 10,
      actor: storeActor(),
      operationId: nextIssueOp("scen1")
    });

    const movements = await store.list("mfr_movements");
    const outboundMov = movements.find((m) => m.fromDepartment === "Store" && m.toDepartment === "Dispatch");
    const onHandAfter = storeAuthoritativeOnHand(await store.get("mfr_job_cards", "JC-DS-1"), movements);
    const issueRec = await store.get(DISPATCH_STORE_ISSUE_COLLECTION, issue.data?.issue.id!);

    assert(
      "Scenario 1: Single Job Card PCS issue deducts native PCS and tracks independent BAG & KG",
      onHandBefore === 500 &&
        issue.success === true &&
        onHandAfter === 400 &&
        issueRec.issuedBagQty === 2 &&
        issueRec.issuedPcsQty === 100 &&
        issueRec.issuedKgQty === 10 &&
        issueRec.nativeDeductedQty === 100 &&
        Boolean(outboundMov) &&
        outboundMov?.quantity === 100
    );
  }

  // SCENARIO 2: Single Job Card Store → Dispatch issue for KG native
  {
    const store = new MemoryStore();
    await seedJob(store, "JC-DS-KG", { unit: "KG", currentQty: 250, boxCount: 5, totalPcs: 2500 });
    const issue = await issueStoreItemToDispatchTx(store, {
      itemName: "Widget",
      issuedBagQty: 1,
      issuedPcsQty: 500,
      issuedKgQty: 50,
      actor: storeActor(),
      operationId: nextIssueOp("scen2")
    });

    const movements = await store.list("mfr_movements");
    const outboundMov = movements.find((m) => m.fromDepartment === "Store" && m.toDepartment === "Dispatch");
    const onHandAfter = storeAuthoritativeOnHand(await store.get("mfr_job_cards", "JC-DS-KG"), movements);
    const issueRec = await store.get(DISPATCH_STORE_ISSUE_COLLECTION, issue.data?.issue.id!);

    assert(
      "Scenario 2: Single Job Card KG issue deducts native KG from authoritative stock",
      issue.success === true &&
        onHandAfter === 200 &&
        issueRec.issuedBagQty === 1 &&
        issueRec.issuedPcsQty === 500 &&
        issueRec.issuedKgQty === 50 &&
        issueRec.nativeDeductedQty === 50 &&
        Boolean(outboundMov) &&
        outboundMov?.quantity === 50
    );
  }

  // SCENARIO 3: Single Job Card Store → Dispatch issue for BAG native
  {
    const store = new MemoryStore();
    await seedJob(store, "JC-DS-BAG", { unit: "BAG", currentQty: 50, boxCount: 50, totalPcs: 5000 });
    const issue = await issueStoreItemToDispatchTx(store, {
      itemName: "Widget",
      issuedBagQty: 10,
      issuedPcsQty: 1000,
      issuedKgQty: 20,
      actor: storeActor(),
      operationId: nextIssueOp("scen3")
    });

    const movements = await store.list("mfr_movements");
    const outboundMov = movements.find((m) => m.fromDepartment === "Store" && m.toDepartment === "Dispatch");
    const onHandAfter = storeAuthoritativeOnHand(await store.get("mfr_job_cards", "JC-DS-BAG"), movements);

    assert(
      "Scenario 3: Single Job Card BAG issue deducts native BAG from on-hand",
      issue.success === true &&
        onHandAfter === 40 &&
        Boolean(outboundMov) &&
        outboundMov?.quantity === 10
    );
  }

  // SCENARIO 4: Over-issuance in native unit returns 409 Conflict (0 deductions, 0 writes)
  {
    const store = new MemoryStore();
    await seedJob(store, "JC-DS-1", { unit: "PCS", currentQty: 100, boxCount: 2, totalPcs: 100 });
    const issue = await issueStoreItemToDispatchTx(store, {
      itemName: "Widget",
      issuedBagQty: 1,
      issuedPcsQty: 150, // exceeds 100
      issuedKgQty: 5,
      actor: storeActor(),
      operationId: nextIssueOp("scen4")
    });

    const movements = await store.list("mfr_movements");
    const issues = await store.list(DISPATCH_STORE_ISSUE_COLLECTION);
    const onHandAfter = storeAuthoritativeOnHand(await store.get("mfr_job_cards", "JC-DS-1"), movements);

    assert(
      "Scenario 4: Over-issuance on PCS returns 409 Conflict and leaves inventory untouched",
      issue.success === false &&
        issue.statusCode === 409 &&
        onHandAfter === 100 &&
        movements.length === 1 &&
        issues.length === 0
    );
  }

  // SCENARIO 5: Over-issuance in Bags returns 409 Conflict (0 deductions, 0 writes)
  {
    const store = new MemoryStore();
    await seedJob(store, "JC-DS-1", { unit: "PCS", currentQty: 500, boxCount: 5, totalPcs: 500 });
    const issue = await issueStoreItemToDispatchTx(store, {
      itemName: "Widget",
      issuedBagQty: 10, // exceeds 5 available boxes
      issuedPcsQty: 100,
      issuedKgQty: 10,
      actor: storeActor(),
      operationId: nextIssueOp("scen5")
    });

    const movements = await store.list("mfr_movements");
    const issues = await store.list(DISPATCH_STORE_ISSUE_COLLECTION);

    assert(
      "Scenario 5: Over-issuance on Bags returns 409 Conflict and writes 0 records",
      issue.success === false && issue.statusCode === 409 && movements.length === 1 && issues.length === 0
    );
  }

  // SCENARIO 6: Multi-Job-Card Item-Centric aggregation across 2 Job Cards
  {
    const store = new MemoryStore();
    await seedJob(store, "JC-001", {
      itemName: "M8 Hex Bolt",
      unit: "KG",
      currentQty: 30,
      boxCount: 6,
      totalPcs: 3000,
      createdAt: "2026-09-01T10:00:00Z"
    });
    await seedJob(store, "JC-002", {
      itemName: "M8 Hex Bolt",
      unit: "KG",
      currentQty: 40,
      boxCount: 8,
      totalPcs: 4000,
      createdAt: "2026-09-05T10:00:00Z"
    });

    const stock = calculateStoreAuthoritativeItemStock(
      "M8 Hex Bolt",
      await store.list("mfr_job_cards"),
      await store.list("mfr_movements"),
      await store.list(DISPATCH_STORE_ISSUE_COLLECTION)
    );

    assert(
      "Scenario 6: Item-Centric aggregation combines 30+40=70 KG, 6+8=14 Bags, 3000+4000=7000 PCS",
      stock.availableKg === 70 &&
        stock.availableBags === 14 &&
        stock.availablePcs === 7000 &&
        stock.candidateJobCards.length === 2
    );
  }

  // SCENARIO 7: Deterministic FIFO Multi-Job-Card Allocation
  {
    const store = new MemoryStore();
    await seedJob(store, "JC-001", {
      itemName: "M8 Hex Bolt",
      unit: "KG",
      currentQty: 30,
      boxCount: 6,
      totalPcs: 3000,
      createdAt: "2026-09-01T10:00:00Z"
    });
    await seedJob(store, "JC-002", {
      itemName: "M8 Hex Bolt",
      unit: "KG",
      currentQty: 40,
      boxCount: 8,
      totalPcs: 4000,
      createdAt: "2026-09-05T10:00:00Z"
    });

    // Request 50 KG, 10 Bags, 5000 PCS
    // Oldest JC-001 (has 30 KG, 6 Bags, 3000 PCS) will be fully allocated
    // Newer JC-002 (has 40 KG, 8 Bags, 4000 PCS) will provide remaining 20 KG, 4 Bags, 2000 PCS
    const issue = await issueStoreItemToDispatchTx(store, {
      itemName: "M8 Hex Bolt",
      issuedBagQty: 10,
      issuedPcsQty: 5000,
      issuedKgQty: 50,
      actor: storeActor(),
      operationId: nextIssueOp("scen7")
    });

    const movements = await store.list("mfr_movements");
    const issueRec = await store.get(DISPATCH_STORE_ISSUE_COLLECTION, issue.data?.issue.id!);
    const allocs = issueRec?.sourceAllocations || [];

    const jc1Move = movements.find((m) => m.jobCardNo === "JC-001" && m.toDepartment === "Dispatch");
    const jc2Move = movements.find((m) => m.jobCardNo === "JC-002" && m.toDepartment === "Dispatch");

    const jc1OnHand = storeAuthoritativeOnHand(await store.get("mfr_job_cards", "JC-001"), movements);
    const jc2OnHand = storeAuthoritativeOnHand(await store.get("mfr_job_cards", "JC-002"), movements);

    assert(
      "Scenario 7: Deterministic FIFO allocation allocates JC-001 (30 KG) and JC-002 (20 KG) with zero negative balances",
      issue.success === true &&
        allocs.length === 2 &&
        allocs[0].jobCardNo === "JC-001" &&
        allocs[0].allocatedKgQty === 30 &&
        allocs[0].allocatedBagQty === 6 &&
        allocs[0].allocatedPcsQty === 3000 &&
        allocs[1].jobCardNo === "JC-002" &&
        allocs[1].allocatedKgQty === 20 &&
        allocs[1].allocatedBagQty === 4 &&
        allocs[1].allocatedPcsQty === 2000 &&
        jc1OnHand === 0 &&
        jc2OnHand === 20 &&
        jc1Move?.quantity === 30 &&
        jc2Move?.quantity === 20
    );
  }

  // SCENARIO 8: Partial unit issue (only KG issued; Bags and PCS remain untouched)
  {
    const store = new MemoryStore();
    await seedJob(store, "JC-001", {
      itemName: "Flange",
      unit: "KG",
      currentQty: 50,
      boxCount: 10,
      totalPcs: 2000
    });

    const issue = await issueStoreItemToDispatchTx(store, {
      itemName: "Flange",
      issuedBagQty: 0,
      issuedPcsQty: 0,
      issuedKgQty: 20,
      actor: storeActor(),
      operationId: nextIssueOp("scen8")
    });

    const stock = calculateStoreAuthoritativeItemStock(
      "Flange",
      await store.list("mfr_job_cards"),
      await store.list("mfr_movements"),
      await store.list(DISPATCH_STORE_ISSUE_COLLECTION)
    );

    assert(
      "Scenario 8: Partial unit issue deducts ONLY KG (leaves available Bags=10, PCS=2000)",
      issue.success === true && stock.availableKg === 30 && stock.availableBags === 10 && stock.availablePcs === 2000
    );
  }

  // SCENARIO 9: Multi-Job-Card over-issuance on KG aborts transaction with 409 Conflict
  {
    const store = new MemoryStore();
    await seedJob(store, "JC-001", { itemName: "Nut", unit: "KG", currentQty: 20 });
    await seedJob(store, "JC-002", { itemName: "Nut", unit: "KG", currentQty: 30 });

    const issue = await issueStoreItemToDispatchTx(store, {
      itemName: "Nut",
      issuedKgQty: 60, // exceeds 20+30=50 KG
      issuedBagQty: 1,
      issuedPcsQty: 100,
      actor: storeActor(),
      operationId: nextIssueOp("scen9")
    });

    const issues = await store.list(DISPATCH_STORE_ISSUE_COLLECTION);
    assert(
      "Scenario 9: Multi-Job-Card over-issuance on KG aborts with 409 and 0 records created",
      issue.success === false && issue.statusCode === 409 && issues.length === 0
    );
  }

  // SCENARIO 10: Multi-Job-Card over-issuance on Bags aborts with 409 Conflict
  {
    const store = new MemoryStore();
    await seedJob(store, "JC-001", { itemName: "Screw", unit: "KG", currentQty: 50, boxCount: 2, totalPcs: 1000 });
    await seedJob(store, "JC-002", { itemName: "Screw", unit: "KG", currentQty: 50, boxCount: 3, totalPcs: 1000 });

    const issue = await issueStoreItemToDispatchTx(store, {
      itemName: "Screw",
      issuedBagQty: 10, // exceeds 2+3=5 Bags
      issuedPcsQty: 500,
      issuedKgQty: 20,
      actor: storeActor(),
      operationId: nextIssueOp("scen10")
    });

    assert("Scenario 10: Multi-Job-Card over-issuance on Bags returns 409 Conflict", issue.success === false && issue.statusCode === 409);
  }

  // SCENARIO 11: Multi-Job-Card over-issuance on PCS aborts with 409 Conflict
  {
    const store = new MemoryStore();
    await seedJob(store, "JC-001", { itemName: "Pin", unit: "KG", currentQty: 50, boxCount: 5, totalPcs: 1000 });
    await seedJob(store, "JC-002", { itemName: "Pin", unit: "KG", currentQty: 50, boxCount: 5, totalPcs: 1000 });

    const issue = await issueStoreItemToDispatchTx(store, {
      itemName: "Pin",
      issuedPcsQty: 3000, // exceeds 1000+1000=2000 PCS
      issuedBagQty: 2,
      issuedKgQty: 20,
      actor: storeActor(),
      operationId: nextIssueOp("scen11")
    });

    assert("Scenario 11: Multi-Job-Card over-issuance on PCS returns 409 Conflict", issue.success === false && issue.statusCode === 409);
  }

  // SCENARIO 12: All-zero quantities rejected with 400 Bad Request
  {
    const store = new MemoryStore();
    await seedJob(store, "JC-001", { itemName: "Washer" });
    const issue = await issueStoreItemToDispatchTx(store, {
      itemName: "Washer",
      issuedBagQty: 0,
      issuedPcsQty: 0,
      issuedKgQty: 0,
      actor: storeActor(),
      operationId: nextIssueOp("scen12")
    });
    assert("Scenario 12: All-zero quantities rejected with 400 Bad Request", issue.success === false && issue.statusCode === 400);
  }

  // SCENARIO 13: Negative or non-numeric quantities rejected with 400 Bad Request
  {
    const store = new MemoryStore();
    await seedJob(store, "JC-001", { itemName: "Washer" });
    const neg = await issueStoreItemToDispatchTx(store, {
      itemName: "Washer",
      issuedBagQty: -1,
      issuedPcsQty: 10,
      issuedKgQty: 5,
      actor: storeActor(),
      operationId: nextIssueOp("scen13a")
    });
    const nan = await issueStoreItemToDispatchTx(store, {
      itemName: "Washer",
      issuedBagQty: 1,
      issuedPcsQty: "invalid" as any,
      issuedKgQty: 5,
      actor: storeActor(),
      operationId: nextIssueOp("scen13b")
    });
    assert(
      "Scenario 13: Negative and non-numeric quantities return 400 Bad Request",
      neg.success === false && neg.statusCode === 400 && nan.success === false && nan.statusCode === 400
    );
  }

  // SCENARIO 14: Unauthorized department rejected with 403 Forbidden
  {
    const store = new MemoryStore();
    await seedJob(store, "JC-001", { itemName: "Washer" });
    const unauth = await issueStoreItemToDispatchTx(store, {
      itemName: "Washer",
      issuedBagQty: 1,
      issuedPcsQty: 10,
      issuedKgQty: 1,
      actor: unauthorizedActor(),
      operationId: nextIssueOp("scen14")
    });
    assert("Scenario 14: Non-Store actor rejected with 403 Forbidden", unauth.success === false && unauth.statusCode === 403);
  }

  // SCENARIO 15: Admin / Super Admin authorization succeeds
  {
    const store = new MemoryStore();
    await seedJob(store, "JC-001", { itemName: "Washer" });
    const adminRes = await issueStoreItemToDispatchTx(store, {
      itemName: "Washer",
      issuedBagQty: 1,
      issuedPcsQty: 10,
      issuedKgQty: 1,
      actor: adminActor(),
      operationId: nextIssueOp("scen15")
    });
    assert("Scenario 15: Admin user succeeds in issuing Store stock", adminRes.success === true);
  }

  // SCENARIO 16: Idempotency with exact replay returns cached result
  {
    const store = new MemoryStore();
    await seedJob(store, "JC-001", { itemName: "Washer", unit: "KG", currentQty: 100 });
    const opKey = "dsi-idemp-scen16";
    const first = await issueStoreItemToDispatchTx(store, {
      itemName: "Washer",
      issuedBagQty: 1,
      issuedPcsQty: 10,
      issuedKgQty: 10,
      actor: storeActor(),
      operationId: opKey
    });
    const replay = await issueStoreItemToDispatchTx(store, {
      itemName: "Washer",
      issuedBagQty: 1,
      issuedPcsQty: 10,
      issuedKgQty: 10,
      actor: storeActor(),
      operationId: opKey
    });

    const movements = await store.list("mfr_movements");
    const onHand = storeAuthoritativeOnHand(await store.get("mfr_job_cards", "JC-001"), movements);

    assert(
      "Scenario 16: Replay with identical operationId returns cached response without duplicate deduction",
      first.success === true &&
        replay.success === true &&
        replay.cached === true &&
        replay.data?.issue.id === first.data?.issue.id &&
        onHand === 90 && // deducted exactly once
        movements.length === 2
    );
  }

  // SCENARIO 17: Idempotency key conflict (mismatched payload) returns 409 Conflict
  {
    const store = new MemoryStore();
    await seedJob(store, "JC-001", { itemName: "Washer", unit: "KG", currentQty: 100 });
    const opKey = "dsi-idemp-scen17";
    await issueStoreItemToDispatchTx(store, {
      itemName: "Washer",
      issuedBagQty: 1,
      issuedPcsQty: 10,
      issuedKgQty: 10,
      actor: storeActor(),
      operationId: opKey
    });
    const conflict = await issueStoreItemToDispatchTx(store, {
      itemName: "Washer",
      issuedBagQty: 2, // different quantity with same opKey
      issuedPcsQty: 10,
      issuedKgQty: 10,
      actor: storeActor(),
      operationId: opKey
    });

    assert("Scenario 17: Mismatched payload with same operationId returns 409 Conflict", conflict.success === false && conflict.statusCode === 409);
  }

  // SCENARIO 18: Complete Audit Log emitted
  {
    const store = new MemoryStore();
    await seedJob(store, "JC-001", { itemName: "Clamp", currentQty: 100 });
    await issueStoreItemToDispatchTx(store, {
      itemName: "Clamp",
      issuedBagQty: 1,
      issuedPcsQty: 10,
      issuedKgQty: 5,
      actor: storeActor(),
      operationId: nextIssueOp("scen18")
    });

    const audits = await store.list("mfr_audit_logs");
    assert(
      "Scenario 18: Audit log recorded with action DISPATCH_STORE_ISSUE and item name",
      audits.length >= 1 && audits.some((a) => a.action === "DISPATCH_STORE_ISSUE" && a.details.includes("Clamp"))
    );
  }

  // SCENARIO 19: Requirement creation blocked with 410 Gone
  {
    const store = new MemoryStore();
    const res = await createDispatchStoreRequirementTx(store, {
      jobCardNo: "JC-001",
      requestedQty: 10,
      requestedUnit: "BAG",
      actor: dispatchActor()
    });
    assert("Scenario 19: POST /api/dispatch-store/requirements returns HTTP 410 Gone", res.success === false && res.statusCode === 410);
  }

  // SCENARIO 20: Legacy Job Card with missing packing details handled gracefully (no NaN)
  {
    const store = new MemoryStore();
    await store.set("mfr_job_cards", "JC-LEGACY", {
      jobCardNo: "JC-LEGACY",
      itemName: "Old Part",
      orderQty: 50,
      currentQty: 50,
      currentDepartment: "Store",
      unit: "KG"
    });
    await store.set("mfr_movements", "M-LEGACY", {
      movementId: "M-LEGACY",
      jobCardNo: "JC-LEGACY",
      fromDepartment: "Packing",
      toDepartment: "Store",
      quantity: 50,
      unit: "KG",
      accepted: true
    });

    const stock = calculateStoreJobCardAvailableStock(
      await store.get("mfr_job_cards", "JC-LEGACY"),
      await store.list("mfr_movements"),
      []
    );

    assert(
      "Scenario 20: Legacy Job Card with no packingDetails returns finite numbers (no NaN)",
      stock.availableKg === 50 &&
        stock.availableBags === 0 &&
        stock.availablePcs === 0 &&
        Number.isFinite(stock.availableKg)
    );
  }

  // SCENARIO 21: Item Code secondary filtering
  {
    const store = new MemoryStore();
    await seedJob(store, "JC-CODE-1", { itemName: "Bearing", itemCode: "BRG-A", currentQty: 50 });
    await seedJob(store, "JC-CODE-2", { itemName: "Bearing", itemCode: "BRG-B", currentQty: 60 });

    const stockA = calculateStoreAuthoritativeItemStock(
      "Bearing",
      await store.list("mfr_job_cards"),
      await store.list("mfr_movements"),
      [],
      "BRG-A"
    );

    assert(
      "Scenario 21: Item Code secondary filtering filters to only matching Job Cards",
      stockA.candidateJobCards.length === 1 && stockA.candidateJobCards[0].jobCardNo === "JC-CODE-1"
    );
  }

  // SCENARIO 22: Backward compatibility issueStoreToDispatchTx delegates cleanly
  {
    const store = new MemoryStore();
    await seedJob(store, "JC-BC-1", { itemName: "Shaft", unit: "KG", currentQty: 40 });
    const res = await issueStoreToDispatchTx(store, {
      jobCardNo: "JC-BC-1",
      issuedKgQty: 15,
      issuedBagQty: 1,
      issuedPcsQty: 10,
      actor: storeActor(),
      operationId: nextIssueOp("scen22")
    });

    assert(
      "Scenario 22: Backward compatibility issueStoreToDispatchTx succeeds",
      res.success === true && res.data?.issue.issuedKgQty === 15 && res.data?.movement?.quantity === 15
    );
  }

  // SCENARIO 23: Factory reset policy and client ledger guards exclude mfr_store_unit_stock
  {
    const collections = operationalCollectionsForFactoryReset();
    const purgeCols = liveFactoryResetPurgeCollections();

    assert(
      "Scenario 23: Factory reset policy excludes removed mfr_store_unit_stock",
      collections.includes("mfr_dispatch_store_issues" as any) &&
        !collections.includes("mfr_store_unit_stock" as any) &&
        !collections.includes("mfr_store_unit_openings" as any) &&
        !purgeCols.includes("mfr_store_unit_stock" as any) &&
        isLedgerCollectionBlockedFromClientSync("mfr_dispatch_store_issues") &&
        !isLedgerCollectionBlockedFromClientSync("mfr_store_unit_stock")
    );
  }

  // SCENARIO 24: Production Queue logic remains fully protected and unaffected
  {
    const jobInProd = { jobCardNo: "JC-P1", orderQty: 500, currentDepartment: "Production" };
    const jobInStore = { jobCardNo: "JC-S1", orderQty: 500, currentDepartment: "Store" };
    const eligibleProd = isEligibleForProductionOperationalQueue(jobInProd, []);
    const eligibleStore = isEligibleForProductionOperationalQueue(jobInStore, []);
    assert(
      "Scenario 24: Production queue eligibility logic is unaffected",
      eligibleProd === true && eligibleStore === false
    );
  }

  // SCENARIO 25: SimpleStore and transaction isolation guarantees
  {
    const store = new MemoryStore();
    await seedJob(store, "JC-ISO-1", { itemName: "Spring", unit: "KG", currentQty: 100, totalPcs: 1000, boxCount: 10 });

    const res = await issueStoreItemToDispatchTx(store, {
      itemName: "Spring",
      issuedKgQty: 25,
      issuedBagQty: 2,
      issuedPcsQty: 200,
      actor: storeActor(),
      operationId: nextIssueOp("scen25")
    });

    const movements = await store.list("mfr_movements");
    const issues = await store.list(DISPATCH_STORE_ISSUE_COLLECTION);
    const idempotency = await store.list("mfr_idempotency_keys");

    assert(
      "Scenario 25: Atomic transaction creates issue, movement, and idempotency key consistently",
      res.success === true && movements.length === 2 && issues.length === 1 && idempotency.length === 1
    );
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
