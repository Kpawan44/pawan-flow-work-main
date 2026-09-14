/**
 * Process Designer persistence. Isolated from mfr_job_cards / mfr_movements.
 * Firestore onSnapshot is authoritative. Never calls manufacturing transaction APIs.
 */

import {
  collection,
  doc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  type Firestore,
  type Unsubscribe
} from "firebase/firestore";
import { db as firebaseDb, DBService, useRealFirebase } from "./firebase";
import { buildDefaultProcessDesignerGraph } from "./processDesignerSeed";
import {
  PROCESS_DESIGNER_EDGES,
  PROCESS_DESIGNER_GRAPH_ID,
  PROCESS_DESIGNER_GRAPHS,
  PROCESS_DESIGNER_NODES,
  ProcessDesignerEdge,
  ProcessDesignerNode,
  ProcessDesignerWriteResult
} from "../types/processDesigner";

type Actor = { userId: string; name: string };

type MemoryState = {
  nodes: Map<string, ProcessDesignerNode>;
  edges: Map<string, ProcessDesignerEdge>;
  graphExists: boolean;
  nodeListeners: Set<(nodes: ProcessDesignerNode[]) => void>;
  edgeListeners: Set<(edges: ProcessDesignerEdge[]) => void>;
};

const memory: MemoryState = {
  nodes: new Map(),
  edges: new Map(),
  graphExists: false,
  nodeListeners: new Set(),
  edgeListeners: new Set()
};

function nowIso(): string {
  return new Date().toISOString();
}

let forceMemoryStore = false;

export function setProcessDesignerForceMemory(enabled: boolean): void {
  forceMemoryStore = enabled;
}

function firestoreReady(): Firestore | null {
  if (forceMemoryStore) return null;
  if (useRealFirebase && firebaseDb) return firebaseDb as Firestore;
  return null;
}

function emitNodes() {
  const list = Array.from(memory.nodes.values());
  memory.nodeListeners.forEach((cb) => cb(list));
}

function emitEdges() {
  const list = Array.from(memory.edges.values());
  memory.edgeListeners.forEach((cb) => cb(list));
}

async function audit(actor: Actor, action: string, details: string): Promise<void> {
  try {
    await DBService.logAction(actor.userId, actor.name, action, details);
  } catch (_) {}
}

function conflict(currentVersion: number): ProcessDesignerWriteResult {
  return {
    ok: false,
    conflict: true,
    currentVersion,
    message: "This Process Designer record was updated by another user. Reload and retry."
  };
}

export function resetProcessDesignerMemoryStore(): void {
  memory.nodes.clear();
  memory.edges.clear();
  memory.graphExists = false;
  memory.nodeListeners.clear();
  memory.edgeListeners.clear();
}

export function subscribeToProcessDesignerNodes(
  onChange: (nodes: ProcessDesignerNode[]) => void
): () => void {
  const fs = firestoreReady();
  if (!fs) {
    memory.nodeListeners.add(onChange);
    onChange(Array.from(memory.nodes.values()));
    return () => {
      memory.nodeListeners.delete(onChange);
    };
  }
  const unsub: Unsubscribe = onSnapshot(collection(fs, PROCESS_DESIGNER_NODES), (snap) => {
    const nodes: ProcessDesignerNode[] = [];
    snap.forEach((d) => nodes.push({ id: d.id, ...(d.data() as Omit<ProcessDesignerNode, "id">) }));
    onChange(nodes);
  });
  return () => unsub();
}

export function subscribeToProcessDesignerEdges(
  onChange: (edges: ProcessDesignerEdge[]) => void
): () => void {
  const fs = firestoreReady();
  if (!fs) {
    memory.edgeListeners.add(onChange);
    onChange(Array.from(memory.edges.values()));
    return () => {
      memory.edgeListeners.delete(onChange);
    };
  }
  const unsub: Unsubscribe = onSnapshot(collection(fs, PROCESS_DESIGNER_EDGES), (snap) => {
    const edges: ProcessDesignerEdge[] = [];
    snap.forEach((d) => edges.push({ id: d.id, ...(d.data() as Omit<ProcessDesignerEdge, "id">) }));
    onChange(edges);
  });
  return () => unsub();
}

