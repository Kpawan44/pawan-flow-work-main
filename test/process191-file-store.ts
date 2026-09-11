import fs from "node:fs";
import path from "node:path";
import { SimpleStore } from "../src/hardening/commitMaterialMovement";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mkdirLock(lockPath: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    try {
      fs.mkdirSync(lockPath);
      return;
    } catch (err: any) {
      if (err?.code !== "EEXIST") throw err;
      await sleep(10 + Math.floor(Math.random() * 20));
    }
  }
  throw new Error(`Could not acquire file lock ${lockPath}`);
}

function releaseLock(lockPath: string): void {
  try {
    fs.rmdirSync(lockPath);
  } catch {
    /* ignore */
  }
}

/**
 * JSON file store with mkdir-based exclusive locks.
 * Two OS processes sharing the same paths cannot overlap runSerialized(key).
 */
export class FileJsonStore implements SimpleStore {
  constructor(
    private dataFile: string,
    private lockRoot: string
  ) {
    fs.mkdirSync(this.lockRoot, { recursive: true });
    if (!fs.existsSync(this.dataFile)) {
      fs.writeFileSync(this.dataFile, JSON.stringify({}), "utf8");
    }
  }

  private readAll(): Record<string, Record<string, any>> {
    const raw = fs.readFileSync(this.dataFile, "utf8") || "{}";
    return JSON.parse(raw);
  }

  private writeAll(data: Record<string, Record<string, any>>): void {
    fs.writeFileSync(this.dataFile, JSON.stringify(data), "utf8");
  }

  private async withDataLock<T>(fn: () => T): Promise<T> {
    const lockPath = path.join(this.lockRoot, "_data.lock");
    await mkdirLock(lockPath);
    try {
      return fn();
    } finally {
      releaseLock(lockPath);
    }
  }

  async get(collection: string, id: string): Promise<any | null> {
    return this.withDataLock(() => {
      const all = this.readAll();
      const row = all[collection]?.[id];
      return row ? JSON.parse(JSON.stringify(row)) : null;
    });
  }

  async set(collection: string, id: string, data: any): Promise<void> {
    await this.withDataLock(() => {
      const all = this.readAll();
      if (!all[collection]) all[collection] = {};
      all[collection][id] = JSON.parse(JSON.stringify(data));
      this.writeAll(all);
    });
  }

  async list(collection: string): Promise<any[]> {
    return this.withDataLock(() => {
      const all = this.readAll();
      return Object.values(all[collection] || {}).map((v) => JSON.parse(JSON.stringify(v)));
    });
  }

  async runSerialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const safe = String(key || "movement").toUpperCase().replace(/[^A-Z0-9:_-]/g, "-");
    const lockPath = path.join(this.lockRoot, `key-${safe}.lock`);
    await mkdirLock(lockPath);
    try {
      return await fn();
    } finally {
      releaseLock(lockPath);
    }
  }
}
