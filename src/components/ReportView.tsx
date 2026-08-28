import React, { useState, useEffect } from 'react';
import { 
  Download, 
  Printer, 
  FileSpreadsheet, 
  Layers, 
  Calendar, 
  Search,
  Filter,
  Scale,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Mail,
  Send,
  Sparkles,
  Inbox,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  RotateCcw
} from 'lucide-react';
import { JobCard, MaterialMovement, Department, UserProfile, ProcessTransfer } from '../types';
import { getJobCardProcessMetrics, getJobCardDepartmentPending, getWireScrapQty } from '../lib/metrics';
import PendingBreakdownModal from './PendingBreakdownModal';
import RawMaterialReportView from './RawMaterialReportView';
import { INVENTORY_RAW_MATERIALS } from './RawMaterialRequestModal';

interface ReportViewProps {
  jobCards: JobCard[];
  movements: MaterialMovement[];
  processTransfers?: ProcessTransfer[];
  onCreateMovement?: (mov: any) => Promise<void>;
  currentUser?: UserProfile | null;
}

type ReportType = 
  | 'production'
  | 'heattreat'
  | 'plating'
  | 'packing'
  | 'incoming_store'
  | 'store'
  | 'process_transfers'
  | 'raw_material_store'
  | 'raw_material_summary'
  | 'stock_summary'
  | 'dispatch'
  | 'pending'
  | 'completed'
  | 'rejected'
  | 'movements'
  | 'balance'
  | 'rejection_by_dept'
  | 'email_triggers';

