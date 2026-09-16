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
  issueDispatchStoreRequirementTx,
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
  opts?: { unit?: string; currentQty?: number; currentDept?: string }
) {
  const unit = opts?.unit || "PCS";
  const qty = opts?.currentQty !== undefined ? opts.currentQty : 1000;
  const currentDept = opts?.currentDept || "Store";
  await store.set("mfr_job_cards", jobCardNo, {
    jobCardNo,
    itemCode: "ITEM-1",
    itemName: "Widget",
    orderQty: qty,
    currentQty: qty,
    currentDepartment: currentDept,
    unit
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
      createdAt: new Date().toISOString()
    });
  }
}

let issueOpSeq = 0;
function nextIssueOp(label = "auto"): string {
  issueOpSeq += 1;
  return `dsi-test-${label}-${issueOpSeq}`;
}

async function issueDirect(
  store: MemoryStore,
  input: {
    jobCardNo: string;
    issuedBagQty?: unknown;
    issuedPcsQty?: unknown;
    issuedKgQty?: unknown;
    remarks?: string;
    operationId?: string;
    actor?: ReturnType<typeof storeActor>;
  }
) {
  return issueStoreToDispatchTx(store, {
    operationId: input.operationId || nextIssueOp(),
    jobCardNo: input.jobCardNo,
    issuedBagQty: input.issuedBagQty,
    issuedPcsQty: input.issuedPcsQty,
    issuedKgQty: input.issuedKgQty,
    remarks: input.remarks,
    actor: input.actor || storeActor()
  });
}

