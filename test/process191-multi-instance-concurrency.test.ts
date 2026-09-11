import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { commitMaterialMovementTx, SimpleStore } from "../src/hardening/commitMaterialMovement";
import {
  ExclusiveLockDb,
  ExclusiveLockRef,
  createKeyedSerializer,
  runWithExclusiveLock
} from "../src/hardening/movementSerialize";
import { unproducedOrderQty } from "../src/hardening/process2Manufacturing";
import { FileJsonStore } from "./process191-file-store";

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

function actor(dept: string) {
  return {
    userId: `u-${dept.toLowerCase().replace(/\s+/g, "-")}`,
    userName: `${dept} User`,
    role: "staff",
    department: dept,
    allowedDepartments: [dept],
    accessList: [dept]
  };
}

class SharedMapStore implements SimpleStore {
  private data = new Map<string, Map<string, any>>();
  listDelayMs = 0;
  runSerialized?: <T>(key: string, fn: () => Promise<T>) => Promise<T>;

  private col(name: string): Map<string, any> {
    if (!this.data.has(name)) this.data.set(name, new Map());
    return this.data.get(name)!;
  }

  async get(collection: string, id: string): Promise<any | null> {
    const v = this.col(collection).get(id);
    return v ? JSON.parse(JSON.stringify(v)) : null;
  }

  async set(collection: string, id: string, data: any): Promise<void> {
    this.col(collection).set(id, JSON.parse(JSON.stringify(data)));
  }

  async list(collection: string): Promise<any[]> {
    const rows = Array.from(this.col(collection).values()).map((v) => JSON.parse(JSON.stringify(v)));
    if (this.listDelayMs) await new Promise((r) => setTimeout(r, this.listDelayMs));
    return rows;
  }
}

/** Firestore-like single-doc transactions: one transaction at a time, then fn runs outside. */
class MemoryLockDb implements ExclusiveLockDb {
  private docs = new Map<string, { owner?: string; expiresAtMs?: number }>();
  private tail: Promise<unknown> = Promise.resolve();

  collection(_name: string): { doc(id: string): ExclusiveLockRef } {
    return {
      doc: (id: string): ExclusiveLockRef & { __id: string } => {
        const ref = {
          __id: id,
          delete: async () => {
            this.docs.delete(id);
          }
        };
        return ref;
      }
    };
  }

  runTransaction<T>(update: (tx: any) => Promise<T>): Promise<T> {
    const run = this.tail.then(async () => {
      const writes: Array<() => void> = [];
      const tx = {
        get: async (ref: { __id: string }) => {
          const data = this.docs.get(ref.__id);
          return {
            exists: Boolean(data),
            data: () => data
          };
        },
        set: (ref: { __id: string }, data: Record<string, unknown>) => {
          writes.push(() => this.docs.set(ref.__id, data as any));
        }
      };
      const result = await update(tx);
      writes.forEach((w) => w());
      return result;
    });
    this.tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}

async function seedProductionJob(store: SimpleStore, jobCardNo: string) {
  await store.set("mfr_job_cards", jobCardNo, {
    jobCardNo,
    orderQty: 1000,
    currentQty: 1000,
    currentDepartment: "Production",
    status: "Pending",
    processType: "Manufacturing",
    version: 1
  });
  await store.set("mfr_movements", `rm-${jobCardNo}`, {
    movementId: `rm-${jobCardNo}`,
    jobCardNo,
    fromDepartment: "Raw Material Store",
    toDepartment: "Production",
    isIssueRequest: true,
    issueStatus: "Issued",
    accepted: true,
    quantity: 1000
  });
}

function send600(store: SimpleStore, jobCardNo: string, operationId: string) {
  return commitMaterialMovementTx(store, {
    operationId,
    jobCardNo,
    fromDepartment: "Production",
    toDepartment: "Heat Treatment",
    quantity: 600,
    requireRawMaterialForProduction: true,
    actor: actor("Production")
  });
}

async function twoProcessFileLockTest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p191-"));
  const dataFile = path.join(dir, "store.json");
  const lockRoot = path.join(dir, "locks");
  const jobCardNo = "JC-P191-PROC";
  const seed = new FileJsonStore(dataFile, lockRoot);
  await seedProductionJob(seed, jobCardNo);