export default function ReportView({ jobCards, movements, processTransfers = [], onCreateMovement, currentUser }: ReportViewProps) {
  const [activeReport, setActiveReport] = useState<ReportType>('production');
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [pendingBreakdownJobCard, setPendingBreakdownJobCard] = useState<JobCard | null>(null);

  // Dispatch Issue Request Modal States
  const [isOpenRequestModal, setIsOpenRequestModal] = useState(false);
  const [selectedStoreRow, setSelectedStoreRow] = useState<any | null>(null);
  const [requestedQty, setRequestedQty] = useState<number>(0);
  const [remarksVal, setRemarksVal] = useState<string>('');

  // Automated Email Trigger States
  const [outboxHistory, setOutboxHistory] = useState<any[]>([]);
  const [isTriggering, setIsTriggering] = useState(false);
  const [recipientInput, setRecipientInput] = useState('pawan.kummar16@gmail.com');
  const [smtpConfigured, setSmtpConfigured] = useState(false);
  const [selectedEmailRecord, setSelectedEmailRecord] = useState<any | null>(null);
  const [emailSuccessMessage, setEmailSuccessMessage] = useState('');
  const [emailErrorMessage, setEmailErrorMessage] = useState('');
  const [previewTab, setPreviewTab] = useState<'insights' | 'email_html' | 'html_source'>('insights');

  // Fetch email logs from outbox backend API
  const fetchOutboxHistory = async () => {
    try {
      const response = await fetch('/api/sent-emails');
      if (response.ok) {
        const data = await response.json();
        setOutboxHistory(data);
        if (data.length > 0 && !selectedEmailRecord) {
          setSelectedEmailRecord(data[0]);
        }
      }
    } catch (e) {
      console.error("Failed to fetch email outbox history:", e);
    }
  };

  useEffect(() => {
    fetchOutboxHistory();
  }, [activeReport]);

  const handleTriggerEmail = async () => {
    setIsTriggering(true);
    setEmailErrorMessage('');
    setEmailSuccessMessage('');
    try {
      const response = await fetch('/api/trigger-daily-summary', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          jobCards,
          movements,
          recipient: recipientInput
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.details || "Failed to trigger daily email");
      }

      const data = await response.json();
      setEmailSuccessMessage(`Daily automated email report successfully generated! ${data.smtpConfigured ? 'Transmitted to admin team inbox.' : 'Logged to local Outbox system for preview.'}`);
      setSmtpConfigured(data.smtpConfigured);
      
      // Refresh outbox
      await fetchOutboxHistory();
      
      // Select the newly generated log
      if (data.record) {
        setSelectedEmailRecord(data.record);
      }
    } catch (e: any) {
      console.error(e);
      setEmailErrorMessage(e.message || "An unexpected error occurred during report compilation.");
    } finally {
      setIsTriggering(false);
    }
  };

  // Define reports descriptors
  const reportOptions: { id: ReportType; label: string; desc: string }[] = [
    { id: 'production', label: 'Production Milling Report', desc: "Machining outputs and operator signoffs" },
    { id: 'heattreat', label: 'Heat Treatment Report', desc: "Hardness levels and temperature recipes" },
    { id: 'plating', label: 'Surfacing & Plating Report', desc: "Thickness measurements and coating quality" },
    { id: 'packing', label: 'Packaging Weights Report', desc: "Box specifications and total count packed" },
    { id: 'incoming_store', label: 'Incoming Store Report', desc: "Goods received into purchase and incoming store buffer before release to production floors" },
    { id: 'store', label: 'Store / Warehousing Report', desc: "Verified inventory placement and bin location storage" },
    { id: 'process_transfers', label: 'Store Process Transfers (Repacking & Replating)', desc: "Full traceability ledger of Store material sent to Repacking and Replating processes, including return quantities, bins, and rejections" },
    { id: 'raw_material_store', label: 'Raw Material Store Ledger', desc: "Production raw material requests, issued weights, and rejected requests log" },
    { id: 'raw_material_summary', label: 'Raw Material Stock & Demand', desc: "Comprehensive audit of raw material stock levels, consumption trends, and pending requests (PDF friendly)" },
    { id: 'stock_summary', label: 'Stock Summary (Item-wise)', desc: "Aggregate current in-stock weights, pieces count and box count grouped by item name" },
    { id: 'dispatch', label: 'Dispatch Shipment Report', desc: "Invoiced amounts and vehicle tracking records" },
    { id: 'pending', label: 'Active Outstanding Queue', desc: "Incomplete orders currently on work floors" },
    { id: 'completed', label: 'Archived Completed Orders', desc: "Perfect run items fully shipped out" },
    { id: 'rejected', label: 'Rejected Orders Report', desc: "Orders flagged with rejection status" },
    { id: 'movements', label: 'Material Movement Log', desc: "Step-by-step chain of custody transfer ledger" },
    { id: 'balance', label: 'Balance Quantity Audit', desc: "Formula calculations: Target vs Processed (Scrap analysis)" },
    { id: 'rejection_by_dept', label: 'Material Rejection Analysis', desc: "Department-level breakdown of processed vs rejected material to identify quality bottlenecks" },
    { id: 'email_triggers', label: 'Automated Email Controls', desc: "Configure admin alerts, send automated summaries, and inspect daily outbox logs" }
  ];

  const getRejectionStatsByDept = (filteredCards: JobCard[]) => {
    const stats: Record<string, { processed: number; rejected: number }> = {
      'Production': { processed: 0, rejected: 0 },
      'Heat Treatment': { processed: 0, rejected: 0 },
      'Plating': { processed: 0, rejected: 0 },
      'Packing': { processed: 0, rejected: 0 },
      'Store': { processed: 0, rejected: 0 }
    };

    filteredCards.forEach(jc => {
      const m = getJobCardProcessMetrics(jc, movements);
      
      const isProdRejected = jc.status === 'Rejected' && jc.currentDepartment === 'Production';
      stats['Production'].processed += jc.orderQty;
      stats['Production'].rejected += isProdRejected ? jc.orderQty : 0;

      if (jc.heatTreatmentRequired) {
        stats['Heat Treatment'].processed += m.qtyReceivedFromProd;
        stats['Heat Treatment'].rejected += m.htRejections;
      }

      stats['Plating'].processed += m.qtyReceivedAtPlating;
      stats['Plating'].rejected += m.platingRejections;

      stats['Packing'].processed += m.qtyReceivedAtPacking;
      stats['Packing'].rejected += m.packingRejections;

      stats['Store'].processed += m.qtyReceivedAtStore;
      stats['Store'].rejected += jc.storeDetails?.rejectionQty || 0;
    });

    return Object.entries(stats).map(([dept, data]) => {
      const pct = data.processed > 0 ? (data.rejected / data.processed) * 100 : 0;
      return {
        department: dept,
        totalProcessedKg: Math.round(data.processed * 10) / 10,
        totalRejectedKg: Math.round(data.rejected * 10) / 10,
        rejectionPercentage: Math.round(pct * 100) / 100
      };
    });
  };

  // Filters calculation
  const getFilteredData = () => {
    console.log("ReportView: total jobCards loaded =", jobCards.length);
    if (jobCards.length > 0) {
        console.log("First job card:", jobCards[0]);
        const found = jobCards.find(jc => jc.jobCardNo.toLowerCase() === 'jc-1001');
        console.log("jc-1001 found in jobCards?", !!found);
    }
    let baseData: any[] = [];

    // 1. Filter dataset according to the reports type
    switch (activeReport) {
      case 'production':
        baseData = jobCards.map(c => {
          const m = getJobCardProcessMetrics(c, movements);
          return {
            jobCardNo: c.jobCardNo,
            partyName: c.partyName,
            itemName: c.itemName,
            targetQtyKg: c.orderQty,
            receivedFromProdKg: m.qtyReceivedFromProd,
            wireScrapKg: getWireScrapQty(c, movements),
            routedToPlatingKg: m.qtyRoutedToPlating,
            remainingAtProdKg: m.qtyRemainingAtProd,
            date: c.createdAt
          };
        });
        break;
      case 'heattreat':
        baseData = jobCards
          .filter(c => c.heatTreatmentRequired)
          .map(c => {
            const m = getJobCardProcessMetrics(c, movements);
            return {
              jobCardNo: c.jobCardNo,
              partyName: c.partyName,
              itemName: c.itemName,
              hardness: c.heatTreatmentDetails?.hardnessRequired || 'Awaiting Action',
              temperature: c.heatTreatmentDetails?.temperature || 'N/A',
              cycleTime: c.heatTreatmentDetails?.cycleTime || 'N/A',
              rejectionsKg: m.htRejections,
              date: c.createdAt
            };
          });
        break;
      case 'plating':
        baseData = jobCards.map(c => {
          const m = getJobCardProcessMetrics(c, movements);
          return {
            jobCardNo: c.jobCardNo,
            partyName: c.partyName,
            itemName: c.itemName,
            platingType: c.platingDetails?.platingType || 'Pending',
            thickness: c.platingDetails?.micronThickness ? `${c.platingDetails.micronThickness}μm` : 'Pending',
            receivedAtPlatingKg: m.qtyReceivedAtPlating,
            routedToPackingKg: m.qtyRoutedToPacking,
            remainingAtPlatingKg: m.qtyRemainingAtPlating,
            rejectionsKg: m.platingRejections,
            date: c.createdAt
          };
        });
        break;
      case 'packing':
        baseData = jobCards.map(c => {
          const m = getJobCardProcessMetrics(c, movements);
          return {
            jobCardNo: c.jobCardNo,
            partyName: c.partyName,
            itemName: c.itemName,
            boxCount: c.packingDetails?.boxCount || 0,
            packType: c.packingDetails?.packingType || 'Pending',
            receivedAtPackingKg: m.qtyReceivedAtPacking,
            routedToStoreKg: m.qtyRoutedToStore,
            remainingAtPackingKg: m.qtyRemainingAtPacking,
            rejectionsKg: m.packingRejections,
            date: c.createdAt
          };
        });
        break;
      case 'incoming_store': {
        const incomingCards = jobCards.filter(c => 
          c.currentDepartment === 'Purchase' || 
          c.processType === 'Purchase' || 
          c.status === 'Stored' || 
          !!c.purchaseDetails ||
          movements.some(m => m.jobCardNo.toLowerCase() === c.jobCardNo.toLowerCase() && (m.toDepartment === 'Purchase' || (m.toDepartment === 'Store' && m.fromDepartment === 'Purchase')))
        );

        baseData = incomingCards.map(c => {
          const storeMovs = movements.filter(mov => 
            mov.jobCardNo.toLowerCase() === c.jobCardNo.toLowerCase() && 
            (mov.toDepartment === 'Purchase' || mov.fromDepartment === 'Purchase' || mov.toDepartment === 'Store')
          );
          const latestMov = storeMovs[storeMovs.length - 1];

          return {
            jobCardNo: c.jobCardNo,
            orderNo: c.orderNo || c.purchaseDetails?.billNo || 'N/A',
            supplierOrParty: c.partyName || c.purchaseDetails?.supplierName || 'N/A',
            itemName: c.itemName,
            itemCode: c.itemCode || 'N/A',
            materialType: c.materialType || c.processType || 'Purchase Inward',
            receivedQty: c.currentQty || c.orderQty || 0,
            unit: c.unit || 'KG',
            billNo: c.purchaseDetails?.billNo || 'N/A',
            locationBin: latestMov?.allottedLocation || c.storeDetails?.locationBin || 'Purchase Buffer',
            currentDepartment: c.currentDepartment,
            status: c.status || 'Stored',
            date: c.createdAt
          };
        });
        break;
      }
      case 'store':
        baseData = jobCards.map(c => {
          const m = getJobCardProcessMetrics(c, movements);
          
          const storeMovements = movements.filter(mov => 
            mov.jobCardNo.toLowerCase() === c.jobCardNo.toLowerCase() && 
            mov.toDepartment === 'Store' && 
            mov.accepted
          );
          const latestStoreMov = storeMovements.reduce<MaterialMovement | null>((latest, current) => {
            if (!latest) return current;
            return new Date(current.transferDate) > new Date(latest.transferDate) ? current : latest;
          }, null);

          return {
            jobCardNo: c.jobCardNo,
            partyName: c.partyName,
            itemName: c.itemName,
            allottedLocation: latestStoreMov?.allottedLocation || c.storeDetails?.locationBin || 'Pending placement',
            rackNo: latestStoreMov?.rackNo || 'N/A',
            receivedAtStoreKg: m.qtyReceivedAtStore,
            pcsReceivedFromPacking: c.packingDetails?.totalPcs !== undefined ? `${c.packingDetails.totalPcs.toLocaleString()} pcs` : 'N/A',
            qtyDispatchedKg: m.qtyDispatched,
            qtyInStockKg: m.qtyRemainingInStock,
            date: c.createdAt
          };
        });
        break;
      case 'process_transfers':
        baseData = (processTransfers || []).map(t => ({
          transferNo: t.transferNo,
          jobCardNo: t.jobCardNo,
          poNumber: t.poNumber || '-',
          customer: t.customer,
          itemName: t.itemName,
          itemCode: t.itemCode || '-',
          material: t.material || '-',
          toProcess: t.toProcess,
          quantity: `${t.quantity.toLocaleString()} ${t.unit}`,
          status: t.status,
          fromLocation: t.fromLocation,
          binOrRack: t.currentLocation || '-',
          transferDate: `${t.transferDate} ${t.transferTime}`,
          sentBy: t.createdBy,
          receivedBy: t.receivedBy || '-',
          completedBy: t.completedBy || '-',
          completedQty: t.completedQty !== undefined ? `${t.completedQty.toLocaleString()} ${t.unit}` : '-',
          rejectionQty: t.rejectionQty ? `${t.rejectionQty.toLocaleString()} ${t.unit}` : '-',
          rejectionReason: t.rejectionReason || '-',
          returnBin: t.returnLocationBin || '-',
          returnRack: t.returnRackNo || '-',
          remarks: t.remarks || '-',
          date: t.createdAt
        }));
        break;
      case 'stock_summary': {
        let cardList = [...jobCards];
        if (searchTerm) {
          const match = searchTerm.toLowerCase();
          cardList = cardList.filter(c =>
            c.jobCardNo.toLowerCase().includes(match) ||
            c.partyName.toLowerCase().includes(match) ||
            c.itemName.toLowerCase().includes(match) ||
            (c.itemCode && c.itemCode.toLowerCase().includes(match))
          );
        }
        if (startDate) {
          const start = new Date(startDate);
          cardList = cardList.filter(c => new Date(c.createdAt) >= start);
        }
        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          cardList = cardList.filter(c => new Date(c.createdAt) <= end);
        }

        const stockMap: Record<string, {
          itemName: string;
          itemCode: string;
          totalReceivedKg: number;
          totalDispatchedKg: number;
          totalInStockKg: number;
          totalBoxesInStock: number;
          totalPiecesInStock: number;
          locationBins: string;
          date: string;
        }> = {};

        cardList.forEach(c => {
          const m = getJobCardProcessMetrics(c, movements);
          const key = c.itemName || 'UNKNOWN';
          const itemCode = c.itemCode || 'N/A';
          const bin = c.storeDetails?.locationBin;

          const totalPcs = c.packingDetails?.totalPcs || 0;
          const boxCount = c.packingDetails?.boxCount || 0;
          const receivedStore = m.qtyReceivedAtStore || 0;
          const remainingStock = m.qtyRemainingInStock || 0;

          let fraction = 0;
          if (receivedStore > 0) {
            fraction = remainingStock / receivedStore;
          } else if (remainingStock > 0) {
            fraction = 1;
          }

          const pcsInStock = fraction * totalPcs;
          const boxesInStock = fraction * boxCount;

          if (!stockMap[key]) {
            stockMap[key] = {
              itemName: key,
              itemCode: itemCode,
              totalReceivedKg: 0,
              totalDispatchedKg: 0,
              totalInStockKg: 0,
              totalBoxesInStock: 0,
              totalPiecesInStock: 0,
              locationBins: '',
              date: c.createdAt
            };
          }

          stockMap[key].totalReceivedKg += receivedStore;
          stockMap[key].totalDispatchedKg += m.qtyDispatched;
          stockMap[key].totalInStockKg += m.qtyRemainingInStock;
          stockMap[key].totalBoxesInStock += boxesInStock;
          stockMap[key].totalPiecesInStock += pcsInStock;

          const storeMovements = movements.filter(mov => 
            mov.jobCardNo.toLowerCase() === c.jobCardNo.toLowerCase() && 
            mov.toDepartment === 'Store' && 
            mov.accepted
          );
          
          const binsList = storeMovements.map(mov => {
            if (mov.allottedLocation) {
              return mov.allottedLocation + (mov.rackNo ? ` [Rack: ${mov.rackNo}]` : '');
            }
            return '';
          }).filter(b => b !== '');

          if (bin && bin !== 'Pending placement' && !binsList.includes(bin)) {
            binsList.push(bin);
          }

          binsList.forEach(b => {
            const currentBins = stockMap[key].locationBins ? stockMap[key].locationBins.split(', ') : [];
            if (!currentBins.includes(b)) {
              currentBins.push(b);
              stockMap[key].locationBins = currentBins.join(', ');
            }
          });

          if (new Date(c.createdAt) > new Date(stockMap[key].date)) {
            stockMap[key].date = c.createdAt;
          }
        });

        baseData = Object.values(stockMap).map(item => ({
          itemName: item.itemName,
          itemCode: item.itemCode,
          totalReceivedKg: Math.round(item.totalReceivedKg * 10) / 10,
          totalDispatchedKg: Math.round(item.totalDispatchedKg * 10) / 10,
          totalInStockKg: Math.round(item.totalInStockKg * 10) / 10,
          totalBoxesInStock: Math.round(item.totalBoxesInStock * 10) / 10,
          totalPiecesInStock: Math.round(item.totalPiecesInStock),
          locationBins: item.locationBins || 'Pending placement',
          date: item.date
        }));
        break;
      }
      case 'raw_material_store': {
        const rawStoreMovs = movements.filter(m => m.fromDepartment === 'Raw Material Store' && m.isIssueRequest);
        baseData = rawStoreMovs.map(m => {
          const matchedCard = jobCards.find(jc => jc.jobCardNo.toLowerCase() === m.jobCardNo.toLowerCase());
          const isRejected = m.issueStatus === 'Rejected' || m.remarks?.toLowerCase().includes('reject');
          return {
            'Job Card No': m.jobCardNo,
            'Party Name': matchedCard?.partyName || 'N/A',
            'Item Name': matchedCard?.itemName || 'N/A',
            'Raw Mat Spec': m.processDetails?.rawMaterialName || 'Raw Material',
            'Raw Mat Code': m.processDetails?.rawMaterialCode || 'N/A',
            'Requested Qty (KG)': m.requestedQty || m.quantity,
            'Issued Qty (KG)': m.issueStatus === 'Issued' ? m.quantity : 0,
            'Status': m.issueStatus || (isRejected ? 'Rejected' : 'Pending'),
            'Bin Location': m.allottedLocation || 'N/A',
            'Remarks': m.remarks || '',
            'Requested By': m.processDetails?.requestedBy || m.transferBy || 'Production',
            'Date': m.transferDate ? m.transferDate.split('T')[0] : 'N/A'
          };
        });
        break;
      }
      case 'raw_material_summary': {
        baseData = INVENTORY_RAW_MATERIALS.map(item => {
          const totalIssued = movements
            .filter(m => 
              m.fromDepartment === 'Raw Material Store' && 
              m.isIssueRequest && 
              m.issueStatus === 'Issued' && 
              (m.processDetails?.rawMaterialCode === item.code || m.jobCardNo === 'STOCK-IN-' + item.code || m.jobCardNo === item.code)
            )
            .reduce((sum, m) => sum + (m.quantity || 0), 0);
          const totalPurchased = movements
            .filter(m => 
              m.toDepartment === 'Raw Material Store' && 
              m.fromDepartment === 'Purchase' && 
              m.accepted &&
              (m.processDetails?.rawMaterialCode === item.code || m.jobCardNo === 'STOCK-IN-' + item.code || m.jobCardNo === item.code)
            )
            .reduce((sum, m) => sum + (m.quantity || 0), 0);
          const totalRejected = movements
            .filter(m => 
              m.fromDepartment === 'Raw Material Store' && 
              (m.issueStatus === 'Rejected' || m.processDetails?.isWireRejection) && 
              (m.processDetails?.rawMaterialCode === item.code || m.jobCardNo === 'STOCK-IN-' + item.code || m.jobCardNo === item.code || m.jobCardNo?.startsWith('RM-REJECT-'))
            )
            .reduce((sum, m) => sum + (m.processDetails?.rejectedQty || m.quantity || m.requestedQty || 0), 0);
          const currentStock = Math.max(0, item.availableStock + totalPurchased - totalIssued - totalRejected);
          return {
            'Material Code': item.code,
            'Material Name': item.name,
            'Category': item.category,
            'Bin Location': item.location,
            'Starting Stock (KG)': item.availableStock,
            'Inwarded Stock (KG)': totalPurchased,
            'Total Issued (KG)': totalIssued,
            'Current Stock (KG)': currentStock,
            'Reserve Status (%)': Math.round(item.availableStock > 0 ? (currentStock / item.availableStock) * 100 : 0)
          };
        });
        break;
      }
      case 'dispatch':
        baseData = jobCards
          .filter(c => c.completed || c.dispatchDetails)
          .map(c => ({
            jobCardNo: c.jobCardNo,
            partyName: c.partyName,
            item: c.itemName,
            orderPlacedBy: c.createdBy || 'Unknown',
            invoiceNo: c.dispatchDetails?.invoiceNo || 'INV-Pending',
            vehicleNo: c.dispatchDetails?.vehicleNo || 'Self Pick',
            dispatchQty: c.dispatchDetails?.dispatchQty || c.currentQty,
            dispatchDate: c.dispatchDetails?.dispatchDate || c.createdAt
          }));
        break;
      case 'pending':
        baseData = jobCards
          .filter(c => !c.completed)
          .map(c => {
            const deptPending = getJobCardDepartmentPending(c, movements);
            return {
              jobCardNo: c.jobCardNo,
              orderNo: c.orderNo,
              partyName: c.partyName,
              itemName: c.itemName,
              orderPlacedBy: c.createdBy || 'Unknown',
              currentDepartment: c.currentDepartment,
              status: c.status,
              targetQtyKg: c.orderQty,
              pendingProdToPackKg: deptPending.totalPending,
              createdAt: c.createdAt
            };
          });
        break;
      case 'completed':
        baseData = jobCards
          .filter(c => c.completed)
          .map(c => ({
            jobCardNo: c.jobCardNo,
            orderNo: c.orderNo,
            partyName: c.partyName,
            itemName: c.itemName,
            orderPlacedBy: c.createdBy || 'Unknown',
            finalDepartment: c.currentDepartment,
            status: c.status,
            orderQty: c.orderQty,
            finalQty: c.currentQty,
            createdAt: c.createdAt
          }));
        break;
      case 'rejected':
        baseData = jobCards
          .filter(c => c.status === 'Rejected')
          .map(c => ({
            jobCardNo: c.jobCardNo,
            orderNo: c.orderNo,
            partyName: c.partyName,
            itemName: c.itemName,
            currentDepartment: c.currentDepartment,
            status: c.status,
            createdAt: c.createdAt
          }));
        break;
      case 'movements':
        baseData = movements.map(m => {
          const matchedCard = jobCards.find(jc => jc.jobCardNo.toLowerCase() === m.jobCardNo.toLowerCase());
          return {
            movementId: m.movementId,
            jobCardNo: m.jobCardNo,
            orderPlacedBy: matchedCard?.createdBy || 'System',
            fromDepartment: m.fromDepartment,
            toDepartment: m.toDepartment,
            quantity: m.quantity,
            transferBy: m.transferBy,
            transferDate: m.transferDate,
            allottedLocation: m.allottedLocation || 'N/A',
            rackNo: m.rackNo || 'N/A',
            status: m.accepted ? 'Accepted' : 'Pending'
          };
        });
        break;
      case 'balance':
        // Calculate balance weight audit
        baseData = jobCards.map(c => {
          const processedWeight = c.completed ? c.currentQty : 0;
          return {
            jobCardNo: c.jobCardNo,
            partyName: c.partyName,
            itemCode: c.itemCode,
            orderPlacedBy: c.createdBy || 'Unknown',
            orderWeight: c.orderQty,
            processedWeight: processedWeight,
            scrapWeight: Math.max(0, c.orderQty - c.currentQty),
            balanceWeight: c.balanceQty,
            currentDept: c.currentDepartment,
            status: c.status
          };
        });
        break;
      case 'rejection_by_dept': {
        // Filter jobCards first so aggregation respects date filters and search filters
        let cardList = [...jobCards];
        if (searchTerm) {
          const match = searchTerm.toLowerCase();
          cardList = cardList.filter(c =>
            c.jobCardNo.toLowerCase().includes(match) ||
            c.partyName.toLowerCase().includes(match) ||
            c.itemName.toLowerCase().includes(match) ||
            (c.itemCode && c.itemCode.toLowerCase().includes(match))
          );
        }
        if (startDate) {
          const start = new Date(startDate);
          cardList = cardList.filter(c => new Date(c.createdAt) >= start);
        }
        if (endDate) {
          const end = new Date(endDate);
          end.setHours(23, 59, 59, 999);
          cardList = cardList.filter(c => new Date(c.createdAt) <= end);
        }
        
        baseData = cardList.map(c => {
          const m = getJobCardProcessMetrics(c, movements);
          const isProdRejected = c.status === 'Rejected' && c.currentDepartment === 'Production';
          const prodRejection = isProdRejected ? c.orderQty : 0;
          const htRejection = m.htRejections;
          const platingRejection = m.platingRejections;
          const packingRejection = m.packingRejections;
          const storeRejection = c.storeDetails?.rejectionQty || 0;
          const totalRejected = prodRejection + htRejection + platingRejection + packingRejection + storeRejection;
          const rejectionPct = c.orderQty > 0 ? (totalRejected / c.orderQty) * 100 : 0;

          return {
            jobCardNo: c.jobCardNo,
            partyName: c.partyName,
            itemName: c.itemName,
            orderQtyKg: c.orderQty,
            prodRejKg: prodRejection,
            htRejKg: htRejection,
            platingRejKg: platingRejection,
            packingRejKg: packingRejection,
            storeRejKg: storeRejection,
            totalRejKg: Math.round(totalRejected * 10) / 10,
            rejectionRate: `${Math.round(rejectionPct * 100) / 100}%`
          };
        });
        break;
      }
    }

    if (activeReport === 'rejection_by_dept' || activeReport === 'stock_summary') {
      return baseData;
    }

    // 2. Filter by search filter
    if (searchTerm) {
      const match = searchTerm.toLowerCase();
      baseData = baseData.filter(d => {
        return (
          (d.jobCardNo && d.jobCardNo.toLowerCase().includes(match)) ||
          (d.partyName && d.partyName.toLowerCase().includes(match)) ||
          (d.itemName && d.itemName.toLowerCase().includes(match)) ||
          (d.operator && d.operator.toLowerCase().includes(match)) ||
          (d.itemCode && d.itemCode.toLowerCase().includes(match))
        );
      });
    }

    // 3. Filter by date bounding limits
    if (startDate) {
      const start = new Date(startDate);
      baseData = baseData.filter(d => {
        const itemDate = d.date || d.transferDate || d.createdAt || d.dispatchDate;
        if (!itemDate) return true;
        return new Date(itemDate) >= start;
      });
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      baseData = baseData.filter(d => {
        const itemDate = d.date || d.transferDate || d.createdAt || d.dispatchDate;
        if (!itemDate) return true;
        return new Date(itemDate) <= end;
      });
    }

    return baseData;
  };

  const filteredData = getFilteredData();

  // Filter job cards for the department-level statistics
  const getFilteredCardsForDept = () => {
    let cardList = [...jobCards];
    if (searchTerm) {
      const match = searchTerm.toLowerCase();
      cardList = cardList.filter(c =>
        c.jobCardNo.toLowerCase().includes(match) ||
        c.partyName.toLowerCase().includes(match) ||
        c.itemName.toLowerCase().includes(match) ||
        (c.itemCode && c.itemCode.toLowerCase().includes(match))
      );
    }
    if (startDate) {
      const start = new Date(startDate);
      cardList = cardList.filter(c => new Date(c.createdAt) >= start);
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      cardList = cardList.filter(c => new Date(c.createdAt) <= end);
    }
    return cardList;
  };

  const filteredCardsForDept = getFilteredCardsForDept();
  const deptRejectionStats = getRejectionStatsByDept(filteredCardsForDept);

  // Export active report to native Excel (.xlsx) file
  const handleExportExcel = async () => {
    if (filteredData.length === 0) return;
    const currentReportObj = reportOptions.find(r => r.id === activeReport);
    const title = currentReportObj ? currentReportObj.label : activeReport;
    const { exportSingleReportExcel } = await import('../lib/excelExport');
    exportSingleReportExcel(title, filteredData);
  };

  // Export full multi-sheet workbook where EVERY report has its own worksheet
  const handleExportFullExcelBackup = async () => {
    const { exportComprehensiveExcelBackup } = await import('../lib/excelExport');
    exportComprehensiveExcelBackup(jobCards, movements);
  };

  return (
    <div className="space-y-6">
      
      {/* Search and Period filters bar */}
      <div className="bg-white dark:bg-slate-900 shadow-sm p-4 rounded-2xl border border-slate-200 dark:border-slate-800 flex flex-col md:flex-row flex-wrap gap-4 items-center justify-between">
        <div className="flex flex-wrap gap-3 items-center w-full md:w-auto flex-1">
          {/* Label selector */}
          <div className="relative">
            <select
              value={activeReport}
              onChange={(e) => {
                setActiveReport(e.target.value as ReportType);
                setSearchTerm('');
              }}
              className="bg-slate-50 dark:bg-slate-800 border-r-8 border-transparent text-xs text-slate-700 dark:text-slate-100 font-bold px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-750 focus:outline-none focus:border-[#3B82F6] cursor-pointer"
            >
              {reportOptions.map(o => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </div>

          {activeReport !== 'email_triggers' && (
            <div className="relative flex-1 md:flex-initial min-w-[200px]">
              <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Filter by Code, Name, Job..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="bg-slate-50 dark:bg-slate-850 pl-9 pr-3 py-2 text-xs text-slate-700 dark:text-slate-200 rounded-lg border border-slate-200 dark:border-slate-750 w-full focus:outline-none focus:border-[#3B82F6] font-sans"
              />
            </div>
          )}
        </div>

        {/* Date picking section */}
        {activeReport !== 'email_triggers' && (
          <div className="flex flex-wrap gap-2.5 items-center w-full md:w-auto text-xs text-slate-500">
            <Calendar className="h-4 w-4 text-slate-400" />
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-slate-50 dark:bg-slate-850 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-750 focus:outline-none focus:border-[#3B82F6] font-mono text-slate-700 dark:text-slate-200"
            />
            <span className="font-mono">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-slate-50 dark:bg-slate-850 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-750 focus:outline-none focus:border-[#3B82F6] font-mono text-slate-700 dark:text-slate-200"
            />

            <div className="flex flex-wrap items-center gap-1.5 ml-auto md:ml-4">
              <button
                onClick={handleExportExcel}
                disabled={filteredData.length === 0}
                className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-slate-800 font-bold px-3 py-2 rounded-lg transition-all text-xs cursor-pointer shadow-xs"
                title="Download current report to Excel (.xlsx)"
              >
                <FileSpreadsheet className="h-4 w-4" />
                <span>Export Current Sheet (.xlsx)</span>
              </button>
              <button
                onClick={handleExportFullExcelBackup}
                className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-3 py-2 rounded-lg transition-all text-xs cursor-pointer shadow-xs border border-indigo-500"
                title="Download a complete Excel backup workbook with a separate sheet for EVERY report (19 sheets)"
              >
                <Download className="h-4 w-4" />
                <span>Backup All Reports (.xlsx)</span>
              </button>
              <button
                onClick={() => window.print()}
                disabled={filteredData.length === 0}
                className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-slate-800 font-bold px-3 py-2 rounded-lg transition-all text-xs cursor-pointer"
              >
                <Printer className="h-4 w-4" />
                <span>Print / PDF</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Selected Report Title Description */}
      <div className="px-1.5">
        <h4 className="font-sans font-bold text-base text-slate-800 dark:text-slate-100">
          {reportOptions.find(r => r.id === activeReport)?.label}
        </h4>
        <p className="text-xs text-slate-400 italic">
          {reportOptions.find(r => r.id === activeReport)?.desc}
        </p>
      </div>

      {activeReport === 'rejection_by_dept' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in print:grid-cols-2">
          
          {/* Dedicated Search & Filter Section for Rejection Analysis */}
          <div className="lg:col-span-3 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="w-full md:w-auto">
              <h5 className="text-xs font-extrabold text-[#4F46E5] dark:text-[#818CF8] uppercase tracking-wider flex items-center gap-1.5">
                <Search className="h-4 w-4 text-indigo-500" />
                <span>Filter Rejection Metrics</span>
              </h5>
              <p className="text-[11px] text-slate-400 mt-1">
                Filter department metrics and records list instantly by Job Card number or Item Name
              </p>
            </div>
            
            <div className="relative w-full md:w-[360px]">
              <Search className="absolute left-3.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search by Job Card No. or Item Name..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="bg-slate-50 dark:bg-slate-850 pl-10 pr-10 py-1.5 text-xs text-slate-700 dark:text-slate-200 rounded-xl border border-slate-200 dark:border-slate-750 w-full focus:outline-none focus:ring-2 focus:ring-[#4F46E5]/20 focus:border-[#4F46E5] font-sans"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-3 top-2 p-0.5 rounded-full hover:bg-slate-200 dark:hover:bg-slate-750 text-slate-400 hover:text-slate-600 transition"
                  title="Clear search"
                >
                  <span className="text-[10px] font-bold">✕</span>
                </button>
              )}
            </div>
          </div>
          
          {/* Bottleneck Summary & High-level insights Card */}
          <div className="lg:col-span-3 bg-slate-50 dark:bg-slate-950 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="p-3 bg-indigo-50 dark:bg-indigo-950/40 rounded-xl border border-indigo-100 dark:border-indigo-900/40 shrink-0 text-2xl">
                ⚠️
              </div>
              <div>
                <h5 className="text-sm font-bold text-slate-800 dark:text-white uppercase tracking-wider">
                  Quality & Rejection Bottleneck Analysis
                </h5>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                  Real-time department-level material yield tracking. High rejection percentages indicate process anomalies, tooling wear, or temperature calibration errors.
                </p>
              </div>
            </div>
            
            {/* Top Bottleneck Badge */}
            {(() => {
              const maxRej = [...deptRejectionStats].sort((a, b) => b.rejectionPercentage - a.rejectionPercentage)[0];
              if (maxRej && maxRej.rejectionPercentage > 0) {
                return (
                  <div className="bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/30 p-3 rounded-xl flex items-center gap-2.5 shrink-0 w-full md:w-auto">
                    <AlertTriangle className="h-5 w-5 text-rose-500 animate-pulse" />
                    <div className="text-left">
                      <p className="text-[10px] text-rose-500 font-extrabold uppercase tracking-wider">Current Bottleneck</p>
                      <p className="text-xs font-mono font-bold text-slate-800 dark:text-slate-200">
                        {maxRej.department}: <span className="text-rose-600 dark:text-rose-400">{maxRej.rejectionPercentage}%</span>
                      </p>
                    </div>
                  </div>
                );
              } else {
                return (
                  <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30 p-3 rounded-xl flex items-center gap-2.5 shrink-0 w-full md:w-auto">
                    <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                    <div className="text-left">
                      <p className="text-[10px] text-emerald-500 font-extrabold uppercase tracking-wider">Flawless Operation</p>
                      <p className="text-xs font-mono font-bold text-slate-800 dark:text-slate-200">No rejections reported</p>
                    </div>
                  </div>
                );
              }
            })()}
          </div>

          {/* Department Cards */}
          {deptRejectionStats.map((row: any) => {
            const pct = row.rejectionPercentage;
            let statusColor = "bg-emerald-500";
            let textColor = "text-emerald-700 dark:text-emerald-400";
            let borderColor = "border-emerald-100 dark:border-emerald-850";
            let bgColor = "bg-emerald-50/30 dark:bg-emerald-950/10";
            let severity = "Optimal";

            if (pct > 5) {
              statusColor = "bg-rose-500";
              textColor = "text-rose-700 dark:text-rose-400";
              borderColor = "border-rose-150 dark:border-rose-850";
              bgColor = "bg-rose-50/20 dark:bg-rose-950/5";
              severity = "Critical Bottleneck";
            } else if (pct > 2) {
              statusColor = "bg-amber-500";
              textColor = "text-amber-700 dark:text-amber-400";
              borderColor = "border-amber-150 dark:border-amber-850";
              bgColor = "bg-amber-50/20 dark:bg-amber-950/5";
              severity = "Moderate Attention";
            }

            return (
              <div 
                key={row.department}
                className={`bg-white dark:bg-slate-900 border ${borderColor} rounded-2xl p-5 shadow-sm flex flex-col justify-between space-y-4`}
              >
                {/* Header info */}
                <div className="flex justify-between items-start">
                  <div>
                    <h5 className="text-[10px] font-extrabold text-slate-400 uppercase tracking-widest">
                      Department
                    </h5>
                    <h3 className="text-sm font-extrabold text-slate-800 dark:text-white mt-0.5">
                      {row.department}
                    </h3>
                  </div>
                  <span className={`text-[9px] font-extrabold uppercase px-2.5 py-1 rounded-full border ${borderColor} ${bgColor} ${textColor}`}>
                    {severity}
                  </span>
                </div>

                {/* Progress bar */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[11px] font-mono">
                    <span className="text-slate-400">Rejection Rate</span>
                    <strong className="text-slate-800 dark:text-slate-200">{pct}%</strong>
                  </div>
                  <div className="h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div 
                      className={`h-full ${statusColor} rounded-full transition-all duration-500`}
                      style={{ width: `${Math.min(100, pct || 0)}%` }}
                    />
                  </div>
                </div>

                {/* Weights info */}
                <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-100 dark:border-slate-850 font-mono text-[10.5px]">
                  <div>
                    <span className="text-slate-400 block uppercase">Processed</span>
                    <strong className="text-slate-800 dark:text-slate-200 text-xs">
                      {row.totalProcessedKg} KG
                    </strong>
                  </div>
                  <div className="text-right">
                    <span className="text-slate-400 block uppercase">Rejected</span>
                    <strong className="text-rose-600 dark:text-rose-400 text-xs">
                      {row.totalRejectedKg} KG
                    </strong>
                  </div>
                </div>

              </div>
            );
          })}

        </div>
      )}

      {/* Automated Email Controls View Console */}
      {activeReport === 'email_triggers' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-fade-in pb-12 print:hidden">
          {/* LEFT: Control Center & Mail logs */}
          <div className="lg:col-span-4 flex flex-col gap-6">
            
            {/* Control Panel */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
              <div>
                <h5 className="text-[10px] font-extrabold text-[#4F46E5] dark:text-[#818CF8] uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-indigo-500" />
                  <span>Cloud Function Emulator</span>
                </h5>
                <h3 className="text-sm font-extrabold text-slate-800 dark:text-white mt-1">
                  Daily Summary Dispatch
                </h3>
                <p className="text-[11px] text-slate-400 mt-1">
                  Compile live database records and prompt Gemini to dispatch a structured executive summary to the administration team.
                </p>
              </div>

              {/* Status indicator */}
              <div className="p-3 rounded-xl border border-dashed text-[11px] space-y-2 bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 font-mono">SMTP Relay State:</span>
                  {smtpConfigured ? (
                    <span className="text-[8.5px] font-extrabold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20 px-2 py-0.5 rounded-full border border-emerald-100 dark:border-emerald-900/30">
                      LIVE RELAY
                    </span>
                  ) : (
                    <span className="text-[8.5px] font-extrabold text-indigo-600 bg-indigo-50 dark:bg-indigo-950/20 px-2 py-0.5 rounded-full border border-indigo-100 dark:border-indigo-900/30">
                      LOCAL OUTBOX
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-slate-400 font-sans leading-relaxed">
                  {smtpConfigured 
                    ? "Emails are sent immediately through your configured live production SMTP server details."
                    : "SMTP credentials are not active. Summaries are rendered and stored locally inside the Outbox simulator below."}
                </p>
              </div>

              {/* Recipient Email Address Input */}
              <div className="space-y-1">
                <label className="text-[10.5px] font-extrabold text-slate-400 uppercase font-mono block">
                  Recipient Admin Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="email"
                    value={recipientInput}
                    onChange={(e) => setRecipientInput(e.target.value)}
                    placeholder="pawan.kummar16@gmail.com"
                    className="bg-slate-50 dark:bg-slate-850 pl-9 pr-3 py-1.5 text-xs text-slate-750 dark:text-slate-200 rounded-xl border border-slate-200 dark:border-slate-750 w-full focus:outline-none focus:ring-2 focus:ring-[#4F46E5]/20 focus:border-[#4F46E5] font-mono"
                  />
                </div>
              </div>

              {/* Trigger Button */}
              <button
                type="button"
                onClick={handleTriggerEmail}
                disabled={isTriggering}
                className="w-full flex items-center justify-center gap-2 bg-[#4F46E5] hover:bg-[#4338CA] disabled:bg-slate-200 dark:disabled:bg-slate-800 text-white disabled:text-slate-450 text-xs font-extrabold py-2 px-4 rounded-xl transition duration-200 shadow-sm cursor-pointer"
              >
                {isTriggering ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin text-indigo-200" />
                    <span>Compiling Report...</span>
                  </>
                ) : (
                  <>
                    <Send className="h-3.5 w-3.5" />
                    <span>Trigger Cloud Function Now</span>
                  </>
                )}
              </button>

              {emailSuccessMessage && (
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30 rounded-xl text-[11px] text-emerald-600 dark:text-emerald-400 leading-normal">
                  {emailSuccessMessage}
                </div>
              )}

              {emailErrorMessage && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/30 rounded-xl text-[11px] text-rose-600 dark:text-rose-400 leading-normal">
                  {emailErrorMessage}
                </div>
              )}

            </div>

            {/* Outbox Logs history */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-3 flex flex-col h-[340px]">
              <div>
                <h3 className="text-xs font-extrabold text-slate-800 dark:text-white flex items-center gap-1.5 uppercase tracking-wider">
                  <Inbox className="h-4 w-4 text-slate-400" />
                  <span>Outbox Logs ({outboxHistory.length})</span>
                </h3>
                <p className="text-[10px] text-slate-400 mt-0.5 font-sans">
                  History of triggered operations summaries and yield digests.
                </p>
              </div>

              <div className="space-y-2 overflow-y-auto pr-1 flex-1">
                {outboxHistory.length === 0 ? (
                  <div className="text-center py-12 text-slate-400 text-xs font-mono">
                    No logs found. Trigger the function above to compile report.
                  </div>
                ) : (
                  outboxHistory.map((item) => {
                    const isSelected = selectedEmailRecord?.id === item.id;
                    const dateStr = new Date(item.timestamp).toLocaleString([], {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    });
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setSelectedEmailRecord(item)}
                        className={`w-full text-left p-3 rounded-xl border transition flex flex-col gap-1 ${
                          isSelected
                            ? 'bg-slate-50 dark:bg-slate-850 border-indigo-200 dark:border-indigo-900/50 ring-2 ring-indigo-500/10'
                            : 'bg-white dark:bg-slate-900 border-slate-150 dark:border-slate-800 hover:bg-slate-50/50 dark:hover:bg-slate-850/30'
                        }`}
                      >
                        <div className="flex items-center justify-between w-full">
                          <span className="text-[9px] font-mono text-slate-400">{dateStr}</span>
                          <span className={`text-[8px] font-extrabold px-1.5 py-0.5 rounded-md ${
                            item.status === 'sent'
                              ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 border border-emerald-100'
                              : item.status === 'simulated'
                              ? 'bg-purple-50 dark:bg-purple-950/20 text-purple-600 border border-purple-100'
                              : 'bg-amber-50 dark:bg-amber-950/20 text-amber-600 border border-amber-100'
                          }`}>
                            {item.status.toUpperCase()}
                          </span>
                        </div>
                        <h4 className="text-[11px] font-bold text-slate-700 dark:text-slate-200 line-clamp-1 font-sans">
                          {item.subject}
                        </h4>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

          </div>

          {/* RIGHT: Selected report preview panel */}
          <div className="lg:col-span-8">
            {selectedEmailRecord ? (
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm flex flex-col h-full min-h-[500px]">
                
                {/* Header detail */}
                <div className="p-5 border-b border-slate-150 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/30">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div>
                      <span className="text-[9px] font-mono text-slate-450 dark:text-slate-500 uppercase tracking-widest font-bold block">
                        EMAIL DISPATCH LOG • ID: {selectedEmailRecord.id}
                      </span>
                      <h2 className="text-sm font-extrabold text-slate-800 dark:text-white mt-1">
                        {selectedEmailRecord.subject}
                      </h2>
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 mt-2 font-sans">
                        <span className="font-bold">Recipient:</span>
                        <code className="text-[10px] font-mono bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-300">
                          {selectedEmailRecord.recipient}
                        </code>
                        <span className="text-slate-300 dark:text-slate-700">|</span>
                        <span>Date: {new Date(selectedEmailRecord.timestamp).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>

                  {/* Tabs selector */}
                  <div className="flex items-center gap-1.5 mt-5 border-b border-slate-200 dark:border-slate-800 -mb-5">
                    <button
                      type="button"
                      onClick={() => setPreviewTab('insights')}
                      className={`px-4 py-2 text-xs font-extrabold border-b-2 transition ${
                        previewTab === 'insights'
                          ? 'border-[#4F46E5] text-[#4F46E5] dark:text-[#818CF8]'
                          : 'border-transparent text-slate-400 hover:text-slate-600'
                      }`}
                    >
                      Executive Highlights
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewTab('email_html')}
                      className={`px-4 py-2 text-xs font-extrabold border-b-2 transition ${
                        previewTab === 'email_html'
                          ? 'border-[#4F46E5] text-[#4F46E5] dark:text-[#818CF8]'
                          : 'border-transparent text-slate-400 hover:text-slate-600'
                      }`}
                    >
                      Interactive Email Simulator
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewTab('html_source')}
                      className={`px-4 py-2 text-xs font-extrabold border-b-2 transition ${
                        previewTab === 'html_source'
                          ? 'border-[#4F46E5] text-[#4F46E5] dark:text-[#818CF8]'
                          : 'border-transparent text-slate-400 hover:text-slate-600'
                      }`}
                    >
                      Raw HTML Source
                    </button>
                  </div>
                </div>

                {/* Tab content area */}
                <div className="p-5 flex-1 overflow-y-auto">
                  {previewTab === 'insights' && (
                    <div className="space-y-6 animate-fade-in">
                      
                      {/* Executive summary block */}
                      <div className="space-y-2">
                        <h4 className="text-[10px] font-extrabold text-slate-450 dark:text-slate-500 uppercase tracking-widest font-mono">
                          Executive Overview
                        </h4>
                        <div className="bg-indigo-50/10 dark:bg-indigo-950/10 border border-indigo-100/50 dark:border-indigo-900/30 p-4 rounded-xl">
                          <p className="text-xs text-slate-750 dark:text-slate-300 leading-relaxed font-sans">
                            {selectedEmailRecord.executiveSummary}
                          </p>
                        </div>
                      </div>

                      {/* Critical Bottlenecks block */}
                      <div className="space-y-2.5">
                        <h4 className="text-[10px] font-extrabold text-slate-450 dark:text-slate-500 uppercase tracking-widest font-mono flex items-center gap-1.5">
                          <AlertCircle className="h-4 w-4 text-rose-500" />
                          <span>Detected Anomalies & Alerts</span>
                        </h4>
                        {selectedEmailRecord.criticalBottlenecks && selectedEmailRecord.criticalBottlenecks.length > 0 ? (
                          <div className="grid grid-cols-1 gap-2">
                            {selectedEmailRecord.criticalBottlenecks.map((b: string, i: number) => (
                              <div key={i} className="flex items-start gap-2.5 bg-rose-50/20 dark:bg-rose-950/5 border border-rose-100/45 dark:border-rose-900/20 p-3 rounded-xl text-xs text-slate-750 dark:text-slate-350 leading-normal">
                                <span className="text-rose-500 font-extrabold font-mono mt-0.5">⚠️</span>
                                <span className="font-sans">{b}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-400 font-sans italic">No critical anomalies detected in active operations.</p>
                        )}
                      </div>

                      {/* Recommended strategic actions block */}
                      <div className="space-y-2.5">
                        <h4 className="text-[10px] font-extrabold text-slate-450 dark:text-slate-500 uppercase tracking-widest font-mono flex items-center gap-1.5">
                          <Sparkles className="h-4 w-4 text-emerald-500" />
                          <span>Recommended Operational Adjustments</span>
                        </h4>
                        {selectedEmailRecord.recommendedActions && selectedEmailRecord.recommendedActions.length > 0 ? (
                          <div className="grid grid-cols-1 gap-2">
                            {selectedEmailRecord.recommendedActions.map((act: string, i: number) => (
                              <div key={i} className="flex items-start gap-2.5 bg-emerald-50/10 dark:bg-emerald-950/5 border border-emerald-100/45 dark:border-emerald-900/20 p-3 rounded-xl text-xs text-slate-750 dark:text-slate-350 leading-normal">
                                <span className="text-emerald-500 font-extrabold font-mono mt-0.5">✓</span>
                                <span className="font-sans">{act}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-400 font-sans italic">All systems performing optimally. No corrective actions proposed.</p>
                        )}
                      </div>

                    </div>
                  )}

                  {previewTab === 'email_html' && (
                    <div className="border border-slate-200 dark:border-slate-850 rounded-xl overflow-hidden h-[480px] flex flex-col bg-white animate-fade-in">
                      <div className="bg-slate-100 dark:bg-slate-800 p-2 border-b border-slate-200 dark:border-slate-700 text-[10px] text-slate-500 font-mono flex items-center justify-between">
                        <span>📧 Live Email Sandbox Iframe (Isolated Sandbox)</span>
                        <span className="text-[9px] uppercase font-bold text-[#4F46E5]">Active Rendering</span>
                      </div>
                      <iframe
                        title="Live Email Preview"
                        srcDoc={selectedEmailRecord.htmlBody}
                        className="w-full flex-1 border-none bg-white"
                        sandbox="allow-same-origin"
                      />
                    </div>
                  )}

                  {previewTab === 'html_source' && (
                    <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 font-mono text-[10px] text-slate-300 overflow-x-auto whitespace-pre h-[480px] leading-relaxed select-all animate-fade-in">
                      {selectedEmailRecord.htmlBody}
                    </div>
                  )}
                </div>

              </div>
            ) : (
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-12 text-center h-full flex flex-col justify-center items-center space-y-3 min-h-[500px]">
                <span className="text-3xl text-slate-300 dark:text-slate-700">📧</span>
                <h3 className="text-sm font-extrabold text-slate-700 dark:text-slate-300">No Email Log Selected</h3>
                <p className="text-xs text-slate-400 max-w-sm">
                  Click on any compiled outbox report in the left ledger or trigger the automated daily summary cloud function to preview results.
                </p>
              </div>
            )}
          </div>

        </div>
      )}

      {activeReport === 'raw_material_summary' && (
        <RawMaterialReportView
          jobCards={jobCards}
          movements={movements}
          startDate={startDate}
          endDate={endDate}
        />
      )}

      {/* Grid records counts */}
      {activeReport !== 'email_triggers' && activeReport !== 'raw_material_summary' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            {filteredData.length === 0 ? (
              <div className="text-center p-8 space-y-2">
                <span className="text-2xl">🔍</span>
                <p className="text-sm font-semibold text-slate-500">No records found matching audit criteria</p>
                <p className="text-xs text-slate-400">Try loosening your search keywords or date range bounds</p>
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-950 text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-slate-200 dark:border-slate-800">
                    {Object.keys(filteredData[0]).map((h) => (
                      <th key={h} className="py-3.5 px-4 font-mono font-bold">
                        {h.replace(/([A-Z])/g, ' $1').trim()}
                      </th>
                    ))}
                    {activeReport === 'store' && (
                      <th className="py-3.5 px-4 font-mono font-bold text-indigo-600 dark:text-indigo-400">
                        Dispatch Request
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filteredData.map((row, idx) => (
                    <tr 
                      key={idx} 
                      className="border-b last:border-b-0 border-slate-200 dark:border-slate-850 hover:bg-slate-50/50 dark:hover:bg-slate-850/40 text-xs transition-colors"
                    >
                      {Object.values(row).map((val: any, valIdx) => {
                        // Custom formatter
                        let displayVal = String(val);
                        if (typeof val === 'boolean') {
                          displayVal = val ? 'True' : 'False';
                        }

                        // Is it date values? Formatter
                        if (typeof val === 'string' && val.includes('T') && !isNaN(Date.parse(val))) {
                          displayVal = new Date(val).toLocaleDateString([], {month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit'});
                        }

                        // Determine column keys
                        const colKey = Object.keys(row)[valIdx];
                        const isJobCard = colKey === 'jobCardNo' || colKey === 'Job Card No';
                        const isItemName = colKey === 'itemName' || colKey === 'Item Name';
                        const isBulkItem = isItemName && (row.qtyInStockKg >= 500 || String(val).toLowerCase().includes('bulk'));
                        const isStatus = colKey.toLowerCase() === 'status';
                        const isPendingCol = colKey === 'pendingProdToPackKg';

                        return (
                          <td key={valIdx} className="py-3 px-4 font-mono text-slate-700 dark:text-slate-300">
                            {isJobCard ? (
                              <span className="font-bold text-slate-900 dark:text-white px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                                {displayVal}
                              </span>
                            ) : isItemName ? (
                              <div className="flex items-center gap-1.5 font-sans font-medium text-slate-900 dark:text-white">
                                <span>{displayVal}</span>
                                {isBulkItem && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-amber-50 dark:bg-amber-950/40 text-amber-650 dark:text-amber-450 border border-amber-200/50 dark:border-amber-900/30 font-sans uppercase tracking-wider">
                                    Bulk Item 📦
                                  </span>
                                )}
                              </div>
                            ) : isStatus ? (
                              <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                                displayVal === 'Issued'
                                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200/30'
                                  : displayVal === 'Rejected'
                                  ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200/30'
                                  : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200/30 font-extrabold animate-pulse'
                              }`}>
                                {displayVal}
                              </span>
                            ) : isPendingCol ? (
                              <button
                                type="button"
                                onClick={() => {
                                  const jc = jobCards.find(c => c.jobCardNo.toLowerCase() === String(row.jobCardNo).toLowerCase());
                                  if (jc) setPendingBreakdownJobCard(jc);
                                }}
                                className="inline-flex items-center gap-1 font-mono font-extrabold text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/60 px-2 py-1 rounded-lg border border-amber-200/80 dark:border-amber-800/50 transition cursor-pointer"
                                title="Click to view department breakdown of pending quantity (Excluding Store)"
                              >
                                <span>{Number(val).toLocaleString()} KG</span>
                                <span className="text-[10px] text-amber-500 font-sans font-bold">ℹ️</span>
                              </button>
                            ) : (
                              displayVal
                            )}
                          </td>
                        );
                      })}
                      {activeReport === 'store' && (
                        <td className="py-3 px-4">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedStoreRow(row);
                              setRequestedQty(row.qtyInStockKg || 0);
                              setRemarksVal(`Bulk material issue request for ${row.itemName} (${row.jobCardNo})`);
                              setIsOpenRequestModal(true);
                            }}
                            disabled={!row.qtyInStockKg || row.qtyInStockKg <= 0}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold font-sans text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:pointer-events-none shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
                          >
                            <Send className="h-3 w-3" />
                            <span>Request Issue</span>
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          
          {/* Dynamic footer tally counts */}
          {filteredData.length > 0 && (
            <div className="p-4 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 flex justify-between font-mono">
              <span>Total Records Listed: {filteredData.length}</span>
              <span>Ref: Site-1 Operations</span>
            </div>
          )}
        </div>
      )}

      {/* Dispatch Issue Request Modal */}
      {isOpenRequestModal && selectedStoreRow && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto animate-fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full shadow-xl border border-slate-200 dark:border-slate-800 overflow-hidden font-sans">
            <div className="p-5 border-b border-slate-150 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/30 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">📦</span>
                <div>
                  <h3 className="text-sm font-extrabold text-slate-800 dark:text-white">
                    Request Dispatch Issue
                  </h3>
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider font-mono">
                    Store Report Workflow
                  </p>
                </div>
              </div>
              <button 
                type="button"
                onClick={() => setIsOpenRequestModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-250 text-xl font-bold cursor-pointer"
              >
                &times;
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3 bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-150 dark:border-slate-850 text-xs">
                <div>
                  <span className="text-slate-400 block text-[10px]">Job Card No</span>
                  <span className="font-mono font-bold text-slate-800 dark:text-white">{selectedStoreRow.jobCardNo}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Party Name</span>
                  <span className="font-semibold text-slate-800 dark:text-white truncate block">{selectedStoreRow.partyName}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-slate-400 block text-[10px]">Item Description</span>
                  <span className="font-semibold text-slate-800 dark:text-white">{selectedStoreRow.itemName}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Available In Store</span>
                  <span className="font-bold text-indigo-600 dark:text-indigo-400 font-mono">
                    {(selectedStoreRow.qtyInStockKg || 0).toLocaleString()} KG
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">Allotted Bin</span>
                  <span className="font-semibold text-slate-800 dark:text-white font-mono">{selectedStoreRow.allottedLocation}</span>
                </div>
              </div>

              {/* Form Input */}
              <div className="space-y-1.5">
                <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Requested Issue Quantity (KG)
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={requestedQty || ''}
                    onChange={e => {
                      const clean = e.target.value.replace(/[^0-9.]/g, '');
                      setRequestedQty(clean === '' ? 0 : parseFloat(clean));
                    }}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-250 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-xs font-mono text-slate-800 dark:text-white pr-12 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                  />
                  <span className="absolute right-3.5 top-2.5 text-xs font-bold text-slate-400">KG</span>
                </div>
                {requestedQty > (selectedStoreRow.qtyInStockKg || 0) && (
                  <p className="text-[10px] text-rose-500 font-medium">
                    ⚠️ Cannot request more than available stock ({(selectedStoreRow.qtyInStockKg || 0).toLocaleString()} KG).
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Remarks / Instructions
                </label>
                <textarea
                  rows={2}
                  value={remarksVal}
                  onChange={e => setRemarksVal(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-slate-800 dark:text-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all placeholder:text-slate-400 resize-none"
                  placeholder="Add any specific instructions for the storekeeper..."
                />
              </div>
            </div>

            <div className="p-5 border-t border-slate-150 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-950/10 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setIsOpenRequestModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={requestedQty <= 0 || requestedQty > (selectedStoreRow.qtyInStockKg || 0)}
                onClick={async () => {
                  if (requestedQty <= 0 || requestedQty > (selectedStoreRow.qtyInStockKg || 0)) return;
                  try {
                    if (onCreateMovement) {
                      await onCreateMovement({
                        jobCardNo: selectedStoreRow.jobCardNo,
                        fromDepartment: 'Store',
                        toDepartment: 'Dispatch',
                        quantity: selectedStoreRow.qtyInStockKg || 0,
                        isIssueRequest: true,
                        requestedUnit: 'KG',
                        requestedQty: requestedQty,
                        remarks: remarksVal || `Dispatch requested issue in KG`
                      });
                      setIsOpenRequestModal(false);
                    }
                  } catch (err) {
                    console.error("Failed to create issue request", err);
                  }
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:pointer-events-none transition flex items-center gap-1.5 shadow-md shadow-indigo-600/10 cursor-pointer"
              >
                <Send className="h-3.5 w-3.5" />
                <span>Submit Issue Request</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pending Breakdown Modal */}
      {pendingBreakdownJobCard && (
        <PendingBreakdownModal
          jobCard={pendingBreakdownJobCard}
          movements={movements}
          onClose={() => setPendingBreakdownJobCard(null)}
        />
      )}

    </div>
  );
}
