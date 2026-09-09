import { JobCard, MaterialMovement, ProcessTransfer } from '../types';
import {
  storeAuthoritativeOnHand,
  getEffectiveDepartmentRejectionQty,
  remainingAtDepartment,
  remainingAtProduction,
  creditedInboundQty,
  process2SendAvailableQty,
  getCumulativeDispatchedQty
} from '../hardening/process2Manufacturing';

function isLiveMovement(m: MaterialMovement | any): boolean {
  if (!m) return false;
  if (m.undone === true) return false;
  if (m.processDetails?.isUndoReversal) return false;
  if (m.deletedDate || m.isDeleted) return false;
  return true;
}

function creditedToDepartment(cardMovements: MaterialMovement[], toDepartment: string): number {
  return cardMovements
    .filter((m) => isLiveMovement(m) && m.toDepartment === toDepartment)
    .reduce((sum, m) => sum + creditedInboundQty(m), 0);
}

function routedToDepartment(cardMovements: MaterialMovement[], toDepartment: string): number {
  return cardMovements
    .filter((m) => isLiveMovement(m) && m.toDepartment === toDepartment)
    .reduce((sum, m) => sum + Number(m.quantity || 0), 0);
}

export function jobCardLedgerWipQty(
  j: JobCard,
  movementsList: MaterialMovement[] = [],
  opts?: { compulsory?: boolean }
): number {
  if (!j) return 0;
  const dept = String(j.currentDepartment || "");
  if (!dept || dept === "Completed") return 0;
  const cap = process2SendAvailableQty(dept, j, movementsList, opts);
  if (cap !== null) return cap;
  return remainingAtDepartment(j, movementsList, dept);
}

export function getJobCardProcessMetrics(j: JobCard, movementsList: MaterialMovement[] = [], processTransfersList: ProcessTransfer[] = []) {
  if (!j) return {
    qtyReceivedFromProd: 0,
    qtyRoutedToPlating: 0,
    qtyRemainingAtProd: 0,
    htRejections: 0,
    qtyReceivedAtPlating: 0,
    qtyRoutedToPacking: 0,
    qtyRemainingAtPlating: 0,
    platingRejections: 0,
    qtyReceivedAtPacking: 0,
    qtyRoutedToStore: 0,
    qtyRemainingAtPacking: 0,
    packingRejections: 0,
    qtyReceivedAtStore: 0,
    qtyDispatched: 0,
    qtyInProcessTransfers: 0,
    qtyReturnedFromProcess: 0,
    qtyRemainingInStock: 0,
    qtyReceivedAtRawStore: 0
  };

  const targetJc = String(j.jobCardNo || '').toLowerCase();
  const cardMovements = (Array.isArray(movementsList) ? movementsList : []).filter(m => m && String(m.jobCardNo || '').toLowerCase() === targetJc);
  const liveMovements = cardMovements.filter(isLiveMovement);

  const cardTransfers = (Array.isArray(processTransfersList) ? processTransfersList : []).filter(t => t && String(t.jobCardNo || '').toLowerCase() === targetJc);
  const activeProcessTransfers = cardTransfers.filter(t => t.status !== 'Returned to Store');
  const qtyInProcessTransfers = activeProcessTransfers.reduce((sum, t) => sum + (t.quantity || 0), 0);
  const returnedTransfers = cardTransfers.filter(t => t.status === 'Returned to Store');
  const qtyReturnedFromProcess = returnedTransfers.reduce((sum, t) => sum + (t.returnedQty !== undefined ? t.returnedQty : t.quantity), 0);

  const htRejections = getEffectiveDepartmentRejectionQty(j, cardMovements, 'Heat Treatment');
  const platingRejections = getEffectiveDepartmentRejectionQty(j, cardMovements, 'Plating');
  const packingRejections = getEffectiveDepartmentRejectionQty(j, cardMovements, 'Packing');

  const qtyReceivedAtPlating = creditedToDepartment(liveMovements, 'Plating');
  const qtyRoutedToPacking = routedToDepartment(liveMovements, 'Packing');
  const qtyRemainingAtPlating = remainingAtDepartment(j, cardMovements, 'Plating');

  const qtyReceivedAtPacking = creditedToDepartment(liveMovements, 'Packing');
  const qtyRoutedToStore = routedToDepartment(liveMovements, 'Store');
  const qtyRemainingAtPacking = remainingAtDepartment(j, cardMovements, 'Packing');

  const qtyReceivedAtStore = creditedToDepartment(liveMovements, 'Store');
  const qtyDispatched = getCumulativeDispatchedQty(j, cardMovements);
  const qtyRemainingInStock = Math.max(0, storeAuthoritativeOnHand(j, cardMovements) - qtyInProcessTransfers);
  const qtyReceivedAtRawStore = creditedToDepartment(liveMovements, 'Raw Material Store');
  const qtyRoutedToPlating = routedToDepartment(liveMovements, 'Plating');

  if (j.processType === 'Purchase') {
    const qtyReceivedFromPurchase = liveMovements
      .filter((m) => m.fromDepartment === 'Purchase')
      .reduce((sum, m) => sum + creditedInboundQty(m), 0);

    return {
      qtyReceivedFromProd: qtyReceivedFromPurchase,
      qtyRoutedToPlating,
      qtyRemainingAtProd: remainingAtDepartment(j, cardMovements, 'Purchase'),
      htRejections,
      qtyReceivedAtPlating,
      qtyRoutedToPacking,
      qtyRemainingAtPlating,
      platingRejections,
      qtyReceivedAtPacking,
      qtyRoutedToStore,
      qtyRemainingAtPacking,
      packingRejections,
      qtyReceivedAtStore,
      qtyDispatched,
      qtyInProcessTransfers,
      qtyReturnedFromProcess,
      qtyRemainingInStock,
      qtyReceivedAtRawStore
    };
  }

  const qtyReceivedFromProd = liveMovements
    .filter((m) => m.fromDepartment === 'Production' && !m.processDetails?.isRejectionReturn)
    .reduce((sum, m) => sum + Number(m.accepted ? creditedInboundQty(m) : m.quantity || 0), 0);

  const qtyRemainingAtProd = remainingAtProduction(j, cardMovements, { compulsory: true });

  return {
    qtyReceivedFromProd,
    qtyRoutedToPlating,
    qtyRemainingAtProd,
    htRejections,
    qtyReceivedAtPlating,
    qtyRoutedToPacking,
    qtyRemainingAtPlating,
    platingRejections,
    qtyReceivedAtPacking,
    qtyRoutedToStore,
    qtyRemainingAtPacking,
    packingRejections,
    qtyReceivedAtStore,
    qtyDispatched,
    qtyInProcessTransfers,
    qtyReturnedFromProcess,
    qtyRemainingInStock,
    qtyReceivedAtRawStore
  };
}

