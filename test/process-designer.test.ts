import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  canEditProcessDesignerCodeLinks,
  canEditProcessDesignerLayout,
  canViewProcessDesigner
} from "../src/hardening/processDesignerAuth";
import { operationalCollectionsForFactoryReset } from "../src/hardening/factoryResetPolicy";
import { buildDefaultProcessDesignerGraph } from "../src/lib/processDesignerSeed";
import {
  createProcessDesignerEdge,
  createProcessDesignerNode,
  deleteProcessDesignerEdge,
  ensureProcessDesignerSeeded,
  resetProcessDesignerMemoryStore,
  setProcessDesignerForceMemory,
  updateProcessDesignerNode
} from "../src/lib/processDesignerStore";

setProcessDesignerForceMemory(true);

const actor = { userId: "u-admin", name: "Admin" };

function readSrc(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf8");
}

describe("Process Designer Phase 1 — isolated documentation graph", () => {
  test("view is allowed for any active authenticated user", () => {
    assert.equal(canViewProcessDesigner({ active: true }), true);
    assert.equal(canViewProcessDesigner({ active: false }), false);
    assert.equal(canViewProcessDesigner(null), false);
  });

  test("shop-floor department membership does not grant layout edit", () => {
    assert.equal(
      canEditProcessDesignerLayout({
        active: true,
        role: "staff",
        department: "Production"
      }),
      false
    );
    assert.equal(
      canEditProcessDesignerLayout({
        active: true,
        role: "production",
        department: "Production"
      }),
      false
    );
    assert.equal(
      canEditProcessDesignerLayout({
        active: true,
        role: "staff",
        department: "Purchase"
      }),
      false
    );
  });

  test("admin, super_admin, and management may edit layout", () => {
    assert.equal(canEditProcessDesignerLayout({ active: true, role: "admin" }), true);
    assert.equal(canEditProcessDesignerLayout({ active: true, role: "super_admin" }), true);
    assert.equal(canEditProcessDesignerLayout({ active: true, role: "management" }), true);
    assert.equal(
      canEditProcessDesignerLayout({ active: true, role: "staff", department: "Admin" }),
      true
    );
  });

  test("code-link editing requires admin or super_admin", () => {
    assert.equal(canEditProcessDesignerCodeLinks({ active: true, role: "admin" }), true);
    assert.equal(canEditProcessDesignerCodeLinks({ active: true, role: "super_admin" }), true);
    assert.equal(canEditProcessDesignerCodeLinks({ active: true, role: "management" }), false);
    assert.equal(
      canEditProcessDesignerCodeLinks({ active: true, role: "staff", department: "Production" }),
      false
    );
  });

  test("department head flag is not enough to edit", () => {
    assert.equal(
      canEditProcessDesignerLayout({
        active: true,
        role: "staff",
        department: "Production"
      }),
      false
    );
  });

  test("seed represents real PMW departments and known code mappings", () => {
    const { graph, nodes, edges } = buildDefaultProcessDesignerGraph();
    assert.equal(graph.id, "default");
    assert.equal(graph.name, "PMW Manufacturing Process");
    const labels = nodes.map((n) => n.label);
    for (const expected of [
      "Purchase",
      "Raw Material Store",
      "Incoming Store",
      "Production",
      "Heat Treatment",
      "Plating",
      "Packing",
      "Store",
      "Dispatch",
      "Outsource / Vendor"
    ]) {
      assert.ok(labels.includes(expected), `missing node ${expected}`);
    }
    const production = nodes.find((n) => n.id === "production");
    assert.ok(production);
    assert.match(production!.codeLinks.backend, /process2Manufacturing\.ts/);
    assert.match(production!.codeLinks.frontend, /DepartmentOperations/);
    assert.ok(production!.codeLinks.functions.includes("unproducedOrderQty"));
    const purchase = nodes.find((n) => n.id === "purchase");
    assert.match(purchase!.codeLinks.backend, /process1Purchase\.ts/);
    const movement = nodes.find((n) => n.id === "material-movement");
    assert.match(movement!.codeLinks.backend, /commitMaterialMovement\.ts/);
    assert.match(movement!.codeLinks.apiRoute, /\/api\/movements/);
    assert.ok(edges.some((e) => e.source === "purchase" && e.target === "production"));
    assert.ok(edges.some((e) => e.source === "outsource" && e.target === "purchase"));
  });

  test("seed is a no-op when the graph already exists in memory", async () => {
    resetProcessDesignerMemoryStore();
    const first = await ensureProcessDesignerSeeded(actor);
    const second = await ensureProcessDesignerSeeded(actor);
    assert.equal(first.seeded, true);
    assert.equal(second.seeded, false);
    resetProcessDesignerMemoryStore();
  });

  test("node update uses optimistic version checks and does not silently overwrite", async () => {
    resetProcessDesignerMemoryStore();
    await ensureProcessDesignerSeeded(actor);
    const created = await createProcessDesignerNode(
      {
        id: "pd-test-node",
        label: "Test",
        department: "Production",
        position: { x: 1, y: 2 },
        codeLinks: {
          frontend: "src/components/DepartmentOperations.tsx",
          backend: "src/hardening/process2Manufacturing.ts",
          apiRoute: "N/A",
          collection: "none",
          functions: []
        },
        nodeType: "department"
      },
      actor
    );
    assert.equal(created.ok, true);
    const conflict = await updateProcessDesignerNode(
      "pd-test-node",
      { label: "Stale" },
      99,
      actor
    );
    assert.equal(conflict.ok, false);
    if (!conflict.ok) assert.equal(conflict.conflict, true);
    const ok = await updateProcessDesignerNode("pd-test-node", { label: "Fresh", position: { x: 10, y: 20 } }, 1, actor, "PROCESS_DESIGNER_NODE_MOVED");
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.version, 2);
    resetProcessDesignerMemoryStore();
  });

  test("edges are documentation only and persist independently of movements", async () => {
    resetProcessDesignerMemoryStore();
    const created = await createProcessDesignerEdge(
      { id: "e-doc-1", source: "purchase", target: "production", label: "docs" },
      actor
    );
    assert.equal(created.ok, true);
    const deleted = await deleteProcessDesignerEdge("e-doc-1", actor);
    assert.equal(deleted.ok, true);
    resetProcessDesignerMemoryStore();
  });

  test("Process Designer store does not import manufacturing transaction engines", () => {
    const store = readSrc("src/lib/processDesignerStore.ts");
    const component = readSrc("src/components/ProcessDesigner.tsx");
    for (const forbidden of [
      "commitMaterialMovement",
      "resolveMaterialMovement",
      "process1Purchase",
      "process2Manufacturing",
      "ledgerHttp",
      "socket.io",
      "socket.io-client"
    ]) {
      assert.equal(store.includes(forbidden), false, `store must not mention ${forbidden}`);
    }
    assert.equal(component.includes("commitMaterialMovement"), false);
    assert.equal(component.includes("socket.io"), false);
  });

  test("Firestore rules add isolated designer collections without a catch-all write", () => {
    const rules = readSrc("firestore.rules");
    assert.match(rules, /match \/process_designer_graphs\/\{graphId\}/);
    assert.match(rules, /match \/process_designer_nodes\/\{nodeId\}/);
    assert.match(rules, /match \/process_designer_edges\/\{edgeId\}/);
    assert.match(rules, /function canEditProcessDesigner\(\)/);
    assert.equal(/match \/\{document=\*\*\}/.test(rules), false);
    const designerBlock = rules.slice(rules.indexOf("match /process_designer_graphs"));
    assert.match(designerBlock, /allow read: if isActiveUser\(\)/);
    assert.match(designerBlock, /allow create, update, delete: if canEditProcessDesigner\(\)/);
  });

  test("factory reset operational list does not include Process Designer collections", () => {
    const cols = operationalCollectionsForFactoryReset();
    assert.equal(cols.includes("process_designer_graphs"), false);
    assert.equal(cols.includes("process_designer_nodes"), false);
    assert.equal(cols.includes("process_designer_edges"), false);
  });

  test("App navigation adds Process Map without replacing existing tabs", () => {
    const app = readSrc("src/App.tsx");
    const sidebar = readSrc("src/components/Sidebar.tsx");
    assert.match(sidebar, /Process Map/);
    assert.match(sidebar, /process-designer/);
    assert.match(app, /activeTab === 'process-designer'/);
    assert.match(app, /activeTab === 'dashboard'/);
    assert.match(app, /activeTab === 'timeline-live'/);
    assert.match(app, /activeTab === 'reports'/);
    assert.match(app, /activeTab === 'outsource'/);
    assert.match(app, /activeTab === 'admin-users'/);
  });

  test("Process Designer Firestore client uses resolved environment-aware Firebase config", () => {
    const firebaseSrc = readSrc("src/lib/firebase.ts");
    const storeSrc = readSrc("src/lib/processDesignerStore.ts");
    const applet = JSON.parse(readSrc("src/firebase-applet-config.json"));
    const rootApplet = JSON.parse(readSrc("firebase-applet-config.json"));
    assert.match(firebaseSrc, /resolveClientFirebaseConfig/);
    assert.match(firebaseSrc, /__PMW_FIREBASE_CLIENT__/);
    assert.match(firebaseSrc, /injected\?\.apiKey/);
    assert.match(firebaseSrc, /injected\?\.appId/);
    assert.match(firebaseSrc, /injected\?\.authDomain/);
    assert.match(firebaseSrc, /injected\?\.storageBucket/);
    assert.match(firebaseSrc, /injected\?\.messagingSenderId/);
    assert.match(storeSrc, /from "\.\/firebase"/);
    assert.equal(applet.projectId, "my-project-9ca72");
    assert.equal(
      applet.firestoreDatabaseId,
      "ai-studio-remixraj-d7813b87-2e92-4313-844a-f71fdf5b7a8d"
    );
    assert.equal(rootApplet.projectId, "my-project-9ca72");
    assert.equal(
      rootApplet.firestoreDatabaseId,
      "ai-studio-remixraj-d7813b87-2e92-4313-844a-f71fdf5b7a8d"
    );
    const dockerfile = readSrc("Dockerfile");
    assert.match(dockerfile, /VITE_FIREBASE_PROJECT_ID/);
    assert.match(dockerfile, /VITE_FIRESTORE_DATABASE_ID/);
    const server = readSrc("server.ts");
    assert.match(server, /injectClientFirebaseConfigScript/);
    assert.match(server, /fetchFirebaseWebAppClientConfig/);
    assert.match(server, /process\.env\.FIRESTORE_DATABASE_ID \|\| firebaseConfig\?\.firestoreDatabaseId/);
  });
});
