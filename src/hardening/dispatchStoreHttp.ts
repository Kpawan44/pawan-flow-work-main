import type { Express, Request, Response, NextFunction } from "express";
import type { SimpleStore } from "./commitMaterialMovement";
import type { LedgerActor } from "./ledgerHttp";
import {
  applyStoreUnitOpeningTx,
  createDispatchStoreRequirementTx,
  DISPATCH_STORE_ISSUE_COLLECTION,
  DISPATCH_STORE_REQUIREMENT_COLLECTION,
  issueStoreToDispatchTx,
  issueDispatchStoreRequirementTx,
  STORE_UNIT_STOCK_COLLECTION
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

  app.post("/api/dispatch-store/openings", ctx.requireAuth, async (req, res) => {
    try {
      const actor = ctx.getActor(req);
      if (!actor) return res.status(401).json({ success: false, error: "Unauthorized: Missing authoritative user profile." });
      const body = req.body || {};
      const headerOp = String(req.get("x-operation-id") || "").trim();
      const result = await applyStoreUnitOpeningTx(ctx.getStore(), {
        operationId: String(body.operationId || headerOp || "").trim() || undefined,
        jobCardNo: body.jobCardNo,
        bagQty: body.bagQty,
        pcsQty: body.pcsQty,
        kgQty: body.kgQty,
        kind: body.kind === "RECEIPT" ? "RECEIPT" : "OPENING",
        remarks: body.remarks,
        actor
      });
      if (!result.success) return res.status(result.statusCode || 400).json({ success: false, error: result.error });
      const { stock, opening } = result.data!;
      if (ctx.onWrite) {
        ctx.onWrite(STORE_UNIT_STOCK_COLLECTION, stock.jobCardNo, stock);
        ctx.onWrite("mfr_store_unit_openings", opening.id, opening);
      }
      return res.json({ success: true, cached: Boolean(result.cached), stock, opening });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || "Failed to apply independent unit opening." });
    }
  });

  app.post("/api/dispatch-store/issues", ctx.requireAuth, async (req, res) => {
    try {
      const actor = ctx.getActor(req);
      if (!actor) return res.status(401).json({ success: false, error: "Unauthorized: Missing authoritative user profile." });
      const body = req.body || {};
      const headerOp = String(req.get("x-operation-id") || "").trim();
      const operationId = String(body.operationId || headerOp || "").trim() || undefined;

      let result;
      if (body.jobCardNo) {
        result = await issueStoreToDispatchTx(ctx.getStore(), {
          operationId,
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
      const { issue, stock } = result.data!;
      if (ctx.onWrite) {
        ctx.onWrite(DISPATCH_STORE_ISSUE_COLLECTION, issue.id, issue);
        ctx.onWrite(STORE_UNIT_STOCK_COLLECTION, stock.jobCardNo, stock);
      }
      return res.json({ success: true, cached: Boolean(result.cached), issue, stock });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || "Failed to issue independent unit stock." });
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

  app.get("/api/dispatch-store/stock", ctx.requireAuth, async (_req, res) => {
    try {
      const rows = await ctx.getStore().list(STORE_UNIT_STOCK_COLLECTION);
      return res.json({ success: true, stock: rows });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || "Failed to list independent unit stock." });
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
}
