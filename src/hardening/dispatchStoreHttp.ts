import type { Express, Request, Response, NextFunction } from "express";
import type { SimpleStore } from "./commitMaterialMovement";
import type { LedgerActor } from "./ledgerHttp";
import {
  calculateStoreAuthoritativeItemStock,
  DISPATCH_STORE_ISSUE_COLLECTION,
  DISPATCH_STORE_REQUIREMENT_COLLECTION,
  issueStoreItemToDispatchTx,
  issueStoreToDispatchTx,
  issueDispatchStoreRequirementTx,
  issueStoreProcessTransferTx
} from "./dispatchStoreIssue";

export interface DispatchStoreHttpContext {
  requireAuth: (req: Request, res: Response, next: NextFunction) => void | Promise<unknown>;
  getStore: () => SimpleStore;
  getActor: (req: Request) => LedgerActor | null;
  onWrite?: (collection: string, id: string, data: any) => void;
}

export function mountDispatchStoreRoutes(app: Express, ctx: DispatchStoreHttpContext): void {
  app.post("/api/dispatch-store/requirements", ctx.requireAuth, async (_req, res) => {
    return res.status(410).json({
      success: false,
      error: "Dispatch → Store requirement creation has been removed. Use direct Store → Dispatch issue."
    });
  });

  app.post("/api/dispatch-store/issues", ctx.requireAuth, async (req, res) => {
    try {
      const actor = ctx.getActor(req);
      if (!actor) return res.status(401).json({ success: false, error: "Unauthorized: Missing authoritative user profile." });
      const body = req.body || {};
      const headerOp = String(req.get("x-operation-id") || "").trim();
      const operationId = String(body.operationId || headerOp || "").trim() || undefined;

      let result;
      if (body.itemName || body.jobCardNo) {
        result = await issueStoreItemToDispatchTx(ctx.getStore(), {
          operationId,
          itemName: body.itemName,
          itemCode: body.itemCode,
          jobCardNo: body.jobCardNo,
          issuedBagQty: body.issuedBagQty,
          issuedPcsQty: body.issuedPcsQty,
          issuedKgQty: body.issuedKgQty,
          remarks: body.remarks,
          actor
        });
      } else {
        result = await issueDispatchStoreRequirementTx(ctx.getStore(), {
          operationId,
          requirementId: body.requirementId,
          issuedBagQty: body.issuedBagQty,
          issuedPcsQty: body.issuedPcsQty,
          issuedKgQty: body.issuedKgQty,
          remarks: body.remarks,
          actor
        });
      }

      if (!result.success) return res.status(result.statusCode || 400).json({ success: false, error: result.error });
      const { issue, movements } = result.data as { issue: any; movements: any[] };
      const movement = movements && movements.length > 0 ? movements[0] : (result.data as any).movement;
      if (ctx.onWrite) {
        ctx.onWrite(DISPATCH_STORE_ISSUE_COLLECTION, issue.id, issue);
        if (movements && Array.isArray(movements)) {
          for (const m of movements) {
            ctx.onWrite("mfr_movements", m.movementId, m);
          }
        } else if (movement) {
          ctx.onWrite("mfr_movements", movement.movementId, movement);
        }
      }
      return res.json({ success: true, cached: Boolean(result.cached), issue, movements: movements || [movement], movement });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || "Failed to issue Store stock to Dispatch." });
    }
  });

  app.post("/api/store-process/transfers", ctx.requireAuth, async (req, res) => {
    try {
      const actor = ctx.getActor(req);
      if (!actor) return res.status(401).json({ success: false, error: "Unauthorized: Missing authoritative user profile." });
      const body = req.body || {};
      const headerOp = String(req.get("x-operation-id") || "").trim();
      const operationId = String(body.operationId || headerOp || "").trim() || undefined;

      const result = await issueStoreProcessTransferTx(ctx.getStore(), {
        operationId,
        toProcess: body.toProcess,
        itemName: body.itemName,
        itemCode: body.itemCode,
        jobCardNo: body.jobCardNo,
        issuedKgQty: body.issuedKgQty,
        issuedPcsQty: body.issuedPcsQty,
        issuedBagQty: body.issuedBagQty,
        remarks: body.remarks,
        actor
      });

      if (!result.success) return res.status(result.statusCode || 400).json({ success: false, error: result.error });
      const { transfer, movements } = result.data as { transfer: any; movements: any[] };
      if (ctx.onWrite) {
        ctx.onWrite("mfr_process_transfers", transfer.transferId, transfer);
        if (movements && Array.isArray(movements)) {
          for (const m of movements) {
            ctx.onWrite("mfr_movements", m.movementId, m);
          }
        }
      }
      return res.json({ success: true, cached: Boolean(result.cached), transfer, movements });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || "Failed to issue Store process transfer." });
    }
  });

  app.get("/api/dispatch-store/item-stock", ctx.requireAuth, async (req, res) => {
    try {
      const store = ctx.getStore();
      const itemName = String(req.query.itemName || "").trim();
      const itemCode = String(req.query.itemCode || "").trim() || undefined;
      const jobCards = await store.list("mfr_job_cards");
      const movements = await store.list("mfr_movements");
      const issues = await store.list(DISPATCH_STORE_ISSUE_COLLECTION);
      const transfers = await store.list("mfr_process_transfers");

      if (itemName) {
        const stock = calculateStoreAuthoritativeItemStock(itemName, jobCards, movements, issues, itemCode, transfers);
        return res.json({ success: true, stock });
      }

      // If no itemName specified, return all items available in Store
      const uniqueItems = new Set<string>();
      for (const j of jobCards) {
        if (j?.itemName && !j.completed && j.status !== "Completed" && !j.isDeleted) {
          uniqueItems.add(j.itemName);
        }
      }
      const allStocks = Array.from(uniqueItems).map((item) =>
        calculateStoreAuthoritativeItemStock(item, jobCards, movements, issues, undefined, transfers)
      ).filter((s) => s.availableKg > 0 || s.availableBags > 0 || s.availablePcs > 0);

      return res.json({ success: true, items: allStocks });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || "Failed to retrieve Store item stock." });
    }
  });

  app.get("/api/dispatch-store/requirements", ctx.requireAuth, async (_req, res) => {
    try {
      const rows = await ctx.getStore().list(DISPATCH_STORE_REQUIREMENT_COLLECTION);
      return res.json({ success: true, requirements: rows });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || "Failed to list requirements." });
    }
  });

  app.get("/api/dispatch-store/issues", ctx.requireAuth, async (_req, res) => {
    try {
      const rows = await ctx.getStore().list(DISPATCH_STORE_ISSUE_COLLECTION);
      return res.json({ success: true, issues: rows });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || "Failed to list issues." });
    }
  });

  app.get("/api/store-process/transfers", ctx.requireAuth, async (_req, res) => {
    try {
      const rows = await ctx.getStore().list("mfr_process_transfers");
      return res.json({ success: true, transfers: rows });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || "Failed to list process transfers." });
    }
  });
}
