import { createServer } from "node:http";
import express from "express";
import { AddressInfo } from "node:net";
import { MemoryStore } from "../src/hardening/memoryStore";
import { mountLedgerRoutes } from "../src/hardening/ledgerHttp";
import { applyJobCardPutPolicy } from "../src/hardening/jobCardUpdatePolicy";
import { commitMaterialMovementTx } from "../src/hardening/commitMaterialMovement";
import { acceptMaterialMovementTx, rejectMaterialMovementTx } from "../src/hardening/resolveMaterialMovement";
import {
  remainingAtDepartment,
  process2SendAvailableQty,
  creditedInboundQty
} from "../src/hardening/process2Manufacturing";
import { getJobCardProcessMetrics, getJobCardDepartmentPending } from "../src/lib/metrics";
import { ensureClientMovementOperationId } from "../src/hardening/movementOperationId";

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

async function run() {
  {
    const payload: Record<string, any> = { jobCardNo: "JC-1", quantity: 10 };
    const first = ensureClientMovementOperationId(payload);
    const second = ensureClientMovementOperationId(payload);
    assert("client retry reuses the same operationId", first === second && payload.operationId === first);
    const other: Record<string, any> = { jobCardNo: "JC-1", quantity: 10 };
    const third = ensureClientMovementOperationId(other);
    assert("separate payloads mint distinguishable operationIds", third !== first);
  }

  {
    const existing = { jobCardNo: "JC-X", heatTreatmentRequired: false, status: "In Process", currentDepartment: "Production" };
    const htStaff = applyJobCardPutPolicy(existing, { heatTreatmentRequired: true }, actor("Heat Treatment"));
    assert("18 unauthorized heatTreatmentRequired rejected", htStaff.ok === false && htStaff.statusCode === 403);
    const statusStaff = applyJobCardPutPolicy(existing, { status: "Completed" }, actor("Production"));
    assert("19 unauthorized Completed status rejected", statusStaff.ok === false && (statusStaff.rejectedFields || []).includes("status"));
    const prodOk = applyJobCardPutPolicy(existing, { status: "In Process", operatorName: "Op A" }, actor("Production"));
    assert("17 legitimate Production status PUT allowed", prodOk.ok === true);
    const dispHt = applyJobCardPutPolicy(existing, { heatTreatmentRequired: true }, actor("Dispatch"));
    assert("18 Dispatch may set heatTreatmentRequired", dispHt.ok === true);
    const purchHt = applyJobCardPutPolicy(existing, { heatTreatmentRequired: false }, actor("Purchase"));
    assert("Dispatch/Purchase amendment heatTreatmentRequired allowed", purchHt.ok === true);
    const dispDone = applyJobCardPutPolicy(existing, { status: "Completed", completed: true, dispatchDetails: { invoiceNo: "I-1" } }, actor("Dispatch"));
    assert("17 Dispatch completion PUT allowed", dispDone.ok === true);
  }

  {
    const job = { jobCardNo: "JC-FB", orderQty: 9999, currentQty: 8888, currentDepartment: "Incoming Store" };
    const moves = [{ jobCardNo: "JC-FB", fromDepartment: "Raw Material Store", toDepartment: "Production", quantity: 50, accepted: true }];
    const cap = process2SendAvailableQty("Incoming Store", job, moves);
    assert("Incoming Store sendAvail is ledger 0 not orderQty", cap === 0);
    const dispCap = process2SendAvailableQty("Dispatch", job, moves);
    assert("Dispatch sendAvail is ledger 0 not snapshot", dispCap === 0);
    const rem = remainingAtDepartment(job, moves, "Incoming Store");
    assert("legacy fallback cannot fire when history exists", rem === 0);
  }

  {
    const job = { jobCardNo: "JC-LEG", orderQty: 40, currentQty: 12, currentDepartment: "Incoming Store" };
    const rem = remainingAtDepartment(job, [], "Incoming Store");
    assert("LEGACY_NO_HISTORY_FALLBACK uses currentQty not orderQty", rem === 12);
  }

  const store = new MemoryStore();
  await seedJob(store, "JC-P27");
  await seedAcceptedRm(store, "JC-P27", 130);
  const app = mountApp(store, true);

  await withServer(app, async (base) => {
    const unauthPut = await api(base, "PUT", "/api/job-cards/JC-P27", { operatorName: "x" }, actor("Production"), false);
    assert("HTTP PUT job-cards requires auth", unauthPut.status === 401);

    const htFlag = await api(base, "PUT", "/api/job-cards/JC-P27", { heatTreatmentRequired: false }, actor("Production"));
    assert("HTTP unauthorized heatTreatmentRequired 403", htFlag.status === 403);

    const statusDone = await api(base, "PUT", "/api/job-cards/JC-P27", { status: "Completed" }, actor("Production"));
    assert("HTTP unauthorized Completed status 403", statusDone.status === 403);

    const legit = await api(base, "PUT", "/api/job-cards/JC-P27", { operatorName: "Prod Op", status: "In Process" }, actor("Production"));
    assert("HTTP legitimate Production PUT 200", legit.status === 200 && legit.json.jobCard.operatorName === "Prod Op");

    const dispHt = await api(base, "PUT", "/api/job-cards/JC-P27", { heatTreatmentRequired: true }, actor("Dispatch"));
    assert("HTTP Dispatch heatTreatmentRequired 200", dispHt.status === 200 && dispHt.json.jobCard.heatTreatmentRequired === true);

    const missingOp = await api(base, "POST", "/api/movements", {
      jobCardNo: "JC-P27",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 10
    }, actor("Production"));
    assert("operationId still required", missingOp.status === 400);

    const first = await api(base, "POST", "/api/movements", {
      operationId: "op-p27-retry",
      jobCardNo: "JC-P27",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 70
    }, actor("Production"));
    assert("POST movement 70", first.status === 200 && first.json.success === true);

    const retry = await api(base, "POST", "/api/movements", {
      operationId: "op-p27-retry",
      jobCardNo: "JC-P27",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 70
    }, actor("Production"));
    assert("12 same operationId retry one logical movement", retry.status === 200 && retry.json.cached === true && retry.json.movement.movementId === first.json.movement.movementId);

    const accept = await api(
      base,
      "POST",
      `/api/movements/${encodeURIComponent(first.json.movement.movementId)}/accept`,
      { remarks: "ok", acceptedQty: 70 },
      actor("Heat Treatment")
    );
    assert("HTTP accept 70", accept.status === 200);

    await store.set("mfr_job_cards", "JC-P27", { ...(await store.get("mfr_job_cards", "JC-P27")), currentQty: 999999, orderQty: 999999 });
    const over = await api(base, "POST", "/api/movements", {
      operationId: "op-p27-stale",
      jobCardNo: "JC-P27",
      fromDepartment: "Heat Treatment",
      toDepartment: "Plating",
      quantity: 71
    }, actor("Heat Treatment"));
    assert("20 stale currentQty cannot bypass ledger", over.status === 400);

    const okHt = await api(base, "POST", "/api/movements", {
      operationId: "op-p27-ht-ok",
      jobCardNo: "JC-P27",
      fromDepartment: "Heat Treatment",
      toDepartment: "Plating",
      quantity: 70
    }, actor("Heat Treatment"));
    assert("ledger remaining 70 still transferable", okHt.status === 200, okHt.json.error);

    const incomingOver = await api(base, "POST", "/api/movements", {
      operationId: "op-p27-inc",
      jobCardNo: "JC-P27",
      fromDepartment: "Incoming Store",
      toDepartment: "Production",
      quantity: 50
    }, actor("Incoming Store"));
    assert("Incoming Store cannot use orderQty snapshot", incomingOver.status === 400);
  });

  {
    const s = new MemoryStore();
    await seedJob(s, "JC-P27-M", { currentQty: 9999, orderQty: 100 });
    await seedAcceptedRm(s, "JC-P27-M", 100);
    const send = await commitMaterialMovementTx(s, {
      operationId: "m-send",
      jobCardNo: "JC-P27-M",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 100,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    const rej = await rejectMaterialMovementTx(s, {
      operationId: "m-rej",
      movementId: send.movement.movementId,
      remarks: "70/30",
      rejectedQty: 30,
      acceptedQty: 70,
      actor: actor("Heat Treatment")
    });
    assert("partial 70/30 reject ok", rej.success === true);
    const movs = await s.list("mfr_movements");
    const job = await s.get("mfr_job_cards", "JC-P27-M");
    const metrics = getJobCardProcessMetrics(job, movs);
    const htRemain = remainingAtDepartment(job, movs, "Heat Treatment");
    const credited = creditedInboundQty(await s.get("mfr_movements", send.movement.movementId));
    assert("21 metrics remaining matches ledger HT", metrics.qtyRemainingAtPlating === remainingAtDepartment(job, movs, "Plating"));
    assert("partial accept uses acceptedQty", credited === 70, `got ${credited}`);
    assert("HT remaining is accepted 70", htRemain === 70, `got ${htRemain}`);
    assert("metrics do not use inflated currentQty as remaining at prod transferable over RM", metrics.qtyRemainingAtProd <= 100);
    const pending = getJobCardDepartmentPending(job, movs);
    assert("pending does not use orderQty as remaining", pending.prodPending === remainingAtDepartment(job, movs, "Production") + remainingAtDepartment(job, movs, "Heat Treatment"));
  }

  {
    const s = new MemoryStore();
    await seedJob(s, "JC-P27-PEND");
    await seedAcceptedRm(s, "JC-P27-PEND", 80);
    const send = await commitMaterialMovementTx(s, {
      operationId: "pend-1",
      jobCardNo: "JC-P27-PEND",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 50,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    assert("pending outbound created", send.success === true);
    const cap = process2SendAvailableQty("Production", await s.get("mfr_job_cards", "JC-P27-PEND"), await s.list("mfr_movements"), { compulsory: true });
    assert("pending outbound reserves production qty", cap === 30, `got ${cap}`);
    const second = await commitMaterialMovementTx(s, {
      operationId: "pend-2",
      jobCardNo: "JC-P27-PEND",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 40,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    assert("cannot over-send while pending", second.success === false);
  }

  {
    const s = new MemoryStore();
    await seedJob(s, "JC-P27-RM2");
    await seedAcceptedRm(s, "JC-P27-RM2", 40, "rm-a");
    await seedAcceptedRm(s, "JC-P27-RM2", 50, "rm-b");
    const over = await commitMaterialMovementTx(s, {
      operationId: "rm-acc-over",
      jobCardNo: "JC-P27-RM2",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 91,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    assert("multiple RM issues accumulate to 90", over.success === false);
    const ok = await commitMaterialMovementTx(s, {
      operationId: "rm-acc-ok",
      jobCardNo: "JC-P27-RM2",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 90,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    assert("multiple RM issues allow 90", ok.success === true);
  }

  {
    const s = new MemoryStore();
    await seedJob(s, "JC-P27-CY");
    await seedAcceptedRm(s, "JC-P27-CY", 40);
    const s1 = await commitMaterialMovementTx(s, {
      operationId: "cy1",
      jobCardNo: "JC-P27-CY",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 40,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    await rejectMaterialMovementTx(s, { operationId: "cy1r", movementId: s1.movement.movementId, remarks: "c1", actor: actor("Heat Treatment") });
    const s2 = await commitMaterialMovementTx(s, {
      operationId: "cy2",
      jobCardNo: "JC-P27-CY",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 40,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    await rejectMaterialMovementTx(s, { operationId: "cy2r", movementId: s2.movement.movementId, remarks: "c2", actor: actor("Heat Treatment") });
    const s3 = await commitMaterialMovementTx(s, {
      operationId: "cy3",
      jobCardNo: "JC-P27-CY",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 40,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    const a3 = await acceptMaterialMovementTx(s, { operationId: "cy3a", movementId: s3.movement.movementId, remarks: "ok", actor: actor("Heat Treatment") });
    assert("multiple rejection cycles then accept", a3.success === true);
    const job = await s.get("mfr_job_cards", "JC-P27-CY");
    const movs = await s.list("mfr_movements");
    const metrics = getJobCardProcessMetrics(job, movs);
    assert("rejection return not double-counted in HT remaining", remainingAtDepartment(job, movs, "Heat Treatment") === 40);
    assert("metrics HT remaining agrees", metrics.qtyReceivedFromProd >= 0 && remainingAtDepartment(job, movs, "Heat Treatment") === 40);
  }

  {
    const s = new MemoryStore();
    await seedJob(s, "JC-P27-DS", { currentDepartment: "Heat Treatment", currentQty: 999 });
    await seedAcceptedRm(s, "JC-P27-DS", 80);
    await s.set("mfr_movements", "ht-in", {
      movementId: "ht-in",
      jobCardNo: "JC-P27-DS",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 80,
      accepted: true,
      acceptedQty: 80
    });
    const over = await commitMaterialMovementTx(s, {
      operationId: "ds-over",
      jobCardNo: "JC-P27-DS",
      fromDepartment: "Heat Treatment",
      toDepartment: "Plating",
      quantity: 81,
      actor: actor("Heat Treatment")
    });
    assert("downstream ceiling 80", over.success === false);
    const part = await commitMaterialMovementTx(s, {
      operationId: "ds-part",
      jobCardNo: "JC-P27-DS",
      fromDepartment: "Heat Treatment",
      toDepartment: "Plating",
      quantity: 30,
      actor: actor("Heat Treatment")
    });
    assert("partial downstream transfer", part.success === true);
    const rem = remainingAtDepartment(await s.get("mfr_job_cards", "JC-P27-DS"), await s.list("mfr_movements"), "Heat Treatment");
    assert("partial downstream remaining 50", rem === 50, `got ${rem}`);
  }

  console.log(`\nProcess 27 tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