export async function ensureProcessDesignerSeeded(actor?: Actor): Promise<{ seeded: boolean }> {
  const seededBy = actor?.userId || "system-seed";
  const fs = firestoreReady();
  const seed = buildDefaultProcessDesignerGraph();

  if (!fs) {
    if (memory.graphExists || memory.nodes.size > 0) return { seeded: false };
    seed.nodes.forEach((n) => memory.nodes.set(n.id, { ...n, updatedBy: seededBy }));
    seed.edges.forEach((e) => memory.edges.set(e.id, { ...e, updatedBy: seededBy }));
    memory.graphExists = true;
    emitNodes();
    emitEdges();
    return { seeded: true };
  }

  const graphRef = doc(fs, PROCESS_DESIGNER_GRAPHS, PROCESS_DESIGNER_GRAPH_ID);
  const seeded = await runTransaction(fs, async (tx) => {
    const snap = await tx.get(graphRef);
    if (snap.exists()) return false;
    tx.set(graphRef, {
      name: seed.graph.name,
      version: 1,
      updatedAt: serverTimestamp(),
      updatedBy: seededBy
    });
    for (const n of seed.nodes) {
      tx.set(doc(fs, PROCESS_DESIGNER_NODES, n.id), {
        ...n,
        updatedBy: seededBy,
        updatedAt: serverTimestamp()
      });
    }
    for (const e of seed.edges) {
      tx.set(doc(fs, PROCESS_DESIGNER_EDGES, e.id), {
        ...e,
        updatedBy: seededBy,
        updatedAt: serverTimestamp()
      });
    }
    return true;
  });
  return { seeded };
}

export async function createProcessDesignerNode(
  input: Omit<ProcessDesignerNode, "updatedAt" | "updatedBy" | "version" | "graphId"> & { graphId?: string },
  actor: Actor
): Promise<ProcessDesignerWriteResult> {
  const record: ProcessDesignerNode = {
    ...input,
    graphId: input.graphId || PROCESS_DESIGNER_GRAPH_ID,
    updatedAt: nowIso(),
    updatedBy: actor.userId,
    version: 1
  };
  const fs = firestoreReady();
  if (!fs) {
    if (memory.nodes.has(record.id)) {
      return { ok: false, conflict: false, error: "Node already exists." };
    }
    memory.nodes.set(record.id, record);
    emitNodes();
    await audit(actor, "PROCESS_DESIGNER_NODE_CREATED", `Created process node ${record.id} (${record.label})`);
    return { ok: true, version: 1 };
  }
  try {
    await runTransaction(fs, async (tx) => {
      const ref = doc(fs, PROCESS_DESIGNER_NODES, record.id);
      const snap = await tx.get(ref);
      if (snap.exists()) throw new Error("NODE_EXISTS");
      tx.set(ref, { ...record, updatedAt: serverTimestamp() });
    });
    await audit(actor, "PROCESS_DESIGNER_NODE_CREATED", `Created process node ${record.id} (${record.label})`);
    return { ok: true, version: 1 };
  } catch (err: any) {
    return { ok: false, conflict: false, error: String(err?.message || err) };
  }
}

export async function updateProcessDesignerNode(
  nodeId: string,
  patch: Partial<Pick<ProcessDesignerNode, "label" | "department" | "position" | "codeLinks" | "nodeType">>,
  expectedVersion: number,
  actor: Actor,
  auditAction = "PROCESS_DESIGNER_NODE_UPDATED"
): Promise<ProcessDesignerWriteResult> {
  const fs = firestoreReady();
  if (!fs) {
    const existing = memory.nodes.get(nodeId);
    if (!existing) return { ok: false, conflict: false, error: "Node not found." };
    if (existing.version !== expectedVersion) return conflict(existing.version);
    const next: ProcessDesignerNode = {
      ...existing,
      ...patch,
      position: patch.position || existing.position,
      codeLinks: patch.codeLinks || existing.codeLinks,
      version: existing.version + 1,
      updatedAt: nowIso(),
      updatedBy: actor.userId
    };
    memory.nodes.set(nodeId, next);
    emitNodes();
    await audit(actor, auditAction, `Updated process node ${nodeId}`);
    return { ok: true, version: next.version };
  }
  try {
    const nextVersion = await runTransaction(fs, async (tx) => {
      const ref = doc(fs, PROCESS_DESIGNER_NODES, nodeId);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error("NOT_FOUND");
      const current = snap.data() as ProcessDesignerNode;
      const curVer = Number(current.version || 0);
      if (curVer !== expectedVersion) {
        const e: any = new Error("CONFLICT");
        e.currentVersion = curVer;
        throw e;
      }
      const version = curVer + 1;
      tx.update(ref, {
        ...patch,
        version,
        updatedAt: serverTimestamp(),
        updatedBy: actor.userId
      });
      return version;
    });
    await audit(actor, auditAction, `Updated process node ${nodeId}`);
    return { ok: true, version: nextVersion };
  } catch (err: any) {
    if (err?.message === "CONFLICT" || err?.currentVersion != null) {
      return conflict(Number(err.currentVersion || 0));
    }
    return { ok: false, conflict: false, error: String(err?.message || err) };
  }
}