  const workerPath = path.join(process.cwd(), "test/process191-worker.ts");
  const spawnOne = (op: string) =>
    new Promise<{ success: boolean; quantity: number; error: string | null }>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", workerPath],
        {
          env: {
            ...process.env,
            P191_STORE: dataFile,
            P191_LOCK: lockRoot,
            P191_JOB: jobCardNo,
            P191_OP: op,
            P191_QTY: "600"
          }
        }
      );
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => {
        out += String(d);
      });
      child.stderr.on("data", (d) => {
        err += String(d);
      });
      child.on("close", () => {
        try {
          const line = out.trim().split("\n").filter(Boolean).pop() || "{}";
          resolve(JSON.parse(line));
        } catch (e) {
          reject(new Error(`worker parse failed: ${out} ${err} ${e}`));
        }
      });
    });

  const [a, b] = await Promise.all([spawnOne("p191-proc-a"), spawnOne("p191-proc-b")]);
  const ok = [a, b].filter((r) => r.success);
  const committed = ok.reduce((s, r) => s + Number(r.quantity || 0), 0);
  const after = new FileJsonStore(dataFile, lockRoot);
  const moves = await after.list("mfr_movements");
  const job = await after.get("mfr_job_cards", jobCardNo);
  const remaining = unproducedOrderQty(job, moves);
  assert(
    "two OS processes 600+600 committed <= 1000",
    committed <= 1000 && ok.length === 1 && remaining === 400,
    `committed=${committed} ok=${ok.length} remaining=${remaining} a=${JSON.stringify(a)} b=${JSON.stringify(b)}`
  );
}

async function exclusiveLockSameStoreTest() {
  const store = new SharedMapStore();
  store.listDelayMs = 40;
  const lockDb = new MemoryLockDb();
  store.runSerialized = (key, fn) =>
    runWithExclusiveLock({
      key,
      fn,
      db: lockDb,
      fallback: createKeyedSerializer()
    });
  const jobCardNo = "JC-P191-LOCK";
  await seedProductionJob(store, jobCardNo);
  const [x, y] = await Promise.all([send600(store, jobCardNo, "p191-lock-a"), send600(store, jobCardNo, "p191-lock-b")]);
  const ok = [x, y].filter((r) => r.success);
  const committed = ok.reduce((s, r) => s + Number(r.movement?.quantity || 0), 0);
  const moves = await store.list("mfr_movements");
  const job = await store.get("mfr_job_cards", jobCardNo);
  assert(
    "exclusive lock 600+600 one commit remaining 400",
    committed === 600 && ok.length === 1 && unproducedOrderQty(job, moves) === 400,
    `committed=${committed} remaining=${unproducedOrderQty(job, moves)}`
  );
}

async function independentMutexWithoutLockCanRace() {
  const store = new SharedMapStore();
  store.listDelayMs = 50;
  const serA = createKeyedSerializer();
  const serB = createKeyedSerializer();
  let flip = 0;
  store.runSerialized = (key, fn) => {
    flip += 1;
    return (flip % 2 === 1 ? serA : serB)(key, fn);
  };
  const jobCardNo = "JC-P191-RACE";
  await seedProductionJob(store, jobCardNo);
  const [x, y] = await Promise.all([send600(store, jobCardNo, "p191-race-a"), send600(store, jobCardNo, "p191-race-b")]);
  const committed = [x, y].filter((r) => r.success).reduce((s, r) => s + Number(r.movement?.quantity || 0), 0);
  assert(
    "independent in-process mutexes without datastore lock can exceed 1000 (documents the gap Firestore tx does not close)",
    committed === 1200,
    `committed=${committed} (expected 1200 to prove read/check/write is not a Firestore transaction)`
  );
}

async function run() {
  await independentMutexWithoutLockCanRace();
  await exclusiveLockSameStoreTest();
  await twoProcessFileLockTest();
  console.log(`\nProcess 191 tests: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
