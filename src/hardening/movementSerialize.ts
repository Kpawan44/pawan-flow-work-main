/**
 * In-process keyed mutex for authoritative movement writes.
 * Used when a store does not provide runSerialized (live Cloud Run store)
 * so quantity checks and commits on the same job cannot interleave.
 *
 * Same key is FIFO. Different keys may run in parallel.
 */
const chains = new Map<string, Promise<unknown>>();

export function runKeyedSerialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const k = String(key || "movement").toUpperCase();
  const prev = chains.get(k) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  chains.set(
    k,
    run.then(
      () => undefined,
      () => undefined
    )
  );
  return run;
}
