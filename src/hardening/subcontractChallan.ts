import { SubcontractChallan, SubcontractChallanItem } from '../types';

export interface CreateChallanInput {
  vendorName: string;
  vendorGstin?: string;
  vendorAddress?: string;
  expectedReturnDate?: string;
  items: {
    jobCardNo: string;
    itemName: string;
    processRequired: string;
    sentQty: number;
    unit?: 'PCS' | 'KGS' | 'KG';
  }[];
  userId: string;
  userName: string;
}

export function createSubcontractChallanTx(
  input: CreateChallanInput,
  activeJobCardsMap: Map<string, any>,
  existingChallanNos: Set<string>
): { success: boolean; challan?: SubcontractChallan; error?: string } {
  if (!input.vendorName || input.vendorName.trim() === '') {
    return { success: false, error: 'Vendor name is required for subcontract delivery challans.' };
  }

  if (!input.items || input.items.length === 0) {
    return { success: false, error: 'At least one item is required to issue a delivery challan.' };
  }

  const challanItems: SubcontractChallanItem[] = [];
  let totalSentQty = 0;

  for (const item of input.items) {
    if (!item.jobCardNo || item.jobCardNo.trim() === '') {
      return { success: false, error: 'Every challan item must specify a valid jobCardNo.' };
    }

    if (typeof item.sentQty !== 'number' || item.sentQty <= 0) {
      return { success: false, error: `Invalid quantity ${item.sentQty} for job card ${item.jobCardNo}.` };
    }

    const jobCard = activeJobCardsMap.get(item.jobCardNo);
    if (!jobCard) {
      return { success: false, error: `Job card ${item.jobCardNo} not found in active inventory.` };
    }

    const available = typeof jobCard.currentQty === 'number' ? jobCard.currentQty : 0;
    if (item.sentQty > available) {
      return {
        success: false,
        error: `Requested quantity ${item.sentQty} for ${item.jobCardNo} exceeds available quantity ${available}.`
      };
    }

    totalSentQty += item.sentQty;
    challanItems.push({
      jobCardNo: item.jobCardNo,
      itemName: item.itemName || jobCard.itemName || 'Unknown Item',
      processRequired: item.processRequired || 'Subcontract Process',
      sentQty: item.sentQty,
      returnedQty: 0,
      scrapQty: 0,
      unit: item.unit || jobCard.unit || 'PCS'
    });
  }

  // Generate unique challan number
  let sequence = existingChallanNos.size + 1;
  let challanNo = `SCH-${sequence.toString().padStart(6, '0')}`;
  while (existingChallanNos.has(challanNo)) {
    sequence++;
    challanNo = `SCH-${sequence.toString().padStart(6, '0')}`;
  }

  const now = new Date().toISOString();
  const challan: SubcontractChallan = {
    challanId: `doc-${challanNo}`,
    challanNo,
    vendorName: input.vendorName.trim(),
    vendorGstin: input.vendorGstin?.trim(),
    vendorAddress: input.vendorAddress?.trim(),
    dispatchDate: now,
    expectedReturnDate: input.expectedReturnDate,
    items: challanItems,
    totalSentQty,
    totalReturnedQty: 0,
    status: 'OUTBOUND',
    createdById: input.userId,
    createdByName: input.userName,
    createdAt: now,
    updatedAt: now
  };

  return { success: true, challan };
}

export function isSubcontractChallanOverdue(challan: SubcontractChallan | null | undefined): boolean {
  if (!challan) return false;
  if (challan.status === 'COMPLETED' || challan.status === 'CANCELLED') {
    return false;
  }
  if (!challan.expectedReturnDate) {
    return false;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const returnDate = new Date(challan.expectedReturnDate);
  if (isNaN(returnDate.getTime())) {
    return false;
  }
  returnDate.setHours(0, 0, 0, 0);

  return today.getTime() > returnDate.getTime();
}
