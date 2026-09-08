import { BatchScanVerificationItem, BatchScanVerificationResult } from '../types';

export interface BatchScanInput {
  scannedCode: string;
  expectedQty?: number;
}

export function verifyBatchManifestTx(
  scannedInputs: BatchScanInput[],
  activeJobCardsMap: Map<string, any>,
  manifestId?: string,
  dispatchGroupNo?: string
): BatchScanVerificationResult {
  let validCount = 0;
  let invalidCount = 0;
  const verifiedItems: BatchScanVerificationItem[] = [];

  for (const input of scannedInputs) {
    const rawCode = input.scannedCode.trim();
    // Parse QR payload or plain job card number
    let jobCardNo = rawCode;
    try {
      if (rawCode.startsWith('{') && rawCode.endsWith('}')) {
        const parsed = JSON.parse(rawCode);
        jobCardNo = parsed.jobCardNo || parsed.jobCard || rawCode;
      }
    } catch (_) {
      jobCardNo = rawCode;
    }

    const jobCard = activeJobCardsMap.get(jobCardNo);

    if (!jobCard) {
      invalidCount++;
      verifiedItems.push({
        jobCardNo,
        scannedQrCode: rawCode,
        expectedQuantity: input.expectedQty || 0,
        unit: 'PCS',
        status: 'INVALID_JOB',
        errorMessage: `Job card ${jobCardNo} not found in active inventory registry.`
      });
      continue;
    }

    const availableQty = typeof jobCard.currentQty === 'number' ? jobCard.currentQty : 0;
    const isCompleted = jobCard.status === 'Completed' || jobCard.stage === 'Completed';

    if (isCompleted || availableQty <= 0) {
      invalidCount++;
      verifiedItems.push({
        jobCardNo,
        scannedQrCode: rawCode,
        expectedQuantity: availableQty,
        unit: jobCard.unit || 'PCS',
        status: 'ALREADY_DISPATCHED',
        errorMessage: `Job card ${jobCardNo} is already completed or has zero available inventory.`
      });
      continue;
    }

    const reqQty = typeof input.expectedQty === 'number' && input.expectedQty > 0 ? input.expectedQty : availableQty;

    if (reqQty > availableQty) {
      invalidCount++;
      verifiedItems.push({
        jobCardNo,
        scannedQrCode: rawCode,
        expectedQuantity: reqQty,
        unit: jobCard.unit || 'PCS',
        status: 'QUANTITY_MISMATCH',
        errorMessage: `Scanned quantity ${reqQty} exceeds available store quantity ${availableQty}.`
      });
      continue;
    }

    validCount++;
    verifiedItems.push({
      jobCardNo,
      scannedQrCode: rawCode,
      expectedQuantity: reqQty,
      unit: jobCard.unit || 'PCS',
      status: 'VALID'
    });
  }

  const isDispatchable = validCount > 0 && invalidCount === 0;

  return {
    manifestId,
    dispatchGroupNo,
    totalScanned: scannedInputs.length,
    validCount,
    invalidCount,
    isDispatchable,
    items: verifiedItems,
    verifiedAt: new Date().toISOString()
  };
}