export function getWireScrapQty(job: JobCard, movements: MaterialMovement[] = []): number {
  if (!job) return 0;
  const targetJc = String(job.jobCardNo || '').toLowerCase();
  const movScrap = (Array.isArray(movements) ? movements : [])
    .filter(m => m && String(m.jobCardNo || '').toLowerCase() === targetJc && m.fromDepartment === 'Production')
    .reduce((sum, m) => sum + (m.wireScrapQty || m.processDetails?.wireScrapQty || 0), 0);

  if (movScrap > 0) return movScrap;
  return job.wireScrapQty || job.productionDetails?.wireScrapQty || 0;
}

export function getAcceptedRawMaterialIssuedQty(job: JobCard, movements: MaterialMovement[] = []): number {
  if (!job) return 0;
  if (job.processType === 'Purchase') return 0;

  const targetJc = String(job.jobCardNo || '').toLowerCase();
  return (Array.isArray(movements) ? movements : [])
    .filter(m => m && String(m.jobCardNo || '').toLowerCase() === targetJc &&
                 m.fromDepartment === 'Raw Material Store' &&
                 m.isIssueRequest &&
                 m.accepted === true)
    .reduce((sum, m) => sum + creditedInboundQty(m), 0);
}

export function getRawMaterialIssuedQty(job: JobCard, movements: MaterialMovement[] = []): number {
  if (!job) return 0;
  if (job.processType === 'Purchase') return 0;
  
  const targetJc = String(job.jobCardNo || '').toLowerCase();
  const issuedMovementsQty = (Array.isArray(movements) ? movements : [])
    .filter(m => m && String(m.jobCardNo || '').toLowerCase() === targetJc && 
                 m.fromDepartment === 'Raw Material Store' && 
                 m.isIssueRequest && 
                 (m.issueStatus === 'Issued' || m.accepted))
    .reduce((sum, m) => sum + creditedInboundQty(m), 0);

  if (issuedMovementsQty > 0) return issuedMovementsQty;

  if (job.rawMaterialStoreDetails?.issueStatus === 'Issued') {
    return job.rawMaterialStoreDetails?.issuedQty || 0;
  }

  return 0;
}

export function getJobCardDepartmentPending(j: JobCard, movementsList: MaterialMovement[]) {
  if (j.completed || j.status === 'Rejected') {
    return {
      prodPending: 0,
      platingPending: 0,
      packingPending: 0,
      totalPending: 0
    };
  }

  const purchasePending = j.processType === 'Purchase' ? remainingAtDepartment(j, movementsList, 'Purchase') : 0;
  const prodPending =
    remainingAtDepartment(j, movementsList, 'Production') +
    remainingAtDepartment(j, movementsList, 'Heat Treatment') +
    purchasePending;
  const platingPending = remainingAtDepartment(j, movementsList, 'Plating');
  const packingPending = remainingAtDepartment(j, movementsList, 'Packing');
  const totalPending = prodPending + platingPending + packingPending;

  return {
    prodPending,
    platingPending,
    packingPending,
    totalPending
  };
}