export async function deleteProcessDesignerNode(nodeId: string, actor: Actor): Promise<ProcessDesignerWriteResult> {
  const fs = firestoreReady();
  if (!fs) {
    if (!memory.nodes.has(nodeId)) return { ok: false, conflict: false, error: "Node not found." };
    memory.nodes.delete(nodeId);
    for (const [id, e] of Array.from(memory.edges.entries())) {
      if (e.source === nodeId || e.target === nodeId) memory.edges.delete(id);
    }
    emitNodes();
    emitEdges();
    await audit(actor, "PROCESS_DESIGNER_NODE_DELETED", `Deleted process node ${nodeId}`);
    return { ok: true, version: 0 };
  }
  try {
    await runTransaction(fs, async (tx) => {
      tx.delete(doc(fs, PROCESS_DESIGNER_NODES, nodeId));
    });
    await audit(actor, "PROCESS_DESIGNER_NODE_DELETED", `Deleted process node ${nodeId}`);
    return { ok: true, version: 0 };
  } catch (err: any) {
    return { ok: false, conflict: false, error: String(err?.message || err) };
  }
}

export async function createProcessDesignerEdge(
  input: Omit<ProcessDesignerEdge, "updatedAt" | "updatedBy" | "version" | "graphId"> & { graphId?: string },
  actor: Actor
): Promise<ProcessDesignerWriteResult> {
  const record: ProcessDesignerEdge = {
    ...input,
    graphId: input.graphId || PROCESS_DESIGNER_GRAPH_ID,
    updatedAt: nowIso(),
    updatedBy: actor.userId,
    version: 1
  };
  const fs = firestoreReady();
  if (!fs) {
    if (memory.edges.has(record.id)) {
      return { ok: false, conflict: false, error: "Edge already exists." };
    }
    memory.edges.set(record.id, record);
    emitEdges();
    await audit(actor, "PROCESS_DESIGNER_EDGE_CREATED", `Created process edge ${record.source} → ${record.target}`);
    return { ok: true, version: 1 };
  }
  try {
    await runTransaction(fs, async (tx) => {
      const ref = doc(fs, PROCESS_DESIGNER_EDGES, record.id);
      const snap = await tx.get(ref);
      if (snap.exists()) throw new Error("EDGE_EXISTS");
      tx.set(ref, { ...record, updatedAt: serverTimestamp() });
    });
    await audit(actor, "PROCESS_DESIGNER_EDGE_CREATED", `Created process edge ${record.source} → ${record.target}`);
    return { ok: true, version: 1 };
  } catch (err: any) {
    return { ok: false, conflict: false, error: String(err?.message || err) };
  }
}

export async function deleteProcessDesignerEdge(edgeId: string, actor: Actor): Promise<ProcessDesignerWriteResult> {
  const fs = firestoreReady();
  if (!fs) {
    if (!memory.edges.has(edgeId)) return { ok: false, conflict: false, error: "Edge not found." };
    memory.edges.delete(edgeId);
    emitEdges();
    await audit(actor, "PROCESS_DESIGNER_EDGE_DELETED", `Deleted process edge ${edgeId}`);
    return { ok: true, version: 0 };
  }
  try {
    await runTransaction(fs, async (tx) => {
      tx.delete(doc(fs, PROCESS_DESIGNER_EDGES, edgeId));
    });
    await audit(actor, "PROCESS_DESIGNER_EDGE_DELETED", `Deleted process edge ${edgeId}`);
    return { ok: true, version: 0 };
  } catch (err: any) {
    return { ok: false, conflict: false, error: String(err?.message || err) };
  }
}
