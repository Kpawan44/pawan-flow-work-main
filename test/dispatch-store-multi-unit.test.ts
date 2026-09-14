import { MemoryStore } from "../src/hardening/memoryStore";
import { commitMaterialMovementTx } from "../src/hardening/commitMaterialMovement";
import { storeAuthoritativeOnHand } from "../src/hardening/process2Manufacturing";
import {
  applyStoreUnitOpeningTx,
  createDispatchStoreRequirementTx,
  DISPATCH_STORE_ISSUE_COLLECTION,
  DISPATCH_STORE_REQUIREMENT_COLLECTION,
  issueDispatchStoreRequirementTx,
  STORE_UNIT_STOCK_COLLECTION
} from "../src/hardening/dispatchStoreIssue";
import { isLedgerCollectionBlockedFromClientSync } from "../src/hardening/clientLedgerGuards";
import { operationalCollectionsForFactoryReset } from "../src/hardening/factoryResetPolicy";

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

async function makeReq(
  store: MemoryStore,
  jobCardNo: string,
  requestedQty: number,
  requestedUnit: "BAG" | "PCS" | "KG"
) {
  const r = await createDispatchStoreRequirementTx(store, {
    jobCardNo,
    requestedQty,
    requestedUnit,
    actor: dispatchActor()
  });
  if (!r.success) throw new Error(r.error);
  return r.data!.requirement;
}

