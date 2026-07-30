import * as XLSX from 'xlsx';
import { JobCard, MaterialMovement, AuditLog } from '../types';
import { getJobCardProcessMetrics, getJobCardDepartmentPending } from './metrics';
import { INVENTORY_RAW_MATERIALS } from '../components/RawMaterialRequestModal';

export interface ComprehensiveExportData {
  jobCards: JobCard[];
  movements: MaterialMovement[];
  auditLogs?: AuditLog[];
}

/**
 * Generates and downloads a complete Excel (.xlsx) workbook where EVERY report
 * and ledger exists in its own separate sheet.
 */
export function exportComprehensiveExcelBackup(
  jobCards: JobCard[],
  movements: MaterialMovement[],
  auditLogs: AuditLog[] = []
) {
  const wb = XLSX.utils.book_new();

  // 1. Executive Summary & Overview
  const activeJobs = jobCards.filter(j => !j.completed && j.status !== 'Rejected');
  const completedJobs = jobCards.filter(j => j.completed);
  const rejectedJobs = jobCards.filter(j => j.status === 'Rejected');
  const totalTargetQty = jobCards.reduce((acc, j) => acc + (j.orderQty || 0), 0);
  const totalDispatchedQty = jobCards.reduce((acc, j) => acc + (j.dispatchDetails?.dispatchQty || (j.completed ? j.currentQty : 0)), 0);

  const overviewRows = [
    ['MFR ERP SYSTEM - COMPREHENSIVE BACKUP REPORT WORKBOOK'],
    ['Generated On:', new Date().toLocaleString()],
    ['Total Job Cards Registered:', jobCards.length],
    ['Active Production Line Jobs:', activeJobs.length],
    ['Completed / Dispatched Jobs:', completedJobs.length],
    ['Rejected Jobs:', rejectedJobs.length],
    ['Total Material Movements Logged:', movements.length],
    ['Total Audit Logs:', auditLogs.length],
    ['Total Target Order Quantity (KG):', totalTargetQty],
    ['Total Dispatched Quantity (KG):', totalDispatchedQty],
    [''],
    ['WORKBOOK INDEX (SEPARATE SHEET FOR EVERY REPORT):'],
    ['1. Overview Summary', 'Executive system snapshot'],
    ['2. Job Cards Master', 'Complete ledger of all Job Cards in database'],
    ['3. Material Movements', 'Complete trail of all material transfers'],
    ['4. Production Milling', 'Machining outputs and operator signoffs'],
    ['5. Heat Treatment', 'Hardness specs, recipes, and rejections'],
    ['6. Surfacing & Plating', 'Coating thickness and plating batches'],
    ['7. Packaging Weights', 'Box specifications and packing counts'],
    ['8. Store & Warehousing', 'Bin locations, rack assignments, and verified stock'],
    ['9. Stock Summary (Item-wise)', 'Aggregated item stock weights, boxes, and pieces'],
    ['10. Raw Material Store Ledger', 'RM requests, issued weights, and statuses'],
    ['11. Raw Material Stock & Demand', 'Audit of raw material inventory & consumption'],
    ['12. Dispatch Shipment Log', 'Invoiced shipments, vehicles, and dispatch dates'],
    ['13. Active Outstanding Queue', 'Active pending work floor orders'],
    ['14. Archived Completed Orders', 'Fully completed and delivered orders'],
    ['15. Rejected Orders', 'Orders marked with rejection status'],
    ['16. Balance Quantity Audit', 'Target vs Processed Scrap calculations'],
    ['17. Rejection Analysis', 'Department-wise rejection percentages'],
    ['18. Process Metrics Ledger', 'Comprehensive department activity logs'],
    ['19. Operations Audit Trail', 'User activity and audit log']
  ];
  const wsOverview = XLSX.utils.aoa_to_sheet(overviewRows);
  XLSX.utils.book_append_sheet(wb, wsOverview, '1. Overview Summary');

  // 2. Job Cards Master
  const jcHeaders = [
    'Job Card No', 'Order No', 'Party Name', 'Item Name', 'Item Code',
    'Order Qty (KG)', 'Current Qty (KG)', 'Balance Qty (KG)', 'Current Dept',
    'Status', 'HT Required', 'Created By', 'Created At', 'Completed'
  ];
  const jcRows = jobCards.map(j => [
    j.jobCardNo, j.orderNo || '', j.partyName, j.itemName, j.itemCode || '',
    j.orderQty, j.currentQty, j.balanceQty, j.currentDepartment,
    j.status, j.heatTreatmentRequired ? 'YES' : 'NO', j.createdBy || '',
    j.createdAt, j.completed ? 'YES' : 'NO'
  ]);
  const wsJC = XLSX.utils.aoa_to_sheet([jcHeaders, ...jcRows]);
  XLSX.utils.book_append_sheet(wb, wsJC, '2. Job Cards Master');

  // 3. Material Movements
  const movHeaders = [
    'Movement ID', 'Job Card No', 'From Department', 'To Department',
    'Quantity (KG)', 'Unit', 'Transferred By', 'Transfer Date',
    'Accepted', 'Accepted By', 'Accepted Date', 'Allotted Location',
    'Rack No', 'Remarks'
  ];
  const movRows = movements.map(m => [
    m.movementId, m.jobCardNo, m.fromDepartment, m.toDepartment,
    m.quantity, m.requestedUnit || 'KG', m.transferBy, m.transferDate,
    m.accepted ? 'YES' : 'NO', m.acceptedBy || '', m.acceptedDate || '',
    m.allottedLocation || '', m.rackNo || '', m.remarks || ''
  ]);
  const wsMov = XLSX.utils.aoa_to_sheet([movHeaders, ...movRows]);
  XLSX.utils.book_append_sheet(wb, wsMov, '3. Material Movements');

  // 4. Production Milling Report
  const prodHeaders = [
    'Job Card No', 'Party Name', 'Item Name', 'Target Qty (KG)',
    'Received From Prod (KG)', 'Routed To Plating (KG)', 'Remaining At Prod (KG)', 'Created Date'
  ];
  const prodRows = jobCards.map(c => {
    const m = getJobCardProcessMetrics(c, movements);
    return [
      c.jobCardNo, c.partyName, c.itemName, c.orderQty,
      m.qtyReceivedFromProd, m.qtyRoutedToPlating, m.qtyRemainingAtProd, c.createdAt
    ];
  });
  const wsProd = XLSX.utils.aoa_to_sheet([prodHeaders, ...prodRows]);
  XLSX.utils.book_append_sheet(wb, wsProd, '4. Production Milling');

  // 5. Heat Treatment Report
  const htHeaders = [
    'Job Card No', 'Party Name', 'Item Name', 'Hardness Spec',
    'Temperature (°C)', 'Cycle Time', 'Rejections (KG)', 'Created Date'
  ];
  const htRows = jobCards
    .filter(c => c.heatTreatmentRequired)
    .map(c => {
      const m = getJobCardProcessMetrics(c, movements);
      return [
        c.jobCardNo, c.partyName, c.itemName,
        c.heatTreatmentDetails?.hardnessRequired || 'Awaiting Action',
        c.heatTreatmentDetails?.temperature || 'N/A',
        c.heatTreatmentDetails?.cycleTime || 'N/A',
        m.htRejections, c.createdAt
      ];
    });
  const wsHT = XLSX.utils.aoa_to_sheet([htHeaders, ...htRows]);
  XLSX.utils.book_append_sheet(wb, wsHT, '5. Heat Treatment');

  // 6. Surfacing & Plating Report
  const platingHeaders = [
    'Job Card No', 'Party Name', 'Item Name', 'Plating Type',
    'Thickness (μm)', 'Received at Plating (KG)', 'Routed to Packing (KG)',
    'Remaining at Plating (KG)', 'Rejections (KG)', 'Created Date'
  ];
  const platingRows = jobCards.map(c => {
    const m = getJobCardProcessMetrics(c, movements);
    return [
      c.jobCardNo, c.partyName, c.itemName,
      c.platingDetails?.platingType || 'Pending',
      c.platingDetails?.micronThickness ? `${c.platingDetails.micronThickness}μm` : 'Pending',
      m.qtyReceivedAtPlating, m.qtyRoutedToPacking, m.qtyRemainingAtPlating,
      m.platingRejections, c.createdAt
    ];
  });
  const wsPlating = XLSX.utils.aoa_to_sheet([platingHeaders, ...platingRows]);
  XLSX.utils.book_append_sheet(wb, wsPlating, '6. Surfacing & Plating');

  // 7. Packaging Weights Report
  const packingHeaders = [
    'Job Card No', 'Party Name', 'Item Name', 'Box Count', 'Packing Style',
    'Received at Packing (KG)', 'Routed to Store (KG)', 'Remaining at Packing (KG)',
    'Rejections (KG)', 'Created Date'
  ];
  const packingRows = jobCards.map(c => {
    const m = getJobCardProcessMetrics(c, movements);
    return [
      c.jobCardNo, c.partyName, c.itemName,
      c.packingDetails?.boxCount || 0,
      c.packingDetails?.packingType || 'Pending',
      m.qtyReceivedAtPacking, m.qtyRoutedToStore, m.qtyRemainingAtPacking,
      m.packingRejections, c.createdAt
    ];
  });
  const wsPacking = XLSX.utils.aoa_to_sheet([packingHeaders, ...packingRows]);
  XLSX.utils.book_append_sheet(wb, wsPacking, '7. Packaging Weights');

  // 8. Store & Warehousing Report
  const storeHeaders = [
    'Job Card No', 'Party Name', 'Item Name', 'Bin Location', 'Rack No',
    'Received at Store (KG)', 'Pcs Received', 'Qty Dispatched (KG)', 'Qty In Stock (KG)', 'Created Date'
  ];
  const storeRows = jobCards.map(c => {
    const m = getJobCardProcessMetrics(c, movements);
    const storeMovements = movements.filter(mov => 
      mov.jobCardNo.toLowerCase() === c.jobCardNo.toLowerCase() && 
      mov.toDepartment === 'Store' && mov.accepted
    );
    const latestStoreMov = storeMovements.reduce<MaterialMovement | null>((latest, current) => {
      if (!latest) return current;
      return new Date(current.transferDate) > new Date(latest.transferDate) ? current : latest;
    }, null);

    return [
      c.jobCardNo, c.partyName, c.itemName,
      latestStoreMov?.allottedLocation || c.storeDetails?.locationBin || 'Pending placement',
      latestStoreMov?.rackNo || 'N/A',
      m.qtyReceivedAtStore,
      c.packingDetails?.totalPcs !== undefined ? `${c.packingDetails.totalPcs.toLocaleString()} pcs` : 'N/A',
      m.qtyDispatched, m.qtyRemainingInStock, c.createdAt
    ];
  });
  const wsStore = XLSX.utils.aoa_to_sheet([storeHeaders, ...storeRows]);
  XLSX.utils.book_append_sheet(wb, wsStore, '8. Store & Warehousing');

  // 9. Stock Summary (Item-wise)
  const stockMap: Record<string, {
    itemName: string; itemCode: string; totalReceivedKg: number;
    totalDispatchedKg: number; totalInStockKg: number; totalBoxesInStock: number;
    totalPiecesInStock: number; locationBins: string; date: string;
  }> = {};

  jobCards.forEach(c => {
    const m = getJobCardProcessMetrics(c, movements);
    const key = c.itemName || 'UNKNOWN';
    const itemCode = c.itemCode || 'N/A';
    const bin = c.storeDetails?.locationBin;
    const totalPcs = c.packingDetails?.totalPcs || 0;
    const boxCount = c.packingDetails?.boxCount || 0;
    const receivedStore = m.qtyReceivedAtStore || 0;
    const remainingStock = m.qtyRemainingInStock || 0;

    let fraction = receivedStore > 0 ? remainingStock / receivedStore : (remainingStock > 0 ? 1 : 0);
    const pcsInStock = fraction * totalPcs;
    const boxesInStock = fraction * boxCount;

    if (!stockMap[key]) {
      stockMap[key] = {
        itemName: key, itemCode, totalReceivedKg: 0, totalDispatchedKg: 0,
        totalInStockKg: 0, totalBoxesInStock: 0, totalPiecesInStock: 0,
        locationBins: '', date: c.createdAt
      };
    }
    stockMap[key].totalReceivedKg += receivedStore;
    stockMap[key].totalDispatchedKg += m.qtyDispatched;
    stockMap[key].totalInStockKg += m.qtyRemainingInStock;
    stockMap[key].totalBoxesInStock += boxesInStock;
    stockMap[key].totalPiecesInStock += pcsInStock;

    if (bin && bin !== 'Pending placement' && !stockMap[key].locationBins.includes(bin)) {
      stockMap[key].locationBins = stockMap[key].locationBins 
        ? `${stockMap[key].locationBins}, ${bin}` 
        : bin;
    }
  });

  const stockSummaryHeaders = [
    'Item Name', 'Item Code', 'Total Received at Store (KG)',
    'Total Dispatched (KG)', 'Total In-Stock (KG)', 'Boxes In Stock',
    'Pieces In Stock', 'Location Bins'
  ];
  const stockSummaryRows = Object.values(stockMap).map(item => [
    item.itemName, item.itemCode,
    Math.round(item.totalReceivedKg * 10) / 10,
    Math.round(item.totalDispatchedKg * 10) / 10,
    Math.round(item.totalInStockKg * 10) / 10,
    Math.round(item.totalBoxesInStock * 10) / 10,
    Math.round(item.totalPiecesInStock),
    item.locationBins || 'Pending placement'
  ]);
  const wsStockSummary = XLSX.utils.aoa_to_sheet([stockSummaryHeaders, ...stockSummaryRows]);
  XLSX.utils.book_append_sheet(wb, wsStockSummary, '9. Stock Summary');

  // 10. Raw Material Store Ledger
  const rmStoreMovs = movements.filter(m => m.fromDepartment === 'Raw Material Store' && m.isIssueRequest);
  const rmLedgerHeaders = [
    'Job Card No', 'Party Name', 'Item Name', 'Raw Mat Spec', 'Raw Mat Code',
    'Requested Qty (KG)', 'Issued Qty (KG)', 'Status', 'Bin Location',
    'Remarks', 'Requested By', 'Date'
  ];
  const rmLedgerRows = rmStoreMovs.map(m => {
    const matchedCard = jobCards.find(jc => jc.jobCardNo.toLowerCase() === m.jobCardNo.toLowerCase());
    const isRejected = m.issueStatus === 'Rejected' || m.remarks?.toLowerCase().includes('reject');
    return [
      m.jobCardNo, matchedCard?.partyName || 'N/A', matchedCard?.itemName || 'N/A',
      m.processDetails?.rawMaterialName || 'Raw Material',
      m.processDetails?.rawMaterialCode || 'N/A',
      m.requestedQty || m.quantity,
      m.issueStatus === 'Issued' ? m.quantity : 0,
      m.issueStatus || (isRejected ? 'Rejected' : 'Pending'),
      m.allottedLocation || 'N/A', m.remarks || '',
      m.processDetails?.requestedBy || m.transferBy || 'Production',
      m.transferDate ? m.transferDate.split('T')[0] : 'N/A'
    ];
  });
  const wsRMLedger = XLSX.utils.aoa_to_sheet([rmLedgerHeaders, ...rmLedgerRows]);
  XLSX.utils.book_append_sheet(wb, wsRMLedger, '10. RM Store Ledger');

  // 11. Raw Material Stock & Demand
  const rmStockHeaders = [
    'Material Code', 'Material Name', 'Category', 'Bin Location',
    'Starting Stock (KG)', 'Inwarded Stock (KG)', 'Total Issued (KG)',
    'Current Stock (KG)', 'Reserve Status (%)'
  ];
  const rmStockRows = INVENTORY_RAW_MATERIALS.map(item => {
    const totalIssued = movements
      .filter(m => 
        m.fromDepartment === 'Raw Material Store' && m.isIssueRequest && 
        m.issueStatus === 'Issued' && 
        (m.processDetails?.rawMaterialCode === item.code || m.jobCardNo === 'STOCK-IN-' + item.code || m.jobCardNo === item.code)
      )
      .reduce((sum, m) => sum + (m.quantity || 0), 0);

    const totalPurchased = movements
      .filter(m => 
        m.toDepartment === 'Raw Material Store' && m.fromDepartment === 'Purchase' && m.accepted &&
        (m.processDetails?.rawMaterialCode === item.code || m.jobCardNo === 'STOCK-IN-' + item.code || m.jobCardNo === item.code)
      )
      .reduce((sum, m) => sum + (m.quantity || 0), 0);

    const currentStock = Math.max(0, item.availableStock + totalPurchased - totalIssued);
    return [
      item.code, item.name, item.category, item.location,
      item.availableStock, totalPurchased, totalIssued, currentStock,
      Math.round(item.availableStock > 0 ? (currentStock / item.availableStock) * 100 : 0)
    ];
  });
  const wsRMStock = XLSX.utils.aoa_to_sheet([rmStockHeaders, ...rmStockRows]);
  XLSX.utils.book_append_sheet(wb, wsRMStock, '11. RM Stock & Demand');

  // 12. Dispatch Shipment Log
  const dispatchHeaders = [
    'Job Card No', 'Party Name', 'Item Name', 'Order Placed By',
    'Invoice No', 'Vehicle No', 'Dispatch Qty (KG)', 'Dispatch Date'
  ];
  const dispatchRows = jobCards
    .filter(c => c.completed || c.dispatchDetails)
    .map(c => [
      c.jobCardNo, c.partyName, c.itemName, c.createdBy || 'Unknown',
      c.dispatchDetails?.invoiceNo || 'INV-Pending',
      c.dispatchDetails?.vehicleNo || 'Self Pick',
      c.dispatchDetails?.dispatchQty || c.currentQty,
      c.dispatchDetails?.dispatchDate || c.createdAt
    ]);
  const wsDispatch = XLSX.utils.aoa_to_sheet([dispatchHeaders, ...dispatchRows]);
  XLSX.utils.book_append_sheet(wb, wsDispatch, '12. Dispatch Log');

  // 13. Active Outstanding Queue
  const pendingHeaders = [
    'Job Card No', 'Order No', 'Party Name', 'Item Name', 'Order Placed By',
    'Current Department', 'Status', 'Target Qty (KG)', 'Pending Prod to Pack (KG)', 'Created Date'
  ];
  const pendingRows = jobCards
    .filter(c => !c.completed)
    .map(c => {
      const deptPending = getJobCardDepartmentPending(c, movements);
      return [
        c.jobCardNo, c.orderNo || '', c.partyName, c.itemName, c.createdBy || 'Unknown',
        c.currentDepartment, c.status, c.orderQty, deptPending.totalPending, c.createdAt
      ];
    });
  const wsPending = XLSX.utils.aoa_to_sheet([pendingHeaders, ...pendingRows]);
  XLSX.utils.book_append_sheet(wb, wsPending, '13. Active Outstanding Queue');

  // 14. Archived Completed Orders
  const completedHeaders = [
    'Job Card No', 'Order No', 'Party Name', 'Item Name', 'Order Placed By',
    'Final Department', 'Status', 'Order Qty (KG)', 'Final Delivered Qty (KG)', 'Created Date'
  ];
  const completedRows = jobCards
    .filter(c => c.completed)
    .map(c => [
      c.jobCardNo, c.orderNo || '', c.partyName, c.itemName, c.createdBy || 'Unknown',
      c.currentDepartment, c.status, c.orderQty, c.currentQty, c.createdAt
    ]);
  const wsCompleted = XLSX.utils.aoa_to_sheet([completedHeaders, ...completedRows]);
  XLSX.utils.book_append_sheet(wb, wsCompleted, '14. Archived Completed');

  // 15. Rejected Orders Report
  const rejectedHeaders = [
    'Job Card No', 'Order No', 'Party Name', 'Item Name', 'Current Department', 'Status', 'Created Date'
  ];
  const rejectedRows = jobCards
    .filter(c => c.status === 'Rejected')
    .map(c => [
      c.jobCardNo, c.orderNo || '', c.partyName, c.itemName, c.currentDepartment, c.status, c.createdAt
    ]);
  const wsRejected = XLSX.utils.aoa_to_sheet([rejectedHeaders, ...rejectedRows]);
  XLSX.utils.book_append_sheet(wb, wsRejected, '15. Rejected Orders');

  // 16. Balance Quantity Audit
  const balanceHeaders = [
    'Job Card No', 'Party Name', 'Item Code', 'Order Placed By',
    'Order Weight (KG)', 'Processed Weight (KG)', 'Scrap Weight (KG)',
    'Balance Weight (KG)', 'Current Dept', 'Status'
  ];
  const balanceRows = jobCards.map(c => {
    const processedWeight = c.completed ? c.currentQty : 0;
    return [
      c.jobCardNo, c.partyName, c.itemCode || '', c.createdBy || 'Unknown',
      c.orderQty, processedWeight, Math.max(0, c.orderQty - c.currentQty),
      c.balanceQty, c.currentDepartment, c.status
    ];
  });
  const wsBalance = XLSX.utils.aoa_to_sheet([balanceHeaders, ...balanceRows]);
  XLSX.utils.book_append_sheet(wb, wsBalance, '16. Balance Qty Audit');

  // 17. Rejection Analysis By Dept
  const deptStats: Record<string, { processed: number; rejected: number }> = {
    'Production': { processed: 0, rejected: 0 },
    'Heat Treatment': { processed: 0, rejected: 0 },
    'Plating': { processed: 0, rejected: 0 },
    'Packing': { processed: 0, rejected: 0 },
    'Store': { processed: 0, rejected: 0 }
  };
  jobCards.forEach(jc => {
    const m = getJobCardProcessMetrics(jc, movements);
    const isProdRejected = jc.status === 'Rejected' && jc.currentDepartment === 'Production';
    deptStats['Production'].processed += jc.orderQty;
    deptStats['Production'].rejected += isProdRejected ? jc.orderQty : 0;

    if (jc.heatTreatmentRequired) {
      deptStats['Heat Treatment'].processed += m.qtyReceivedFromProd;
      deptStats['Heat Treatment'].rejected += m.htRejections;
    }
    deptStats['Plating'].processed += m.qtyReceivedAtPlating;
    deptStats['Plating'].rejected += m.platingRejections;

    deptStats['Packing'].processed += m.qtyReceivedAtPacking;
    deptStats['Packing'].rejected += m.packingRejections;

    deptStats['Store'].processed += m.qtyReceivedAtStore;
    deptStats['Store'].rejected += jc.storeDetails?.rejectionQty || 0;
  });

  const rejectionAnalysisHeaders = [
    'Department', 'Total Processed (KG)', 'Total Rejected (KG)', 'Rejection Percentage (%)'
  ];
  const rejectionAnalysisRows = Object.entries(deptStats).map(([dept, data]) => {
    const pct = data.processed > 0 ? (data.rejected / data.processed) * 100 : 0;
    return [
      dept, Math.round(data.processed * 10) / 10, Math.round(data.rejected * 10) / 10, Math.round(pct * 100) / 100
    ];
  });
  const wsRejectionAnalysis = XLSX.utils.aoa_to_sheet([rejectionAnalysisHeaders, ...rejectionAnalysisRows]);
  XLSX.utils.book_append_sheet(wb, wsRejectionAnalysis, '17. Rejection Analysis');

  // 18. Department Process Metrics
  const metricsHeaders = [
    'Timestamp/Approx', 'Job Card No', 'Department', 'Operator/Updater',
    'Hardness Spec/Type', 'Temp/Plating Bath', 'Cycle Time/Coating',
    'Box Count/Bin Loc', 'Packing Style/Invoice', 'Rejection Qty (KG)',
    'Notes/Remarks', 'Qty Received (KG)', 'Qty Sent (KG)', 'Remaining Balance (KG)'
  ];
  const metricsRows: any[][] = [];
  jobCards.forEach(c => {
    if (c.heatTreatmentDetails) {
      const ht = c.heatTreatmentDetails;
      if (ht.hardnessRequired || ht.temperature || ht.cycleTime || ht.rejectionQty || ht.remarks) {
        metricsRows.push([
          c.createdAt, c.jobCardNo, 'Heat Treatment', c.operatorName || 'System Sync',
          ht.hardnessRequired || '', ht.temperature || '', ht.cycleTime || '',
          '', '', ht.rejectionQty || 0, ht.remarks || '',
          ht.qtyReceivedFromProd || '', ht.qtySentToPlating || '', ht.qtyRemaining || ''
        ]);
      }
    }
    if (c.platingDetails) {
      const pl = c.platingDetails;
      if (pl.platingType || pl.micronThickness || pl.durationMinutes || pl.rejectionQty || pl.remarks) {
        metricsRows.push([
          c.createdAt, c.jobCardNo, 'Plating', c.operatorName || 'System Sync',
          pl.platingType || '', '', pl.micronThickness || '',
          '', pl.durationMinutes || '', pl.rejectionQty || 0, pl.remarks || '',
          pl.qtyReceivedFromHt || '', pl.qtySentToPacking || '', pl.qtyRemaining || ''
        ]);
      }
    }
    if (c.packingDetails) {
      const pk = c.packingDetails;
      if (pk.packedQty || pk.boxCount || pk.packingType || pk.rejectionQty || pk.remarks) {
        metricsRows.push([
          c.createdAt, c.jobCardNo, 'Packing', c.operatorName || 'System Sync',
          '', '', '', pk.boxCount ? String(pk.boxCount) : '', pk.packingType || '',
          pk.rejectionQty || 0, pk.remarks || '',
          pk.qtyReceivedFromPlating || '', pk.qtySentToStore || '', pk.qtyRemaining || ''
        ]);
      }
    }
    if (c.storeDetails) {
      const st = c.storeDetails;
      if (st.verifiedQty || st.locationBin || st.rejectionQty || st.remarks) {
        metricsRows.push([
          c.createdAt, c.jobCardNo, 'Store', c.operatorName || 'System Sync',
          '', '', '', st.locationBin || '', '', st.rejectionQty || 0, st.remarks || '',
          st.qtyReceivedFromPacking || '', st.qtySentToDispatch || '', st.qtyRemaining || ''
        ]);
      }
    }
    if (c.dispatchDetails) {
      const dp = c.dispatchDetails;
      if (dp.invoiceNo || dp.vehicleNo || dp.dispatchQty || dp.remarks) {
        metricsRows.push([
          dp.dispatchDate || c.createdAt, c.jobCardNo, 'Dispatch', c.operatorName || 'System Sync',
          '', dp.vehicleNo || '', '', '', dp.invoiceNo || '', 0, dp.remarks || '',
          dp.dispatchQty || '', '', ''
        ]);
      }
    }
  });
  const wsMetrics = XLSX.utils.aoa_to_sheet([metricsHeaders, ...metricsRows]);
  XLSX.utils.book_append_sheet(wb, wsMetrics, '18. Process Metrics');

  // 19. Operations Audit Trail
  const auditHeaders = ['Timestamp', 'User ID', 'User Name', 'Action', 'Details'];
  const auditRows = auditLogs.map(l => [
    l.timestamp, l.userId, l.userName, l.action, l.details
  ]);
  const wsAudit = XLSX.utils.aoa_to_sheet([auditHeaders, ...auditRows]);
  XLSX.utils.book_append_sheet(wb, wsAudit, '19. Audit Trail');

  // Generate filename & download
  const dateStr = new Date().toISOString().slice(0, 10);
  const timeStr = new Date().toTimeString().slice(0, 5).replace(':', '');
  const filename = `MFR_ERP_Full_Backup_${dateStr}_${timeStr}.xlsx`;

  XLSX.writeFile(wb, filename);
}

/**
 * Export a single report's filtered dataset to Excel (.xlsx).
 */
export function exportSingleReportExcel(reportTitle: string, data: any[]) {
  if (!data || data.length === 0) return;
  const wb = XLSX.utils.book_new();

  let ws: XLSX.WorkSheet;
  if (Array.isArray(data[0])) {
    ws = XLSX.utils.aoa_to_sheet(data);
  } else {
    ws = XLSX.utils.json_to_sheet(data);
  }

  // Safe sheet name <= 31 chars
  const cleanSheetName = reportTitle.slice(0, 31).replace(/[\\/?*:[\]]/g, '');
  XLSX.utils.book_append_sheet(wb, ws, cleanSheetName || 'Report');

  const filename = `${reportTitle.replace(/[^a-zA-Z0-9_-]/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, filename);
}
