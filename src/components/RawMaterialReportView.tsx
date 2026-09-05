import React, { useMemo } from 'react';
import { 
  FileText, 
  Printer, 
  TrendingUp, 
  Scale, 
  AlertTriangle, 
  CheckCircle, 
  Inbox, 
  BarChart4, 
  Calendar, 
  Users, 
  Download,
  Flame,
  Clock,
  ArrowDownToLine,
  Activity
} from 'lucide-react';
import { JobCard, MaterialMovement } from '../types';
import { INVENTORY_RAW_MATERIALS, getDynamicRawMaterialsStock } from './RawMaterialRequestModal';

interface RawMaterialReportViewProps {
  jobCards: JobCard[];
  movements: MaterialMovement[];
  startDate: string;
  endDate: string;
}

export default function RawMaterialReportView({
  jobCards,
  movements,
  startDate,
  endDate
}: RawMaterialReportViewProps) {

  // 1. Parse date bounds
  const startBound = useMemo(() => startDate ? new Date(startDate) : null, [startDate]);
  const endBound = useMemo(() => {
    if (!endDate) return null;
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    return end;
  }, [endDate]);

  // 2. Filter movements for raw material store requests
  const rawMaterialMovements = useMemo(() => {
    return movements.filter(m => {
      if (m.fromDepartment !== 'Raw Material Store' || !m.isIssueRequest) return false;
      
      const itemDate = m.transferDate ? new Date(m.transferDate) : null;
      if (!itemDate) return true;

      if (startBound && itemDate < startBound) return false;
      if (endBound && itemDate > endBound) return false;
      return true;
    });
  }, [movements, startBound, endBound]);

  // 3. Calculate dynamic consumption by raw material code
  const consumptionByCode = useMemo(() => {
    const consumption: Record<string, { code: string; name: string; issuedWeight: number; requestCount: number }> = {};
    
    // Initialize with inventory list items
    INVENTORY_RAW_MATERIALS.forEach(rm => {
      consumption[rm.code] = {
        code: rm.code,
        name: rm.name,
        issuedWeight: 0,
        requestCount: 0
      };
    });

    // Populate from movements (only issued)
    rawMaterialMovements.forEach(m => {
      const code = m.processDetails?.rawMaterialCode || 'GENERAL';
      const name = m.processDetails?.rawMaterialName || 'General Store Request';
      const isIssued = m.issueStatus === 'Issued';
      
      if (!consumption[code]) {
        consumption[code] = { code, name, issuedWeight: 0, requestCount: 0 };
      }

      consumption[code].requestCount += 1;
      if (isIssued) {
        consumption[code].issuedWeight += (m.quantity || m.requestedQty || 0);
      }
    });

    return Object.values(consumption).sort((a, b) => b.issuedWeight - a.issuedWeight);
  }, [rawMaterialMovements]);

  // 4. Calculate dynamic current stock levels
  const dynamicInventory = useMemo(() => {
    return getDynamicRawMaterialsStock(movements).map(item => {
      const opening = INVENTORY_RAW_MATERIALS.find(s => s.code === item.code)?.availableStock ?? item.availableStock;
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

      const currentStock = item.availableStock;
      const stockPercentage = opening > 0 ? (currentStock / opening) * 100 : 0;

      return {
        ...item,
        startingStock: opening,
        totalPurchased,
        totalIssued,
        totalRejected,
        currentStock,
        stockPercentage
      };
    });
  }, [movements]);

  // 5. Get pending material requests
  const pendingRequests = useMemo(() => {
    return rawMaterialMovements
      .filter(m => {
        const isRejected = m.issueStatus === 'Rejected' || m.remarks?.toLowerCase().includes('reject');
        const isIssued = m.issueStatus === 'Issued';
        return !isIssued && !isRejected;
      })
      .map(m => {
        const matchedCard = jobCards.find(jc => jc.jobCardNo.toLowerCase() === m.jobCardNo.toLowerCase());
        return {
          id: m.movementId,
          jobCardNo: m.jobCardNo,
          partyName: matchedCard?.partyName || 'Internal',
          itemName: matchedCard?.itemName || 'General Maintenance',
          materialName: m.processDetails?.rawMaterialName || 'Raw Material Spec',
          materialCode: m.processDetails?.rawMaterialCode || 'N/A',
          qty: m.requestedQty || m.quantity,
          urgency: m.processDetails?.urgency || 'Medium',
          requestedBy: m.processDetails?.requestedBy || m.transferBy || 'Production',
          date: m.transferDate || new Date().toISOString()
        };
      })
      .sort((a, b) => {
        const urgencyWeight = { 'Critical': 4, 'High': 3, 'Medium': 2, 'Low': 1 };
        const wA = urgencyWeight[a.urgency as keyof typeof urgencyWeight] || 0;
        const wB = urgencyWeight[b.urgency as keyof typeof urgencyWeight] || 0;
        return wB - wA; // Highest urgency first
      });
  }, [rawMaterialMovements, jobCards]);

  // 6. Overall Metrics
  const summaryMetrics = useMemo(() => {
    const totalCurrentStock = dynamicInventory.reduce((sum, item) => sum + item.currentStock, 0);
    const totalConsumption = dynamicInventory.reduce((sum, item) => sum + item.totalIssued, 0);
    const totalPendingCount = pendingRequests.length;
    
    const criticalPendingCount = pendingRequests.filter(r => r.urgency === 'Critical' || r.urgency === 'High').length;
    const lowStockItemsCount = dynamicInventory.filter(item => item.stockPercentage < 25).length;

    return {
      totalCurrentStock,
      totalConsumption,
      totalPendingCount,
      criticalPendingCount,
      lowStockItemsCount
    };
  }, [dynamicInventory, pendingRequests]);

  // Max value for scale in charts
  const maxIssuedWeight = useMemo(() => {
    const max = Math.max(...consumptionByCode.map(c => c.issuedWeight));
    return max > 0 ? max : 1000;
  }, [consumptionByCode]);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm overflow-hidden p-6 md:p-8 space-y-8 print:border-none print:shadow-none print:p-0">
      
      {/* Print Controls (Hidden during actual print) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-100 dark:border-slate-800 print:hidden">
        <div>
          <span className="text-[10px] bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 font-extrabold px-2.5 py-1 rounded-md uppercase tracking-wider">
            Premium Executive Report
          </span>
          <h3 className="font-sans font-extrabold text-slate-800 dark:text-white text-base uppercase tracking-wider mt-1.5 flex items-center gap-2">
            🪵 RAW MATERIAL STOCK & DEMAND AUDIT
          </h3>
          <p className="text-xs text-slate-450 mt-0.5">
            ISO-9001 Compliant audit summary of floor requisitions, consumption vectors, and physical bin balances.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handlePrint}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 text-white rounded-xl font-bold text-xs flex items-center gap-2 shadow-sm transition-all cursor-pointer"
          >
            <Printer className="h-4 w-4" />
            <span>Print / Save PDF</span>
          </button>
        </div>
      </div>

      {/* PDF Printable Header Block */}
      <div className="hidden print:flex justify-between items-start border-b-2 border-slate-900 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-2xl">🪵</span>
            <div>
              <h1 className="font-sans font-black text-slate-900 text-xl tracking-tight leading-none uppercase">
                REMIX MANUFACTURING CORP
              </h1>
              <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500 font-semibold mt-1">
                Central Inventory & Production Logistics Division
              </p>
            </div>
          </div>
          <p className="text-[10.5px] font-sans text-slate-600 mt-2.5 max-w-lg leading-relaxed">
            Raw Material Stores Ledger & Consumption Trend Audit Report. This document compiles verified steel alloy stock records, production floor requisitions, and pending fulfillment logs.
          </p>
        </div>
        <div className="text-right font-mono text-[10px] text-slate-600 space-y-1">
          <p className="font-bold text-slate-900">DOC-ID: RMX-RM-LGR</p>
          <p>Generated: {new Date().toLocaleDateString([], {year: 'numeric', month: 'long', day: 'numeric'})}</p>
          <p>Time: {new Date().toLocaleTimeString()}</p>
          <p className="italic text-[9px]">Period: {startDate || 'Beginning'} to {endDate || 'Today'}</p>
        </div>
      </div>

      {/* Audit Highlights (Executive KPIs) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 print:grid-cols-4">
        
        {/* KPI 1 */}
        <div className="bg-slate-50 dark:bg-slate-950/20 p-4 rounded-xl border border-slate-200/50 dark:border-slate-850 print:bg-slate-50 print:border-slate-200">
          <div className="flex items-center justify-between text-slate-400 dark:text-slate-500">
            <span className="text-[10px] font-bold uppercase tracking-wider font-mono">Store Balance</span>
            <Scale className="h-4 w-4 text-indigo-500" />
          </div>
          <h2 className="text-xl font-bold font-mono text-slate-900 dark:text-white mt-1.5 leading-none">
            {summaryMetrics.totalCurrentStock.toLocaleString()} <span className="text-xs">KG</span>
          </h2>
          <p className="text-[10px] text-slate-450 mt-1">
            Across {dynamicInventory.length} certified alloy specs
          </p>
        </div>

        {/* KPI 2 */}
        <div className="bg-slate-50 dark:bg-slate-950/20 p-4 rounded-xl border border-slate-200/50 dark:border-slate-850 print:bg-slate-50 print:border-slate-200">
          <div className="flex items-center justify-between text-slate-400 dark:text-slate-500">
            <span className="text-[10px] font-bold uppercase tracking-wider font-mono">Issued Weight</span>
            <TrendingUp className="h-4 w-4 text-emerald-500" />
          </div>
          <h2 className="text-xl font-bold font-mono text-slate-900 dark:text-white mt-1.5 leading-none">
            {summaryMetrics.totalConsumption.toLocaleString()} <span className="text-xs">KG</span>
          </h2>
          <p className="text-[10px] text-slate-450 mt-1">
            Total consumption this period
          </p>
        </div>

        {/* KPI 3 */}
        <div className="bg-slate-50 dark:bg-slate-950/20 p-4 rounded-xl border border-slate-200/50 dark:border-slate-850 print:bg-slate-50 print:border-slate-200">
          <div className="flex items-center justify-between text-slate-400 dark:text-slate-500">
            <span className="text-[10px] font-bold uppercase tracking-wider font-mono">Demand Queue</span>
            <Inbox className="h-4 w-4 text-amber-500" />
          </div>
          <h2 className="text-xl font-bold font-mono text-slate-900 dark:text-white mt-1.5 leading-none">
            {summaryMetrics.totalPendingCount} <span className="text-xs">REQS</span>
          </h2>
          <p className="text-[10px] text-slate-450 mt-1">
            {summaryMetrics.criticalPendingCount} flagged high/critical priority
          </p>
        </div>

        {/* KPI 4 */}
        <div className="bg-slate-50 dark:bg-slate-950/20 p-4 rounded-xl border border-slate-200/50 dark:border-slate-850 print:bg-slate-50 print:border-slate-200">
          <div className="flex items-center justify-between text-slate-400 dark:text-slate-500">
            <span className="text-[10px] font-bold uppercase tracking-wider font-mono">Low Stock Alerts</span>
            <AlertTriangle className={`h-4 w-4 ${summaryMetrics.lowStockItemsCount > 0 ? 'text-rose-500 animate-pulse' : 'text-slate-300'}`} />
          </div>
          <h2 className={`text-xl font-bold font-mono mt-1.5 leading-none ${summaryMetrics.lowStockItemsCount > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'}`}>
            {summaryMetrics.lowStockItemsCount} <span className="text-xs">SPECS</span>
          </h2>
          <p className="text-[10px] text-slate-450 mt-1">
            Below 25% safety reserve thresh
          </p>
        </div>
      </div>

      {/* SECTION 1: Dynamic Inventory Balances (Stock Levels) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-sans font-black text-xs text-slate-800 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
            <span className="text-indigo-600 dark:text-indigo-400">1.</span> PHYSICAL BIN STOCKS & ALLOY SPECIFICATIONS
          </h4>
          <span className="text-[10px] font-mono text-slate-400">Values in Kilograms (KG)</span>
        </div>

        <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-950 font-mono text-[9px] text-slate-500 dark:text-slate-400 uppercase tracking-widest border-b border-slate-200 dark:border-slate-800">
                <th className="py-2.5 px-3">RM Code</th>
                <th className="py-2.5 px-3">Material Specification Name</th>
                <th className="py-2.5 px-3">Category</th>
                <th className="py-2.5 px-3">Storage Bin</th>
                <th className="py-2.5 px-3 text-right">Initial Stock</th>
                <th className="py-2.5 px-3 text-right">Qty Inwarded</th>
                <th className="py-2.5 px-3 text-right">Qty Issued</th>
                <th className="py-2.5 px-3 text-right">Current Balance</th>
                <th className="py-2.5 px-4 text-center">Reserve Status</th>
              </tr>
            </thead>
            <tbody>
              {dynamicInventory.map(item => {
                const isLow = item.stockPercentage < 25;
                const isCrit = item.stockPercentage < 10;
                return (
                  <tr key={item.code} className="border-b last:border-b-0 border-slate-200 dark:border-slate-850 hover:bg-slate-50/40 dark:hover:bg-slate-850/25">
                    <td className="py-3 px-3 font-mono font-bold text-slate-900 dark:text-white">
                      <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
                        {item.code}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-medium text-slate-800 dark:text-slate-200">{item.name}</td>
                    <td className="py-3 px-3 text-slate-500 dark:text-slate-400">{item.category}</td>
                    <td className="py-3 px-3 font-mono font-semibold text-slate-600 dark:text-slate-350">{item.location}</td>
                    <td className="py-3 px-3 font-mono text-right text-slate-500">{item.startingStock.toLocaleString()}</td>
                    <td className="py-3 px-3 font-mono text-right text-indigo-650 dark:text-indigo-400 font-medium">
                      {item.totalPurchased > 0 ? `+${item.totalPurchased.toLocaleString()}` : '0'}
                    </td>
                    <td className="py-3 px-3 font-mono text-right text-emerald-650 dark:text-emerald-400 font-medium">
                      {item.totalIssued > 0 ? `-${item.totalIssued.toLocaleString()}` : '0'}
                    </td>
                    <td className="py-3 px-3 font-mono text-right font-bold text-slate-900 dark:text-white">
                      {item.currentStock.toLocaleString()}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2 justify-center">
                        <div className="w-16 bg-slate-100 dark:bg-slate-800 rounded-full h-2 overflow-hidden border border-slate-200/30">
                          <div 
                            className={`h-full rounded-full ${
                              isCrit ? 'bg-rose-600' : isLow ? 'bg-amber-500' : 'bg-emerald-500'
                            }`}
                            style={{ width: `${Math.min(100, item.stockPercentage)}%` }}
                          />
                        </div>
                        <span className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          isCrit 
                            ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400' 
                            : isLow 
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400' 
                            : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                        }`}>
                          {Math.round(item.stockPercentage)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* SECTION 2: Consumption Trends Graph & Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 print:grid-cols-12">
        
        {/* Left: Consumption bar-chart */}
        <div className="lg:col-span-7 space-y-3 print:col-span-7">
          <h4 className="font-sans font-black text-xs text-slate-800 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
            <span className="text-emerald-600 dark:text-emerald-400">2.</span> CONSUMPTION ANALYSIS (WEIGHT ISSUED)
          </h4>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Visual distribution of issued weights per alloy spec.
          </p>

          <div className="bg-slate-50 dark:bg-slate-950/30 border border-slate-200/60 dark:border-slate-850 p-4 rounded-xl space-y-3.5 print:bg-white print:border-none print:p-0">
            {consumptionByCode.map(c => {
              const percentageOfMax = maxIssuedWeight > 0 ? (c.issuedWeight / maxIssuedWeight) * 100 : 0;
              return (
                <div key={c.code} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono font-bold text-slate-800 dark:text-slate-200">{c.code}</span>
                    <span className="font-sans text-slate-400 text-[10.5px] truncate max-w-[200px] print:max-w-xs">{c.name}</span>
                    <span className="font-mono font-extrabold text-slate-900 dark:text-white">{c.issuedWeight.toLocaleString()} KG</span>
                  </div>
                  <div className="w-full bg-slate-200/50 dark:bg-slate-850 rounded-full h-3 overflow-hidden">
                    <div 
                      className="bg-indigo-600 h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.max(2, percentageOfMax)}%` }}
                    />
                  </div>
                </div>
              );
            })}

            {consumptionByCode.reduce((sum, item) => sum + item.issuedWeight, 0) === 0 && (
              <div className="text-center py-10 text-slate-400 italic">
                No active raw material dispatches recorded in selected date bounds.
              </div>
            )}
          </div>
        </div>

        {/* Right: Consumption Vector Table */}
        <div className="lg:col-span-5 space-y-3 print:col-span-5">
          <h4 className="font-sans font-black text-xs text-slate-800 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
            <span className="text-teal-600 dark:text-teal-400">3.</span> DEMAND VECTOR LEDGER
          </h4>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Fulfillment request count and ratios by specification.
          </p>

          <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-950 font-mono text-[9px] text-slate-500 dark:text-slate-400 uppercase tracking-widest border-b border-slate-200 dark:border-slate-800">
                  <th className="py-2.5 px-3">RM Code</th>
                  <th className="py-2.5 px-3 text-right">Req. Count</th>
                  <th className="py-2.5 px-3 text-right">Avg / Req</th>
                </tr>
              </thead>
              <tbody>
                {consumptionByCode.slice(0, 6).map(item => {
                  const avgPerRequest = item.requestCount > 0 ? Math.round(item.issuedWeight / item.requestCount) : 0;
                  return (
                    <tr key={item.code} className="border-b last:border-b-0 border-slate-200 dark:border-slate-850 hover:bg-slate-50/40">
                      <td className="py-2.5 px-3 font-mono font-bold text-slate-800 dark:text-slate-200">{item.code}</td>
                      <td className="py-2.5 px-3 font-mono text-right text-slate-600 dark:text-slate-400">{item.requestCount}</td>
                      <td className="py-2.5 px-3 font-mono text-right text-slate-900 dark:text-white font-semibold">
                        {avgPerRequest > 0 ? `${avgPerRequest.toLocaleString()} KG` : 'N/A'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      {/* SECTION 3: Current Pending Requests */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-sans font-black text-xs text-slate-800 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
            <span className="text-amber-600 dark:text-amber-400">4.</span> OUTSTANDING WORKSTATION DEMANDS & REQUISITIONS
          </h4>
          <span className="text-[10px] bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 font-extrabold px-2 py-0.5 rounded font-mono">
            {pendingRequests.length} Pending Approval
          </span>
        </div>

        <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-950 font-mono text-[9px] text-slate-500 dark:text-slate-400 uppercase tracking-widest border-b border-slate-200 dark:border-slate-800">
                <th className="py-2.5 px-3">Job Card No</th>
                <th className="py-2.5 px-3">Linked Order</th>
                <th className="py-2.5 px-3">Requested Spec</th>
                <th className="py-2.5 px-3 text-right">Required Qty</th>
                <th className="py-2.5 px-3 text-center">Urgency</th>
                <th className="py-2.5 px-3">Requested By</th>
                <th className="py-2.5 px-3">Req Date</th>
              </tr>
            </thead>
            <tbody>
              {pendingRequests.map(req => {
                const isCrit = req.urgency === 'Critical';
                const isHigh = req.urgency === 'High';
                return (
                  <tr key={req.id} className="border-b last:border-b-0 border-slate-200 dark:border-slate-850 hover:bg-slate-50/40">
                    <td className="py-3 px-3 font-mono font-bold text-indigo-600 dark:text-indigo-400">
                      {req.jobCardNo}
                    </td>
                    <td className="py-3 px-3">
                      <div className="font-sans text-slate-800 dark:text-slate-200 font-semibold">{req.partyName}</div>
                      <div className="text-[10px] text-slate-400">{req.itemName}</div>
                    </td>
                    <td className="py-3 px-3 font-medium text-slate-800 dark:text-slate-200">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[10px] bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded text-slate-550 font-bold border border-slate-200/50">
                          {req.materialCode}
                        </span>
                        <span>{req.materialName}</span>
                      </div>
                    </td>
                    <td className="py-3 px-3 font-mono text-right font-bold text-slate-900 dark:text-white">
                      {req.qty.toLocaleString()} KG
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex justify-center">
                        <span className={`px-2 py-0.5 rounded text-[9.5px] font-black uppercase tracking-wider ${
                          isCrit 
                            ? 'bg-rose-50 text-rose-700 border border-rose-200/50 dark:bg-rose-950/40 dark:text-rose-400' 
                            : isHigh 
                            ? 'bg-amber-50 text-amber-700 border border-amber-200/50 dark:bg-amber-950/40 dark:text-amber-400' 
                            : 'bg-slate-100 text-slate-600 border border-slate-200/50 dark:bg-slate-800 dark:text-slate-400'
                        }`}>
                          {req.urgency}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-slate-600 dark:text-slate-350">{req.requestedBy}</td>
                    <td className="py-3 px-3 text-slate-450 font-mono text-[10.5px]">
                      {new Date(req.date).toLocaleDateString([], {month: 'short', day: 'numeric', hour: '2-digit', minute:'2-digit'})}
                    </td>
                  </tr>
                );
              })}

              {pendingRequests.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-slate-400 font-sans italic border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                    No pending raw material demands currently registered.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* SECTION 4: Professional Signature / Verification Block (Print only) */}
      <div className="hidden print:grid grid-cols-2 gap-12 mt-16 pt-10 border-t border-slate-350">
        <div className="space-y-6">
          <p className="text-[10px] font-sans text-slate-550 leading-relaxed">
            I hereby certify that the consumption summaries and physical store balances listed above correspond to verified mill allocations and scale receipts.
          </p>
          <div className="flex justify-between items-end border-b border-slate-400 pb-1.5 pt-4">
            <span className="text-[10px] font-mono font-bold text-slate-700">Production Dept. Head Sign-off</span>
            <span className="text-[9.5px] font-mono text-slate-400">Date: ____/____/2026</span>
          </div>
        </div>

        <div className="space-y-6">
          <p className="text-[10px] font-sans text-slate-550 leading-relaxed">
            Store Custodian confirmation of material issue compliance, reserve status warnings, and visual bin audit placement reconciliation.
          </p>
          <div className="flex justify-between items-end border-b border-slate-400 pb-1.5 pt-4">
            <span className="text-[10px] font-mono font-bold text-slate-700">Central Stores Custodian Signature</span>
            <span className="text-[9.5px] font-mono text-slate-400">Date: ____/____/2026</span>
          </div>
        </div>
      </div>

    </div>
  );
}