async function run() {
  console.log("=== DISPATCH → STORE INDEPENDENT MULTI-UNIT INVENTORY ===");

  {
    const store = new MemoryStore();
    await seedJob(store);
    await seedStock(store, "JC-DS-1", 100, 0, 0);
    const req = await makeReq(store, "JC-DS-1", 40, "BAG");
    const issue = await issueDispatchStoreRequirementTx(store, {
      requirementId: req.id,
      issuedBagQty: 40,
      actor: storeActor()
    });
    const stock = await store.get(STORE_UNIT_STOCK_COLLECTION, "JC-DS-1");
    assert("1 BAG requirement + BAG issue", issue.success === true && issue.data?.requirement.status === "COMPLETED" && stock.bagQty === 60);
  }

  {
    const store = new MemoryStore();
    await seedJob(store);
    await seedStock(store, "JC-DS-1", 0, 200, 0);
    const req = await makeReq(store, "JC-DS-1", 50, "PCS");
    const issue = await issueDispatchStoreRequirementTx(store, {
      requirementId: req.id,
      issuedPcsQty: 50,
      actor: storeActor()
    });
    const stock = await store.get(STORE_UNIT_STOCK_COLLECTION, "JC-DS-1");
    assert("2 PCS requirement + PCS issue", issue.success === true && issue.data?.requirement.remainingQty === 0 && stock.pcsQty === 150);
  }

  {
    const store = new MemoryStore();
    await seedJob(store);
    await seedStock(store, "JC-DS-1", 0, 0, 80);
    const req = await makeReq(store, "JC-DS-1", 25, "KG");
    const issue = await issueDispatchStoreRequirementTx(store, {
      requirementId: req.id,
      issuedKgQty: 25,
      actor: storeActor()
    });
    const stock = await store.get(STORE_UNIT_STOCK_COLLECTION, "JC-DS-1");
    assert("3 KG requirement + KG issue", issue.success === true && issue.data?.requirement.status === "COMPLETED" && stock.kgQty === 55);
  }

  {
    const store = new MemoryStore();
    await seedJob(store);
    await seedStock(store, "JC-DS-1", 100, 0, 0);
    const req = await makeReq(store, "JC-DS-1", 100, "BAG");
    const issue = await issueDispatchStoreRequirementTx(store, {
      requirementId: req.id,
      issuedBagQty: 20,
      actor: storeActor()
    });
    assert(
      "4 Partial BAG requirement",
      issue.success === true &&
        issue.data?.requirement.status === "PARTIALLY_ISSUED" &&
        issue.data?.requirement.remainingQty === 80
    );
  }

  {
    const store = new MemoryStore();
    await seedJob(store);
    await seedStock(store, "JC-DS-1", 0, 100, 0);
    const req = await makeReq(store, "JC-DS-1", 100, "PCS");
    const issue = await issueDispatchStoreRequirementTx(store, {
      requirementId: req.id,
      issuedPcsQty: 25,
      actor: storeActor()
    });
    assert("5 Partial PCS requirement", issue.success === true && issue.data?.requirement.remainingQty === 75);
  }

  {
    const store = new MemoryStore();
    await seedJob(store);
    await seedStock(store, "JC-DS-1", 0, 0, 100);
    const req = await makeReq(store, "JC-DS-1", 100, "KG");
    const issue = await issueDispatchStoreRequirementTx(store, {
      requirementId: req.id,
      issuedKgQty: 30,
      actor: storeActor()
    });
    assert("6 Partial KG requirement", issue.success === true && issue.data?.requirement.remainingQty === 70);
  }

  {
    const store = new MemoryStore();
    await seedJob(store);
    await seedStock(store, "JC-DS-1", 100, 500, 80);
    const req = await makeReq(store, "JC-DS-1", 100, "BAG");
    const issue = await issueDispatchStoreRequirementTx(store, {
      requirementId: req.id,
      issuedBagQty: 20,
      issuedPcsQty: 500,
      issuedKgQty: 80,
      actor: storeActor()
    });
    const stock = await store.get(STORE_UNIT_STOCK_COLLECTION, "JC-DS-1");
    assert(
      "7 Mixed-unit issue against BAG requirement",
      issue.success === true &&
        issue.data?.requirement.remainingQty === 80 &&
        issue.data?.requirement.status === "PARTIALLY_ISSUED" &&
        stock.bagQty === 80 &&
        stock.pcsQty === 0 &&
        stock.kgQty === 0
    );
  }

  {
    const store = new MemoryStore();
    await seedJob(store);
    await seedStock(store, "JC-DS-1", 10, 100, 50);
    const req = await makeReq(store, "JC-DS-1", 100, "PCS");
    const issue = await issueDispatchStoreRequirementTx(store, {
      requirementId: req.id,
      issuedBagQty: 10,
      issuedPcsQty: 25,
      issuedKgQty: 50,
      actor: storeActor()
    });
    const stock = await store.get(STORE_UNIT_STOCK_COLLECTION, "JC-DS-1");
    assert(
      "8 Mixed-unit issue against PCS requirement",
      issue.success === true &&
        issue.data?.requirement.remainingQty === 75 &&
        stock.bagQty === 0 &&
        stock.pcsQty === 75 &&
        stock.kgQty === 0
    );
  }

  {
    const store = new MemoryStore();
    await seedJob(store);
    await seedStock(store, "JC-DS-1", 5, 9, 100);
    const req = await makeReq(store, "JC-DS-1", 40, "KG");
    const issue = await issueDispatchStoreRequirementTx(store, {
      requirementId: req.id,
      issuedBagQty: 5,
      issuedPcsQty: 9,
      issuedKgQty: 10,
      actor: storeActor()
    });
    assert("9 Mixed-unit issue against KG requirement", issue.success === true && issue.data?.requirement.remainingQty === 30);
  }

  {
    const store = new MemoryStore();
    await seedJob(store);
    await seedStock(store, "JC-DS-1", 200, 0, 0);
    const req = await makeReq(store, "JC-DS-1", 10, "BAG");
    const issue = await issueDispatchStoreRequirementTx(store, {
      requirementId: req.id,
      issuedBagQty: 11,
      actor: storeActor()
    });
    const stock = await store.get(STORE_UNIT_STOCK_COLLECTION, "JC-DS-1");
    assert("10 Controlling-unit over-issue rejected", issue.success === false && stock.bagQty === 200);
  }

  {
    const store = new MemoryStore();
    await seedJob(store);
    await seedStock(store, "JC-DS-1", 5, 100, 100);
    const req = await makeReq(store, "JC-DS-1", 10, "PCS");
    const issue = await issueDispatchStoreRequirementTx(store, {
      requirementId: req.id,
      issuedBagQty: 6,
      issuedPcsQty: 1,
      actor: storeActor()
    });
    const stock = await store.get(STORE_UNIT_STOCK_COLLECTION, "JC-DS-1");
    assert("11 BAG stock over-issue rejected", issue.success === false && stock.bagQty === 5 && stock.pcsQty === 100);
  }

  {
    const store = new MemoryStore();
    await seedJob(store);
    await seedStock(store, "JC-DS-1", 100, 2, 100);
    const req = await makeReq(store, "JC-DS-1", 10, "BAG");
    const issue = await issueDispatchStoreRequirementTx(store, {
      requirementId: req.id,
      issuedBagQty: 1,
      issuedPcsQty: 3,
      actor: storeActor()
    });
    const stock = await store.get(STORE_UNIT_STOCK_COLLECTION, "JC-DS-1");
    assert("12 PCS stock over-issue rejected", issue.success === false && stock.pcsQty === 2 && stock.bagQty === 100);
  }

  {
    const store = new MemoryStore();
    await seedJob(store);
    await seedStock(store, "JC-DS-1", 100, 100, 4);
    const req = await makeReq(store, "JC-DS-1", 10, "BAG");
    const issue = await issueDispatchStoreRequirementTx(store, {
      requirementId: req.id,
      issuedBagQty: 1,
      issuedKgQty: 5,
      actor: storeActor()
    });
    const stock = await store.get(STORE_UNIT_STOCK_COLLECTION, "JC-DS-1");
    assert("13 KG stock over-issue rejected", issue.success === false && stock.kgQty === 4 && stock.bagQty === 100);
  }

  {
    const store = new MemoryStore();
    await seedJob(store);
    await seedStock(store, "JC-DS-1", 10, 10, 1);
    const req = await makeReq(store, "JC-DS-1", 100, "BAG");
    const issue = await issueDispatchStoreRequirementTx(store, {
      requirementId: req.id,
      issuedBagQty: 10,
      issuedPcsQty: 10,
      issuedKgQty: 9,
      actor: storeActor()
    });
    const stock = await store.get(STORE_UNIT_STOCK_COLLECTION, "JC-DS-1");
    const reqAfter = await store.get(DISPATCH_STORE_REQUIREMENT_COLLECTION, req.id);
    assert(
      "14 Failed mixed issue rolls back ALL deductions",
      issue.success === false &&
        stock.bagQty === 10 &&
        stock.pcsQty === 10 &&
        stock.kgQty === 1 &&
        reqAfter.remainingQty === 100 &&
        reqAfter.status === "PENDING"
    );
  }

  {
    const store = new MemoryStore();
    await seedJob(store);
    await seedStock(store, "JC-DS-1", 100, 0, 0);
    const req = await makeReq(store, "JC-DS-1", 100, "BAG");
    await issueDispatchStoreRequirementTx(store, { requirementId: req.id, issuedBagQty: 20, actor: storeActor() });
    await issueDispatchStoreRequirementTx(store, { requirementId: req.id, issuedBagQty: 30, actor: storeActor() });
    const reqAfter = await store.get(DISPATCH_STORE_REQUIREMENT_COLLECTION, req.id);
    const issues = await store.list(DISPATCH_STORE_ISSUE_COLLECTION);
    const stock = await store.get(STORE_UNIT_STOCK_COLLECTION, "JC-DS-1");
    assert(
      "15 Multiple issues accumulate correctly",
      reqAfter.issuedQty === 50 && reqAfter.remainingQty === 50 && issues.length === 2 && stock.bagQty === 50
    );
  }

  {
    const store = new MemoryStore();
    await seedJob(store);
    await seedStock(store, "JC-DS-1", 100, 500, 80);
    const req = await makeReq(store, "JC-DS-1", 100, "BAG");
    await issueDispatchStoreRequirementTx(store, {
      requirementId: req.id,
      issuedBagQty: 99,
      issuedPcsQty: 500,
      issuedKgQty: 80,
      actor: storeActor()
    });
    let reqAfter = await store.get(DISPATCH_STORE_REQUIREMENT_COLLECTION, req.id);
    assert("16a not complete until controlling quantity is met", reqAfter.status === "PARTIALLY_ISSUED");
    const last = await issueDispatchStoreRequirementTx(store, {
      requirementId: req.id,
      issuedBagQty: 1,
      actor: storeActor()
    });
    reqAfter = await store.get(DISPATCH_STORE_REQUIREMENT_COLLECTION, req.id);
    assert("16 Completion occurs only when controlling quantity reaches requirement", last.success === true && reqAfter.status === "COMPLETED" && reqAfter.remainingQty === 0);
  }

  {
    const store = new MemoryStore();
    await seedJob(store);
    await seedStock(store, "JC-DS-1", 100, 1000, 1000);
    const req = await makeReq(store, "JC-DS-1", 100, "BAG");
    const issue = await issueDispatchStoreRequirementTx(store, {
      requirementId: req.id,
      issuedBagQty: 0,
      issuedPcsQty: 1000,
      issuedKgQty: 1000,
      actor: storeActor()
    });
    assert(
      "17 Non-controlling quantities do not affect completion",
      issue.success === true &&
        issue.data?.requirement.status === "PENDING" &&
        issue.data?.requirement.remainingQty === 100 &&
        issue.data?.requirement.issuedQty === 0
    );
  }

  {
    const store = new MemoryStore();
    await seedJob(store);
    await seedStock(store, "JC-DS-1", 100, 0, 0);
    const req = await makeReq(store, "JC-DS-1", 1000, "BAG");
    const [a, b] = await Promise.all([
      issueDispatchStoreRequirementTx(store, { requirementId: req.id, issuedBagQty: 80, actor: storeActor() }),
      issueDispatchStoreRequirementTx(store, { requirementId: req.id, issuedBagQty: 80, actor: storeActor() })
    ]);
    const stock = await store.get(STORE_UNIT_STOCK_COLLECTION, "JC-DS-1");
    const successes = [a, b].filter((r) => r.success);
    const failures = [a, b].filter((r) => !r.success);
    assert("18 Concurrent issues cannot overdraw stock", successes.length === 1 && failures.length === 1 && stock.bagQty === 20);
  }

  {
    const store = new MemoryStore();
    await seedJob(store);
    await seedStock(store, "JC-DS-1", 200, 0, 0);
    const req = await makeReq(store, "JC-DS-1", 100, "BAG");
    const [a, b] = await Promise.all([
      issueDispatchStoreRequirementTx(store, { requirementId: req.id, issuedBagQty: 70, actor: storeActor() }),
      issueDispatchStoreRequirementTx(store, { requirementId: req.id, issuedBagQty: 70, actor: storeActor() })
    ]);
    const reqAfter = await store.get(DISPATCH_STORE_REQUIREMENT_COLLECTION, req.id);
    const successes = [a, b].filter((r) => r.success);
    assert(
      "19 Concurrent issues cannot over-complete requirement",
      successes.length === 1 && reqAfter.issuedQty === 70 && reqAfter.remainingQty === 30 && reqAfter.status !== "COMPLETED"
    );
  }

  {
    const store = new MemoryStore();
    await seedJob(store);
    await seedStock(store, "JC-DS-1", 10, 10, 10);
    const req = await makeReq(store, "JC-DS-1", 10, "BAG");
    const issue = await issueDispatchStoreRequirementTx(store, {
      requirementId: req.id,
      issuedBagQty: 0,
      issuedPcsQty: 0,
      issuedKgQty: 0,
      actor: storeActor()
    });
    assert("20 Zero issue rejected", issue.success === false);
  }

  {
    const store = new MemoryStore();
    await seedJob(store);
    await seedStock(store, "JC-DS-1", 10, 10, 10);
    const req = await makeReq(store, "JC-DS-1", 10, "BAG");
    const issue = await issueDispatchStoreRequirementTx(store, {
      requirementId: req.id,
      issuedBagQty: -1,
      actor: storeActor()
    });
    const stock = await store.get(STORE_UNIT_STOCK_COLLECTION, "JC-DS-1");
    assert("21 Negative quantities rejected", issue.success === false && stock.bagQty === 10);
  }

  {
    const store = new MemoryStore();
    await seedJob(store, "JC-LEGACY");
    const inbound = {
      movementId: "M-IN-LEGACY",
      jobCardNo: "JC-LEGACY",
      fromDepartment: "Packing",
      toDepartment: "Store",
      quantity: 400,
      accepted: true
    };
    await store.set("mfr_movements", "M-IN-LEGACY", inbound);
    const job = await store.get("mfr_job_cards", "JC-LEGACY");
    const onHandBefore = storeAuthoritativeOnHand(job, [inbound]);
    await seedStock(store, "JC-LEGACY", 50, 50, 50);
    const req = await makeReq(store, "JC-LEGACY", 10, "BAG");
    await issueDispatchStoreRequirementTx(store, {
      requirementId: req.id,
      issuedBagQty: 10,
      issuedPcsQty: 10,
      issuedKgQty: 10,
      actor: storeActor()
    });
    const movements = await store.list("mfr_movements");
    const onHandAfter = storeAuthoritativeOnHand(job, movements);
    const issueReq = await commitMaterialMovementTx(store, {
      operationId: "op-legacy-issue",
      jobCardNo: "JC-LEGACY",
      fromDepartment: "Store",
      toDepartment: "Dispatch",
      quantity: 400,
      isIssueRequest: true,
      requestedQty: 12,
      requestedUnit: "PCS",
      actor: storeActor()
    });
    const movementsAfter = await store.list("mfr_movements");
    assert("22 Existing legacy isIssueRequest still commits independently", issueReq.success === true && issueReq.movement?.isIssueRequest === true);
    assert("23 Store scalar on-hand unchanged by independent-unit issue", onHandBefore === 400 && onHandAfter === 400);
    assert("24 Independent-unit issue does not write mfr_movements", movements.length === 1 && movementsAfter.some((m) => m.isIssueRequest));
  }

  {
    const noOpening = new MemoryStore();
    await seedJob(noOpening);
    const req = await makeReq(noOpening, "JC-DS-1", 1, "BAG");
    const issue = await issueDispatchStoreRequirementTx(noOpening, {
      requirementId: req.id,
      issuedBagQty: 1,
      actor: storeActor()
    });
    assert("unit with no opening has no available stock", issue.success === false);
  }

  assert("client sync queue blocks independent-unit collections", isLedgerCollectionBlockedFromClientSync("mfr_store_unit_stock"));
  assert(
    "factory reset includes independent-unit collections",
    operationalCollectionsForFactoryReset().includes("mfr_dispatch_store_requirements") &&
      operationalCollectionsForFactoryReset().includes("mfr_store_unit_stock")
  );

  const denied = await createDispatchStoreRequirementTx(new MemoryStore(), {
    jobCardNo: "JC-X",
    requestedQty: 1,
    requestedUnit: "BAG",
    actor: storeActor()
  });
  assert("Store cannot create Dispatch requirement", denied.success === false);

  console.log(`\nDispatch-store tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
