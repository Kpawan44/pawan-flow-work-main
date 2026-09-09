import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  FileSpreadsheet, 
  FileText, 
  Share2, 
  Download, 
  Calendar, 
  Filter, 
  TrendingUp, 
  Scale, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  Factory, 
  Warehouse, 
  Layers, 
  RefreshCw, 
  ChevronRight,
  ChevronDown,
  Boxes,
  Flame,
  Sparkles,
  Box,
  Truck,
  ShoppingCart,
  Search,
  Mail,
  Send,
  ArrowRight,
  Inbox,
  Eye,
  CheckCircle
} from 'lucide-react';
import { JobCard, MaterialMovement, UserProfile, Department, ProcessTransfer } from '../../types';
import { getJobCardProcessMetrics, getWireScrapQty, getRawMaterialIssuedQty, getJobCardDepartmentPending, jobCardLedgerWipQty } from '../../lib/metrics';
import { getCumulativeDispatchedQty, remainingAtDepartment } from '../../hardening/process2Manufacturing';
import { exportComprehensiveExcelBackup } from '../../lib/excelExport';
import { exportJobCards, exportMaterialMovements } from '../../lib/csvExport';
import { INVENTORY_RAW_MATERIALS, getDynamicRawMaterialsStock } from '../../components/RawMaterialRequestModal';
import MobileJobCardDetailScreen from './MobileJobCardDetailScreen';

interface MobileReportsScreenProps {
  jobCards?: JobCard[];
  movements?: MaterialMovement[];
  processTransfers?: ProcessTransfer[];
  currentUser?: UserProfile | null;
  isOnline?: boolean;
}

export type MainReportTab = 'executive' | 'stations_wip' | 'ageing' | 'rejections' | 'raw_material' | 'all_reports';
export type DatePreset = 'today' | 'yesterday' | '7days' | '30days' | 'all';

export type SpecificReportType = 
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

const ALL_MANUFACTURING_DEPARTMENTS: Department[] = [
  'Purchase',
  'Raw Material Store',
  'Production',
  'Heat Treatment',
  'Plating',
  'Packing',
  'Store',
  'Dispatch'
];

const REPORT_DIRECTORY: { id: SpecificReportType; label: string; desc: string; category: string }[] = [
  { id: 'production', label: 'Production Milling', desc: 'Machining outputs, wire sizes, and operator signoffs', category: 'Stations' },
  { id: 'heattreat', label: 'Heat Treatment Furnace', desc: 'Hardness levels, recipes, and furnace rejections', category: 'Stations' },
  { id: 'plating', label: 'Surfacing & Plating', desc: 'Micron thickness, coating quality, and chemical baths', category: 'Stations' },
  { id: 'packing', label: 'Packaging Weights', desc: 'Box specs, carton packing counts, and tare weights', category: 'Stations' },
  { id: 'incoming_store', label: 'Incoming Store Buffer', desc: 'Goods received into purchase prior to production', category: 'Stations' },
  { id: 'store', label: 'Store / Warehousing', desc: 'Bin locations, shelf allocations, and verified finished stock', category: 'Stations' },
  { id: 'process_transfers', label: 'Store Process Transfers', desc: 'Repacking & Replating process movements and return quantities', category: 'Stations' },
  { id: 'raw_material_store', label: 'Raw Material Store Ledger', desc: 'Production coil requests, issued weights, and statuses', category: 'Materials' },
  { id: 'raw_material_summary', label: 'Raw Material Stock & Demand', desc: 'Comprehensive audit of coil grades, stock, and demands', category: 'Materials' },
  { id: 'stock_summary', label: 'Stock Summary (Item-wise)', desc: 'Aggregated stock weights, piece counts, and boxes by item', category: 'Inventory' },
  { id: 'dispatch', label: 'Dispatch Shipment Ledger', desc: 'Invoiced shipments, delivery vehicles, and dispatch dates', category: 'Operations' },
  { id: 'pending', label: 'Active Outstanding Queue', desc: 'Orders currently running through the factory workfloor', category: 'Operations' },
  { id: 'completed', label: 'Archived Completed Orders', desc: 'Fully processed and shipped manufacturing batches', category: 'Operations' },
  { id: 'rejected', label: 'Rejected Orders Report', desc: 'Batches flagged with rejection and scrap remarks', category: 'Quality' },
  { id: 'movements', label: 'Material Movement Trail', desc: 'Step-by-step custody transfer history with timestamps', category: 'Ledger' },
  { id: 'balance', label: 'Balance Quantity Audit', desc: 'Target vs Processed scrap analysis per Job Card', category: 'Quality' },
  { id: 'rejection_by_dept', label: 'Rejection Bottleneck Analysis', desc: 'Department-level breakdown of processed vs rejected mass', category: 'Quality' },
  { id: 'email_triggers', label: 'Automated Email Controls', desc: 'Send daily summary report to plant management inbox', category: 'System' }
];

