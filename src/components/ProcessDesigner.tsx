import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  addEdge,
  Handle,
  Position,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  MarkerType
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { GitBranch, Save, Trash2, X } from "lucide-react";
import { UserProfile } from "../types";
import { ProcessDesignerEdge, ProcessDesignerNode, ProcessDesignerWriteResult } from "../types/processDesigner";
import {
  canEditProcessDesignerCodeLinks,
  canEditProcessDesignerLayout
} from "../hardening/processDesignerAuth";
import {
  createProcessDesignerEdge,
  deleteProcessDesignerEdge,
  ensureProcessDesignerSeeded,
  subscribeToProcessDesignerEdges,
  subscribeToProcessDesignerNodes,
  updateProcessDesignerNode
} from "../lib/processDesignerStore";

const DEPARTMENTS = [
  "Purchase",
  "Raw Material Store",
  "Incoming Store",
  "Production",
  "Heat Treatment",
  "Plating",
  "Packing",
  "Store",
  "Dispatch",
  "All"
];

function PmwProcessNode({ data, selected }: NodeProps) {
  const label = String(data.label || "");
  const department = String(data.department || "");
  const backend = String((data.codeLinks as any)?.backend || "");
  const apiRoute = String((data.codeLinks as any)?.apiRoute || "");
  const collection = String((data.codeLinks as any)?.collection || "");
  return (
    <div
      className={`min-w-[220px] max-w-[260px] rounded-xl border-2 bg-white dark:bg-slate-900 shadow-sm px-3 py-2 ${
        selected ? "border-blue-500" : "border-slate-200 dark:border-slate-700"
      }`}
    >
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <div className="text-[11px] font-extrabold uppercase tracking-wide text-slate-900 dark:text-white truncate">
        {label}
      </div>
      <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Department: {department}</div>
      <div className="mt-1.5 font-mono text-[9px] leading-snug text-slate-600 dark:text-slate-300 space-y-0.5">
        <div className="truncate" title={backend}>
          Backend: {backend.split(",").pop()?.trim() || "—"}
        </div>
        <div className="truncate" title={apiRoute}>
          API: {apiRoute || "N/A"}
        </div>
        <div className="truncate" title={collection}>
          DB: {collection || "—"}
        </div>
      </div>
    </div>
  );
}

const nodeTypes = { pmwProcess: PmwProcessNode };

function writeFailureMessage(result: ProcessDesignerWriteResult): string {
  if (result.ok === true) return "";
  if (result.conflict === true) return result.message;
  return result.error;
}

function toFlowNodes(docs: ProcessDesignerNode[]): Node[] {
  return docs.map((n) => ({
    id: n.id,
    type: "pmwProcess",
    position: { x: n.position?.x || 0, y: n.position?.y || 0 },
    data: { ...n }
  }));
}

function toFlowEdges(docs: ProcessDesignerEdge[]): Edge[] {
  return docs.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    label: e.label,
    markerEnd: { type: MarkerType.ArrowClosed },
    data: { version: e.version }
  }));
}

interface ProcessDesignerProps {
  currentUser: UserProfile;
  showToast?: (msg: string, type?: "success" | "error" | "info") => void;
}

