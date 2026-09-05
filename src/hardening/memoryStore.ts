import { SimpleStore } from "./commitMaterialMovement";

export class MemoryStore implements SimpleStore {
  private data = new Map<string, Map<string, any>>();
  private serializeTail: Promise<unknown> = Promise.resolve();

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
    return Array.from(this.col(collection).values()).map((v) => JSON.parse(JSON.stringify(v)));
  }

  async delete(collection: string, id: string): Promise<void> {
    this.col(collection).delete(id);
  }

  async clearCollection(collection: string): Promise<void> {
    this.data.delete(collection);
  }

  async runSerialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
    void key;
    const run = this.serializeTail.then(fn, fn);
    this.serializeTail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }
}