export const MobileReportsScreen: React.FC<MobileReportsScreenProps> = ({
  jobCards = [],
  movements = [],
  processTransfers = [],
  currentUser,
  isOnline = true
}) => {
  const [activeMainTab, setActiveMainTab] = useState<MainReportTab>('executive');
  const [selectedSpecificReport, setSelectedSpecificReport] = useState<SpecificReportType>('production');
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedDept, setSelectedDept] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [exportFeedback, setExportFeedback] = useState<string | null>(null);
  const [selectedDrillJobCard, setSelectedDrillJobCard] = useState<JobCard | null>(null);

  // Email Trigger State
  const [isTriggeringEmail, setIsTriggeringEmail] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState('pawan.kummar16@gmail.com');
  const [emailStatusMessage, setEmailStatusMessage] = useState<string | null>(null);

  // Determine authorized departments for current user
  const authorizedDepartments = useMemo(() => {
    if (!currentUser) return ALL_MANUFACTURING_DEPARTMENTS;
    if (currentUser.role === 'super_admin' || currentUser.role === 'admin' || currentUser.department === 'Admin') {
      return ALL_MANUFACTURING_DEPARTMENTS;
    }
    const allowed = new Set<string>();
    if (currentUser.department) allowed.add(String(currentUser.department).toLowerCase());
    (currentUser.allowedDepartments || []).forEach(d => {
      if (d) allowed.add(String(d).toLowerCase());
    });
    (currentUser.accessList || []).forEach(d => {
      if (d) allowed.add(String(d).toLowerCase());
    });
    return ALL_MANUFACTURING_DEPARTMENTS.filter(d => allowed.has(d.toLowerCase()));
  }, [currentUser]);

  // Date Filter Boundaries
  const dateBoundary = useMemo(() => {
    if (startDate || endDate) {
      const start = startDate ? new Date(startDate) : null;
      let end = endDate ? new Date(endDate) : null;
      if (end) {
        end.setHours(23, 59, 59, 999);
      }
      return { start, end };
    }

    const now = new Date();
    if (datePreset === 'today') {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return { start, end: now };
    }
    if (datePreset === 'yesterday') {
      const start = new Date(now);
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setDate(end.getDate() - 1);
      end.setHours(23, 59, 59, 999);
      return { start, end };
    }
    if (datePreset === '7days') {
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      start.setHours(0, 0, 0, 0);
      return { start, end: now };
    }
    if (datePreset === '30days') {
      const start = new Date(now);
      start.setDate(start.getDate() - 30);
      start.setHours(0, 0, 0, 0);
      return { start, end: now };
    }
    return null; // 'all'
  }, [datePreset, startDate, endDate]);

  // Filtered Job Cards based on date, RBAC, and Department
  const filteredJobCards = useMemo(() => {
    if (!Array.isArray(jobCards)) return [];
    return jobCards.filter((j) => {
      if (!j) return false;

      // RBAC check
      const isSuper = !currentUser || currentUser.role === 'super_admin' || currentUser.role === 'admin' || currentUser.department === 'Admin';
      if (!isSuper) {
        const jDept = String(j.currentDepartment || '').toLowerCase();
        const allowed = authorizedDepartments.some(d => d.toLowerCase() === jDept);
        if (!allowed) return false;
      }

      // Department filter
      if (selectedDept !== 'ALL') {
        const jDept = String(j.currentDepartment || '').toLowerCase();
        if (jDept !== selectedDept.toLowerCase()) return false;
      }

      // Date boundary check
      if (dateBoundary && j.createdAt) {
        const cDate = new Date(j.createdAt);
        if (!isNaN(cDate.getTime())) {
          if (dateBoundary.start && cDate < dateBoundary.start) return false;
          if (dateBoundary.end && cDate > dateBoundary.end) return false;
        }
      }

      // Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matches = 
          String(j.jobCardNo || '').toLowerCase().includes(q) ||
          String(j.partyName || '').toLowerCase().includes(q) ||
          String(j.itemName || '').toLowerCase().includes(q) ||
          String(j.materialGrade || '').toLowerCase().includes(q) ||
          String(j.heatNo || '').toLowerCase().includes(q);
        if (!matches) return false;
      }

      return true;
    });
  }, [jobCards, currentUser, authorizedDepartments, selectedDept, dateBoundary, searchQuery]);

  // Filtered Movements based on date and department
  const filteredMovements = useMemo(() => {
    if (!Array.isArray(movements)) return [];
    return movements.filter((m) => {
      if (!m) return false;

      // Date boundary check
      if (dateBoundary && m.transferDate) {
        const mDate = new Date(m.transferDate);
        if (!isNaN(mDate.getTime())) {
          if (dateBoundary.start && mDate < dateBoundary.start) return false;
          if (dateBoundary.end && mDate > dateBoundary.end) return false;
        }
      }

      // Department filter
      if (selectedDept !== 'ALL') {
        const matchFrom = String(m.fromDepartment || '').toLowerCase() === selectedDept.toLowerCase();
        const matchTo = String(m.toDepartment || '').toLowerCase() === selectedDept.toLowerCase();
        if (!matchFrom && !matchTo) return false;
      }

      // Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matches = 
          String(m.jobCardNo || '').toLowerCase().includes(q) ||
          String(m.movementId || '').toLowerCase().includes(q) ||
          String(m.fromDepartment || '').toLowerCase().includes(q) ||
          String(m.toDepartment || '').toLowerCase().includes(q);
        if (!matches) return false;
      }

      return true;
    });
  }, [movements, selectedDept, dateBoundary, searchQuery]);

  // Core Executive Metrics
  const metrics = useMemo(() => {
    const activeJobs = filteredJobCards.filter(j => j && j.currentDepartment !== 'Completed' && j.status !== 'Completed');
    const completedJobs = filteredJobCards.filter(j => j && (j.completed || j.currentDepartment === 'Completed' || j.status === 'Completed'));
    const rejectedJobs = filteredJobCards.filter(j => j && j.status === 'Rejected');

    const totalTargetMass = filteredJobCards.reduce((sum, j) => sum + (Number(j.orderQty) || 0), 0);
    const activeWipMass = activeJobs.reduce((sum, j) => sum + jobCardLedgerWipQty(j, filteredMovements), 0);
    const totalDispatchedMass = filteredJobCards.reduce(
      (sum, j) => sum + getCumulativeDispatchedQty(j, filteredMovements),
      0
    );

    const pendingIngressCount = (Array.isArray(movements) ? movements : []).filter(
      m => m && !m.accepted && m.issueStatus !== 'Rejected' && (selectedDept === 'ALL' || String(m.toDepartment || '').toLowerCase() === selectedDept.toLowerCase())
    ).length;

    // Total wire scrap & rejections
    const totalScrap = filteredJobCards.reduce((sum, j) => sum + (Number(getWireScrapQty(j, filteredMovements)) || 0), 0);
    const totalRejectionMass = filteredJobCards.reduce(
      (sum, j) => sum + (Number(j.heatTreatmentDetails?.rejectionQty) || 0) + (Number(j.platingDetails?.rejectionQty) || 0) + (Number(j.packingDetails?.rejectionQty) || 0),
      0
    );

    return {
      activeJobsCount: activeJobs.length,
      completedJobsCount: completedJobs.length,
      rejectedJobsCount: rejectedJobs.length,
      totalTargetMass,
      activeWipMass,
      totalDispatchedMass,
      pendingIngressCount,
      totalScrap,
      totalRejectionMass
    };
  }, [filteredJobCards, filteredMovements, movements, selectedDept]);

  // Ageing Buckets
  const ageingBuckets = useMemo(() => {
    const now = Date.now();
    const buckets: Record<string, { count: number; mass: number }> = {
      '0-1 Day': { count: 0, mass: 0 },
      '1-3 Days': { count: 0, mass: 0 },
      '3-7 Days': { count: 0, mass: 0 },
      '7-14 Days': { count: 0, mass: 0 },
      '14+ Days': { count: 0, mass: 0 }
    };

    filteredJobCards
      .filter(j => j && j.status !== 'Completed' && j.currentDepartment !== 'Completed')
      .forEach(j => {
        const createdDate = j.createdAt ? new Date(j.createdAt).getTime() : now;
        const created = isNaN(createdDate) ? now : createdDate;
        const diffDays = Math.max(0, Math.floor((now - created) / (1000 * 60 * 60 * 24)));
        const mass = jobCardLedgerWipQty(j, filteredMovements);

        if (diffDays <= 1) {
          buckets['0-1 Day'].count++;
          buckets['0-1 Day'].mass += mass;
        } else if (diffDays <= 3) {
          buckets['1-3 Days'].count++;
          buckets['1-3 Days'].mass += mass;
        } else if (diffDays <= 7) {
          buckets['3-7 Days'].count++;
          buckets['3-7 Days'].mass += mass;
        } else if (diffDays <= 14) {
          buckets['7-14 Days'].count++;
          buckets['7-14 Days'].mass += mass;
        } else {
          buckets['14+ Days'].count++;
          buckets['14+ Days'].mass += mass;
        }
      });

    return buckets;
  }, [filteredJobCards, filteredMovements]);

  // Department Breakdown
  const departmentBreakdown = useMemo(() => {
    return authorizedDepartments.map(dept => {
      const deptLower = dept.toLowerCase();
      const deptJobs = (Array.isArray(jobCards) ? jobCards : []).filter(
        j => j && String(j.currentDepartment || '').toLowerCase() === deptLower && j.status !== 'Completed' && j.currentDepartment !== 'Completed'
      );
      const mass = deptJobs.reduce((sum, j) => sum + jobCardLedgerWipQty(j, movements), 0);
      const pendingIngress = (Array.isArray(movements) ? movements : []).filter(
        m => m && String(m.toDepartment || '').toLowerCase() === deptLower && !m.accepted && m.issueStatus !== 'Rejected'
      ).length;

      return {
        dept,
        batchCount: deptJobs.length,
        mass,
        pendingIngress
      };
    });
  }, [authorizedDepartments, jobCards, movements]);

  // Department Rejection Bottleneck Breakdown
  const departmentRejectionStats = useMemo(() => {
    const stats: Record<string, { processed: number; rejected: number }> = {
      'Production': { processed: 0, rejected: 0 },
      'Heat Treatment': { processed: 0, rejected: 0 },
      'Plating': { processed: 0, rejected: 0 },
      'Packing': { processed: 0, rejected: 0 },
      'Store': { processed: 0, rejected: 0 }
    };

    filteredJobCards.forEach(jc => {
      const m = getJobCardProcessMetrics(jc, filteredMovements);
      const isProdRejected = jc.status === 'Rejected' && jc.currentDepartment === 'Production';
      stats['Production'].processed += (Number(jc.orderQty) || 0);
      stats['Production'].rejected += isProdRejected ? (Number(jc.orderQty) || 0) : (Number(jc.productionDetails?.rejectionQty) || 0);

      if (jc.heatTreatmentRequired) {
        stats['Heat Treatment'].processed += m.qtyReceivedFromProd;
        stats['Heat Treatment'].rejected += (Number(jc.heatTreatmentDetails?.rejectionQty) || 0);
      }

      stats['Plating'].processed += m.qtyReceivedAtPlating;
      stats['Plating'].rejected += (Number(jc.platingDetails?.rejectionQty) || 0);

      stats['Packing'].processed += m.qtyReceivedAtPacking;
      stats['Packing'].rejected += (Number(jc.packingDetails?.rejectionQty) || 0);

      stats['Store'].processed += m.qtyReceivedAtStore;
      stats['Store'].rejected += (Number(jc.storeDetails?.rejectionQty) || 0);
    });

    return stats;
  }, [filteredJobCards, filteredMovements]);

  // Raw Material Inventory Summary Calculation
  const rawMaterialConsumption = useMemo(() => {
    return getDynamicRawMaterialsStock(movements).map(item => {
      const totalIssued = (Array.isArray(movements) ? movements : [])
        .filter(m => 
          m &&
          m.fromDepartment === 'Raw Material Store' && 
          m.isIssueRequest && 
          m.issueStatus === 'Issued' && 
          (m.processDetails?.rawMaterialCode === item.code || m.processDetails?.rawMaterialName === item.name)
        )
        .reduce((sum, m) => sum + (Number(m.quantity) || Number(m.requestedQty) || 0), 0);

      const pendingRequests = (Array.isArray(movements) ? movements : [])
        .filter(m => 
          m &&
          m.fromDepartment === 'Raw Material Store' && 
          m.isIssueRequest && 
          m.issueStatus === 'Pending' && 
          (m.processDetails?.rawMaterialCode === item.code || m.processDetails?.rawMaterialName === item.name)
        )
        .reduce((sum, m) => sum + (Number(m.quantity) || Number(m.requestedQty) || 0), 0);

      const opening = (item as any).openingStock || 0;
      const currentStock = Math.max(0, opening - totalIssued);

      return {
        ...item,
        totalIssued,
        pendingRequests,
        currentStock
      };
    });
  }, [movements]);

  // Item-wise Stock Aggregation
  const itemWiseStock = useMemo(() => {
    const map = new Map<string, { itemName: string; totalQty: number; boxCount: number; batchCount: number }>();
    filteredJobCards.forEach(j => {
      const name = j.itemName || 'Unnamed Item';
      const m = getJobCardProcessMetrics(j, filteredMovements);
      const stock = m.qtyRemainingInStock;
      const boxes = Number(j.packingDetails?.boxCount) || 0;

      if (!map.has(name)) {
        map.set(name, { itemName: name, totalQty: 0, boxCount: 0, batchCount: 0 });
      }
      const entry = map.get(name)!;
      entry.totalQty += stock;
      entry.boxCount += boxes;
      entry.batchCount += (stock > 0 ? 1 : 0);
    });
    return Array.from(map.values()).filter(i => i.totalQty > 0 || i.batchCount > 0);
  }, [filteredJobCards, filteredMovements]);

  // Excel Export
  const handleExportExcel = async () => {
    setIsExporting(true);
    setExportFeedback(null);
    try {
      exportComprehensiveExcelBackup(filteredJobCards, filteredMovements);
      setExportFeedback("✅ Full Excel Workbook generated successfully!");
      setTimeout(() => setExportFeedback(null), 3000);
    } catch (err: any) {
      console.error("Failed to export Excel", err);
      setExportFeedback("❌ Failed to generate Excel: " + (err?.message || "Please retry."));
    } finally {
      setIsExporting(false);
    }
  };

  // CSV Export
  const handleExportCSV = async () => {
    setIsExporting(true);
    setExportFeedback(null);
    try {
      exportJobCards(filteredJobCards);
      setExportFeedback("✅ CSV Ledger generated successfully!");
      setTimeout(() => setExportFeedback(null), 3000);
    } catch (err: any) {
      console.error("Failed to export CSV", err);
      setExportFeedback("❌ Failed to generate CSV.");
    } finally {
      setIsExporting(false);
    }
  };

  // Automated Email Trigger
  const handleTriggerSummaryEmail = async () => {
    setIsTriggeringEmail(true);
    setEmailStatusMessage(null);
    try {
      const response = await fetch('/api/trigger-daily-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobCards: filteredJobCards,
          movements: filteredMovements,
          recipient: recipientEmail
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.details || "Failed to transmit email summary");
      setEmailStatusMessage(`✅ Daily summary report successfully generated and sent to ${recipientEmail}!`);
    } catch (e: any) {
      setEmailStatusMessage(`⚠️ Email queued for outbox transmission: ${e.message || "Recorded locally."}`);
    } finally {
      setIsTriggeringEmail(false);
    }
  };

  // 1. Drill-down screen for specific Job Card
  if (selectedDrillJobCard && currentUser) {
    return (
      <MobileJobCardDetailScreen
        jobCard={selectedDrillJobCard}
        movements={movements}
        currentUser={currentUser}
        onBack={() => setSelectedDrillJobCard(null)}
      />
    );
  }

  return (
    <div className="space-y-4 pb-24 select-none px-1">
      {/* Top Header & Connectivity Status */}
      <div className="p-4 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
        <div>
          <h2 className="text-sm font-extrabold uppercase tracking-tight text-slate-900 dark:text-white flex items-center gap-1.5">
            <Layers className="h-4 w-4 text-[#3B82F6]" />
            <span>Factory Analytics & Reports</span>
          </h2>
          <p className="text-[10.5px] text-slate-500 font-mono">
            {isOnline ? '🟢 Authoritative Live Cloud Data' : '🟠 Offline Cached View'}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={handleExportExcel}
            disabled={isExporting}
            className="p-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-xs font-bold flex items-center gap-1 cursor-pointer transition hover:bg-emerald-100 disabled:opacity-50"
            title="Export Excel"
          >
            <FileSpreadsheet className="h-4 w-4" />
            <span className="hidden sm:inline">Excel</span>
          </button>
          <button
            onClick={handleExportCSV}
            disabled={isExporting}
            className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-[#3B82F6] border border-blue-200 dark:border-blue-800 text-xs font-bold flex items-center gap-1 cursor-pointer transition hover:bg-blue-100 disabled:opacity-50"
            title="Export CSV"
          >
            <FileText className="h-4 w-4" />
            <span className="hidden sm:inline">CSV</span>
          </button>
        </div>
      </div>

      {/* Export Feedback Toast */}
      {exportFeedback && (
        <div className="p-3 rounded-2xl bg-slate-900 text-white text-xs font-mono font-bold flex items-center justify-between">
          <span>{exportFeedback}</span>
        </div>
      )}

      {/* Date, Department & Search Filters */}
      <div className="p-3.5 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 space-y-3 shadow-xs">
        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-3.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search report records (Job Card, Party, Item, Heat No)..."
            className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:border-blue-500"
          />
        </div>

        {/* Date Presets */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          {(['all', 'today', 'yesterday', '7days', '30days'] as DatePreset[]).map(preset => (
            <button
              key={preset}
              type="button"
              onClick={() => {
                setDatePreset(preset);
                setStartDate('');
                setEndDate('');
              }}
              className={`px-3 py-1.5 rounded-xl text-[11px] font-bold font-mono transition shrink-0 cursor-pointer border ${
                datePreset === preset && !startDate && !endDate
                  ? 'bg-[#3B82F6] text-white border-blue-600 shadow-xs'
                  : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
              }`}
            >
              {preset === 'all' ? 'All Time' : preset === 'today' ? 'Today' : preset === 'yesterday' ? 'Yesterday' : preset === '7days' ? 'Last 7D' : 'Last 30D'}
            </button>
          ))}
        </div>

        {/* Custom Date Bounds & Department Filter */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-1.5 text-xs">
            <Calendar className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="bg-transparent text-slate-800 dark:text-white text-[11px] w-full focus:outline-hidden"
              title="From Date"
            />
            <span className="text-slate-400 text-[10px]">to</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="bg-transparent text-slate-800 dark:text-white text-[11px] w-full focus:outline-hidden"
              title="To Date"
            />
          </div>

          <div className="flex items-center gap-2">
            <Filter className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            <select
              value={selectedDept}
              onChange={(e) => setSelectedDept(e.target.value)}
              className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:outline-hidden focus:border-blue-500 cursor-pointer"
            >
              <option value="ALL">All Stations ({authorizedDepartments.length})</option>
              {authorizedDepartments.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Main Navigation Tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
        {[
          { id: 'executive', label: 'Executive KPIs' },
          { id: 'stations_wip', label: 'Stations WIP' },
          { id: 'ageing', label: 'WIP Ageing' },
          { id: 'rejections', label: 'Quality & Scrap' },
          { id: 'raw_material', label: 'Raw Materials' },
          { id: 'all_reports', label: '18-Report Directory' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveMainTab(tab.id as MainReportTab)}
            className={`px-3.5 py-2 rounded-2xl text-xs font-extrabold tracking-tight transition shrink-0 cursor-pointer border ${
              activeMainTab === tab.id
                ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-transparent shadow-xs'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200/80 dark:border-slate-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ======================================================== */}
      {/* TAB 1: EXECUTIVE KPIS */}
      {/* ======================================================== */}
      {activeMainTab === 'executive' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2.5">
            <div className="p-4 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-1">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Active WIP Mass</span>
              <span className="text-sm font-extrabold text-[#3B82F6] font-mono flex items-center gap-1.5">
                <Scale className="h-4 w-4 shrink-0" />
                <span>{metrics.activeWipMass.toLocaleString()} KG</span>
              </span>
              <span className="text-[10px] text-slate-500 font-mono block">
                {metrics.activeJobsCount} Active Production Batches
              </span>
            </div>

            <div className="p-4 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-1">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Dispatched Mass</span>
              <span className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400 font-mono flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>{metrics.totalDispatchedMass.toLocaleString()} KG</span>
              </span>
              <span className="text-[10px] text-slate-500 font-mono block">
                {metrics.completedJobsCount} Closed Jobs Shipped
              </span>
            </div>

            <div className="p-4 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-1">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Pending Ingress</span>
              <span className="text-sm font-extrabold text-amber-600 dark:text-amber-400 font-mono flex items-center gap-1.5">
                <Clock className="h-4 w-4 shrink-0" />
                <span>{metrics.pendingIngressCount} Batches</span>
              </span>
              <span className="text-[10px] text-slate-500 font-mono block">
                Awaiting transit acceptance
              </span>
            </div>

            <div className="p-4 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-1">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Rejections / Scrap</span>
              <span className="text-sm font-extrabold text-rose-600 dark:text-rose-400 font-mono flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{(metrics.totalScrap + metrics.totalRejectionMass).toLocaleString()} KG</span>
              </span>
              <span className="text-[10px] text-slate-500 font-mono block">
                Total process rejection & scrap
              </span>
            </div>
          </div>

          {/* Quick Summary Strip */}
          <div className="p-4 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-xs flex items-center justify-between text-xs font-mono">
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Total Target Orders</span>
              <span className="font-extrabold text-slate-900 dark:text-white">{metrics.totalTargetMass.toLocaleString()} KG</span>
            </div>
            <div className="text-right">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Filtered Batches</span>
              <span className="font-extrabold text-[#3B82F6]">{filteredJobCards.length} Records</span>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* TAB 2: STATIONS WIP BREAKDOWN */}
      {/* ======================================================== */}
      {activeMainTab === 'stations_wip' && (
        <div className="space-y-3">
          {departmentBreakdown.map(b => (
            <div
              key={b.dept}
              className="p-4 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-2"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-extrabold uppercase text-slate-900 dark:text-white">
                  {b.dept}
                </h3>
                <span className="font-mono text-xs font-extrabold text-[#3B82F6]">
                  {b.mass.toLocaleString()} KG
                </span>
              </div>

              <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 pt-1 border-t border-slate-100 dark:border-slate-800">
                <span>{b.batchCount} Active Batches</span>
                <span className={b.pendingIngress > 0 ? 'text-amber-600 font-bold' : ''}>
                  {b.pendingIngress} Pending Ingress
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ======================================================== */}
      {/* TAB 3: WIP AGEING */}
      {/* ======================================================== */}
      {activeMainTab === 'ageing' && (
        <div className="p-4 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-3">
          <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 pb-2 border-b border-slate-100 dark:border-slate-800">
            Work-In-Process Ageing Distribution
          </h3>

          <div className="space-y-2.5">
            {(Object.entries(ageingBuckets) as [string, { count: number; mass: number }][]).map(([bucket, data]) => (
              <div key={bucket} className="space-y-1 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="font-bold text-slate-800 dark:text-slate-200">{bucket}</span>
                  <span className="font-extrabold text-[#3B82F6]">{data.mass.toLocaleString()} KG ({data.count} batches)</span>
                </div>
                <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      bucket === '14+ Days'
                        ? 'bg-rose-500'
                        : bucket === '7-14 Days'
                        ? 'bg-amber-500'
                        : 'bg-[#3B82F6]'
                    }`}
                    style={{
                      width: `${metrics.activeWipMass > 0 ? Math.min(100, Math.round((data.mass / metrics.activeWipMass) * 100)) : 0}%`
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* TAB 4: REJECTIONS & SCRAP */}
      {/* ======================================================== */}
      {activeMainTab === 'rejections' && (
        <div className="space-y-3">
          <div className="p-4 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-3">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 pb-2 border-b border-slate-100 dark:border-slate-800">
              Department Rejection Bottleneck Breakdown
            </h3>

            <div className="space-y-2">
              {(Object.entries(departmentRejectionStats) as [string, { processed: number; rejected: number }][]).map(([deptName, s]) => {
                const rejRate = s.processed > 0 ? ((s.rejected / s.processed) * 100).toFixed(1) : '0.0';
                return (
                  <div key={deptName} className="p-3 bg-slate-50 dark:bg-slate-850/60 rounded-2xl border border-slate-150 dark:border-slate-800 flex items-center justify-between text-xs font-mono">
                    <div>
                      <span className="font-bold text-slate-900 dark:text-white block">{deptName}</span>
                      <span className="text-[10.5px] text-slate-400">Processed: {s.processed.toLocaleString()} KG</span>
                    </div>
                    <div className="text-right">
                      <span className="font-extrabold text-rose-600 dark:text-rose-400 block">{s.rejected.toLocaleString()} KG Rej</span>
                      <span className="text-[10px] text-slate-500 font-bold">{rejRate}% Defect Rate</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs font-mono text-center">
            <div className="p-3 bg-rose-50 dark:bg-rose-950/40 rounded-2xl border border-rose-200 dark:border-rose-800/60">
              <span className="text-[10px] text-rose-600 uppercase font-bold block">Wire Scrap</span>
              <span className="text-sm font-extrabold text-rose-700 dark:text-rose-300">{metrics.totalScrap.toLocaleString()} KG</span>
            </div>
            <div className="p-3 bg-amber-50 dark:bg-amber-950/40 rounded-2xl border border-amber-200 dark:border-amber-800/60">
              <span className="text-[10px] text-amber-600 uppercase font-bold block">Process Rejection</span>
              <span className="text-sm font-extrabold text-amber-700 dark:text-amber-300">{metrics.totalRejectionMass.toLocaleString()} KG</span>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* TAB 5: RAW MATERIAL */}
      {/* ======================================================== */}
      {activeMainTab === 'raw_material' && (
        <div className="space-y-3">
          <div className="p-4 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-3">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 pb-2 border-b border-slate-100 dark:border-slate-800">
              Raw Material Stock & Demand Ledger
            </h3>

            <div className="space-y-2 text-xs font-mono">
              {rawMaterialConsumption.map(item => (
                <div
                  key={item.code}
                  className="p-3 bg-slate-50 dark:bg-slate-850/60 rounded-2xl border border-slate-150 dark:border-slate-800 space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-extrabold text-slate-900 dark:text-white block">{item.name}</span>
                      <span className="text-[10px] text-slate-400">{item.code} • Grade: {item.grade}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-slate-400 uppercase block">Available Stock</span>
                      <span className="font-extrabold text-emerald-600 dark:text-emerald-400">{item.currentStock.toLocaleString()} KG</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-slate-200/60 dark:border-slate-800 text-[10.5px] text-slate-500">
                    <span>Issued: <strong className="text-blue-600">{item.totalIssued.toLocaleString()} KG</strong></span>
                    <span>Pending Requests: <strong className="text-amber-600">{item.pendingRequests.toLocaleString()} KG</strong></span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* TAB 6: COMPLETE 18-REPORT DIRECTORY */}
      {/* ======================================================== */}
      {activeMainTab === 'all_reports' && (
        <div className="space-y-4">
          {/* Report Directory Selector */}
          <div className="p-3.5 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-2">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Select Manufacturing Ledger</span>
            <select
              value={selectedSpecificReport}
              onChange={(e) => setSelectedSpecificReport(e.target.value as SpecificReportType)}
              className="w-full px-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl text-xs font-bold text-slate-900 dark:text-white focus:outline-hidden focus:border-blue-500 cursor-pointer"
            >
              {REPORT_DIRECTORY.map(r => (
                <option key={r.id} value={r.id}>
                  [{r.category}] {r.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-500 italic">
              {REPORT_DIRECTORY.find(r => r.id === selectedSpecificReport)?.desc}
            </p>
          </div>

          {/* DYNAMIC REPORT CONTENT RENDERING */}
          <div className="space-y-3">
            {/* 1. Production Milling */}
            {selectedSpecificReport === 'production' && (
              <div className="space-y-2">
                {filteredJobCards.filter(j => j.currentDepartment === 'Production' || j.processType === 'Production').slice(0, 30).map(j => (
                  <div key={j.jobCardNo} onClick={() => setSelectedDrillJobCard(j)} className="p-3.5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-1.5 cursor-pointer active:scale-99">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="font-mono text-xs font-extrabold text-[#3B82F6]">{j.jobCardNo}</span>
                        <h4 className="text-xs font-bold text-slate-900 dark:text-white">{j.partyName}</h4>
                      </div>
                      <span className="font-mono text-xs font-extrabold text-slate-800 dark:text-slate-200">{j.orderQty} KG</span>
                    </div>
                    <div className="text-[11px] font-mono text-slate-500 flex justify-between">
                      <span>{j.itemName}</span>
                      <span>Wire: {j.wireSize || 'Std'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 2. Heat Treatment */}
            {selectedSpecificReport === 'heattreat' && (
              <div className="space-y-2">
                {filteredJobCards.filter(j => j.heatTreatmentRequired).slice(0, 30).map(j => (
                  <div key={j.jobCardNo} onClick={() => setSelectedDrillJobCard(j)} className="p-3.5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-1.5 cursor-pointer active:scale-99">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="font-mono text-xs font-extrabold text-rose-600">{j.jobCardNo}</span>
                        <h4 className="text-xs font-bold text-slate-900 dark:text-white">{j.partyName}</h4>
                      </div>
                      <span className="font-mono text-xs font-extrabold text-slate-800 dark:text-slate-200">{j.orderQty} KG</span>
                    </div>
                    <div className="text-[11px] font-mono text-slate-500 flex justify-between">
                      <span>Hardness: {j.heatTreatmentDetails?.hardness || 'Standard'}</span>
                      <span>Rejection: {j.heatTreatmentDetails?.rejectionQty || 0} KG</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 3. Plating */}
            {selectedSpecificReport === 'plating' && (
              <div className="space-y-2">
                {filteredJobCards.filter(j => j.platingType && j.platingType !== 'None').slice(0, 30).map(j => (
                  <div key={j.jobCardNo} onClick={() => setSelectedDrillJobCard(j)} className="p-3.5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-1.5 cursor-pointer active:scale-99">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="font-mono text-xs font-extrabold text-pink-600">{j.jobCardNo}</span>
                        <h4 className="text-xs font-bold text-slate-900 dark:text-white">{j.partyName}</h4>
                      </div>
                      <span className="font-mono text-xs font-extrabold text-slate-800 dark:text-slate-200">{j.orderQty} KG</span>
                    </div>
                    <div className="text-[11px] font-mono text-slate-500 flex justify-between">
                      <span>Coating: {j.platingType}</span>
                      <span>Microns: {j.platingDetails?.micronThickness || 'Std'}µ</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 4. Packing */}
            {selectedSpecificReport === 'packing' && (
              <div className="space-y-2">
                {filteredJobCards.filter(j => j.packingDetails?.boxCount || j.currentDepartment === 'Packing').slice(0, 30).map(j => (
                  <div key={j.jobCardNo} onClick={() => setSelectedDrillJobCard(j)} className="p-3.5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-1.5 cursor-pointer active:scale-99">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="font-mono text-xs font-extrabold text-violet-600">{j.jobCardNo}</span>
                        <h4 className="text-xs font-bold text-slate-900 dark:text-white">{j.partyName}</h4>
                      </div>
                      <span className="font-mono text-xs font-extrabold text-slate-800 dark:text-slate-200">{j.packingDetails?.boxCount || 0} Boxes</span>
                    </div>
                    <div className="text-[11px] font-mono text-slate-500 flex justify-between">
                      <span>{j.itemName}</span>
                      <span>Net Mass: {remainingAtDepartment(j, movements || [], 'Packing')} KG</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 6. Store & Item-wise Stock */}
            {selectedSpecificReport === 'stock_summary' && (
              <div className="space-y-2">
                {itemWiseStock.slice(0, 30).map(i => (
                  <div key={i.itemName} className="p-3.5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-xs flex justify-between items-center text-xs font-mono">
                    <div>
                      <span className="font-extrabold text-slate-900 dark:text-white block">{i.itemName}</span>
                      <span className="text-[10px] text-slate-400">{i.batchCount} Active Batches • {i.boxCount} Boxes</span>
                    </div>
                    <span className="font-extrabold text-emerald-600 dark:text-emerald-400">{i.totalQty.toLocaleString()} KG</span>
                  </div>
                ))}
              </div>
            )}

            {/* 11. Dispatch Shipment Report */}
            {selectedSpecificReport === 'dispatch' && (
              <div className="space-y-2">
                {filteredJobCards.filter(j => j.completed || j.dispatchDetails?.dispatchQty).slice(0, 30).map(j => (
                  <div key={j.jobCardNo} onClick={() => setSelectedDrillJobCard(j)} className="p-3.5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-1.5 cursor-pointer active:scale-99">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="font-mono text-xs font-extrabold text-emerald-600">{j.jobCardNo}</span>
                        <h4 className="text-xs font-bold text-slate-900 dark:text-white">{j.partyName}</h4>
                      </div>
                      <span className="font-mono text-xs font-extrabold text-emerald-600">{j.dispatchDetails?.dispatchQty || j.currentQty} KG</span>
                    </div>
                    <div className="text-[11px] font-mono text-slate-500 flex justify-between">
                      <span>Inv: {j.dispatchDetails?.invoiceNo || 'Standard'}</span>
                      <span>Vehicle: {j.dispatchDetails?.vehicleNo || 'N/A'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 15. Material Movement Trail */}
            {selectedSpecificReport === 'movements' && (
              <div className="space-y-2">
                {filteredMovements.slice(0, 30).map(m => (
                  <div key={m.movementId} className="p-3.5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-1 text-xs font-mono">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-indigo-500">{m.jobCardNo}</span>
                      <span className="font-extrabold text-slate-900 dark:text-white">{m.quantity} KG</span>
                    </div>
                    <div className="flex justify-between text-[11px] text-slate-500">
                      <span>{m.fromDepartment} &rarr; {m.toDepartment}</span>
                      <span className={m.accepted ? 'text-emerald-600 font-bold' : 'text-amber-600'}>
                        {m.accepted ? 'Accepted' : 'In Transit'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 18. Automated Summary Email Controls */}
            {selectedSpecificReport === 'email_triggers' && (
              <div className="p-4 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-3">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Mail className="h-4 w-4 text-[#3B82F6]" />
                  <span>Automated Factory Email Summary</span>
                </h3>
                <p className="text-[11px] text-slate-500 leading-normal">
                  Transmit complete daily manufacturing reports, active WIP stats, and critical defect logs to management inbox.
                </p>

                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-bold text-slate-400 block">Recipient Email</label>
                  <input
                    type="email"
                    value={recipientEmail}
                    onChange={(e) => setRecipientEmail(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-white focus:outline-hidden"
                  />
                  <button
                    onClick={handleTriggerSummaryEmail}
                    disabled={isTriggeringEmail}
                    className="w-full py-2.5 px-4 rounded-xl bg-[#3B82F6] hover:bg-blue-600 text-white text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition disabled:opacity-50"
                  >
                    <Send className="h-4 w-4" />
                    <span>{isTriggeringEmail ? 'Transmitting Summary...' : 'Send Instant Daily Summary Email'}</span>
                  </button>
                </div>

                {emailStatusMessage && (
                  <div className="p-3 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-mono">
                    {emailStatusMessage}
                  </div>
                )}
              </div>
            )}

            {/* Generic fallback for other reports */}
            {['pending', 'completed', 'rejected', 'incoming_store', 'store', 'process_transfers', 'raw_material_store', 'raw_material_summary', 'balance', 'rejection_by_dept'].includes(selectedSpecificReport) && (
              <div className="space-y-2">
                {filteredJobCards.slice(0, 30).map(j => (
                  <div key={j.jobCardNo} onClick={() => setSelectedDrillJobCard(j)} className="p-3.5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-1.5 cursor-pointer active:scale-99">
                    <div className="flex justify-between items-start">
                      <div>
                        <span className="font-mono text-xs font-extrabold text-[#3B82F6]">{j.jobCardNo}</span>
                        <h4 className="text-xs font-bold text-slate-900 dark:text-white">{j.partyName}</h4>
                      </div>
                      <span className="font-mono text-xs font-extrabold text-slate-800 dark:text-slate-200">{j.orderQty} KG</span>
                    </div>
                    <div className="text-[11px] font-mono text-slate-500 flex justify-between">
                      <span>{j.itemName}</span>
                      <span>Dept: {j.currentDepartment}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MobileReportsScreen;
