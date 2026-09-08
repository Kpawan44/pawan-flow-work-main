import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { MemoryStore } from "../src/hardening/memoryStore";
import { splitJobCardTx } from "../src/hardening/splitJobCard";
import { commitMaterialMovementTx } from "../src/hardening/commitMaterialMovement";

const mockActor = {
  userId: "USR-P7-OPERATOR",
  userName: "Process7 Operator",
  role: "operator",
  department: "Production",
  allowedDepartments: ["Production", "Store", "Dispatch"],
  accessList: ["Production", "Store", "Dispatch"]
};

describe("PROCESS 7 — UI & REST API SPLIT INTEGRATION & PARITY TESTS", () => {
  test("TEST 1: Valid parent -> multi-child split via domain/API contract", async () => {
    const store = new MemoryStore();
    await store.set("mfr_job_cards", "JOB-P7-100", {
      jobCardNo: "JOB-P7-100",
      orderNo: "ORD-P7-01",
      partyName: "Apex Forge Ltd",
      itemName: "8mm Hex Bolt",
      itemCode: "HEX-8",
      materialGrade: "EN8",
      unit: "KG",
      processType: "In-House",
      currentDepartment: "Production",
      orderQty: 1000,
      currentQty: 1000,
      status: "In-Progress",
      createdAt: "2026-09-09T03:00:00Z"
    });

    const res = await splitJobCardTx(store, {
      operationId: "op-p7-test-1",
      parentJobCardNo: "JOB-P7-100",
      childSplits: [
        { childJobCardNo: "JOB-P7-100-A", quantity: 600 },
        { childJobCardNo: "JOB-P7-100-B", quantity: 400 }
      ],
      actor: mockActor
    });

    assert.equal(res.success, true, "Split operation must succeed");
    assert.equal(res.parentJobCard.currentQty, 0, "Parent currentQty decrements to 0 after full split");
    assert.deepEqual(res.parentJobCard.childJobCardNos, ["JOB-P7-100-A", "JOB-P7-100-B"], "Parent records child IDs");

    const childA = await store.get("mfr_job_cards", "JOB-P7-100-A");
    const childB = await store.get("mfr_job_cards", "JOB-P7-100-B");

    assert.equal(childA.parentJobCardNo, "JOB-P7-100", "Child A references parent");
    assert.equal(childA.orderQty, 600, "Child A orderQty equals 600");
    assert.equal(childA.currentQty, 600, "Child A currentQty equals 600");

    assert.equal(childB.parentJobCardNo, "JOB-P7-100", "Child B references parent");
    assert.equal(childB.orderQty, 400, "Child B orderQty equals 400");
    assert.equal(childB.currentQty, 400, "Child B currentQty equals 400");
  });

  test("TEST 2: Over-allocation rejection (600 + 500 > 1000)", async () => {
    const store = new MemoryStore();
    await store.set("mfr_job_cards", "JOB-P7-101", {
      jobCardNo: "JOB-P7-101",
      orderQty: 1000,
      currentQty: 1000,
      status: "In-Progress"
    });

    const res = await splitJobCardTx(store, {
      operationId: "op-p7-test-2",
      parentJobCardNo: "JOB-P7-101",
      childSplits: [
        { childJobCardNo: "JOB-P7-101-A", quantity: 600 },
        { childJobCardNo: "JOB-P7-101-B", quantity: 500 }
      ],
      actor: mockActor
    });

    assert.equal(res.success, false, "Over-allocation must be rejected");
    assert.match(res.error || "", /exceeds parent (available|current) quantity/, "Error message explains over-allocation");

    const parent = await store.get("mfr_job_cards", "JOB-P7-101");
    assert.equal(parent.currentQty, 1000, "Parent job card remains untouched after rejection");
  });

  test("TEST 3: Sequential split & cumulative conservation", async () => {
    const store = new MemoryStore();
    await store.set("mfr_job_cards", "JOB-P7-102", {
      jobCardNo: "JOB-P7-102",
      orderQty: 1000,
      currentQty: 1000
    });

    // Leg 1: 400 KG
    const res1 = await splitJobCardTx(store, {
      operationId: "op-p7-seq-1",
      parentJobCardNo: "JOB-P7-102",
      childSplits: [{ childJobCardNo: "JOB-P7-102-A", quantity: 400 }],
      actor: mockActor
    });

    assert.equal(res1.success, true);
    assert.equal(res1.parentJobCard.currentQty, 600, "Parent remaining quantity is 600 after leg 1");

    // Leg 2: 700 KG (exceeds remaining 600) -> Rejected
    const res2 = await splitJobCardTx(store, {
      operationId: "op-p7-seq-2",
      parentJobCardNo: "JOB-P7-102",
      childSplits: [{ childJobCardNo: "JOB-P7-102-B", quantity: 700 }],
      actor: mockActor
    });

    assert.equal(res2.success, false, "Sequential split exceeding remaining quantity rejected");

    // Leg 3: Valid 600 KG -> Succeeded
    const res3 = await splitJobCardTx(store, {
      operationId: "op-p7-seq-3",
      parentJobCardNo: "JOB-P7-102",
      childSplits: [{ childJobCardNo: "JOB-P7-102-B", quantity: 600 }],
      actor: mockActor
    });

    assert.equal(res3.success, true);
    assert.equal(res3.parentJobCard.currentQty, 0, "Parent currentQty decrements to 0 after final leg");
  });

  test("TEST 4: Duplicate operationId idempotency check", async () => {
    const store = new MemoryStore();
    await store.set("mfr_job_cards", "JOB-P7-103", {
      jobCardNo: "JOB-P7-103",
      orderQty: 1000,
      currentQty: 1000
    });

    const input = {
      operationId: "op-p7-idemp-103",
      parentJobCardNo: "JOB-P7-103",
      childSplits: [
        { childJobCardNo: "JOB-P7-103-A", quantity: 600 },
        { childJobCardNo: "JOB-P7-103-B", quantity: 400 }
      ],
      actor: mockActor
    };

    const res1 = await splitJobCardTx(store, input);
    assert.equal(res1.success, true);
    assert.equal(res1.cached, undefined);

    // Duplicate call with same operationId
    const res2 = await splitJobCardTx(store, input);
    assert.equal(res2.success, true);
    assert.equal(res2.cached, true, "Duplicate operationId returns cached result");

    const parent = await store.get("mfr_job_cards", "JOB-P7-103");
    assert.equal(parent.currentQty, 0, "Parent currentQty is 0, not negative double-decremented");
  });

  test("TEST 5: Duplicate child ID and self/cyclic split rejection", async () => {
    const store = new MemoryStore();
    await store.set("mfr_job_cards", "JOB-P7-104", {
      jobCardNo: "JOB-P7-104",
      orderQty: 1000,
      currentQty: 1000
    });

    // 1. Self split
    const resSelf = await splitJobCardTx(store, {
      operationId: "op-p7-self",
      parentJobCardNo: "JOB-P7-104",
      childSplits: [{ childJobCardNo: "JOB-P7-104", quantity: 500 }],
      actor: mockActor
    });
    assert.equal(resSelf.success, false, "Self parent==child split rejected");

    // 2. Duplicate child ID in input list
    const resDup = await splitJobCardTx(store, {
      operationId: "op-p7-dup",
      parentJobCardNo: "JOB-P7-104",
      childSplits: [
        { childJobCardNo: "JOB-P7-104-A", quantity: 300 },
        { childJobCardNo: "JOB-P7-104-A", quantity: 300 }
      ],
      actor: mockActor
    });
    assert.equal(resDup.success, false, "Duplicate child ID in input list rejected");

    // 3. Existing child ID collision
    await store.set("mfr_job_cards", "JOB-P7-EXISTING", { jobCardNo: "JOB-P7-EXISTING" });
    const resCollision = await splitJobCardTx(store, {
      operationId: "op-p7-col",
      parentJobCardNo: "JOB-P7-104",
      childSplits: [{ childJobCardNo: "JOB-P7-EXISTING", quantity: 500 }],
      actor: mockActor
    });
    assert.equal(resCollision.success, false, "Existing child ID collision rejected");
  });

  test("TEST 6: Downstream child isolation & no cross-job inventory consumption", async () => {
    const store = new MemoryStore();
    await store.set("mfr_job_cards", "JOB-P7-PARENT", {
      jobCardNo: "JOB-P7-PARENT",
      orderQty: 1000,
      currentQty: 1000,
      currentDepartment: "Store",
      unit: "KG"
    });

    await splitJobCardTx(store, {
      operationId: "op-p7-iso",
      parentJobCardNo: "JOB-P7-PARENT",
      childSplits: [
        { childJobCardNo: "JOB-P7-CHILD-A", quantity: 600 },
        { childJobCardNo: "JOB-P7-CHILD-B", quantity: 400 }
      ],
      actor: mockActor
    });

    // Attempt to dispatch 700 KG on Child A (which only has 600 KG)
    const movRes = await commitMaterialMovementTx(store, {
      operationId: "op-p7-over-dispatch",
      jobCardNo: "JOB-P7-CHILD-A",
      fromDepartment: "Store",
      toDepartment: "Dispatch",
      quantity: 700,
      actor: mockActor
    });

    assert.equal(movRes.success, false, "Child A over-dispatch rejected (700 > 600)");

    // Child B remains completely untouched at 400 KG
    const childB = await store.get("mfr_job_cards", "JOB-P7-CHILD-B");
    assert.equal(childB.currentQty, 400, "Child B currentQty remains 400 KG");
  });

  test("TEST 7: Legacy unsplit job compatibility", async () => {
    const store = new MemoryStore();
    await store.set("mfr_job_cards", "LEGACY-P7-JOB", {
      jobCardNo: "LEGACY-P7-JOB",
      orderQty: 500,
      currentQty: 500,
      currentDepartment: "Production",
      status: "Accepted",
      processType: "In-House"
    });

    // Standard movement on legacy job card without lineage attributes
    const movRes = await commitMaterialMovementTx(store, {
      operationId: "op-p7-legacy-mov",
      jobCardNo: "LEGACY-P7-JOB",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 200,
      actor: mockActor
    });

    assert.equal(movRes.success, true, `Legacy job card movement failed: ${movRes.error}`);
  });
});
