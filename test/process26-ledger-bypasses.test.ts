import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import express from "express";
import { AddressInfo } from "node:net";
import { MemoryStore } from "../src/hardening/memoryStore";
import { mountLedgerRoutes } from "../src/hardening/ledgerHttp";
import { applyJobCardPutPolicy, omitLedgerFieldsFromJobCardPut } from "../src/hardening/jobCardUpdatePolicy";
import {
  denyDirectMovementDelete,
  denyDirectMovementUpdate,
  MOVEMENT_DELETE_BLOCKED_MESSAGE,
  MOVEMENT_UPDATE_BLOCKED_MESSAGE,
  JOB_CARD_CREATE_NO_CLIENT_FALLBACK_MESSAGE
} from "../src/hardening/clientLedgerGuards";
import { commitMaterialMovementTx } from "../src/hardening/commitMaterialMovement";
import { acceptMaterialMovementTx, rejectMaterialMovementTx, undoMaterialMovementTx } from "../src/hardening/resolveMaterialMovement";
import { remainingAtDepartment, productionSendAvailable } from "../src/hardening/process2Manufacturing";
import { resolveCreateMovementOperationId } from "../src/hardening/movementOperationId";

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

function actor(dept: string, extra: Record<string, any> = {}) {
  return {
    userId: `u-${dept.toLowerCase().replace(/\s+/g, "-")}`,
    userName: `${dept} User`,
    role: extra.role || "staff",
    department: dept,
    allowedDepartments: extra.allowedDepartments || [dept],
    accessList: extra.accessList || [dept]
  };
}

async function seedJob(store: MemoryStore, jobCardNo: string, extra: Record<string, any> = {}) {
  const job = {
    jobCardNo,
    orderQty: 100,
    currentQty: 100,
    currentDepartment: "Production",
    status: "In Process",
    processType: "Manufacturing",
    heatTreatmentRequired: true,
    version: 1,
    itemName: "Bolt",
    itemCode: "B-1",
    unit: "KGS",
    ...extra
  };
  await store.set("mfr_job_cards", jobCardNo, job);
  return job;
}

async function seedAcceptedRm(store: MemoryStore, jobCardNo: string, qty: number, op = `rm-${jobCardNo}`) {
  await store.set("mfr_movements", op, {
    movementId: op,
    jobCardNo,
    fromDepartment: "Raw Material Store",
    toDepartment: "Production",
    quantity: qty,
    accepted: true,
    isIssueRequest: true,
    issueStatus: "Issued"
  });
}

function mountApp(store: MemoryStore, compulsory = true) {
  const app = express();
  app.use(express.json());
  mountLedgerRoutes(app, {
    requireAuth: (_req, _res, next) => next(),
    getStore: () => store,
    getActor: (req) => {
      const raw = String(req.headers["x-test-actor"] || "");
      if (!raw) return actor("Production");
      try {
        return JSON.parse(raw);
      } catch {
        return actor("Production");
      }
    },
    getRmCompulsory: async () => compulsory
  });
  return app;
}

