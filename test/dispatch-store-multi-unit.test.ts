import { MemoryStore } from "../src/hardening/memoryStore";
import { commitMaterialMovementTx } from "../src/hardening/commitMaterialMovement";
import {
  storeAuthoritativeOnHand,
  isEligibleForProductionOperationalQueue,
  isRoutedAwayFromProductionQueue
} from "../src/hardening/process2Manufacturing";
import {
  applyStoreUnitOpeningTx,
  createDispatchStoreRequirementTx,
  issueStoreToDispatchTx,
  issueDispatchStoreRequirementTx,
  DISPATCH_STORE_ISSUE_COLLECTION,
  DISPATCH_STORE_REQUIREMENT_COLLECTION,
  STORE_UNIT_STOCK_COLLECTION,
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

async function seedJob(store: MemoryStore, jobCardNo = "JC-DS-1") {
  await store.set("mfr_job_cards", jobCardNo, {
    jobCardNo,
    itemCode: "ITEM-1",
    itemName: "Widget",
    orderQty: 1000,
    currentQty: 1000,
    currentDepartment: "Store",
    unit: "PCS"
  });
}

async function seedStock(
  store: MemoryStore,
  jobCardNo: string,
  bagQty: number,
  pcsQty: number,
  kgQty: number
) {
  const r = await applyStoreUnitOpeningTx(store, {
    jobCardNo,
    bagQty,
    pcsQty,
    kgQty,
    actor: storeActor()
  });
  if (!r.success) throw new Error(r.error);
  return r.data!.stock;
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
  console.log("=== DIRECT STORE → DISPATCH MULTI-UNIT MATERIAL ISSUE TEST SUITE ===");

  // SCENARIO 1: Store issues only BAG
  {
    const store = new MemoryStore();
    await seedJob(store);
    await seedStock(store, "JC-DS-1", 100, 50, 20);
    const issue = await issueDirect(store, {
      jobCardNo: "JC-DS-1",
      issuedBagQty: 40,
      issuedPcsQty: 0,
      issuedKgQty: 0
    });
    const stock = await store.get(STORE_UNIT_STOCK_COLLECTION, "JC-DS-1");
    assert(
      "Scenario 1: Store issues only BAG",
      issue.success === true &&
        stock.bagQty === 60 &&
        stock.pcsQty === 50 &&
        stock.kgQty === 20 &&
        issue.data?.issue.issuedBagQty === 40 &&
        issue.data?.issue.issuedPcsQty === 0 &&
        issue.data?.issue.issuedKgQty === 0
    );
  }

  // SCENARIO 2: Store issues only PCS
  {
    const store = new MemoryStore();
    await seedJob(store);
    await seedStock(store, "JC-DS-1", 100, 200, 50);
    const issue = await issueDirect(store, {
      jobCardNo: "JC-DS-1",
      issuedBagQty: 0,
      issuedPcsQty: 75,
      issuedKgQty: 0
    });
    const stock = await store.get(STORE_UNIT_STOCK_COLLECTION, "JC-DS-1");
    assert(
      "Scenario 2: Store issues only PCS",
      issue.success === true &&
        stock.bagQty === 100 &&
        stock.pcsQty === 125 &&
        stock.kgQty === 50 &&
        issue.data?.issue.issuedPcsQty === 75
    );
  }

  // SCENARIO 3: Store issues only KG
  {
    const store = new MemoryStore();
    await seedJob(store);
    await seedStock(store, "JC-DS-1", 50, 50, 80);
    const issue = await issueDirect(store, {
      jobCardNo: "JC-DS-1",
      issuedBagQty: 0,
      issuedPcsQty: 0,
      issuedKgQty: 25
    });
    const stock = await store.get(STORE_UNIT_STOCK_COLLECTION, "JC-DS-1");
    assert(
      "Scenario 3: Store issues only KG",
      issue.success === true &&
        stock.bagQty === 50 &&
        stock.pcsQty === 50 &&
        stock.kgQty === 55 &&
        issue.data?.issue.issuedKgQty === 25
    );
  }

  // SCENARIO 4: Store issues BAG + PCS
  {
    const store = new MemoryStore();
    await seedJob(store);
    await seedStock(store, "JC-DS-1", 100, 200, 50);
    const issue = await issueDirect(store, {
      jobCardNo: "JC-DS-1",
      issuedBagQty: 30,
      issuedPcsQty: 50,
      issuedKgQty: 0
    });
    const stock = await store.get(STORE_UNIT_STOCK_COLLECTION, "JC-DS-1");
    assert(
      "Scenario 4: Store issues BAG + PCS",
      issue.success === true &&
        stock.bagQty === 70 &&
        stock.pcsQty === 150 &&
        stock.kgQty === 50
    );
  }

  // SCENARIO 5: Store issues BAG + KG
  {
    const store = new MemoryStore();
    await seedJob(store);
    await seedStock(store, "JC-DS-1", 100, 200, 50);
    const issue = await issueDirect(store, {
      jobCardNo: "JC-DS-1",
      issuedBagQty: 20,
      issuedPcsQty: 0,
      issuedKgQty: 15
    });
    const stock = await store.get(STORE_UNIT_STOCK_COLLECTION, "JC-DS-1");
    assert(
      "Scenario 5: Store issues BAG + KG",
      issue.success === true &&
        stock.bagQty === 80 &&
        stock.pcsQty === 200 &&
        stock.kgQty === 35
    );
  }

  // SCENARIO 6: Store issues PCS + KG
  {
    const store = new MemoryStore();
    await seedJob(store);
    await seedStock(store, "JC-DS-1", 100, 200, 50);
    const issue = await issueDirect(store, {
      jobCardNo: "JC-DS-1",
      issuedBagQty: 0,
      issuedPcsQty: 40,
      issuedKgQty: 10
    });
    const stock = await store.get(STORE_UNIT_STOCK_COLLECTION, "JC-DS-1");
    assert(
      "Scenario 6: Store issues PCS + KG",
      issue.success === true &&
        stock.bagQty === 100 &&
        stock.pcsQty === 160 &&
        stock.kgQty === 40
    );
  }

  // SCENARIO 7: Store issues BAG + PCS + KG
  {
    const store = new MemoryStore();
    await seedJob(store);
    await seedStock(store, "JC-DS-1", 100, 500, 80);
    const issue = await issueDirect(store, {
      jobCardNo: "JC-DS-1",
      issuedBagQty: 20,
      issuedPcsQty: 100,
      issuedKgQty: 30
    });
    const stock = await store.get(STORE_UNIT_STOCK_COLLECTION, "JC-DS-1");
    assert(
      "Scenario 7: Store issues BAG + PCS + KG",
      issue.success === true &&
        stock.bagQty === 80 &&
        stock.pcsQty === 400 &&
        stock.kgQty === 50 &&
        issue.data?.issue.issuedBagQty === 20 &&
        issue.data?.issue.issuedPcsQty === 100 &&
        issue.data?.issue.issuedKgQty === 30
    );
  }

  // SCENARIO 8: No unit conversion
  {
    const store = new MemoryStore();
    await seedJob(store);
    await seedStock(store, "JC-DS-1", 10, 1000, 50);
    await issueDirect(store, { jobCardNo: "JC-DS-1", issuedBagQty: 5 });
    let stock = await store.get(STORE_UNIT_STOCK_COLLECTION, "JC-DS-1");
    const bagIndependent = stock.bagQty === 5 && stock.pcsQty === 1000 && stock.kgQty === 50;

    await issueDirect(store, { jobCardNo: "JC-DS-1", issuedPcsQty: 250 });
    stock = await store.get(STORE_UNIT_STOCK_COLLECTION, "JC-DS-1");
    const pcsIndependent = stock.bagQty === 5 && stock.pcsQty === 750 && stock.kgQty === 50;

    await issueDirect(store, { jobCardNo: "JC-DS-1", issuedKgQty: 20 });
    stock = await store.get(STORE_UNIT_STOCK_COLLECTION, "JC-DS-1");
    const kgIndependent = stock.bagQty === 5 && stock.pcsQty === 750 && stock.kgQty === 30;

    assert(
      "Scenario 8: No unit conversion (BAG, PCS, KG are strictly independent)",
      bagIndependent && pcsIndependent && kgIndependent
    );
  }

  // SCENARIO 9: BAG > stock → entire tx fails (0 deducted)
  {
    const store = new MemoryStore();
    await seedJob(store);
    await seedStock(store, "JC-DS-1", 10, 100, 50);
    const issue = await issueDirect(store, {
      jobCardNo: "JC-DS-1",
      issuedBagQty: 11,
      issuedPcsQty: 50,
      issuedKgQty: 20
    });
    const stock = await store.get(STORE_UNIT_STOCK_COLLECTION, "JC-DS-1");
    const issues = await store.list(DISPATCH_STORE_ISSUE_COLLECTION);
    assert(
      "Scenario 9: BAG > stock → entire tx fails (0 deducted across all units)",
      issue.success === false &&
        issue.statusCode === 409 &&
        stock.bagQty === 10 &&
        stock.pcsQty === 100 &&
        stock.kgQty === 50 &&
        issues.length === 0
    );
  }

  // SCENARIO 10: PCS > stock → entire tx fails (0 deducted)
  {
    const store = new MemoryStore();
    await seedJob(store);
    await seedStock(store, "JC-DS-1", 100, 20, 50);
    const issue = await issueDirect(store, {
      jobCardNo: "JC-DS-1",
      issuedBagQty: 10,
      issuedPcsQty: 25,
      issuedKgQty: 10
    });
    const stock = await store.get(STORE_UNIT_STOCK_COLLECTION, "JC-DS-1");
    const issues = await store.list(DISPATCH_STORE_ISSUE_COLLECTION);
    assert(
      "Scenario 10: PCS > stock → entire tx fails (0 deducted across all units)",
      issue.success === false &&
        issue.statusCode === 409 &&
        stock.bagQty === 100 &&
        stock.pcsQty === 20 &&
        stock.kgQty === 50 &&
        issues.length === 0
    );
  }

  // SCENARIO 11: KG > stock → entire tx fails (0 deducted)
  {
    const store = new MemoryStore();
    await seedJob(store);
    await seedStock(store, "JC-DS-1", 100, 100, 5);
    const issue = await issueDirect(store, {
      jobCardNo: "JC-DS-1",
      issuedBagQty: 10,
      issuedPcsQty: 10,
      issuedKgQty: 6
    });
    const stock = await store.get(STORE_UNIT_STOCK_COLLECTION, "JC-DS-1");
    const issues = await store.list(DISPATCH_STORE_ISSUE_COLLECTION);
    assert(
      "Scenario 11: KG > stock → entire tx fails (0 deducted across all units)",
      issue.success === false &&
        issue.statusCode === 409 &&
        stock.bagQty === 100 &&
        stock.pcsQty === 100 &&
        stock.kgQty === 5 &&
        issues.length === 0
    );
  }

  // SCENARIO 12: Atomic rollback on failure
  {
    class AbortStore extends MemoryStore {
      async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
        const pending = new Map<string, { collection: string; id: string; data: any }>();
        const keyOf = (collection: string, id: string) => `${collection}\0${id}`;
        const tx = {
          get: async (collection: string, id: string) => {
            const hit = pending.get(keyOf(collection, id));
            if (hit) return JSON.parse(JSON.stringify(hit.data));
            return this.get(collection, id);
          },
          set: (collection: string, id: string, data: any) => {
            pending.set(keyOf(collection, id), { collection, id, data: JSON.parse(JSON.stringify(data)) });
          }
        };
        await fn(tx);
        throw new Error("simulated-mid-tx-abort");
      }
    }
    const store = new AbortStore();
    await seedJob(store);
    await seedStock(store, "JC-DS-1", 50, 40, 30);
    let threw = false;
    try {
      await issueDirect(store, {
        jobCardNo: "JC-DS-1",
        issuedBagQty: 5,
        issuedPcsQty: 4,
        issuedKgQty: 3
      });
    } catch {
      threw = true;
    }
    const stock = await store.get(STORE_UNIT_STOCK_COLLECTION, "JC-DS-1");
    const issues = await store.list(DISPATCH_STORE_ISSUE_COLLECTION);
    const auditLogs = await store.list("mfr_audit_logs");
    assert(
      "Scenario 12: Atomic rollback leaves stock, issues, and audit logs untouched",
      threw &&
        stock.bagQty === 50 &&
        stock.pcsQty === 40 &&
        stock.kgQty === 30 &&
        issues.length === 0 &&
        auditLogs.filter((a) => a.action === "DISPATCH_STORE_ISSUE").length === 0
    );
  }

  // SCENARIO 13: Duplicate operationId does not issue twice (cached)
  {
    const store = new MemoryStore();
    await seedJob(store);
    await seedStock(store, "JC-DS-1", 100, 100, 100);
    const opId = "dsi-idempotent-replay-001";
    const res1 = await issueDirect(store, {
      jobCardNo: "JC-DS-1",
      issuedBagQty: 10,
      issuedPcsQty: 20,
      issuedKgQty: 5,
      operationId: opId
    });
    const res2 = await issueDirect(store, {
      jobCardNo: "JC-DS-1",
      issuedBagQty: 10,
      issuedPcsQty: 20,
      issuedKgQty: 5,
      operationId: opId
    });
    const stock = await store.get(STORE_UNIT_STOCK_COLLECTION, "JC-DS-1");
    const issues = await store.list(DISPATCH_STORE_ISSUE_COLLECTION);

    const resMismatched = await issueDirect(store, {
      jobCardNo: "JC-DS-1",
      issuedBagQty: 99,
      issuedPcsQty: 0,
      issuedKgQty: 0,
      operationId: opId
    });

    assert(
      "Scenario 13: Duplicate operationId does not issue twice (cached result returned, single deduction)",
      res1.success === true &&
        res2.success === true &&
        res2.cached === true &&
        res2.data?.issue.id === res1.data?.issue.id &&
        stock.bagQty === 90 &&
        stock.pcsQty === 80 &&
        stock.kgQty === 95 &&
        issues.length === 1 &&
        resMismatched.success === false &&
        resMismatched.statusCode === 409
    );
  }

  // SCENARIO 14: Correct ledger creation (mfr_dispatch_store_issues + mfr_audit_logs)
  {
    const store = new MemoryStore();
    await seedJob(store, "JC-LEDGER-1");
    await seedStock(store, "JC-LEDGER-1", 50, 100, 40);
    const res = await issueDirect(store, {
      jobCardNo: "JC-LEDGER-1",
      issuedBagQty: 12,
      issuedPcsQty: 34,
      issuedKgQty: 15,
      remarks: "Urgent dispatch batch A",
      operationId: "op-ledger-audit-001"
    });
    const issueDoc = await store.get(DISPATCH_STORE_ISSUE_COLLECTION, res.data!.issue.id);
    const auditLogs = await store.list("mfr_audit_logs");
    const issueAudit = auditLogs.find((a) => a.action === "DISPATCH_STORE_ISSUE");
    assert(
      "Scenario 14: Correct ledger creation (mfr_dispatch_store_issues + mfr_audit_logs)",
      Boolean(issueDoc) &&
        issueDoc.jobCardNo === "JC-LEDGER-1" &&
        issueDoc.fromDepartment === "Store" &&
        issueDoc.toDepartment === "Dispatch" &&
        issueDoc.issuedBagQty === 12 &&
        issueDoc.issuedPcsQty === 34 &&
        issueDoc.issuedKgQty === 15 &&
        issueDoc.remarks === "Urgent dispatch batch A" &&
        issueDoc.issuedBy === "Store User" &&
        Boolean(issueAudit) &&
        issueAudit.details.includes("JC-LEDGER-1") &&
        issueAudit.details.includes("BAG 12")
    );
  }

  // SCENARIO 15: Correct Store → Dispatch movement
  {
    const store = new MemoryStore();
    await seedJob(store, "JC-MOV-1");
    const inbound = {
      movementId: "M-IN-1",
      jobCardNo: "JC-MOV-1",
      fromDepartment: "Packing",
      toDepartment: "Store",
      quantity: 500,
      accepted: true
    };
    await store.set("mfr_movements", "M-IN-1", inbound);
    const job = await store.get("mfr_job_cards", "JC-MOV-1");
    const onHandBefore = storeAuthoritativeOnHand(job, [inbound]);

    await seedStock(store, "JC-MOV-1", 50, 500, 40);
    const res = await issueDirect(store, {
      jobCardNo: "JC-MOV-1",
      issuedBagQty: 10,
      issuedPcsQty: 100,
      issuedKgQty: 10
    });
    const movements = await store.list("mfr_movements");
    const onHandAfter = storeAuthoritativeOnHand(job, movements);

    assert(
      "Scenario 15: Direct issue has fromDepartment=Store, toDepartment=Dispatch, and leaves legacy movements untouched",
      res.data?.issue.fromDepartment === "Store" &&
        res.data?.issue.toDepartment === "Dispatch" &&
        movements.length === 1 &&
        onHandBefore === 500 &&
        onHandAfter === 500
    );
  }

  // SCENARIO 16: Correct Dispatch display / query simulation
  {
    const store = new MemoryStore();
    await seedJob(store, "JC-DISP-1");
    await seedStock(store, "JC-DISP-1", 100, 500, 100);
    await issueDirect(store, { jobCardNo: "JC-DISP-1", issuedBagQty: 10, issuedPcsQty: 100, issuedKgQty: 20 });
    await issueDirect(store, { jobCardNo: "JC-DISP-1", issuedBagQty: 15, issuedPcsQty: 50, issuedKgQty: 10 });

    const allIssues = await store.list(DISPATCH_STORE_ISSUE_COLLECTION);
    const dispatchIssues = allIssues.filter(
      (iss) => iss.toDepartment === "Dispatch" && iss.jobCardNo === "JC-DISP-1"
    );
    const totalBag = dispatchIssues.reduce((s, i) => s + (Number(i.issuedBagQty) || 0), 0);
    const totalPcs = dispatchIssues.reduce((s, i) => s + (Number(i.issuedPcsQty) || 0), 0);
    const totalKg = dispatchIssues.reduce((s, i) => s + (Number(i.issuedKgQty) || 0), 0);

    assert(
      "Scenario 16: Correct Dispatch display (aggregates received issues accurately: 25 BAG, 150 PCS, 30 KG)",
      dispatchIssues.length === 2 && totalBag === 25 && totalPcs === 150 && totalKg === 30
    );
  }

  // SCENARIO 17: Unauthorized user rejected (403)
  {
    const store = new MemoryStore();
    await seedJob(store);
    await seedStock(store, "JC-DS-1", 100, 100, 100);

    const deniedCutting = await issueDirect(store, {
      jobCardNo: "JC-DS-1",
      issuedBagQty: 5,
      actor: unauthorizedActor()
    });

    const deniedDispatch = await issueDirect(store, {
      jobCardNo: "JC-DS-1",
      issuedBagQty: 5,
      actor: dispatchActor()
    });

    assert(
      "Scenario 17: Unauthorized user rejected with 403 (Cutting and Dispatch cannot issue from Store)",
      deniedCutting.success === false &&
        deniedCutting.statusCode === 403 &&
        deniedDispatch.success === false &&
        deniedDispatch.statusCode === 403
    );
  }

  // SCENARIO 18: Zero / negative / non-numeric quantities rejected (400)
  {
    const store = new MemoryStore();
    await seedJob(store);
    await seedStock(store, "JC-DS-1", 100, 100, 100);

    const zeroIssue = await issueDirect(store, {
      jobCardNo: "JC-DS-1",
      issuedBagQty: 0,
      issuedPcsQty: 0,
      issuedKgQty: 0
    });
    const negativeIssue = await issueDirect(store, {
      jobCardNo: "JC-DS-1",
      issuedBagQty: -5,
      issuedPcsQty: 0,
      issuedKgQty: 0
    });
    const nonNumericIssue = await issueDirect(store, {
      jobCardNo: "JC-DS-1",
      issuedBagQty: "abc",
      issuedPcsQty: 0,
      issuedKgQty: 0
    });
    const missingJobIssue = await issueDirect(store, {
      jobCardNo: "JC-NON-EXISTENT",
      issuedBagQty: 5
    });

    assert(
      "Scenario 18: Zero, negative, non-numeric, and non-existent job issues rejected with 400/404",
      zeroIssue.success === false &&
        zeroIssue.statusCode === 400 &&
        negativeIssue.success === false &&
        negativeIssue.statusCode === 400 &&
        nonNumericIssue.success === false &&
        nonNumericIssue.statusCode === 400 &&
        missingJobIssue.success === false &&
        missingJobIssue.statusCode === 404
    );
  }

  // SCENARIO 19: Old Dispatch → Store requirement creation is unavailable (410)
  {
    const store = new MemoryStore();
    await seedJob(store);
    const reqRes = await createDispatchStoreRequirementTx(store, {
      jobCardNo: "JC-DS-1",
      requestedQty: 10,
      requestedUnit: "BAG",
      actor: dispatchActor()
    });

    assert(
      "Scenario 19: Old Dispatch → Store requirement creation is unavailable (returns 410 Gone)",
      reqRes.success === false &&
        reqRes.statusCode === 410 &&
        reqRes.error?.includes("Dispatch → Store requirement creation has been removed")
    );
  }

    // SCENARIO 20: Existing Production Queue behavior remains unchanged
  {
    const purchaseJob = {
      jobCardNo: "JC-PURCHASE-1",
      orderQty: 500,
      currentQty: 500,
      currentDepartment: "Production",
      processType: "Purchase"
    };

    // Movement from Purchase to Plating (accepted)
    const movPlating = [
      {
        movementId: "M-PUR-1",
        jobCardNo: "JC-PURCHASE-1",
        fromDepartment: "Purchase",
        toDepartment: "Plating",
        quantity: 500,
        accepted: true
      }
    ];
    const hasAwayPlating = isRoutedAwayFromProductionQueue(purchaseJob, movPlating);
    const eligPlating = isEligibleForProductionOperationalQueue(purchaseJob, movPlating);

    // Movement from Purchase to HT (pending)
    const movHT = [
      {
        movementId: "M-PUR-2",
        jobCardNo: "JC-PURCHASE-1",
        fromDepartment: "Purchase",
        toDepartment: "Heat Treatment",
        quantity: 500,
        accepted: false
      }
    ];
    const hasAwayHT = isRoutedAwayFromProductionQueue(purchaseJob, movHT);
    const eligHT = isEligibleForProductionOperationalQueue(purchaseJob, movHT);

    // Movement from Purchase to Store (accepted)
    const movStore = [
      {
        movementId: "M-PUR-3",
        jobCardNo: "JC-PURCHASE-1",
        fromDepartment: "Purchase",
        toDepartment: "Store",
        quantity: 500,
        accepted: true
      }
    ];
    const hasAwayStore = isRoutedAwayFromProductionQueue(purchaseJob, movStore);
    const eligStore = isEligibleForProductionOperationalQueue(purchaseJob, movStore);

    // Normal production job
    const prodJob = {
      jobCardNo: "JC-PROD-1",
      orderQty: 500,
      currentQty: 500,
      currentDepartment: "Production",
      processType: "In-house"
    };
    const eligProd = isEligibleForProductionOperationalQueue(prodJob, []);

    assert(
      "Scenario 20: Existing Production Queue behavior remains unchanged (Purchase routed away excluded, normal prod included)",
      hasAwayPlating === true &&
        eligPlating === false &&
        hasAwayHT === true &&
        eligHT === false &&
        hasAwayStore === true &&
        eligStore === false &&
        eligProd === true
    );
  }

  // ADDITIONAL HARDENING CHECKS
  {
    assert(
      "Hardening: Client sync queue blocks independent-unit collections",
      isLedgerCollectionBlockedFromClientSync("mfr_store_unit_stock") &&
        isLedgerCollectionBlockedFromClientSync("mfr_dispatch_store_issues") &&
        isLedgerCollectionBlockedFromClientSync("mfr_store_unit_openings")
    );
    assert(
      "Hardening: Factory reset purge lists include all independent-unit collections",
      DISPATCH_STORE_UNIT_LEDGER_COLLECTIONS.every((c) => liveFactoryResetPurgeCollections().includes(c)) &&
        DISPATCH_STORE_UNIT_LEDGER_COLLECTIONS.every((c) => liveFactoryDeleteAllPurgeCollections().includes(c)) &&
        DISPATCH_STORE_UNIT_LEDGER_COLLECTIONS.every((c) => operationalCollectionsForFactoryReset().includes(c))
    );

    const store = new MemoryStore();
    await store.set("mfr_users", "super-1", { userId: "super-1", role: "super_admin", name: "Boss", active: true });
    await store.set("mfr_user_credentials", "super-1", { pinHash: "hash" });
    await store.set("mfr_users", "staff-1", { userId: "staff-1", role: "staff", name: "Staff" });
    await seedJob(store, "JC-RESET");
    await seedStock(store, "JC-RESET", 12, 8, 3);
    await issueDirect(store, { jobCardNo: "JC-RESET", issuedBagQty: 2 });
    const resetOut = await applyFactoryResetToStore(store, "gen-ds-reset");
    const leftover = await Promise.all(DISPATCH_STORE_UNIT_LEDGER_COLLECTIONS.map((c) => store.list(c)));
    const usersAfter = await store.list("mfr_users");
    assert(
      "Hardening: Factory reset purges unit collections while preserving super_admin",
      leftover.every((rows) => rows.length === 0) &&
        resetOut.preservedSuperAdmins.length === 1 &&
        usersAfter.some((u) => u.role === "super_admin" && u.userId === "super-1")
    );
  }

  console.log(`\nDirect Store → Dispatch tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
