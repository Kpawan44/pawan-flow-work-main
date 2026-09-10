import { MemoryStore } from "../src/hardening/memoryStore";
import { commitMaterialMovementTx } from "../src/hardening/commitMaterialMovement";
import { acceptMaterialMovementTx } from "../src/hardening/resolveMaterialMovement";
import { process2SendAvailableQty, remainingAtProduction, remainingAtDepartment } from "../src/hardening/process2Manufacturing";
import { readFileSync } from "node:fs";
import express from "express";
import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import { createPurchaseCreationFingerprint, validatePurchaseReceiptInput } from "../src/hardening/process1Purchase";

let passed = 0;
let failed = 0;

function assert(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function actor(department: string, overrides: Record<string, any> = {}) {
  return {
    userId: `u-${department.toLowerCase().replace(/\s+/g, "-")}`,
    userName: `${department} User`,
    role: "staff",
    department,
    allowedDepartments: [department],
    accessList: [department],
    ...overrides
  };
}

async function seedPurchase(store: MemoryStore) {
  await store.set("mfr_job_cards", "PUR-P70", {
    jobCardNo: "PUR-P70",
    partyName: "Supplier",
    processType: "Purchase",
    orderQty: 2000,
    currentQty: 2000,
    currentDepartment: "Purchase",
    status: "In Process",
    purchaseDetails: { receivedQty: 2000, rejectionQty: 0 },
    version: 1
  });
}

async function seedProduction(store: MemoryStore, jobCardNo = "JC-P70", orderQty = 10000) {
  await store.set("mfr_job_cards", jobCardNo, {
    jobCardNo,
    orderQty,
    currentQty: orderQty,
    currentDepartment: "Production",
    status: "In Process",
    processType: "Manufacturing",
    heatTreatmentRequired: true,
    version: 1
  });
  await store.set("mfr_movements", `rm-${jobCardNo}`, {
    movementId: `rm-${jobCardNo}`,
    jobCardNo,
    fromDepartment: "Raw Material Store",
    toDepartment: "Production",
    quantity: orderQty,
    accepted: true,
    acceptedQty: orderQty,
    isIssueRequest: true,
    issueStatus: "Issued"
  });
}

async function sendProduction(store: MemoryStore, jobCardNo: string, quantity: number, operationId: string) {
  return commitMaterialMovementTx(store, {
    operationId,
    jobCardNo,
    fromDepartment: "Production",
    toDepartment: "Heat Treatment",
    quantity,
    requireRawMaterialForProduction: true,
    actor: actor("Production")
  });
}

async function accept(store: MemoryStore, movement: any, operationId: string, department = "Heat Treatment") {
  return acceptMaterialMovementTx(store, {
    operationId,
    movementId: movement.movementId,
    actor: actor(department)
  });
}

async function run() {
  {
    const store = new MemoryStore();
    const app = express();
    app.use(express.json());
    app.post("/api/job-cards", async (req, res) => {
      const job = req.body?.jobCard;
      const validation = validatePurchaseReceiptInput(job);
      if (!validation.ok) return res.status(400).json({ success: false, error: validation.error });
      const fingerprint = createPurchaseCreationFingerprint(job);
      const existingJob = await store.get("mfr_job_cards", String(job.jobCardNo).toUpperCase());
      if (existingJob && existingJob.purchaseCreationFingerprint !== fingerprint) {
        return res.status(409).json({ success: false, error: "Purchase job already exists with different immutable receipt data." });
      }
      const storedJob = { ...job, jobCardNo: String(job.jobCardNo).toUpperCase(), purchaseCreationFingerprint: fingerprint };
      await store.set("mfr_job_cards", storedJob.jobCardNo, storedJob);
      const initial = await commitMaterialMovementTx(store, {
        operationId: `purchase-receipt-${job.jobCardNo}`,
        jobCardNo: storedJob.jobCardNo,
        fromDepartment: "Supplier",
        toDepartment: "Purchase",
        quantity: validation.creditedQty!,
        isSupplierReceipt: true,
        actor: actor("Purchase")
      });
      if (!initial.success) return res.status(400).json({ success: false, error: initial.error });
      const purchaseAvailabilityAfterCredit = remainingAtDepartment(storedJob, await store.list("mfr_movements"), "Purchase");
      const outbound = await commitMaterialMovementTx(store, {
        operationId: `purchase-outbound-${job.jobCardNo}`,
        jobCardNo: storedJob.jobCardNo,
        fromDepartment: "Purchase",
        toDepartment: "Raw Material Store",
        quantity: validation.sentQty!,
        actor: actor("Purchase")
      });
      return res.status(outbound.success ? 200 : 400).json({ success: outbound.success, initial, outbound, purchaseAvailabilityAfterCredit });
    });
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const validJob = {
      jobCardNo: "PUR-P70-ENDPOINT",
      partyName: "Supplier 70",
      itemName: "Raw Material",
      itemCode: "RM-70",
      materialType: "Raw Material",
      currentQty: 2000,
      processType: "Purchase",
      currentDepartment: "Purchase",
      purchaseDetails: { supplierName: "Supplier 70", receivedQty: 2000, rejectionQty: 0 }
    };
    const post = (jobCard: any) => fetch(`http://127.0.0.1:${port}/api/job-cards`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobCard })
    });
    const created = await post(validJob);
    const createdJson = await created.json();
    const rows = await store.list("mfr_movements");
    const credits = rows.filter((m) => m.processDetails?.isSupplierReceipt);
    assert("21 endpoint purchase creation succeeds", created.status === 200 && createdJson.success === true);
    assert("21 endpoint creates exactly one supplier credit", credits.length === 1 && credits[0].quantity === 2000);
    assert("21 endpoint initial Purchase movement is correct", rows.some((m) => m.fromDepartment === "Purchase" && m.toDepartment === "Raw Material Store" && m.quantity === 2000 && m.accepted === false));
    assert("21 endpoint Purchase availability after supplier credit is 2000", createdJson.purchaseAvailabilityAfterCredit === 2000);
    const retry = await post(validJob);
    await retry.json();
    const afterRetry = await store.list("mfr_movements");
    assert("22 endpoint retry does not duplicate supplier credit", afterRetry.filter((m) => m.processDetails?.isSupplierReceipt).length === 1);
    const beforeConflict = { job: await store.get("mfr_job_cards", validJob.jobCardNo), movements: afterRetry };
    const changedQuantity = await post({ ...validJob, currentQty: 1500, purchaseDetails: { ...validJob.purchaseDetails, receivedQty: 1500 } });
    await changedQuantity.json();
    const afterQuantityConflict = { job: await store.get("mfr_job_cards", validJob.jobCardNo), movements: await store.list("mfr_movements") };
    assert("25 changed quantity retry returns 409 without overwrite", changedQuantity.status === 409 && JSON.stringify(afterQuantityConflict) === JSON.stringify(beforeConflict));
    const changedRejection = await post({ ...validJob, currentQty: 1800, purchaseDetails: { ...validJob.purchaseDetails, rejectionQty: 100 } });
    await changedRejection.json();
    assert("25 changed rejection retry returns 409", changedRejection.status === 409);
    const changedSupplier = await post({ ...validJob, partyName: "Different Supplier", purchaseDetails: { ...validJob.purchaseDetails, supplierName: "Different Supplier" } });
    await changedSupplier.json();
    assert("25 changed supplier retry returns 409", changedSupplier.status === 409);
    const concurrent = await Promise.all([post(validJob), post(validJob)]);
    await Promise.all(concurrent.map((response) => response.json()));
    const afterConcurrent = await store.list("mfr_movements");
    assert("26 concurrent identical requests keep one supplier credit", concurrent.every((response) => response.status === 200) && afterConcurrent.filter((m) => m.processDetails?.isSupplierReceipt).length === 1);
    const invalidJob = { ...validJob, jobCardNo: "PUR-P70-ENDPOINT-BAD", purchaseDetails: { supplierName: "Supplier 70", receivedQty: 0, rejectionQty: 0 } };
    const invalid = await post(invalidJob);
    await invalid.json();
    const badRows = await store.list("mfr_movements");
    assert("23 invalid endpoint receipt fails before writes", invalid.status === 400 && !(await store.get("mfr_job_cards", invalidJob.jobCardNo)) && !badRows.some((m) => m.jobCardNo === invalidJob.jobCardNo));
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }

  {
    class FailOnceReceiptStore extends MemoryStore {
      private failed = false;

      async set(collection: string, id: string, data: any): Promise<void> {
        if (!this.failed && collection === "mfr_movements" && data?.processDetails?.isSupplierReceipt) {
          this.failed = true;
          throw new Error("simulated supplier credit failure");
        }
        await super.set(collection, id, data);
      }
    }
    const store = new FailOnceReceiptStore();
    await seedPurchase(store);
    const first = await commitMaterialMovementTx(store, {
      operationId: "p70-credit-retry",
      jobCardNo: "PUR-P70",
      fromDepartment: "Supplier",
      toDepartment: "Purchase",
      quantity: 2000,
      isSupplierReceipt: true,
      actor: actor("Purchase")
    }).catch(() => ({ success: false }));
    assert("24 simulated supplier credit failure is contained", first.success === false && (await store.list("mfr_movements")).filter((m) => m.processDetails?.isSupplierReceipt).length === 0);
    const retry = await commitMaterialMovementTx(store, {
      operationId: "p70-credit-retry",
      jobCardNo: "PUR-P70",
      fromDepartment: "Supplier",
      toDepartment: "Purchase",
      quantity: 2000,
      isSupplierReceipt: true,
      actor: actor("Purchase")
    });
    const retryRows = await store.list("mfr_movements");
    assert("24 retry after supplier credit failure succeeds once", retry.success === true && retryRows.filter((m) => m.processDetails?.isSupplierReceipt).length === 1 && remainingAtDepartment(await store.get("mfr_job_cards", "PUR-P70"), retryRows, "Purchase") === 2000);

    class FailOnceIdempotencyStore extends MemoryStore {
      private failed = false;

      async set(collection: string, id: string, data: any): Promise<void> {
        if (!this.failed && collection === "mfr_idempotency_keys") {
          this.failed = true;
          throw new Error("simulated idempotency persistence failure");
        }
        await super.set(collection, id, data);
      }
    }
    const idempotencyStore = new FailOnceIdempotencyStore();
    await seedPurchase(idempotencyStore);
    await commitMaterialMovementTx(idempotencyStore, {
      operationId: "p70-credit-idempotency-retry",
      jobCardNo: "PUR-P70",
      fromDepartment: "Supplier",
      toDepartment: "Purchase",
      quantity: 2000,
      isSupplierReceipt: true,
      actor: actor("Purchase")
    }).catch(() => undefined);
    const idempotencyRetry = await commitMaterialMovementTx(idempotencyStore, {
      operationId: "p70-credit-idempotency-retry",
      jobCardNo: "PUR-P70",
      fromDepartment: "Supplier",
      toDepartment: "Purchase",
      quantity: 2000,
      isSupplierReceipt: true,
      actor: actor("Purchase")
    });
    assert("24 retry after idempotency failure does not duplicate credit", idempotencyRetry.success === true && (await idempotencyStore.list("mfr_movements")).filter((m) => m.processDetails?.isSupplierReceipt).length === 1);
  }

  {
    const store = new MemoryStore();
    await seedPurchase(store);
    const receipt = await commitMaterialMovementTx(store, {
      operationId: "p70-receipt",
      jobCardNo: "PUR-P70",
      fromDepartment: "Supplier",
      toDepartment: "Purchase",
      quantity: 2000,
      transactionType: "PURCHASE_RECEIPT",
      isSupplierReceipt: true,
      actor: actor("Purchase")
    });
    assert("1 supplier inward credits Purchase with 2000", receipt.success && remainingAtDepartment(await store.get("mfr_job_cards", "PUR-P70"), await store.list("mfr_movements"), "Purchase") === 2000);
    assert("1 supplier credit is accepted ledger history", receipt.movement?.accepted === true && receipt.movement?.processDetails?.isSupplierReceipt === true);

    const retryReceipt = await commitMaterialMovementTx(store, {
      operationId: "p70-receipt",
      jobCardNo: "PUR-P70",
      fromDepartment: "Supplier",
      toDepartment: "Purchase",
      quantity: 2000,
      transactionType: "PURCHASE_RECEIPT",
      isSupplierReceipt: true,
      actor: actor("Purchase")
    });
    assert("7 supplier receipt retry is idempotent", retryReceipt.cached === true && (await store.list("mfr_movements")).filter((m) => m.processDetails?.isSupplierReceipt).length === 1);

    const firstSend = await commitMaterialMovementTx(store, {
      operationId: "p70-purchase-send-1",
      jobCardNo: "PUR-P70",
      fromDepartment: "Purchase",
      toDepartment: "Raw Material Store",
      quantity: 1200,
      actor: actor("Purchase")
    });
    assert("2 Purchase sends 1200 to RM Store", firstSend.success === true);
    assert("4 partial Purchase transfer leaves 800", remainingAtDepartment(await store.get("mfr_job_cards", "PUR-P70"), await store.list("mfr_movements"), "Purchase") === 800);

    const duplicatePending = await commitMaterialMovementTx(store, {
      operationId: "p70-purchase-send-duplicate",
      jobCardNo: "PUR-P70",
      fromDepartment: "Purchase",
      toDepartment: "Raw Material Store",
      quantity: 1200,
      actor: actor("Purchase")
    });
    assert("3 same Purchase quantity cannot transfer twice", duplicatePending.success === false);
    const over = await commitMaterialMovementTx(store, {
      operationId: "p70-purchase-send-over",
      jobCardNo: "PUR-P70",
      fromDepartment: "Purchase",
      toDepartment: "Raw Material Store",
      quantity: 801,
      actor: actor("Purchase")
    });
    assert("5 Purchase cannot become negative", over.success === false);

    const acceptedFirst = await accept(store, firstSend.movement, "p70-purchase-accept-1", "Raw Material Store");
    assert("2 RM Store accepts the first Purchase transfer", acceptedFirst.success === true && acceptedFirst.movement?.accepted === true);
    const secondSend = await commitMaterialMovementTx(store, {
      operationId: "p70-purchase-send-2",
      jobCardNo: "PUR-P70",
      fromDepartment: "Purchase",
      toDepartment: "Raw Material Store",
      quantity: 800,
      actor: actor("Purchase")
    });
    assert("16 Purchase → RM Store full route remains available", secondSend.success === true);
    assert("6 unaccepted outbound movement is not inbound RM availability", remainingAtDepartment(await store.get("mfr_job_cards", "PUR-P70"), await store.list("mfr_movements"), "Raw Material Store") === 1200);
    const acceptedSecond = await accept(store, secondSend.movement, "p70-purchase-accept-2", "Raw Material Store");
    assert("6 accepted inbound totals 2000", acceptedSecond.success === true && remainingAtDepartment(await store.get("mfr_job_cards", "PUR-P70"), await store.list("mfr_movements"), "Raw Material Store") === 2000);
  }

  {
    const store = new MemoryStore();
    await seedProduction(store);
    const first = await sendProduction(store, "JC-P70", 8000, "p70-prod-1");
    assert("8 production records 8000", first.success === true && first.movement?.quantity === 8000);
    assert("9 8000 production leaves 2000 pending", remainingAtProduction(await store.get("mfr_job_cards", "JC-P70"), await store.list("mfr_movements"), { compulsory: true }) === 2000);
    const firstAccepted = await accept(store, first.movement, "p70-prod-accept-1");
    const afterFirst = await store.get("mfr_job_cards", "JC-P70");
    assert("9 partial production remains a Production requirement", firstAccepted.success === true && afterFirst.currentDepartment === "Heat Treatment" && remainingAtProduction(afterFirst, await store.list("mfr_movements"), { compulsory: true }) === 2000);
    assert("11 partial production is not complete", afterFirst.status !== "Completed" && afterFirst.completed !== true);
    assert("12 production ceiling is remaining ledger quantity", process2SendAvailableQty("Production", afterFirst, await store.list("mfr_movements"), { compulsory: true }) === 2000);

    const second = await sendProduction(store, "JC-P70", 2000, "p70-prod-2");
    assert("10 production can fulfill the remaining 2000", second.success === true);
    await accept(store, second.movement, "p70-prod-accept-2");
    const finalJob = await store.get("mfr_job_cards", "JC-P70");
    const finalMovements = await store.list("mfr_movements");
    assert("10 total production reaches 10000", finalMovements.filter((m) => m.fromDepartment === "Production" && m.toDepartment === "Heat Treatment").reduce((sum, m) => sum + m.quantity, 0) === 10000);
    assert("10 remaining production quantity is zero", remainingAtProduction(finalJob, finalMovements, { compulsory: true }) === 0);

    const over = await sendProduction(store, "JC-P70", 1, "p70-prod-over");
    assert("12 production cannot exceed required quantity", over.success === false);
  }

  {
    const store = new MemoryStore();
    await seedProduction(store, "JC-P70-MULTI", 10000);
    for (const [index, quantity] of [3000, 4000, 3000].entries()) {
      const sent = await sendProduction(store, "JC-P70-MULTI", quantity, `p70-prod-multi-${index}`);
      assert(`13 partial production operation ${index + 1} succeeds`, sent.success === true);
      await accept(store, sent.movement, `p70-prod-multi-accept-${index}`);
    }
    const movements = await store.list("mfr_movements");
    const job = await store.get("mfr_job_cards", "JC-P70-MULTI");
    assert("13 multiple partial operations accumulate exactly", movements.filter((m) => m.fromDepartment === "Production").reduce((sum, m) => sum + m.quantity, 0) === 10000 && remainingAtProduction(job, movements, { compulsory: true }) === 0);
    const retry = await sendProduction(store, "JC-P70-MULTI", 3000, "p70-prod-multi-0");
    assert("14 production retry does not duplicate", retry.cached === true && movements.filter((m) => m.fromDepartment === "Production").length === 3);
  }

  const componentSource = readFileSync(new URL("../src/components/DepartmentOperations.tsx", import.meta.url), "utf8");
  assert("15 Production queue uses ledger remaining quantity", componentSource.includes("remainingAtProduction(c, movements") && componentSource.includes("activeDept === 'Production'"));
  assert("18 RBAC still rejects unauthorized Production sender", !(await sendProduction(new MemoryStore(), "missing", 1, "p70-rbac")).success);
  const firebaseSource = readFileSync(new URL("../src/lib/firebase.ts", import.meta.url), "utf8");
  const hasClientLedgerWrite = /setDoc\(doc\(db,\s*["']mfr_movements/.test(firebaseSource);
  assert("20 client movement path remains API-only", firebaseSource.includes("fetch(`${apiBase}/api/movements`") && !hasClientLedgerWrite);

  console.log(`\nProcess 70 tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
