import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import express from "express";
import { AddressInfo } from "node:net";
import { MemoryStore } from "../src/hardening/memoryStore";
import { mountLedgerRoutes } from "../src/hardening/ledgerHttp";
import { applyJobCardPutPolicy } from "../src/hardening/jobCardUpdatePolicy";
import { commitMaterialMovementTx } from "../src/hardening/commitMaterialMovement";
import { acceptMaterialMovementTx, rejectMaterialMovementTx } from "../src/hardening/resolveMaterialMovement";
import { splitJobCardTx } from "../src/hardening/splitJobCard";
import { tombstoneJobCardTx, JOB_CARD_DELETE_PRESERVES_MOVEMENTS } from "../src/hardening/jobCardTombstone";
import { createSubcontractChallanTx } from "../src/hardening/subcontractChallan";
import { verifyBatchManifestTx } from "../src/hardening/batchManifestScanner";
import {
  remainingAtDepartment,
  productionSendAvailable
} from "../src/hardening/process2Manufacturing";
import {
  authorizeDatabaseRestore,
  isRestoreAdminRole,
  RESTORE_ADMIN_ONLY_MESSAGE,
  RESTORE_LEDGER_CLIENT_BLOCKED_MESSAGE
} from "../src/hardening/restoreDatabaseDumpPolicy";
import { JOB_CARD_CLIENT_DESTROY_BLOCKED_MESSAGE } from "../src/hardening/jobCardTombstone";

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
    const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
    const movementsBlock = rules.slice(rules.indexOf("match /mfr_movements"), rules.indexOf("match /mfr_idempotency_keys"));
    const jobBlock = rules.slice(rules.indexOf("match /mfr_job_cards"), rules.indexOf("match /mfr_movements"));
    assert("1 firestore rules deny client movement create/update/delete", /allow create, update, delete:\s*if false/.test(movementsBlock));
    assert("2/3 movement match does not allow isActiveUser writes", !movementsBlock.includes("allow create: if isActiveUser"));
    assert("4 firestore rules deny client job-card create/update/delete", /allow create, update, delete:\s*if false/.test(jobBlock));
    assert("4 job-card client cannot change currentQty via rules", jobBlock.includes("if false") && !jobBlock.includes("allow update: if isActiveUser"));
    assert("emulator not required for static rule parse", !rules.includes("allow create: if isActiveUser() &&") || !movementsBlock.includes("allow create: if isActiveUser"));
  }

  {
    assert("5 staff restore denied", authorizeDatabaseRestore({ role: "staff" }).ok === false);
    assert("5 staff restore message", authorizeDatabaseRestore({ role: "staff" }).error === RESTORE_ADMIN_ONLY_MESSAGE);
    assert("5 admin restore role allowed", authorizeDatabaseRestore({ role: "admin" }).ok === true);
    assert("5 super_admin restore role allowed", isRestoreAdminRole("super_admin"));
    const firebaseSrc = readFileSync(new URL("../src/lib/firebase.ts", import.meta.url), "utf8");
    const restoreSlice = firebaseSrc.slice(firebaseSrc.indexOf("static async restoreDatabaseDump"), firebaseSrc.indexOf("static subscribeToRealtimeEvents"));
    assert("5 restore calls verifyAdmin", restoreSlice.includes("await this.verifyAdmin(userId)"));
    assert("5 restore does not setDoc mfr_job_cards", !restoreSlice.includes("mfr_job_cards"));
    assert("5 restore does not setDoc mfr_movements", !restoreSlice.includes("mfr_movements"));
    assert("5 restore skip message present", restoreSlice.includes("RESTORE_LEDGER_CLIENT_BLOCKED_MESSAGE") || restoreSlice.includes(RESTORE_LEDGER_CLIENT_BLOCKED_MESSAGE.slice(0, 20)));
    const addQueue = firebaseSrc.slice(firebaseSrc.indexOf("static async addToSyncQueue"), firebaseSrc.indexOf("static async retrySyncItem"));
    assert("17 addToSyncQueue refuses ledger collections", addQueue.includes("isLedgerCollectionBlockedFromClientSync"));
    const purgeSlice = firebaseSrc.slice(firebaseSrc.indexOf("static async deleteAllJobCards"), firebaseSrc.indexOf("static async factoryReset"));
    assert("purge has no client deleteDoc fallback", !purgeSlice.includes("deleteDoc(doc") && !purgeSlice.includes("falling back to direct Firestore"));
    assert("purge fail-closed without API", purgeSlice.includes("FACTORY_PURGE_NO_CLIENT_FIRESTORE_MESSAGE"));
    const splitSrc = readFileSync(new URL("../src/components/SplitJobModal.tsx", import.meta.url), "utf8");
    assert("split has no client splitJobCardTx fallback", !splitSrc.includes("splitJobCardTx("));
    assert("split requires auth headers", splitSrc.includes("getAuthHeaders"));
  }

  {
    const store = new MemoryStore();
    await store.set("mfr_job_cards", "PUR-P28", {
      jobCardNo: "PUR-P28",
      orderQty: 9999,
      currentQty: 80,
      currentDepartment: "Purchase",
      processType: "Purchase",
      purchaseDetails: { billNo: "INV-P28", supplierName: "P28 Supplier", receivedQty: 80, rejectionQty: 0 },
      partyName: "P28 Supplier",
      itemName: "Bar",
      itemCode: "BAR-P28",
      materialType: "Raw Material",
      version: 1
    });
    const over = await commitMaterialMovementTx(store, {
      operationId: "pur-over",
      jobCardNo: "PUR-P28",
      fromDepartment: "Purchase",
      toDepartment: "Raw Material Store",
      quantity: 81,
      processDetails: { billNo: "INV-P28", supplierName: "P28 Supplier", itemCode: "BAR-P28" },
      actor: actor("Purchase")
    });
    assert("6 Purchase cannot invent qty beyond currentQty with no history", over.success === false);
    const ok = await commitMaterialMovementTx(store, {
      operationId: "pur-ok",
      jobCardNo: "PUR-P28",
      fromDepartment: "Purchase",
      toDepartment: "Raw Material Store",
      quantity: 80,
      processDetails: { billNo: "INV-P28", supplierName: "P28 Supplier", itemCode: "BAR-P28" },
      actor: actor("Purchase")
    });
    assert("6 Purchase first receipt of currentQty still works", ok.success === true);
    await store.set("mfr_job_cards", "PUR-P28", {
      ...(await store.get("mfr_job_cards", "PUR-P28")),
      currentQty: 999999,
      orderQty: 999999
    });
    const extra = await commitMaterialMovementTx(store, {
      operationId: "pur-extra",
      jobCardNo: "PUR-P28",
      fromDepartment: "Purchase",
      toDepartment: "Store",
      quantity: 1,
      processDetails: { billNo: "INV-P28", supplierName: "P28 Supplier", itemCode: "BAR-P28" },
      actor: actor("Purchase")
    });
    assert("6 Purchase cannot send again from inflated snapshot", extra.success === false);
  }

  {
    const store = new MemoryStore();
    await seedJob(store, "JC-P28-RM", { itemCode: "EN8-R" });
    await store.set("mfr_rm_sku_master", "EN8-R", { code: "EN8-R", openingQty: 50 });
    const over = await commitMaterialMovementTx(store, {
      operationId: "rm-over",
      jobCardNo: "JC-P28-RM",
      fromDepartment: "Raw Material Store",
      toDepartment: "Production",
      quantity: 51,
      isIssueRequest: true,
      requestedQty: 51,
      processDetails: { rawMaterialCode: "EN8-R" },
      actor: actor("Raw Material Store")
    });
    assert("7 RM Store cannot issue more than SKU stock", over.success === false);
    const ok = await commitMaterialMovementTx(store, {
      operationId: "rm-ok",
      jobCardNo: "JC-P28-RM",
      fromDepartment: "Raw Material Store",
      toDepartment: "Production",
      quantity: 50,
      isIssueRequest: true,
      requestedQty: 50,
      processDetails: { rawMaterialCode: "EN8-R" },
      actor: actor("Raw Material Store")
    });
    assert("7 RM Store issue within SKU stock works", ok.success === true);
  }

  {
    const store = new MemoryStore();
    await seedJob(store, "JC-P28-SP", { currentQty: 9999, orderQty: 9999, currentDepartment: "Heat Treatment" });
    await seedAcceptedRm(store, "JC-P28-SP", 80);
    await store.set("mfr_movements", "ht-in", {
      movementId: "ht-in",
      jobCardNo: "JC-P28-SP",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 80,
      accepted: true,
      acceptedQty: 80
    });
    const overCq = await splitJobCardTx(store, {
      operationId: "sp-cq",
      parentJobCardNo: "JC-P28-SP",
      childSplits: [{ childJobCardNo: "JC-P28-SP-A", quantity: 81 }],
      actor: actor("Production", { role: "admin" })
    });
    assert("8 inflated currentQty cannot increase split", overCq.success === false);
    const overOq = await splitJobCardTx(store, {
      operationId: "sp-oq",
      parentJobCardNo: "JC-P28-SP",
      childSplits: [{ childJobCardNo: "JC-P28-SP-B", quantity: 81 }],
      actor: actor("Production", { role: "admin" })
    });
    assert("9 inflated orderQty cannot increase split", overOq.success === false);
    const ok = await splitJobCardTx(store, {
      operationId: "sp-ok",
      parentJobCardNo: "JC-P28-SP",
      childSplits: [
        { childJobCardNo: "JC-P28-SP-C1", quantity: 50 },
        { childJobCardNo: "JC-P28-SP-C2", quantity: 30 }
      ],
      actor: actor("Production", { role: "admin" })
    });
    assert("10 valid split still works", ok.success === true);
    const parent = await store.get("mfr_job_cards", "JC-P28-SP");
    const c1 = await store.get("mfr_job_cards", "JC-P28-SP-C1");
    const c2 = await store.get("mfr_job_cards", "JC-P28-SP-C2");
    assert("10 parent+child conserved 80", parent.currentQty === 0 && c1.orderQty === 50 && c2.orderQty === 30);
  }

  {
    const store = new MemoryStore();
    await seedJob(store, "JC-P28-DEL");
    await store.set("mfr_movements", "keep-me", {
      movementId: "keep-me",
      jobCardNo: "JC-P28-DEL",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 10,
      accepted: true
    });
    const del = await tombstoneJobCardTx(store, {
      jobCardNo: "JC-P28-DEL",
      actor: { userId: "admin", userName: "Admin", role: "admin" }
    });
    assert("11 tombstone succeeds", del.success === true);
    assert("11 movements not deleted", JOB_CARD_DELETE_PRESERVES_MOVEMENTS === true);
    const mov = await store.get("mfr_movements", "keep-me");
    assert("11 movement history survives", mov && mov.quantity === 10);
    const firebaseSrc = readFileSync(new URL("../src/lib/firebase.ts", import.meta.url), "utf8");
    const delSlice = firebaseSrc.slice(firebaseSrc.indexOf("static async deleteJobCard"), firebaseSrc.indexOf("static async deleteAllJobCards"));
    assert("11 client deleteJobCard has no movement deleteDoc", !delSlice.includes("collection(db, 'mfr_movements')") && !delSlice.includes('collection(db, "mfr_movements")'));
    assert("11 client delete fail-closed", delSlice.includes("JOB_CARD_CLIENT_DESTROY_BLOCKED_MESSAGE") || delSlice.includes(JOB_CARD_CLIENT_DESTROY_BLOCKED_MESSAGE.slice(0, 24)));
    const serverSrc = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
    const serverDel = serverSrc.slice(serverSrc.indexOf('app.delete("/api/job-cards/:jobCardNo"'), serverSrc.indexOf("handleCompleteFactoryPurge"));
    assert("11 server delete does not cascade movements", !serverDel.includes("Cascade delete movements") && !serverDel.includes('collection("mfr_movements")'));
  }

  {
    const job = { jobCardNo: "JC-P28-CH", currentQty: 9999, orderQty: 9999, currentDepartment: "Store", unit: "PCS" };
    const moves = [
      {
        jobCardNo: "JC-P28-CH",
        fromDepartment: "Packing",
        toDepartment: "Store",
        quantity: 100,
        accepted: true,
        acceptedQty: 100
      }
    ];
    const over = createSubcontractChallanTx(
      {
        vendorName: "Vendor",
        items: [{ jobCardNo: "JC-P28-CH", itemName: "Bolt", processRequired: "Plate", sentQty: 101 }],
        userId: "u1",
        userName: "U"
      },
      new Map([["JC-P28-CH", job]]),
      new Set(),
      moves
    );
    assert("12 challan ignores stale currentQty", over.success === false);
    const ok = createSubcontractChallanTx(
      {
        vendorName: "Vendor",
        items: [{ jobCardNo: "JC-P28-CH", itemName: "Bolt", processRequired: "Plate", sentQty: 100 }],
        userId: "u1",
        userName: "U"
      },
      new Map([["JC-P28-CH", job]]),
      new Set(),
      moves
    );
    assert("12 challan allows ledger store qty", ok.success === true);
  }

  {
    const job = { jobCardNo: "JC-P28-SC", currentQty: 9999, currentDepartment: "Store", status: "In Store", unit: "PCS" };
    const moves = [
      { jobCardNo: "JC-P28-SC", fromDepartment: "Packing", toDepartment: "Store", quantity: 40, accepted: true, acceptedQty: 40 }
    ];
    const over = verifyBatchManifestTx([{ scannedCode: "JC-P28-SC", expectedQty: 41 }], new Map([["JC-P28-SC", job]]), "M", "G", moves);
    assert("13 scanner ignores stale currentQty", over.isDispatchable === false && over.items[0].status === "QUANTITY_MISMATCH");
    const ok = verifyBatchManifestTx([{ scannedCode: "JC-P28-SC", expectedQty: 40 }], new Map([["JC-P28-SC", job]]), "M", "G", moves);
    assert("13 scanner allows ledger store qty", ok.isDispatchable === true);
  }

  {
    const existing = { jobCardNo: "JC-X", status: "In Process", currentDepartment: "Production" };
    const wrong = applyJobCardPutPolicy(existing, { heatTreatmentDetails: { hardness: "x" } }, actor("Production"));
    assert("14 cross-department Details rejected", wrong.ok === false && (wrong.rejectedFields || []).includes("heatTreatmentDetails"));
    const own = applyJobCardPutPolicy(existing, { productionDetails: { producedQty: 1 } }, actor("Production"));
    assert("15 own department Details allowed", own.ok === true);
    const admin = applyJobCardPutPolicy(existing, { heatTreatmentDetails: { hardness: "y" } }, actor("Admin", { role: "admin", department: "Admin" }));
    assert("15 admin Details allowed", admin.ok === true);
    const disp = applyJobCardPutPolicy(existing, { dispatchDetails: { invoiceNo: "I" } }, actor("Dispatch"));
    assert("24 Dispatch details allowed", disp.ok === true);
  }

  {
    const s = new MemoryStore();
    await seedJob(s, "JC-P28-24");
    await seedAcceptedRm(s, "JC-P28-24", 100);
    const send = await commitMaterialMovementTx(s, {
      operationId: "p28-send",
      jobCardNo: "JC-P28-24",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 100,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    const rej = await rejectMaterialMovementTx(s, {
      operationId: "p28-rej",
      movementId: send.movement.movementId,
      remarks: "70/30",
      rejectedQty: 30,
      acceptedQty: 70,
      actor: actor("Heat Treatment")
    });
    assert("16/17 reject 70/30 works", rej.success === true);
    const original = await s.get("mfr_movements", send.movement.movementId);
    assert("16 original qty immutable 100", original.quantity === 100);
    assert("17 accepted 70 rejected 30", Number(original.acceptedQty) === 70 && Number(original.rejectedQty) === 30);
    const job = await s.get("mfr_job_cards", "JC-P28-24");
    const movs = await s.list("mfr_movements");
    assert("17 HT remaining 70", remainingAtDepartment(job, movs, "Heat Treatment") === 70);
    assert("16 return lineage", Boolean(rej.returnMovement?.processDetails?.isRejectionReturn));
  }

  {
    const s = new MemoryStore();
    await seedJob(s, "JC-P28-OV", { orderQty: 100 });
    await seedAcceptedRm(s, "JC-P28-OV", 130);
    const overOrder = await commitMaterialMovementTx(s, {
      operationId: "ov-ok",
      jobCardNo: "JC-P28-OV",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 110,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    assert("18 Production may exceed orderQty when RM allows", overOrder.success === true);
    const tooMuch = await commitMaterialMovementTx(s, {
      operationId: "ov-no",
      jobCardNo: "JC-P28-OV",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 21,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    assert("19 compulsory RM ceiling", tooMuch.success === false);
    const cap = productionSendAvailable(await s.get("mfr_job_cards", "JC-P28-OV"), await s.list("mfr_movements"), { compulsory: true });
    assert("19 remaining RM after 110 of 130 is 20", cap === 20);
  }

  {
    const s = new MemoryStore();
    await seedJob(s, "JC-P28-DS", { currentDepartment: "Heat Treatment", currentQty: 999 });
    await seedAcceptedRm(s, "JC-P28-DS", 80);
    await s.set("mfr_movements", "ht-in-2", {
      movementId: "ht-in-2",
      jobCardNo: "JC-P28-DS",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 80,
      accepted: true,
      acceptedQty: 80
    });
    const over = await commitMaterialMovementTx(s, {
      operationId: "ds-over",
      jobCardNo: "JC-P28-DS",
      fromDepartment: "Heat Treatment",
      toDepartment: "Plating",
      quantity: 81,
      actor: actor("Heat Treatment")
    });
    assert("20 downstream ceiling", over.success === false);
  }

  {
    const s = new MemoryStore();
    await seedJob(s, "JC-P28-CY");
    await seedAcceptedRm(s, "JC-P28-CY", 40);
    const s1 = await commitMaterialMovementTx(s, {
      operationId: "cy1",
      jobCardNo: "JC-P28-CY",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 40,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    await rejectMaterialMovementTx(s, { operationId: "cy1r", movementId: s1.movement.movementId, remarks: "c1", actor: actor("Heat Treatment") });
    const s2 = await commitMaterialMovementTx(s, {
      operationId: "cy2",
      jobCardNo: "JC-P28-CY",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 40,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    await rejectMaterialMovementTx(s, { operationId: "cy2r", movementId: s2.movement.movementId, remarks: "c2", actor: actor("Heat Treatment") });
    const s3 = await commitMaterialMovementTx(s, {
      operationId: "cy3",
      jobCardNo: "JC-P28-CY",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 40,
      requireRawMaterialForProduction: true,
      actor: actor("Production")
    });
    const a3 = await acceptMaterialMovementTx(s, { operationId: "cy3a", movementId: s3.movement.movementId, remarks: "ok", actor: actor("Heat Treatment") });
    assert("21 multiple rejection cycles then accept", a3.success === true);
  }

  const store = new MemoryStore();
  await seedJob(store, "JC-P28-HTTP");
  await seedAcceptedRm(store, "JC-P28-HTTP", 130);
  const app = mountApp(store, true);
  await withServer(app, async (base) => {
    const missingOp = await api(base, "POST", "/api/movements", {
      jobCardNo: "JC-P28-HTTP",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 10
    }, actor("Production"));
    assert("22 operationId required", missingOp.status === 400);

    const first = await api(base, "POST", "/api/inventory/movement", {
      operationId: "op-p28-retry",
      jobCardNo: "JC-P28-HTTP",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 70
    }, actor("Production"));
    assert("22 POST /api/inventory/movement 70", first.status === 200);
    const retry = await api(base, "POST", "/api/movements", {
      operationId: "op-p28-retry",
      jobCardNo: "JC-P28-HTTP",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 70
    }, actor("Production"));
    assert("22 same operationId cached", retry.status === 200 && retry.json.cached === true);

    const conflict = await api(base, "POST", "/api/movements", {
      operationId: "op-p28-retry",
      jobCardNo: "JC-P28-HTTP",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 71
    }, actor("Production"));
    assert("22 fingerprint conflict 409", conflict.status === 409);

    const unauthPut = await api(base, "PUT", "/api/job-cards/JC-P28-HTTP", { operatorName: "x" }, actor("Production"), false);
    assert("HTTP PUT requires auth", unauthPut.status === 401);
    const unauthAccept = await api(base, "POST", `/api/movements/${encodeURIComponent(first.json.movement.movementId)}/accept`, { remarks: "x" }, actor("Heat Treatment"), false);
    assert("HTTP ACCEPT requires auth", unauthAccept.status === 401);
    const packingSend = await api(base, "POST", "/api/movements", {
      operationId: "op-p28-unauth-dept",
      jobCardNo: "JC-P28-HTTP",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 1
    }, actor("Packing"));
    assert("unauthorized department POST blocked", packingSend.status === 403);

    const undoPending = await api(
      base,
      "POST",
      `/api/movements/${encodeURIComponent(first.json.movement.movementId)}/undo`,
      { operationId: "op-p28-undo", remarks: "undo pending" },
      actor("Production")
    );
    assert("HTTP UNDO pending", undoPending.status === 200 && undoPending.json.success === true);
    assert("HTTP undo preserves original qty", undoPending.json.movement.quantity === 70 && undoPending.json.movement.undone === true);

    const resend = await api(base, "POST", "/api/movements", {
      operationId: "op-p28-resend",
      jobCardNo: "JC-P28-HTTP",
      fromDepartment: "Production",
      toDepartment: "Heat Treatment",
      quantity: 100
    }, actor("Production"));
    assert("HTTP POST after undo", resend.status === 200);

    const packingAccept = await api(
      base,
      "POST",
      `/api/movements/${encodeURIComponent(resend.json.movement.movementId)}/accept`,
      { remarks: "nope" },
      actor("Packing")
    );
    assert("HTTP ACCEPT unauthorized department", packingAccept.status === 403);

    const rejectPartial = await api(
      base,
      "POST",
      `/api/movements/${encodeURIComponent(resend.json.movement.movementId)}/reject`,
      { remarks: "70/30 HTTP", rejectedQty: 30, acceptedQty: 70 },
      actor("Heat Treatment")
    );
    assert("HTTP REJECT partial 70/30", rejectPartial.status === 200 && rejectPartial.json.success === true);
    assert("HTTP reject original qty immutable", rejectPartial.json.movement.quantity === 100);
    assert("HTTP reject acceptedQty 70", Number(rejectPartial.json.movement.acceptedQty) === 70);
    assert("HTTP return lineage", Boolean(rejectPartial.json.returnMovement?.processDetails?.isRejectionReturn));

    const putQty = await api(base, "PUT", "/api/job-cards/JC-P28-HTTP", { currentQty: 1 }, actor("Production"));
    assert("23 PUT currentQty 403", putQty.status === 403);
    const putCross = await api(base, "PUT", "/api/job-cards/JC-P28-HTTP", { heatTreatmentDetails: { x: 1 } }, actor("Production"));
    assert("14 HTTP cross-dept Details 403", putCross.status === 403);
    const putOwn = await api(base, "PUT", "/api/job-cards/JC-P28-HTTP", { productionDetails: { producedQty: 2 } }, actor("Production"));
    assert("15 HTTP own Details 200", putOwn.status === 200);
    const putDisp = await api(base, "PUT", "/api/job-cards/JC-P28-HTTP", { dispatchDetails: { invoiceNo: "INV-28" } }, actor("Dispatch"));
    assert("24 HTTP Dispatch PUT 200", putDisp.status === 200 && putDisp.json.jobCard.dispatchDetails.invoiceNo === "INV-28");
  });

  console.log(`\nProcess 28 tests: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
