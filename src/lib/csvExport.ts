import { JobCard, MaterialMovement, AuditLog } from '../types';

// Escapes values for safe CSV inclusion (handles quotes, commas, newlines)
function escapeCSV(val: any): string {
  if (val === null || val === undefined) return '';
  let str = String(val);
  str = str.replace(/"/g, '""');
  if (/[",\n\r]/.test(str)) {
    return `"${str}"`;
  }
  return str;
}

// Download utility
export function downloadCSVFile(filename: string, headers: string[], rows: any[][]) {
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(escapeCSV).join(','))
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// 1. Export Job Cards
export function exportJobCards(jobCards: JobCard[]) {
  const headers = [
    'Job Card No',
    'Order No',
    'Party Name',
    'Item Name',
    'Item Code',
    'Order Qty (KG)',
    'Current Qty (KG)',
    'Balance Qty (KG)',
    'Current Dept',
    'Status',
    'HT Required',
    'Created By',
    'Created At',
    'Completed'
  ];

  const rows = jobCards.map(j => [
    j.jobCardNo,
    j.orderNo,
    j.partyName,
    j.itemName,
    j.itemCode,
    j.orderQty,
    j.currentQty,
    j.balanceQty,
    j.currentDepartment,
    j.status,
    j.heatTreatmentRequired ? 'YES' : 'NO',
    j.createdBy,
    j.createdAt,
    j.completed ? 'YES' : 'NO'
  ]);

  downloadCSVFile(`Job_Cards_Ledger_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
}

// 2. Export Material Movements
export function exportMaterialMovements(movements: MaterialMovement[]) {
  const headers = [
    'Movement ID',
    'Job Card No',
    'From Department',
    'To Department',
    'Quantity (KG)',
    'Transferred By',
    'Transfer Date',
    'Accepted',
    'Accepted By',
    'Accepted Date',
    'Remarks'
  ];

  const rows = movements.map(m => [
    m.movementId,
    m.jobCardNo,
    m.fromDepartment,
    m.toDepartment,
    m.quantity,
    m.transferBy,
    m.transferDate,
    m.accepted ? 'YES' : 'NO',
    m.acceptedBy || '',
    m.acceptedDate || '',
    m.remarks || ''
  ]);

  downloadCSVFile(`Material_Movements_Trail_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
}

// 3. Export Actions & Audit Log
export function exportAuditLogs(logs: AuditLog[]) {
  const headers = [
    'Timestamp',
    'User ID',
    'User Name',
    'Action',
    'Details'
  ];

  const rows = logs.map(l => [
    l.timestamp,
    l.userId,
    l.userName,
    l.action,
    l.details
  ]);

  downloadCSVFile(`Operations_Audit_Trail_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
}

// 4. Export Department Updates & Process Metrics
export function exportDepartmentUpdates(jobCards: JobCard[]) {
  const headers = [
    'Timestamp/Approx',
    'Job Card No',
    'Department',
    'Operator/Updater',
    'Hardness Spec/Type',
    'Temp/Plating Bath',
    'Cycle Time/Coating',
    'Box Count/Bin Loc',
    'Packing Style/Invoice',
    'Rejection Qty (KG)',
    'Notes/Remarks',
    'Qty Received From Prod (KG)',
    'Qty Sent to Plating (KG)',
    'Remaining Balance Qty (KG)'
  ];

  const rows: any[][] = [];

  jobCards.forEach(c => {
    // 1. Heat Treatment
    if (c.heatTreatmentDetails) {
      const ht = c.heatTreatmentDetails;
      if (ht.hardnessRequired || ht.temperature || ht.cycleTime || ht.rejectionQty || ht.remarks) {
        rows.push([
          c.createdAt, // Approx timestamp
          c.jobCardNo,
          'Heat Treatment',
          c.operatorName || 'System Sync',
          ht.hardnessRequired || '',
          ht.temperature || '',
          ht.cycleTime || '',
          '',
          '',
          ht.rejectionQty || 0,
          ht.remarks || '',
          ht.qtyReceivedFromProd || '',
          ht.qtySentToPlating || '',
          ht.qtyRemaining || ''
        ]);
      }
    }

    // 2. Plating
    if (c.platingDetails) {
      const pl = c.platingDetails;
      if (pl.platingType || pl.micronThickness || pl.durationMinutes || pl.rejectionQty || pl.remarks) {
        rows.push([
          c.createdAt, // Approx timestamp
          c.jobCardNo,
          'Plating',
          c.operatorName || 'System Sync',
          pl.platingType || '',
          '',
          pl.micronThickness || '',
          '',
          pl.durationMinutes || '',
          pl.rejectionQty || 0,
          pl.remarks || '',
          pl.qtyReceivedFromHt || '',
          pl.qtySentToPacking || '',
          pl.qtyRemaining || ''
        ]);
      }
    }

    // 3. Packing
    if (c.packingDetails) {
      const pk = c.packingDetails;
      if (pk.packedQty || pk.boxCount || pk.packingType || pk.rejectionQty || pk.remarks) {
        rows.push([
          c.createdAt, // Approx timestamp
          c.jobCardNo,
          'Packing',
          c.operatorName || 'System Sync',
          '',
          '',
          '',
          pk.boxCount ? String(pk.boxCount) : '',
          pk.packingType || '',
          pk.rejectionQty || 0,
          pk.remarks || '',
          pk.qtyReceivedFromPlating || '',
          pk.qtySentToStore || '',
          pk.qtyRemaining || ''
        ]);
      }
    }

    // 4. Store
    if (c.storeDetails) {
      const st = c.storeDetails;
      if (st.verifiedQty || st.locationBin || st.rejectionQty || st.remarks) {
        rows.push([
          c.createdAt, // Approx timestamp
          c.jobCardNo,
          'Store',
          c.operatorName || 'System Sync',
          '',
          '',
          '',
          st.locationBin || '',
          '',
          st.rejectionQty || 0,
          st.remarks || '',
          st.qtyReceivedFromPacking || '',
          st.qtySentToDispatch || '',
          st.qtyRemaining || ''
        ]);
      }
    }

    // 5. Dispatch
    if (c.dispatchDetails) {
      const dp = c.dispatchDetails;
      if (dp.invoiceNo || dp.vehicleNo || dp.dispatchQty || dp.remarks) {
        rows.push([
          dp.dispatchDate || c.createdAt,
          c.jobCardNo,
          'Dispatch',
          c.operatorName || 'System Sync',
          '',
          dp.vehicleNo || '',
          '',
          '',
          dp.invoiceNo || '',
          0,
          dp.remarks || '',
          dp.dispatchQty || '',
          '',
          ''
        ]);
      }
    }
  });

  downloadCSVFile(`Process_Metrics_Ledger_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
}