export default function ProcessDesigner({ currentUser, showToast }: ProcessDesignerProps) {
  const actor = { userId: currentUser.userId, name: currentUser.name };
  const canEdit = canEditProcessDesignerLayout(currentUser);
  const canEditCode = canEditProcessDesignerCodeLinks(currentUser);

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [docs, setDocs] = useState<ProcessDesignerNode[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    label: "",
    department: "",
    frontend: "",
    backend: "",
    apiRoute: "",
    collection: "",
    functions: ""
  });
  const draggingRef = useRef<Set<string>>(new Set());
  const docsRef = useRef<ProcessDesignerNode[]>([]);

  useEffect(() => {
    docsRef.current = docs;
  }, [docs]);

  useEffect(() => {
    let cancelled = false;
    let unsubNodes = () => {};
    let unsubEdges = () => {};
    const attach = () => {
      unsubNodes = subscribeToProcessDesignerNodes((list) => {
        setDocs(list);
        setNodes((prev) => {
          const byId = new Map<string, Node>(prev.map((node) => [node.id, node]));
          return toFlowNodes(list).map((n) => {
            const prevNode = byId.get(n.id);
            if (draggingRef.current.has(n.id) && prevNode) {
              return { ...n, position: prevNode.position, selected: prevNode.selected };
            }
            return prevNode ? { ...n, selected: prevNode.selected } : n;
          });
        });
      });
      unsubEdges = subscribeToProcessDesignerEdges((list) => {
        setEdges((prev) => {
          const selected = new Set(prev.filter((e) => e.selected).map((e) => e.id));
          return toFlowEdges(list).map((e) => ({ ...e, selected: selected.has(e.id) }));
        });
      });
    };
    ensureProcessDesignerSeeded(actor)
      .catch(() => {
        showToast?.("Process Map seed skipped (view-only or already present).", "info");
      })
      .finally(() => {
        if (!cancelled) attach();
      });
    return () => {
      cancelled = true;
      unsubNodes();
      unsubEdges();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser.userId]);

  const selectedDoc = useMemo(
    () => docs.find((d) => d.id === selectedNodeId) || null,
    [docs, selectedNodeId]
  );

  useEffect(() => {
    if (!selectedDoc) return;
    setDraft({
      label: selectedDoc.label,
      department: selectedDoc.department,
      frontend: selectedDoc.codeLinks.frontend,
      backend: selectedDoc.codeLinks.backend,
      apiRoute: selectedDoc.codeLinks.apiRoute,
      collection: selectedDoc.codeLinks.collection,
      functions: (selectedDoc.codeLinks.functions || []).join("\n")
    });
  }, [selectedDoc]);

  const onConnect = useCallback(
    async (connection: Connection) => {
      if (!canEdit || !connection.source || !connection.target) return;
      const id = `e-${connection.source}-${connection.target}-${Date.now()}`;
      const result = await createProcessDesignerEdge(
        {
          id,
          source: connection.source,
          target: connection.target,
          sourceHandle: connection.sourceHandle || undefined,
          targetHandle: connection.targetHandle || undefined
        },
        actor
      );
      if (!result.ok) {
        showToast?.(writeFailureMessage(result), "error");
        return;
      }
      setEdges((eds) => addEdge({ ...connection, id, markerEnd: { type: MarkerType.ArrowClosed } }, eds));
    },
    [actor, canEdit, showToast]
  );

  const persistPosition = useCallback(
    async (nodeId: string, x: number, y: number) => {
      const doc = docsRef.current.find((d) => d.id === nodeId);
      if (!doc || !canEdit) return;
      const result = await updateProcessDesignerNode(
        nodeId,
        { position: { x, y } },
        doc.version,
        actor,
        "PROCESS_DESIGNER_NODE_MOVED"
      );
      if (!result.ok) {
        setConflictMsg(writeFailureMessage(result));
        showToast?.(writeFailureMessage(result), "error");
      }
    },
    [actor, canEdit, showToast]
  );

  const handleSaveMetadata = async () => {
    if (!selectedDoc || !canEdit) return;
    const patch: Partial<ProcessDesignerNode> = {
      label: draft.label.trim() || selectedDoc.label,
      department: draft.department.trim() || selectedDoc.department
    };
    if (canEditCode) {
      patch.codeLinks = {
        frontend: draft.frontend,
        backend: draft.backend,
        apiRoute: draft.apiRoute,
        collection: draft.collection,
        functions: draft.functions
          .split(/[\n,]/)
          .map((s) => s.trim())
          .filter(Boolean)
      };
    }
    const result = await updateProcessDesignerNode(selectedDoc.id, patch, selectedDoc.version, actor);
    if (!result.ok) {
      setConflictMsg(writeFailureMessage(result));
      showToast?.(writeFailureMessage(result), "error");
      return;
    }
    setConflictMsg(null);
    showToast?.("Process node saved.", "success");
  };

  const handleDeleteEdge = async () => {
    if (!selectedEdgeId || !canEdit) return;
    const result = await deleteProcessDesignerEdge(selectedEdgeId, actor);
    if (!result.ok) {
      showToast?.(writeFailureMessage(result), "error");
      return;
    }
    setSelectedEdgeId(null);
    showToast?.("Connection removed from Process Map.", "success");
  };

  return (
    <div className="h-full w-full flex min-h-0 bg-slate-50 dark:bg-slate-950">
      <div className="flex-1 min-w-0 relative">
        <div className="absolute top-2 left-2 z-10 flex items-center gap-2 bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-[10px] font-bold uppercase text-slate-600 dark:text-slate-300">
          <GitBranch className="h-3.5 w-3.5 text-blue-500" />
          Process Map (documentation only)
        </div>
        {conflictMsg && (
          <div className="absolute top-10 left-2 right-2 z-10 bg-amber-50 border border-amber-300 text-amber-900 text-xs rounded-lg px-3 py-2">
            {conflictMsg}
          </div>
        )}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={(changes) => {
            setNodes((nds) => {
              const next = [...nds];
              for (const ch of changes) {
                if (ch.type === "position" && ch.id && ch.position) {
                  const idx = next.findIndex((n) => n.id === ch.id);
                  if (idx >= 0) next[idx] = { ...next[idx], position: ch.position };
                }
                if (ch.type === "select" && ch.id) {
                  const idx = next.findIndex((n) => n.id === ch.id);
                  if (idx >= 0) next[idx] = { ...next[idx], selected: ch.selected };
                }
              }
              return next;
            });
          }}
          onEdgesChange={(changes) => {
            setEdges((eds) => {
              const next = [...eds];
              for (const ch of changes) {
                if (ch.type === "select" && ch.id) {
                  const idx = next.findIndex((e) => e.id === ch.id);
                  if (idx >= 0) next[idx] = { ...next[idx], selected: ch.selected };
                }
              }
              return next;
            });
          }}
          onConnect={onConnect}
          onNodeDragStart={(_, n) => draggingRef.current.add(n.id)}
          onNodeDragStop={(_, n) => {
            draggingRef.current.delete(n.id);
            persistPosition(n.id, n.position.x, n.position.y);
          }}
          onSelectionChange={({ nodes: sn, edges: se }) => {
            setSelectedNodeId(sn[0]?.id || null);
            setSelectedEdgeId(se[0]?.id || null);
          }}
          nodesDraggable={canEdit}
          nodesConnectable={canEdit}
          elementsSelectable
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>

      <aside className="w-[320px] max-w-[90vw] shrink-0 border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-y-auto p-3 text-xs space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Node editor</h2>
          {selectedNodeId && (
            <button type="button" className="p-1 text-slate-400" onClick={() => setSelectedNodeId(null)}>
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {!canEdit && (
          <p className="text-[10px] text-slate-500">View only. Editing requires admin, super_admin, or management.</p>
        )}
        {selectedEdgeId && canEdit && (
          <button
            type="button"
            onClick={handleDeleteEdge}
            className="w-full flex items-center justify-center gap-1 py-2 rounded-lg bg-rose-50 text-rose-700 font-bold"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete selected connection
          </button>
        )}
        {!selectedDoc ? (
          <p className="text-slate-500">Select a process node to edit documentation metadata. This never moves shop-floor material.</p>
        ) : (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              handleSaveMetadata();
            }}
          >
            <label className="block font-semibold text-slate-600">Label</label>
            <input
              disabled={!canEdit}
              className="w-full border rounded-lg px-2 py-1.5 bg-slate-50 dark:bg-slate-950 dark:border-slate-700"
              value={draft.label}
              onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
            />
            <label className="block font-semibold text-slate-600">Department</label>
            <select
              disabled={!canEdit}
              className="w-full border rounded-lg px-2 py-1.5 bg-slate-50 dark:bg-slate-950 dark:border-slate-700"
              value={draft.department}
              onChange={(e) => setDraft((d) => ({ ...d, department: e.target.value }))}
            >
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <label className="block font-semibold text-slate-600">Frontend module</label>
            <textarea
              disabled={!canEditCode}
              rows={2}
              className="w-full border rounded-lg px-2 py-1.5 font-mono bg-slate-50 dark:bg-slate-950 dark:border-slate-700"
              value={draft.frontend}
              onChange={(e) => setDraft((d) => ({ ...d, frontend: e.target.value }))}
            />
            <label className="block font-semibold text-slate-600">Backend module</label>
            <textarea
              disabled={!canEditCode}
              rows={2}
              className="w-full border rounded-lg px-2 py-1.5 font-mono bg-slate-50 dark:bg-slate-950 dark:border-slate-700"
              value={draft.backend}
              onChange={(e) => setDraft((d) => ({ ...d, backend: e.target.value }))}
            />
            <label className="block font-semibold text-slate-600">API route</label>
            <input
              disabled={!canEditCode}
              className="w-full border rounded-lg px-2 py-1.5 font-mono bg-slate-50 dark:bg-slate-950 dark:border-slate-700"
              value={draft.apiRoute}
              onChange={(e) => setDraft((d) => ({ ...d, apiRoute: e.target.value }))}
            />
            <label className="block font-semibold text-slate-600">Firestore collection</label>
            <input
              disabled={!canEditCode}
              className="w-full border rounded-lg px-2 py-1.5 font-mono bg-slate-50 dark:bg-slate-950 dark:border-slate-700"
              value={draft.collection}
              onChange={(e) => setDraft((d) => ({ ...d, collection: e.target.value }))}
            />
            <label className="block font-semibold text-slate-600">Functions (one per line)</label>
            <textarea
              disabled={!canEditCode}
              rows={4}
              className="w-full border rounded-lg px-2 py-1.5 font-mono bg-slate-50 dark:bg-slate-950 dark:border-slate-700"
              value={draft.functions}
              onChange={(e) => setDraft((d) => ({ ...d, functions: e.target.value }))}
            />
            {canEdit && (
              <button
                type="submit"
                className="w-full flex items-center justify-center gap-1 py-2 rounded-lg bg-blue-600 text-white font-bold"
              >
                <Save className="h-3.5 w-3.5" /> Save documentation
              </button>
            )}
            {!canEditCode && (
              <p className="text-[10px] text-slate-500">Code-link fields require admin or super_admin.</p>
            )}
          </form>
        )}
      </aside>
    </div>
  );
}
