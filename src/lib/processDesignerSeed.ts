import {
  PROCESS_DESIGNER_GRAPH_ID,
  ProcessDesignerEdge,
  ProcessDesignerGraph,
  ProcessDesignerNode
} from "../types/processDesigner";

const nowIso = () => new Date().toISOString();

function node(
  id: string,
  label: string,
  department: string,
  x: number,
  y: number,
  nodeType: string,
  codeLinks: ProcessDesignerNode["codeLinks"]
): ProcessDesignerNode {
  return {
    id,
    graphId: PROCESS_DESIGNER_GRAPH_ID,
    label,
    department,
    position: { x, y },
    codeLinks,
    nodeType,
    updatedAt: nowIso(),
    updatedBy: "system-seed",
    version: 1
  };
}

function edge(id: string, source: string, target: string, label?: string): ProcessDesignerEdge {
  return {
    id,
    graphId: PROCESS_DESIGNER_GRAPH_ID,
    source,
    target,
    label,
    updatedAt: nowIso(),
    updatedBy: "system-seed",
    version: 1
  };
}

/** Documentation-only seed matching repository departments and known modules. */
export function buildDefaultProcessDesignerGraph(): {
  graph: ProcessDesignerGraph;
  nodes: ProcessDesignerNode[];
  edges: ProcessDesignerEdge[];
} {
  const graph: ProcessDesignerGraph = {
    id: PROCESS_DESIGNER_GRAPH_ID,
    name: "PMW Manufacturing Process",
    version: 1,
    updatedAt: nowIso(),
    updatedBy: "system-seed"
  };

  const nodes: ProcessDesignerNode[] = [
    node("purchase", "Purchase", "Purchase", 80, 280, "department", {
      frontend: "src/components/DepartmentOperations.tsx, src/components/OutsourceManager.tsx",
      backend: "src/hardening/process1Purchase.ts",
      apiRoute: "POST /api/job-cards",
      collection: "mfr_job_cards, mfr_outsource_orders",
      functions: ["resolveInitialPurchaseRoute", "createPurchaseJobInwardTx"]
    }),
    node("raw-material-store", "Raw Material Store", "Raw Material Store", 380, 80, "department", {
      frontend: "src/components/DepartmentOperations.tsx, src/components/RawMaterialRequestModal.tsx",
      backend: "src/hardening/rmSkuMaster.ts, src/hardening/process2Manufacturing.ts",
      apiRoute: "POST /api/movements",
      collection: "mfr_movements, mfr_items",
      functions: ["computeRmRuntimeStock", "isRawMaterialStoreIssuingToProduction"]
    }),
    node("incoming-store", "Incoming Store", "Incoming Store", 380, 480, "department", {
      frontend: "src/components/DepartmentOperations.tsx, src/components/IssueOtherRawMaterialModal.tsx",
      backend: "src/hardening/process248OtherRawMaterial.ts",
      apiRoute: "GET/PUT /api/item-other-rm-links",
      collection: "mfr_item_other_rm_links",
      functions: ["getAcceptedOtherRawMaterialIssuedQty"]
    }),
    node("production", "Production", "Production", 680, 280, "department", {
      frontend: "src/components/DepartmentOperations.tsx, src/mobile/screens/MobileDepartmentQueueScreen.tsx",
      backend: "src/hardening/process2Manufacturing.ts",
      apiRoute: "POST /api/movements",
      collection: "mfr_job_cards, mfr_movements",
      functions: ["isEligibleForProductionOperationalQueue", "unproducedOrderQty", "remainingAtProduction"]
    }),
    node("heat-treatment", "Heat Treatment", "Heat Treatment", 980, 80, "department", {
      frontend: "src/components/DepartmentOperations.tsx",
      backend: "src/hardening/process2Manufacturing.ts",
      apiRoute: "POST /api/movements",
      collection: "mfr_job_cards, mfr_movements",
      functions: ["assertHeatTreatmentRouting", "remainingAtDepartment"]
    }),
    node("plating", "Plating", "Plating", 980, 280, "department", {
      frontend: "src/components/DepartmentOperations.tsx",
      backend: "src/hardening/storePlatingKgOnly.ts",
      apiRoute: "POST /api/movements",
      collection: "mfr_job_cards, mfr_movements",
      functions: ["assertStoreToPlatingKgOnly"]
    }),
    node("packing", "Packing", "Packing", 1280, 280, "department", {
      frontend: "src/components/DepartmentOperations.tsx",
      backend: "src/hardening/packingBagLines.ts",
      apiRoute: "POST /api/movements",
      collection: "mfr_job_cards, mfr_movements",
      functions: ["finalizePackingBagLines"]
    }),
    node("store", "Store", "Store", 1580, 280, "department", {
      frontend: "src/components/DepartmentOperations.tsx, src/components/StoreProcessTransferModal.tsx",
      backend: "src/hardening/processTransferMachine.ts",
      apiRoute: "/api/process-transfers",
      collection: "mfr_process_transfers",
      functions: ["storeAuthoritativeOnHand"]
    }),
    node("dispatch", "Dispatch", "Dispatch", 1880, 280, "department", {
      frontend: "src/components/DepartmentOperations.tsx",
      backend: "src/hardening/process2Manufacturing.ts, src/hardening/batchManifestScanner.ts",
      apiRoute: "/api/dispatch/verify-manifest",
      collection: "mfr_job_cards, mfr_movements",
      functions: ["isVisibleInDispatchQueue", "canFinalizeDispatch"]
    }),
    node("outsource", "Outsource / Vendor", "Purchase", 80, 80, "outsource", {
      frontend: "src/components/OutsourceManager.tsx",
      backend: "src/hardening/process1Purchase.ts",
      apiRoute: "POST /api/job-cards",
      collection: "mfr_outsource_orders",
      functions: ["handleSubmitReceipt (UI)", "resolveInitialPurchaseRoute"]
    }),
    node("material-movement", "Material Movement Ledger", "All", 680, 520, "ledger", {
      frontend: "src/App.tsx, src/lib/firebase.ts",
      backend: "src/hardening/commitMaterialMovement.ts, src/hardening/ledgerHttp.ts, src/hardening/resolveMaterialMovement.ts",
      apiRoute: "POST /api/movements; /api/movements/:id/accept|reject|undo",
      collection: "mfr_movements",
      functions: ["commitMaterialMovementTx", "acceptMaterialMovementTx"]
    })
  ];

  const edges: ProcessDesignerEdge[] = [
    edge("e-outsource-purchase", "outsource", "purchase", "Vendor receipt"),
    edge("e-purchase-rm", "purchase", "raw-material-store", "Wire RM"),
    edge("e-purchase-incoming", "purchase", "incoming-store", "Other RM / SFG"),
    edge("e-purchase-production", "purchase", "production", "SFG inward"),
    edge("e-purchase-ht", "purchase", "heat-treatment", "SFG inward"),
    edge("e-purchase-plating", "purchase", "plating", "SFG inward"),
    edge("e-rm-production", "raw-material-store", "production", "RM issue"),
    edge("e-incoming-production", "incoming-store", "production", "Other RM / SFG"),
    edge("e-production-ht", "production", "heat-treatment", "When HT required"),
    edge("e-ht-plating", "heat-treatment", "plating"),
    edge("e-production-plating", "production", "plating", "When HT not required"),
    edge("e-plating-packing", "plating", "packing"),
    edge("e-packing-store", "packing", "store"),
    edge("e-store-dispatch", "store", "dispatch"),
    edge("e-dispatch-outsource", "dispatch", "outsource", "Outsource send")
  ];

  return { graph, nodes, edges };
}