async function run() {
  console.log("=== DIRECT STORE → DISPATCH MAIN INVENTORY INTEGRATION TEST SUITE ===");

  // SCENARIO 1: Store issues PCS for a PCS native Job Card
  {
    const store = new MemoryStore();
    await seedJob(store, "JC-DS-1", { unit: "PCS", currentQty: 500 });
    const onHandBefore = storeAuthoritativeOnHand(await store.get("mfr_job_cards", "JC-DS-1"), await store.list("mfr_movements"));
    assert("Scenario 1 initial on-hand is 500 PCS", onHandBefore === 500);

    const issue = await issueDirect(store, {
      jobCardNo: "JC-DS-1",
      issuedBagQty: 5,
      issuedPcsQty: 100,
      issuedKgQty: 25
    });

    const movements = await store.list("mfr_movements");
    const outboundMov = movements.find((m) => m.fromDepartment === "Store" && m.toDepartment === "Dispatch");
    const onHandAfter = storeAuthoritativeOnHand(await store.get("mfr_job_cards", "JC-DS-1"), movements);
    const issueRec = await store.get(DISPATCH_STORE_ISSUE_COLLECTION, issue.data?.issue.id!);

    assert(
      "Scenario 1: Store issues PCS native Job Card (PCS deducted, BAG & KG recorded as physical metadata)",
      issue.success === true &&
        onHandAfter === 400 &&
        issueRec.issuedBagQty === 5 &&
        issueRec.issuedPcsQty === 100 &&
        issueRec.issuedKgQty === 25 &&
        issueRec.nativeDeductedQty === 100 &&
        issueRec.nativeUnit === "PCS" &&
        Boolean(outboundMov) &&
        outboundMov?.quantity === 100 &&
        outboundMov?.fromDepartment === "Store" &&
        outboundMov?.toDepartment === "Dispatch"
    );
  }

  // SCENARIO 2: Store issues KG for a KG native Job Card
  {
    const store = new MemoryStore();
    await seedJob(store, "JC-DS-KG", { unit: "KG", currentQty: 250 });
    const issue = await issueDirect(store, {
      jobCardNo: "JC-DS-KG",
      issuedBagQty: 2,
      issuedPcsQty: 50,
      issuedKgQty: 40.5
    });

    const movements = await store.list("mfr_movements");
    const outboundMov = movements.find((m) => m.fromDepartment === "Store" && m.toDepartment === "Dispatch");
    const onHandAfter = storeAuthoritativeOnHand(await store.get("mfr_job_cards", "JC-DS-KG"), movements);
    const issueRec = await store.get(DISPATCH_STORE_ISSUE_COLLECTION, issue.data?.issue.id!);

    assert(
      "Scenario 2: Store issues KG native Job Card (KG deducted from Store on-hand)",
      issue.success === true &&
        onHandAfter === 209.5 &&
        issueRec.issuedBagQty === 2 &&
        issueRec.issuedPcsQty === 50 &&
        issueRec.issuedKgQty === 40.5 &&
        issueRec.nativeDeductedQty === 40.5 &&
        Boolean(outboundMov) &&
        outboundMov?.quantity === 40.5
    );
  }

  // SCENARIO 3: Store issues BAG for a BAG native Job Card
  {
    const store = new MemoryStore();
    await seedJob(store, "JC-DS-BAG", { unit: "BAG", currentQty: 50 });
    const issue = await issueDirect(store, {
      jobCardNo: "JC-DS-BAG",
      issuedBagQty: 10,
      issuedPcsQty: 100,
      issuedKgQty: 50
    });

    const movements = await store.list("mfr_movements");
    const outboundMov = movements.find((m) => m.fromDepartment === "Store" && m.toDepartment === "Dispatch");
    const onHandAfter = storeAuthoritativeOnHand(await store.get("mfr_job_cards", "JC-DS-BAG"), movements);
    const issueRec = await store.get(DISPATCH_STORE_ISSUE_COLLECTION, issue.data?.issue.id!);

    assert(
      "Scenario 3: Store issues BAG native Job Card (BAG deducted from Store on-hand)",
      issue.success === true &&
        onHandAfter === 40 &&
        issueRec.issuedBagQty === 10 &&
        issueRec.nativeDeductedQty === 10 &&
        Boolean(outboundMov) &&
        outboundMov?.quantity === 10
    );
  }

  // SCENARIO 4: Over-issuance in native unit fails with 409 Conflict (0 deductions, 0 writes)
  {
    const store = new MemoryStore();
    await seedJob(store, "JC-DS-1", { unit: "PCS", currentQty: 100 });
    const issue = await issueDirect(store, {
      jobCardNo: "JC-DS-1",
      issuedBagQty: 10,
      issuedPcsQty: 150, // exceeds 100
      issuedKgQty: 20
    });

    const movements = await store.list("mfr_movements");
    const issues = await store.list(DISPATCH_STORE_ISSUE_COLLECTION);
    const onHandAfter = storeAuthoritativeOnHand(await store.get("mfr_job_cards", "JC-DS-1"), movements);

    assert(
      "Scenario 4: Over-issuance returns 409 Conflict and leaves inventory untouched",
      issue.success === false &&
        issue.statusCode === 409 &&
        onHandAfter === 100 &&
        movements.length === 1 &&
        issues.length === 0
    );
  }

  // SCENARIO 5: Zero entered for native unit (physical only) creates 0-qty movement without deducting native stock
  {
    const store = new MemoryStore();
    await seedJob(store, "JC-DS-1", { unit: "PCS", currentQty: 200 });
    const issue = await issueDirect(store, {
      jobCardNo: "JC-DS-1",
      issuedBagQty: 10,
      issuedPcsQty: 0, // 0 PCS for a PCS job card
      issuedKgQty: 50
    });

    const movements = await store.list("mfr_movements");
    const outboundMov = movements.find((m) => m.fromDepartment === "Store" && m.toDepartment === "Dispatch");
    const onHandAfter = storeAuthoritativeOnHand(await store.get("mfr_job_cards", "JC-DS-1"), movements);
    const issueRec = await store.get(DISPATCH_STORE_ISSUE_COLLECTION, issue.data?.issue.id!);

    assert(
      "Scenario 5: 0 native unit entered records physical breakdown and leaves on-hand stock intact",
      issue.success === true &&
        onHandAfter === 200 &&
        issueRec.issuedBagQty === 10 &&
        issueRec.issuedPcsQty === 0 &&
        issueRec.issuedKgQty === 50 &&
        issueRec.nativeDeductedQty === 0 &&
        Boolean(outboundMov) &&
        outboundMov?.quantity === 0
    );
  }

  // SCENARIO 6: All-zero quantities rejected with 400
  {
    const store = new MemoryStore();
    await seedJob(store, "JC-DS-1", { unit: "PCS", currentQty: 200 });
    const issue = await issueDirect(store, {
      jobCardNo: "JC-DS-1",
      issuedBagQty: 0,
      issuedPcsQty: 0,
      issuedKgQty: 0
    });
    assert(
      "Scenario 6: All-zero quantities rejected with 400",
      issue.success === false && issue.statusCode === 400
    );
  }

  // SCENARIO 7: Negative and non-numeric quantities rejected with 400
  {
    const store = new MemoryStore();
    await seedJob(store, "JC-DS-1");
    const neg = await issueDirect(store, {
      jobCardNo: "JC-DS-1",
      issuedBagQty: -5,
      issuedPcsQty: 10,
      issuedKgQty: 0
    });
    const nan = await issueDirect(store, {
      jobCardNo: "JC-DS-1",
      issuedBagQty: "abc",
      issuedPcsQty: 10,
      issuedKgQty: 0
    });
    assert(
      "Scenario 7: Negative and non-numeric quantities return 400",
      neg.success === false && neg.statusCode === 400 && nan.success === false && nan.statusCode === 400
    );
  }

  // SCENARIO 8: Authorization checks (Store & Admin allowed; other departments rejected)
  {
    const store = new MemoryStore();
    await seedJob(store, "JC-DS-1", { currentQty: 500 });
    const unauth = await issueDirect(store, {
      jobCardNo: "JC-DS-1",
      issuedBagQty: 1,
      issuedPcsQty: 10,
      issuedKgQty: 0,
      actor: unauthorizedActor()
    });
    const admin = await issueDirect(store, {
      jobCardNo: "JC-DS-1",
      issuedBagQty: 1,
      issuedPcsQty: 10,
      issuedKgQty: 0,
      actor: adminActor()
    });
    assert(
      "Scenario 8: Only Store and Admin are authorized to issue to Dispatch",
      unauth.success === false && unauth.statusCode === 403 && admin.success === true
    );
  }

  // SCENARIO 9: Idempotency with operationId (exact retry returns cached; mismatched payload returns 409)
  {
    const store = new MemoryStore();
    await seedJob(store, "JC-DS-1", { currentQty: 500 });
    const op = "dsi-idemp-test-1";
    const first = await issueDirect(store, {
      jobCardNo: "JC-DS-1",
      issuedBagQty: 2,
      issuedPcsQty: 20,
      issuedKgQty: 5,
      operationId: op
    });
    const retrySame = await issueDirect(store, {
      jobCardNo: "JC-DS-1",
      issuedBagQty: 2,
      issuedPcsQty: 20,
      issuedKgQty: 5,
      operationId: op
    });
    const retryDiff = await issueDirect(store, {
      jobCardNo: "JC-DS-1",
      issuedBagQty: 3, // different payload with same op
      issuedPcsQty: 20,
      issuedKgQty: 5,
      operationId: op
    });

    const movements = await store.list("mfr_movements");
    const onHandAfter = storeAuthoritativeOnHand(await store.get("mfr_job_cards", "JC-DS-1"), movements);

    assert(
      "Scenario 9: Idempotency protects against duplicate deductions and payload hijacking",
      first.success === true &&
        retrySame.success === true &&
        retrySame.cached === true &&
        retrySame.data?.issue.id === first.data?.issue.id &&
        retryDiff.success === false &&
        retryDiff.statusCode === 409 &&
        onHandAfter === 480 && // 500 - 20 = 480 (deducted exactly once)
        movements.length === 2
    );
  }

  // SCENARIO 10: Non-existent Job Card returns 404
  {
    const store = new MemoryStore();
    const issue = await issueDirect(store, {
      jobCardNo: "JC-NON-EXISTENT",
      issuedBagQty: 1,
      issuedPcsQty: 1,
      issuedKgQty: 1
    });
    assert(
      "Scenario 10: Non-existent Job Card returns 404",
      issue.success === false && issue.statusCode === 404
    );
  }

  // SCENARIO 11: Audit log recorded in mfr_audit_logs
  {
    const store = new MemoryStore();
    await seedJob(store, "JC-DS-1", { currentQty: 300 });
    await issueDirect(store, {
      jobCardNo: "JC-DS-1",
      issuedBagQty: 2,
      issuedPcsQty: 50,
      issuedKgQty: 12
    });
    const audits = await store.list("mfr_audit_logs");
    assert(
      "Scenario 11: Audit log recorded in mfr_audit_logs with action DISPATCH_STORE_ISSUE",
      audits.length >= 1 &&
        audits.some((a) => a.action === "DISPATCH_STORE_ISSUE" && a.details.includes("JC-DS-1"))
    );
  }

  // SCENARIO 12: Requirement creation blocked with 410 Gone
  {
    const store = new MemoryStore();
    const res = await createDispatchStoreRequirementTx(store, {
      jobCardNo: "JC-DS-1",
      requestedQty: 10,
      requestedUnit: "BAG",
      actor: dispatchActor()
    });
    assert(
      "Scenario 12: Dispatch → Store requirement creation returns HTTP 410 Gone",
      res.success === false && res.statusCode === 410
    );
  }

  // SCENARIO 13: Factory reset policy and client ledger guards exclude mfr_store_unit_stock
  {
    const store = new MemoryStore();
    await seedJob(store, "JC-DS-1");
    const collections = operationalCollectionsForFactoryReset();
    const purgeCols = liveFactoryResetPurgeCollections();

    assert(
      "Scenario 13: Operational reset collections contain mfr_dispatch_store_issues and exclude mfr_store_unit_stock",
      collections.includes("mfr_dispatch_store_issues" as any) &&
        !collections.includes("mfr_store_unit_stock" as any) &&
        !collections.includes("mfr_store_unit_openings" as any) &&
        !purgeCols.includes("mfr_store_unit_stock" as any) &&
        isLedgerCollectionBlockedFromClientSync("mfr_dispatch_store_issues") &&
        !isLedgerCollectionBlockedFromClientSync("mfr_store_unit_stock")
    );
  }

  // SCENARIO 14: Production Queue logic remains fully protected and unaffected
  {
    const jobInProd = { jobCardNo: "JC-P1", orderQty: 500, currentDepartment: "Production" };
    const jobInStore = { jobCardNo: "JC-S1", orderQty: 500, currentDepartment: "Store" };
    const eligibleProd = isEligibleForProductionOperationalQueue(jobInProd, []);
    const eligibleStore = isEligibleForProductionOperationalQueue(jobInStore, []);
    assert(
      "Scenario 14: Production queue eligibility logic is unchanged",
      eligibleProd === true && eligibleStore === false
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
