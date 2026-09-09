import type { Express, Request, Response, NextFunction } from "express";
import { commitMaterialMovementTx, SimpleStore } from "./commitMaterialMovement";
import { acceptMaterialMovementTx, rejectMaterialMovementTx, undoMaterialMovementTx } from "./resolveMaterialMovement";
import { applyJobCardPutPolicy } from "./jobCardUpdatePolicy";
import { defaultAcceptOperationId, defaultRejectOperationId, resolveCreateMovementOperationId } from "./movementOperationId";
import type { MovementCommitInput } from "./commitMaterialMovement";

export type LedgerActor = MovementCommitInput["actor"];

export interface LedgerHttpContext {
  requireAuth: (req: Request, res: Response, next: NextFunction) => void | Promise<unknown>;
  getStore: () => SimpleStore;
  getActor: (req: Request) => LedgerActor | null;
  getRmCompulsory: () => Promise<boolean>;
  onWrite?: (collection: string, id: string, data: any) => void;
}

function persistResult(ctx: LedgerHttpContext, result: { movement?: any; returnMovement?: any; updatedJobCard?: any }) {
  if (result.movement && ctx.onWrite) ctx.onWrite("mfr_movements", result.movement.movementId, result.movement);
  if (result.returnMovement && ctx.onWrite) {
    ctx.onWrite("mfr_movements", result.returnMovement.movementId, result.returnMovement);
  }
  if (result.updatedJobCard?.jobCardNo && ctx.onWrite) {
    ctx.onWrite("mfr_job_cards", String(result.updatedJobCard.jobCardNo).toUpperCase(), result.updatedJobCard);
  }
}

/**
 * Live Express ledger routes. Production server.ts and Process 26 HTTP tests both mount this.
 */
