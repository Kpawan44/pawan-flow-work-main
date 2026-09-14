/** Isolated Process Designer graph types. Not job cards or movements. */

export interface ProcessDesignerCodeLinks {
  frontend: string;
  backend: string;
  apiRoute: string;
  collection: string;
  functions: string[];
}

export interface ProcessDesignerPosition {
  x: number;
  y: number;
}

export interface ProcessDesignerNode {
  id: string;
  graphId: string;
  label: string;
  department: string;
  position: ProcessDesignerPosition;
  codeLinks: ProcessDesignerCodeLinks;
  nodeType: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
}

export interface ProcessDesignerEdge {
  id: string;
  graphId: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
}

export interface ProcessDesignerGraph {
  id: string;
  name: string;
  version: number;
  updatedAt: string;
  updatedBy: string;
}

export type ProcessDesignerWriteResult =
  | { ok: true; version: number }
  | { ok: false; conflict: true; currentVersion: number; message: string }
  | { ok: false; conflict: false; error: string };

export const PROCESS_DESIGNER_GRAPH_ID = "default";
export const PROCESS_DESIGNER_GRAPHS = "process_designer_graphs";
export const PROCESS_DESIGNER_NODES = "process_designer_nodes";
export const PROCESS_DESIGNER_EDGES = "process_designer_edges";