async function withServer<T>(app: express.Express, fn: (base: string) => Promise<T>): Promise<T> {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${addr.port}`;
  try {
    return await fn(base);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

async function api(
  base: string,
  method: string,
  path: string,
  body: any,
  who: ReturnType<typeof actor>
) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-test-actor": JSON.stringify(who)
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function run() {
  const firebaseSrc = readFileSync(new URL("../src/lib/firebase.ts", import.meta.url), "utf8");
  const createSlice = firebaseSrc.slice(
    firebaseSrc.indexOf("static async createJobCard"),
    firebaseSrc.indexOf("static async updateJobCard")
  );
  const updateMovSlice = firebaseSrc.slice(
    firebaseSrc.indexOf("static async updateMovement"),
    firebaseSrc.indexOf("static async deleteMovement")
  );
  const deleteMovSlice = firebaseSrc.slice(
    firebaseSrc.indexOf("static async deleteMovement"),
    firebaseSrc.indexOf("static async revertMovement")
  );

  // 1 updateMovement cannot rewrite quantity
  {
    let threw = false;
    let msg = "";
    try {
      denyDirectMovementUpdate();
    } catch (e: any) {
      threw = true;
      msg = e.message;
    }
    assert("1 updateMovement throws (no quantity rewrite)", threw && msg === MOVEMENT_UPDATE_BLOCKED_MESSAGE);
    assert("1 updateMovement source has no setDoc", !updateMovSlice.includes("setDoc"));
  }

  // 2 deleteMovement cannot delete
  {
    let threw = false;
    try {
      denyDirectMovementDelete();
    } catch (e: any) {
      threw = e.message === MOVEMENT_DELETE_BLOCKED_MESSAGE;
    }
    assert("2 deleteMovement throws (no physical delete)", threw);
    assert("2 deleteMovement source has no deleteDoc", !deleteMovSlice.includes("deleteDoc"));
  }

  // 3 revertMovement: valid undo reversal OR reject accepted
  {
    const store = new MemoryStore();
    await seedJob(store, "JC-P26-UNDO");
    await seedAcceptedRm(store, "JC-P26-UNDO", 80);
    const send = await commitMaterialMovementTx(store, {
      operationId: "op-undo-src",
      jobCardNo: "JC-P26-UNDO",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 40,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    const undone = await undoMaterialMovementTx(store, {
      operationId: "op-undo-1",
      movementId: send.movement.movementId,
      actor: actor("Production")
    });
    const original = await store.get("mfr_movements", send.movement.movementId);
    assert("3 pending undo succeeds", undone.success === true && Boolean(undone.returnMovement));
    assert("3 original movement not deleted", Boolean(original) && original.quantity === 40 && original.undone === true);
    assert("3 reversal lineage present", undone.returnMovement?.reversalOfMovementId === send.movement.movementId);

    const store2 = new MemoryStore();
    await seedJob(store2, "JC-P26-UNDO2");
    await seedAcceptedRm(store2, "JC-P26-UNDO2", 80);
    const send2 = await commitMaterialMovementTx(store2, {
      operationId: "op-undo-src2",
      jobCardNo: "JC-P26-UNDO2",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 20,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    await acceptMaterialMovementTx(store2, {
      operationId: "op-acc-u2",
      movementId: send2.movement.movementId,
      actor: actor("Heat Treatment")
    });
    const undoAccepted = await undoMaterialMovementTx(store2, {
      operationId: "op-undo-acc",
      movementId: send2.movement.movementId,
      actor: actor("Production")
    });
    assert("3 accepted undo is rejected", undoAccepted.success === false && undoAccepted.statusCode === 400);
  }

  // 4 job-card create cannot silently fall back to client Firestore
  {
    assert(
      "4 createJobCard has no setDoc fallback",
      !createSlice.includes("setDoc") && createSlice.includes("JOB_CARD_CREATE_NO_CLIENT_FALLBACK_MESSAGE")
    );
    assert("4 fail-closed message is explicit", JOB_CARD_CREATE_NO_CLIENT_FALLBACK_MESSAGE.includes("Direct Firestore fallback is disabled"));
  }

  // 5 ordinary department complete must not mutate ledger via currentQty PUT
  {
    const store = new MemoryStore();
    await seedJob(store, "JC-P26-CQ", { currentQty: 70, currentDepartment: "Heat Treatment" });
    const policy = applyJobCardPutPolicy(
      await store.get("mfr_job_cards", "JC-P26-CQ"),
      { currentQty: 12, heatTreatmentDetails: { qtySentToPlating: 12 } },
      actor("Heat Treatment")
    );
    assert("5 PUT currentQty rejected at policy", policy.ok === false && (policy.rejectedFields || []).includes("currentQty"));
    const clientPayload = omitLedgerFieldsFromJobCardPut({
      currentQty: 12,
      heatTreatmentDetails: { qtySentToPlating: 12 }
    });
    assert("5 client omit drops currentQty keeps details", clientPayload.currentQty === undefined && Boolean(clientPayload.heatTreatmentDetails));
  }

  // HTTP: POST movements, accept, reject, PUT job-cards
  {
    const store = new MemoryStore();
    await seedJob(store, "JC-P26-HTTP");
    await seedAcceptedRm(store, "JC-P26-HTTP", 100);
    const app = mountApp(store, true);
    await withServer(app, async (base) => {
      const missingOp = await api(base, "POST", "/api/movements", {
        jobCardNo: "JC-P26-HTTP",
        fromDepartment: "Production",
        toDepartment: "Heat Treatment",
        quantity: 30
      }, actor("Production"));
      assert("10 omitted operationId is 400 (no server mint)", missingOp.status === 400 && missingOp.json.success === false);

      const first = await api(base, "POST", "/api/movements", {
        operationId: "op-http-dup",
        jobCardNo: "JC-P26-HTTP",
        fromDepartment: "Production",
        toDepartment: "Heat Treatment",
        quantity: 40
      }, actor("Production"));
      const retry = await api(base, "POST", "/api/movements", {
        operationId: "op-http-dup",
        jobCardNo: "JC-P26-HTTP",
        fromDepartment: "Production",
        toDepartment: "Heat Treatment",
        quantity: 40
      }, actor("Production"));
      assert("10 POST /api/movements succeeds", first.status === 200 && first.json.success === true);
      assert(
        "10 duplicate operationId is idempotent",
        retry.status === 200 &&
          retry.json.cached === true &&
          retry.json.movement.movementId === first.json.movement.movementId
      );

      const accept = await api(
        base,
        "POST",
        `/api/movements/${encodeURIComponent(first.json.movement.movementId)}/accept`,
        { remarks: "HT received" },
        actor("Heat Treatment")
      );
      assert("HTTP POST /api/movements/:id/accept", accept.status === 200 && accept.json.movement.accepted === true);

      const second = await api(base, "POST", "/api/movements", {
        operationId: "op-http-rej",
        jobCardNo: "JC-P26-HTTP",
        fromDepartment: "Production",
        toDepartment: "Heat Treatment",
        quantity: 40
      }, actor("Production"));
      assert("HTTP second distinct movement", second.status === 200 && second.json.movement.movementId !== first.json.movement.movementId);

      const reject = await api(
        base,
        "POST",
        `/api/movements/${encodeURIComponent(second.json.movement.movementId)}/reject`,
        { remarks: "30 returned", rejectedQty: 30, acceptedQty: 10 },
        actor("Heat Treatment")
      );
      assert("HTTP POST /api/movements/:id/reject partial", reject.status === 200 && reject.json.success === true);
      assert("HTTP reject preserves original qty", reject.json.movement.quantity === 40);
      assert("HTTP reject return lineage", reject.json.returnMovement?.processDetails?.isRejectionReturn === true);

      const putQty = await api(base, "PUT", "/api/job-cards/JC-P26-HTTP", { currentQty: 1 }, actor("Heat Treatment"));
      assert("6 unauthorized PUT currentQty 403", putQty.status === 403);
      const putDept = await api(base, "PUT", "/api/job-cards/JC-P26-HTTP", { currentDepartment: "Dispatch" }, actor("Heat Treatment"));
      assert("8 client cannot PUT currentDepartment", putDept.status === 403);
      const putOrder = await api(base, "PUT", "/api/job-cards/JC-P26-HTTP", { orderQty: 999 }, actor("Heat Treatment"));
      assert("9 client cannot PUT orderQty", putOrder.status === 403);
      const putUnknown = await api(base, "PUT", "/api/job-cards/JC-P26-HTTP", { secretLedgerHack: true }, actor("Heat Treatment"));
      assert("6 unknown PUT field 403", putUnknown.status === 403);

      const qtyBeforeWorkflowPut = Number((await store.get("mfr_job_cards", "JC-P26-HTTP")).currentQty);
      const putOk = await api(
        base,
        "PUT",
        "/api/job-cards/JC-P26-HTTP",
        { heatTreatmentDetails: { hardnessRequired: "HRC 40" }, operatorName: "HT Op" },
        actor("Heat Treatment")
      );
      assert("7 authorized workflow PUT works", putOk.status === 200 && putOk.json.jobCard.heatTreatmentDetails.hardnessRequired === "HRC 40");
      assert("7 PUT does not change currentQty", Number(putOk.json.jobCard.currentQty) === qtyBeforeWorkflowPut);

      const putCompletedStaff = await api(base, "PUT", "/api/job-cards/JC-P26-HTTP", { completed: true }, actor("Heat Treatment"));
      assert("6 staff cannot PUT completed", putCompletedStaff.status === 403);

      const putCompletedDispatch = await api(
        base,
        "PUT",
        "/api/job-cards/JC-P26-HTTP",
        { status: "Completed", completed: true, dispatchDetails: { invoiceNo: "INV-1" } },
        actor("Dispatch")
      );
      assert("7 Dispatch completion PUT allowed", putCompletedDispatch.status === 200 && putCompletedDispatch.json.jobCard.completed === true);

      const after = await store.get("mfr_job_cards", "JC-P26-HTTP");
      assert("8 currentDepartment unchanged by rogue PUT", after.currentDepartment !== "Dispatch" || putDept.status === 403);
    });
  }

  // 11-16 Process 24 rules still hold
  {
    const store = new MemoryStore();
    await seedJob(store, "JC-P26-R1");
    await seedAcceptedRm(store, "JC-P26-R1", 100);
    const send = await commitMaterialMovementTx(store, {
      operationId: "op-r1",
      jobCardNo: "JC-P26-R1",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 100,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    const rej = await rejectMaterialMovementTx(store, {
      operationId: "op-r1r",
      movementId: send.movement.movementId,
      remarks: "full reject",
      actor: actor("Heat Treatment")
    });
    assert("11 rejection return to previous dept", rej.success === true && rej.returnMovement?.toDepartment === "Production");
    assert("11 original qty immutable", (await store.get("mfr_movements", send.movement.movementId)).quantity === 100);
  }

  {
    const store = new MemoryStore();
    await seedJob(store, "JC-P26-R2");
    await seedAcceptedRm(store, "JC-P26-R2", 100);
    const send = await commitMaterialMovementTx(store, {
      operationId: "op-r2",
      jobCardNo: "JC-P26-R2",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 100,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    const rej = await rejectMaterialMovementTx(store, {
      operationId: "op-r2r",
      movementId: send.movement.movementId,
      remarks: "partial",
      acceptedQty: 70,
      rejectedQty: 30,
      actor: actor("Heat Treatment")
    });
    const job = await store.get("mfr_job_cards", "JC-P26-R2");
    const htRem = remainingAtDepartment(job, await store.list("mfr_movements"), "Heat Treatment");
    const prodRem = remainingAtDepartment(job, await store.list("mfr_movements"), "Production");
    assert("12 partial accept/reject conserved", rej.success === true && htRem === 70 && prodRem >= 30);
  }

  {
    const store = new MemoryStore();
    await seedJob(store, "JC-P26-R3", { orderQty: 50 });
    await seedAcceptedRm(store, "JC-P26-R3", 80);
    const over = await commitMaterialMovementTx(store, {
      operationId: "op-r3",
      jobCardNo: "JC-P26-R3",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 80,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    assert("13 Production may exceed orderQty when RM allows", over.success === true);
    const blocked = await commitMaterialMovementTx(store, {
      operationId: "op-r3b",
      jobCardNo: "JC-P26-R3",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 1,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    assert("14 compulsory RM ceiling blocks extra", blocked.success === false);
  }

  {
    const store = new MemoryStore();
    await seedJob(store, "JC-P26-R4", { currentDepartment: "Heat Treatment", heatTreatmentRequired: true });
    await seedAcceptedRm(store, "JC-P26-R4", 100);
    const toHt = await commitMaterialMovementTx(store, {
      operationId: "op-r4a",
      jobCardNo: "JC-P26-R4",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 40,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    await acceptMaterialMovementTx(store, {
      operationId: "op-r4acc",
      movementId: toHt.movement.movementId,
      actor: actor("Heat Treatment")
    });
    const oversend = await commitMaterialMovementTx(store, {
      operationId: "op-r4b",
      jobCardNo: "JC-P26-R4",
      fromDepartment: "Heat Treatment",
      toDepartment: "Plating",
      quantity: 41,
      requireRawMaterialForProduction: true,
      actor: actor("Heat Treatment")
    });
    assert("15 downstream cannot exceed received", oversend.success === false);
    const ok = await commitMaterialMovementTx(store, {
      operationId: "op-r4c",
      jobCardNo: "JC-P26-R4",
      fromDepartment: "Heat Treatment",
      toDepartment: "Plating",
      quantity: 40,
      requireRawMaterialForProduction: true,
      actor: actor("Heat Treatment")
    });
    assert("15 downstream exact received allowed", ok.success === true);
  }

  {
    const store = new MemoryStore();
    await seedJob(store, "JC-P26-R5");
    await seedAcceptedRm(store, "JC-P26-R5", 100);
    const s1 = await commitMaterialMovementTx(store, {
      operationId: "op-r5-1",
      jobCardNo: "JC-P26-R5",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 50,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    await rejectMaterialMovementTx(store, {
      operationId: "op-r5-1r",
      movementId: s1.movement.movementId,
      remarks: "cycle 1",
      actor: actor("Heat Treatment")
    });
    const s2 = await commitMaterialMovementTx(store, {
      operationId: "op-r5-2",
      jobCardNo: "JC-P26-R5",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 50,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    const r2 = await rejectMaterialMovementTx(store, {
      operationId: "op-r5-2r",
      movementId: s2.movement.movementId,
      remarks: "cycle 2",
      actor: actor("Heat Treatment")
    });
    assert("16 multiple rejection cycles work", s2.success === true && r2.success === true && Boolean(r2.returnMovement));
    const avail = productionSendAvailable(await store.get("mfr_job_cards", "JC-P26-R5"), await store.list("mfr_movements"), { compulsory: true });
    assert("16 rejection returns restore Production availability", avail !== null && avail >= 50);
  }

  {
    const r = resolveCreateMovementOperationId({});
    assert("operationId helper requires client id", r.ok === false);
  }

  console.log(`\nProcess 26 tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