export function mountLedgerRoutes(app: Express, ctx: LedgerHttpContext): void {
  const createHandler = async (req: Request, res: Response) => {
    try {
      const actor = ctx.getActor(req);
      if (!actor) {
        return res.status(401).json({ success: false, error: "Unauthorized: Missing authoritative user profile." });
      }
      const bodyData = req.body?.movement ? req.body.movement : req.body || {};
      const opResolved = resolveCreateMovementOperationId({
        ...bodyData,
        operationId: bodyData.operationId || req.body?.operationId
      });
      if (!opResolved.ok) {
        return res.status(400).json({ success: false, error: opResolved.error });
      }
      const jobCardNo = bodyData.jobCardNo;
      const fromDepartment = bodyData.fromDepartment;
      const toDepartment = bodyData.toDepartment;
      const quantity = bodyData.quantity;
      if (!jobCardNo || !fromDepartment || !toDepartment) {
        return res.status(400).json({ success: false, error: "jobCardNo, fromDepartment, and toDepartment are required." });
      }
      const compulsory = await ctx.getRmCompulsory();
      const result = await commitMaterialMovementTx(ctx.getStore(), {
        operationId: opResolved.operationId!,
        movementId: bodyData.movementId,
        jobCardNo: String(jobCardNo).trim(),
        fromDepartment: String(fromDepartment).trim(),
        toDepartment: String(toDepartment).trim(),
        quantity: Number(quantity),
        remarks: bodyData.remarks,
        processDetails: bodyData.processDetails,
        isIssueRequest: Boolean(bodyData.isIssueRequest),
        requestedQty: bodyData.requestedQty,
        requestedUnit: bodyData.requestedUnit,
        transactionType: bodyData.transactionType,
        dispatchGroupNo: bodyData.dispatchGroupNo,
        manifestId: bodyData.manifestId,
        extra: bodyData,
        requireRawMaterialForProduction: compulsory,
        actor
      });
      if (!result.success) {
        return res.status(result.statusCode || 400).json({ success: false, error: result.error });
      }
      persistResult(ctx, result);
      return res.json({
        success: true,
        cached: Boolean(result.cached),
        movement: result.movement,
        updatedJobCard: result.updatedJobCard,
        updatedJobCardVersion: result.updatedJobCard?.version
      });
    } catch (err: any) {
      return res.status(err.statusCode || 400).json({ success: false, error: err.message || "Material movement transaction failed." });
    }
  };

  app.post("/api/inventory/movement", ctx.requireAuth, createHandler);
  app.post("/api/movements", ctx.requireAuth, createHandler);

  app.post("/api/movements/:movementId/accept", ctx.requireAuth, async (req, res) => {
    try {
      const actor = ctx.getActor(req);
      const movementId = req.params.movementId;
      const { remarks, allottedLocation, rackNo, quantity, issueStatus, acceptQty, operationId } = req.body || {};
      if (!actor) return res.status(401).json({ success: false, error: "Unauthorized: Missing user profile." });
      if (!movementId) return res.status(400).json({ success: false, error: "Movement ID is required." });
      const qty = acceptQty !== undefined ? Number(acceptQty) : quantity !== undefined ? Number(quantity) : undefined;
      const compulsory = await ctx.getRmCompulsory();
      const result = await acceptMaterialMovementTx(ctx.getStore(), {
        operationId: String(operationId || defaultAcceptOperationId(movementId, qty)).trim(),
        movementId,
        acceptQty: qty,
        remarks,
        allottedLocation,
        rackNo,
        issueStatus,
        requireRawMaterialForProduction: compulsory,
        actor
      });
      if (!result.success) return res.status(result.statusCode || 400).json({ success: false, error: result.error });
      persistResult(ctx, result);
      return res.json({ success: true, cached: Boolean(result.cached), movement: result.movement, jobCard: result.updatedJobCard });
    } catch (err: any) {
      return res.status(err.statusCode || 500).json({ success: false, error: err.message || "Failed to accept material transfer." });
    }
  });

  app.post("/api/movements/:movementId/reject", ctx.requireAuth, async (req, res) => {
    try {
      const actor = ctx.getActor(req);
      const movementId = req.params.movementId;
      const { remarks, rejectedQty, acceptedQty, operationId } = req.body || {};
      if (!actor) return res.status(401).json({ success: false, error: "Unauthorized: Missing user profile." });
      const compulsory = await ctx.getRmCompulsory();
      const result = await rejectMaterialMovementTx(ctx.getStore(), {
        operationId: String(operationId || defaultRejectOperationId(movementId, rejectedQty, acceptedQty)).trim(),
        movementId,
        remarks: remarks || "",
        rejectedQty: rejectedQty !== undefined ? Number(rejectedQty) : undefined,
        acceptedQty: acceptedQty !== undefined ? Number(acceptedQty) : undefined,
        requireRawMaterialForProduction: compulsory,
        actor
      });
      if (!result.success) return res.status(result.statusCode || 400).json({ success: false, error: result.error });
      persistResult(ctx, result);
      return res.json({
        success: true,
        cached: Boolean(result.cached),
        movement: result.movement,
        returnMovement: result.returnMovement,
        jobCard: result.updatedJobCard
      });
    } catch (err: any) {
      return res.status(err.statusCode || 500).json({ success: false, error: err.message || "Failed to reject material transfer." });
    }
  });

  app.post("/api/movements/:movementId/undo", ctx.requireAuth, async (req, res) => {
    try {
      const actor = ctx.getActor(req);
      const movementId = req.params.movementId;
      const { remarks, operationId } = req.body || {};
      if (!actor) return res.status(401).json({ success: false, error: "Unauthorized: Missing user profile." });
      const compulsory = await ctx.getRmCompulsory();
      const result = await undoMaterialMovementTx(ctx.getStore(), {
        operationId: String(operationId || `op-undo-${movementId}`).trim(),
        movementId,
        remarks,
        requireRawMaterialForProduction: compulsory,
        actor
      });
      if (!result.success) return res.status(result.statusCode || 400).json({ success: false, error: result.error });
      persistResult(ctx, result);
      return res.json({
        success: true,
        cached: Boolean(result.cached),
        movement: result.movement,
        returnMovement: result.returnMovement,
        jobCard: result.updatedJobCard
      });
    } catch (err: any) {
      return res.status(err.statusCode || 500).json({ success: false, error: err.message || "Failed to undo material transfer." });
    }
  });

  app.put("/api/job-cards/:jobCardNo", ctx.requireAuth, async (req, res) => {
    try {
      const actor = ctx.getActor(req);
      if (!actor) return res.status(401).json({ success: false, error: "Unauthorized: Missing user profile." });
      const rawJobCardNo = decodeURIComponent(req.params.jobCardNo).trim();
      const upperId = rawJobCardNo.toUpperCase();
      const store = ctx.getStore();
      const existing = (await store.get("mfr_job_cards", upperId)) || (await store.get("mfr_job_cards", rawJobCardNo));
      const policy = applyJobCardPutPolicy(existing, req.body || {}, actor);
      if (!policy.ok) {
        return res.status(policy.statusCode || 403).json({ success: false, error: policy.error, rejectedFields: policy.rejectedFields });
      }
      const now = new Date().toISOString();
      const updatedCard = {
        ...existing,
        ...policy.sanitized,
        jobCardNo: existing.jobCardNo,
        currentQty: existing.currentQty,
        currentDepartment: existing.currentDepartment,
        orderQty: existing.orderQty,
        version: (existing.version || 1) + 1,
        updatedAt: now,
        updatedBy: actor.userName,
        updatedByUserId: actor.userId
      };
      await store.set("mfr_job_cards", upperId, updatedCard);
      if (ctx.onWrite) ctx.onWrite("mfr_job_cards", upperId, updatedCard);
      return res.json({ success: true, jobCard: updatedCard });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: err.message || "Failed to update job card" });
    }
  });
}
