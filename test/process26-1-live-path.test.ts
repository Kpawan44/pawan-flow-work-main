import { createServer } from "node:http";
import express from "express";
import { AddressInfo } from "node:net";
import { MemoryStore } from "../src/hardening/memoryStore";
import { mountLedgerRoutes } from "../src/hardening/ledgerHttp";
import { applyJobCardPutPolicy } from "../src/hardening/jobCardUpdatePolicy";
import {
  denyDirectMovementDelete,
  denyDirectMovementUpdate,
  isLedgerCollectionBlockedFromClientSync
} from "../src/hardening/clientLedgerGuards";
import { remainingAtDepartment, process2SendAvailableQty, assertHeatTreatmentRouting } from "../src/hardening/process2Manufacturing";

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
    userId: extra.userId || `u-${dept.toLowerCase().replace(/\s+/g, "-")}`,
    userName: extra.userName || `${dept} User`,
    role: extra.role || "staff",
    department: dept,
    allowedDepartments: extra.allowedDepartments || [dept],
    accessList: extra.accessList || [dept]
  };
}

async function seedJob(store: MemoryStore, jobCardNo: string, extra: Record<string, any> = {}) {
  await store.set("mfr_job_cards", jobCardNo, {
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
  });
}

async function seedAcceptedRm(store: MemoryStore, jobCardNo: string, qty: number, op = `rm-${jobCardNo}-${qty}`) {
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
    requireAuth: (req, res, next) => {
      if (String(req.headers["x-test-auth"] || "") !== "ok") {
        return res.status(401).json({ success: false, error: "Unauthorized" });
      }
      next();
    },
    getStore: () => store,
    getActor: (req) => {
      const raw = String(req.headers["x-test-actor"] || "");
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return null;
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

async function api(base: string, method: string, path: string, body: any, who: ReturnType<typeof actor> | null, auth = true) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) headers["x-test-auth"] = "ok";
  if (who) headers["x-test-actor"] = JSON.stringify(who);
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

function countMovements(store: MemoryStore, jobCardNo: string) {
  return store.list("mfr_movements").then((rows) => rows.filter((m) => m.jobCardNo === jobCardNo && !m.processDetails?.isRejectionReturn && !m.processDetails?.isUndoReversal).length);
}

async function run() {
  assert("sync queue blocks mfr_movements", isLedgerCollectionBlockedFromClientSync("mfr_movements"));
  assert("sync queue blocks mfr_job_cards", isLedgerCollectionBlockedFromClientSync("mfr_job_cards"));
  assert("sync queue blocks idempotency keys", isLedgerCollectionBlockedFromClientSync("mfr_idempotency_keys"));
  assert("sync queue blocks purchase invoice claims", isLedgerCollectionBlockedFromClientSync("mfr_purchase_invoice_claims"));
  assert("sync queue blocks serialize locks", isLedgerCollectionBlockedFromClientSync("mfr_serialize_locks"));
  assert("sync queue allows notifications", isLedgerCollectionBlockedFromClientSync("mfr_notifications") === false);

  {
    let u = false;
    let d = false;
    try {
      denyDirectMovementUpdate();
    } catch {
      u = true;
    }
    try {
      denyDirectMovementDelete();
    } catch {
      d = true;
    }
    assert("11 DBService-path updateMovement cannot rewrite", u);
    assert("11 DBService-path deleteMovement cannot delete", d);
  }

  const store = new MemoryStore();
  await seedJob(store, "JC-P261");
  await seedAcceptedRm(store, "JC-P261", 130);
  const app = mountApp(store, true);

  await withServer(app, async (base) => {
    const unauth = await api(base, "POST", "/api/movements", { operationId: "x", jobCardNo: "JC-P261", fromDepartment: "Production", toDepartment: "Heat Treatment", quantity: 10 }, actor("Production"), false);
    assert("auth required on POST /api/movements", unauth.status === 401);

    const noActor = await api(base, "POST", "/api/movements", { operationId: "x", jobCardNo: "JC-P261", fromDepartment: "Production", toDepartment: "Heat Treatment", quantity: 10 }, null);
    assert("actor required on POST /api/movements", noActor.status === 401);

    const packingFromProd = await api(base, "POST", "/api/movements", {
      operationId: "op-rbac-bad",
      jobCardNo: "JC-P261",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 10
    }, actor("Packing"));
    assert("RBAC: Packing cannot send from Production", packingFromProd.status === 403);

    const skipHt = await api(base, "POST", "/api/movements", {
      operationId: "op-skip-ht",
      jobCardNo: "JC-P261",
      fromDepartment: "Production",
      toDepartment: "Plating",
      quantity: 10
    }, actor("Production"));
    assert("18 HTTP HT routing blocks Production→Plating", skipHt.status === 400);

    const missingOp = await api(base, "POST", "/api/movements", {
      jobCardNo: "JC-P261",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 10
    }, actor("Production"));
    assert("4 missing operationId → 400", missingOp.status === 400);

    const first = await api(base, "POST", "/api/movements", {
      operationId: "op-live-1",
      jobCardNo: "JC-P261",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 40
    }, actor("Production"));
    assert("1 HTTP POST movement", first.status === 200 && first.json.success === true);

    const retry = await api(base, "POST", "/api/movements", {
      operationId: "op-live-1",
      jobCardNo: "JC-P261",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 40
    }, actor("Production"));
    assert("2/9/10 same operationId retry is cached", retry.status === 200 && retry.json.cached === true && retry.json.movement.movementId === first.json.movement.movementId);

    const conflict = await api(base, "POST", "/api/movements", {
      operationId: "op-live-1",
      jobCardNo: "JC-P261",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 99
    }, actor("Production"));
    assert("3 same operationId different request → 409", conflict.status === 409);

    const afterRetryCount = await countMovements(store, "JC-P261");
    assert("6 retry after success does not duplicate", afterRetryCount === 2);

    const second = await api(base, "POST", "/api/movements", {
      operationId: "op-live-2",
      jobCardNo: "JC-P261",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 30
    }, actor("Production"));
    assert("5 distinct operationId blocked while first pending OR succeeds after", second.status === 400 || second.status === 200);

    const undoWrongDept = await api(
      base,
      "POST",
      `/api/movements/${encodeURIComponent(first.json.movement.movementId)}/undo`,
      { operationId: "op-undo-wrong", remarks: "nope" },
      actor("Heat Treatment")
    );
    assert("undo RBAC: receiver cannot undo sender transfer", undoWrongDept.status === 403);

    const undo = await api(
      base,
      "POST",
      `/api/movements/${encodeURIComponent(first.json.movement.movementId)}/undo`,
      { operationId: "op-undo-live", remarks: "Undo Bulk Transfer path" },
      actor("Production")
    );
    assert("4 HTTP POST undo pending", undo.status === 200 && undo.json.success === true);
    assert("undo preserves original quantity", undo.json.movement.quantity === 40 && undo.json.movement.undone === true);
    assert("undo creates reversal lineage", undo.json.returnMovement?.reversalOfMovementId === first.json.movement.movementId);
    const originalAfterUndo = await store.get("mfr_movements", first.json.movement.movementId);
    assert("undo does not delete original", Boolean(originalAfterUndo) && originalAfterUndo.quantity === 40);

    const resend = await api(base, "POST", "/api/movements", {
      operationId: "op-live-resend",
      jobCardNo: "JC-P261",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 50
    }, actor("Production"));
    assert("resend after undo", resend.status === 200, resend.json.error);

    const acceptWrong = await api(
      base,
      "POST",
      `/api/movements/${encodeURIComponent(resend.json.movement.movementId)}/accept`,
      { remarks: "no" },
      actor("Packing")
    );
    assert("accept RBAC: Packing cannot accept HT inbound", acceptWrong.status === 403);

    const accept = await api(
      base,
      "POST",
      `/api/movements/${encodeURIComponent(resend.json.movement.movementId)}/accept`,
      { remarks: "ok" },
      actor("Heat Treatment")
    );
    assert("2 HTTP POST accept", accept.status === 200 && accept.json.movement.accepted === true);

    const undoAccepted = await api(
      base,
      "POST",
      `/api/movements/${encodeURIComponent(resend.json.movement.movementId)}/undo`,
      { operationId: "op-undo-acc", remarks: "should fail" },
      actor("Production")
    );
    assert("accepted movement cannot be undone", undoAccepted.status === 400);

    const oversend = await api(base, "POST", "/api/movements", {
      operationId: "op-ht-over",
      jobCardNo: "JC-P261",
      fromDepartment: "Heat Treatment",
      toDepartment: "Plating",
      quantity: 51
    }, actor("Heat Treatment"));
    assert("17 downstream ceiling HTTP", oversend.status === 400);

    const jobInflated = await store.get("mfr_job_cards", "JC-P261");
    await store.set("mfr_job_cards", "JC-P261", { ...jobInflated, currentQty: 999999 });
    const inflatedSend = await api(base, "POST", "/api/movements", {
      operationId: "op-ht-inflated",
      jobCardNo: "JC-P261",
      fromDepartment: "Heat Treatment",
      toDepartment: "Plating",
      quantity: 51
    }, actor("Heat Treatment"));
    assert("currentQty=999999 cannot increase transferable qty", inflatedSend.status === 400);

    await store.set("mfr_job_cards", "JC-P261", { ...(await store.get("mfr_job_cards", "JC-P261")), currentQty: 0 });
    const remHt = remainingAtDepartment(await store.get("mfr_job_cards", "JC-P261"), await store.list("mfr_movements"), "Heat Treatment");
    assert("currentQty=0 is not treated as missing when ledger exists", remHt === 50, `got ${remHt}`);

    const htOk = await api(base, "POST", "/api/movements", {
      operationId: "op-ht-ok",
      jobCardNo: "JC-P261",
      fromDepartment: "Heat Treatment",
      toDepartment: "Plating",
      quantity: 20
    }, actor("Heat Treatment"));
    assert("partial HT transfer still works", htOk.status === 200, htOk.json.error);

    const rej = await api(
      base,
      "POST",
      `/api/movements/${encodeURIComponent(htOk.json.movement.movementId)}/reject`,
      { remarks: "partial 70/30 style", acceptedQty: 14, rejectedQty: 6 },
      actor("Plating")
    );
    assert("3 HTTP POST reject", rej.status === 200 && rej.json.success === true);
    assert("12 reject original qty immutable", rej.json.movement.quantity === 20);
    assert("13 rejection return to previous dept", rej.json.returnMovement?.toDepartment === "Heat Treatment");

    const putFields = [
      "currentQty",
      "currentDepartment",
      "quantity",
      "orderQty",
      "balanceQty",
      "accepted",
      "acceptedQty",
      "rejectedQty",
      "resolutionStatus",
      "parentMovementId",
      "originalMovementId",
      "movementId"
    ];
    for (const field of putFields) {
      const r = await api(base, "PUT", "/api/job-cards/JC-P261", { [field]: 1 }, actor("Heat Treatment"));
      assert(`6/7/8 PUT ${field} → 403`, r.status === 403);
    }

    const depts: Array<[string, Record<string, any>]> = [
      ["Production", { productionDetails: { producedQty: 1 }, operatorName: "P" }],
      ["Heat Treatment", { heatTreatmentDetails: { hardnessRequired: "HRC" } }],
      ["Plating", { platingDetails: { platingType: "Zn" } }],
      ["Packing", { packingDetails: { packedQty: 1 } }],
      ["Store", { storeDetails: { locationBin: "A1" } }],
      ["Dispatch", { dispatchDetails: { invoiceNo: "INV" }, completed: true, status: "Completed" }],
      ["Purchase", { purchaseDetails: { billNo: "B1" } }]
    ];
    for (const [dept, payload] of depts) {
      const r = await api(base, "PUT", "/api/job-cards/JC-P261", payload, actor(dept));
      assert(`7 ${dept} legitimate PUT`, r.status === 200, r.json.error);
    }
  });

  {
    const s = new MemoryStore();
    await seedJob(s, "JC-P261-R", { orderQty: 100 });
    await seedAcceptedRm(s, "JC-P261-R", 50);
    await seedAcceptedRm(s, "JC-P261-R", 30, "rm-b");
    await seedAcceptedRm(s, "JC-P261-R", 40, "rm-c");
    const app2 = mountApp(s, true);
    await withServer(app2, async (base) => {
      const overOrder = await api(base, "POST", "/api/movements", {
        operationId: "op-over",
        jobCardNo: "JC-P261-R",
        fromDepartment: "Production",
        toDepartment: "Heat Treatment",
        quantity: 110
      }, actor("Production"));
      assert("15 Production over orderQty with RM 120", overOrder.status === 200, overOrder.json.error);
      const ceiling = await api(base, "POST", "/api/movements", {
        operationId: "op-ceil",
        jobCardNo: "JC-P261-R",
        fromDepartment: "Production",
        toDepartment: "Heat Treatment",
        quantity: 11
      }, actor("Production"));
      assert("16 compulsory RM ceiling 50+30+40", ceiling.status === 400);
    });
  }

  {
    const s = new MemoryStore();
    await seedJob(s, "JC-P261-CY");
    await seedAcceptedRm(s, "JC-P261-CY", 100);
    const app3 = mountApp(s, true);
    await withServer(app3, async (base) => {
      const s1 = await api(base, "POST", "/api/movements", {
        operationId: "cyc-a",
        jobCardNo: "JC-P261-CY",
        fromDepartment: "Production",
        toDepartment: "Heat Treatment",
        quantity: 40
      }, actor("Production"));
      const r1 = await api(base, "POST", `/api/movements/${encodeURIComponent(s1.json.movement.movementId)}/reject`, { remarks: "c1" }, actor("Heat Treatment"));
      const s2 = await api(base, "POST", "/api/movements", {
        operationId: "cyc-b",
        jobCardNo: "JC-P261-CY",
        fromDepartment: "Production",
        toDepartment: "Heat Treatment",
        quantity: 40
      }, actor("Production"));
      const r2 = await api(base, "POST", `/api/movements/${encodeURIComponent(s2.json.movement.movementId)}/reject`, { remarks: "c2" }, actor("Heat Treatment"));
      const s3 = await api(base, "POST", "/api/movements", {
        operationId: "cyc-c",
        jobCardNo: "JC-P261-CY",
        fromDepartment: "Production",
        toDepartment: "Heat Treatment",
        quantity: 40
      }, actor("Production"));
      const a3 = await api(base, "POST", `/api/movements/${encodeURIComponent(s3.json.movement.movementId)}/accept`, { remarks: "ok" }, actor("Heat Treatment"));
      assert("14 multiple rejection cycles HTTP", r1.status === 200 && r2.status === 200 && a3.status === 200);
      assert("14 first original still 40", (await s.get("mfr_movements", s1.json.movement.movementId)).quantity === 40);
    });
  }

  {
    const ht = assertHeatTreatmentRouting({ heatTreatmentRequired: true }, "Production", "Plating");
    assert("18 helper HT skip blocked", ht.ok === false);
    const cap = process2SendAvailableQty("Heat Treatment", { jobCardNo: "X", currentQty: 999999 }, [{ jobCardNo: "X", toDepartment: "Heat Treatment", quantity: 10, accepted: true }], { compulsory: true });
    assert("inflated cache ignored when ledger exists", cap === 10);
  }

  {
    const existing = { jobCardNo: "JC-X", currentQty: 5, currentDepartment: "Packing", orderQty: 100 };
    const policy = applyJobCardPutPolicy(existing, { currentQty: 9, packingDetails: { packedQty: 1 } }, actor("Packing"));
    assert("PUT does not silently drop protected fields", policy.ok === false && (policy.rejectedFields || []).includes("currentQty"));
  }

  console.log(`\nProcess 26.1 tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
