import React, { useState } from 'react';
import { X, Printer, FileText, CheckSquare, Calendar, User, Hash, HelpCircle, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { JobCard, MaterialMovement, UserProfile } from '../types';
import { getJobCardProcessMetrics } from '../lib/metrics';

type SortColumn = 'jobCardNo' | 'partyName' | 'itemName' | 'orderQty' | 'currentDepartment';
type SortDirection = 'asc' | 'desc';

interface BulkPrintManifestModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedJobCards: JobCard[];
  movements: MaterialMovement[];
  currentUser: UserProfile | null;
}

export default function BulkPrintManifestModal({
  isOpen,
  onClose,
  selectedJobCards,
  movements,
  currentUser
}: BulkPrintManifestModalProps) {
  // Option toggles for the user before printing
  const [showPartyName, setShowPartyName] = useState(true);
  const [showOrderQty, setShowOrderQty] = useState(true);
  const [showStatus, setShowStatus] = useState(true);
  const [showRemarksColumn, setShowRemarksColumn] = useState(true);
  const [customTitle, setCustomTitle] = useState('Production Routing & Batch Transfer Manifest');

  // Sorting state
  const [sortColumn, setSortColumn] = useState<SortColumn>('partyName');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  if (!isOpen) return null;

  // Sort handler
  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  // Compute sorted job cards
  const sortedJobCards = [...selectedJobCards].sort((a, b) => {
    let valA: string | number = '';
    let valB: string | number = '';

    switch (sortColumn) {
      case 'jobCardNo':
        return sortDirection === 'asc'
          ? a.jobCardNo.localeCompare(b.jobCardNo, undefined, { numeric: true })
          : b.jobCardNo.localeCompare(a.jobCardNo, undefined, { numeric: true });
      case 'partyName':
        valA = a.partyName || '';
        valB = b.partyName || '';
        break;
      case 'itemName':
        valA = a.itemName || '';
        valB = b.itemName || '';
        break;
      case 'orderQty':
        valA = a.orderQty || 0;
        valB = b.orderQty || 0;
        break;
      case 'currentDepartment':
        valA = a.currentDepartment || 'Production';
        valB = b.currentDepartment || 'Production';
        break;
    }

    if (typeof valA === 'number' && typeof valB === 'number') {
      return sortDirection === 'asc' ? valA - valB : valB - valA;
    }

    return sortDirection === 'asc'
      ? String(valA).localeCompare(String(valB))
      : String(valB).localeCompare(String(valA));
  });

  // Manifest Metadata
  const manifestId = `MNF-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
  const printedAtStr = new Date().toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });

  const handlePrint = () => {
    window.print();
  };

  // Compute stats
  const totalQty = selectedJobCards.reduce((acc, curr) => acc + curr.orderQty, 0);

  const renderSortHeader = (col: SortColumn, label: string, align: 'left' | 'center' | 'right' = 'left', extraClasses: string = '') => {
    const isActive = sortColumn === col;
    return (
      <th 
        onClick={() => handleSort(col)}
        className={`py-2.5 px-2 select-none cursor-pointer hover:bg-slate-200/70 transition group ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'} ${extraClasses}`}
        title={`Click to sort by ${label} (${isActive && sortDirection === 'asc' ? 'Descending' : 'Ascending'})`}
      >
        <div className={`inline-flex items-center gap-1 ${align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'}`}>
          <span>{label}</span>
          <span className="print:hidden">
            {isActive ? (
              sortDirection === 'asc' ? (
                <ArrowUp className="h-3 w-3 text-indigo-600 dark:text-indigo-400 font-bold" />
              ) : (
                <ArrowDown className="h-3 w-3 text-indigo-600 dark:text-indigo-400 font-bold" />
              )
            ) : (
              <ArrowUpDown className="h-2.5 w-2.5 text-slate-350 group-hover:text-slate-600 transition" />
            )}
          </span>
        </div>
      </th>
    );
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto animate-fade-in" id="bulk_print_modal">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-4xl w-full overflow-hidden shadow-2xl relative my-8 flex flex-col max-h-[90vh]">
        
        {/* Header - Interactive Preview Configuration (Hidden on Print) */}
        <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/40 shrink-0 select-none print:hidden">
          <div className="flex items-center gap-2">
            <Printer className="h-5 w-5 text-indigo-500" />
            <h3 className="font-sans font-bold text-base text-slate-800 dark:text-white uppercase tracking-wider">
              Print Selection Manifest Preview
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-400 hover:text-slate-600 dark:hover:text-slate-250 transition cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Configuration Toolbar (Hidden on Print) */}
        <div className="p-4 bg-slate-50 dark:bg-slate-950/40 border-b border-slate-200 dark:border-slate-850 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs print:hidden">
          {/* Left: Toggles */}
          <div className="space-y-2 md:col-span-2">
            <span className="font-bold uppercase tracking-wider text-slate-450 text-[10px]">Customize Columns</span>
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-slate-700 dark:text-slate-300">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showPartyName}
                  onChange={(e) => setShowPartyName(e.target.checked)}
                  className="rounded border-slate-300 dark:border-slate-700 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5 accent-indigo-600"
                />
                Party Name
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showOrderQty}
                  onChange={(e) => setShowOrderQty(e.target.checked)}
                  className="rounded border-slate-300 dark:border-slate-700 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5 accent-indigo-600"
                />
                Order Qty
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showStatus}
                  onChange={(e) => setShowStatus(e.target.checked)}
                  className="rounded border-slate-300 dark:border-slate-700 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5 accent-indigo-600"
                />
                Process Metrics
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showRemarksColumn}
                  onChange={(e) => setShowRemarksColumn(e.target.checked)}
                  className="rounded border-slate-300 dark:border-slate-700 text-indigo-600 focus:ring-indigo-500 h-3.5 w-3.5 accent-indigo-600"
                />
                Physical Verification Column
              </label>
            </div>
          </div>

          {/* Right: Sort By Selector & Custom Title */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block font-bold uppercase tracking-wider text-slate-450 text-[10px]">Sort Order</label>
              <button 
                onClick={() => setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')}
                className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
              >
                {sortDirection === 'asc' ? 'Ascending (A-Z / 1-9)' : 'Descending (Z-A / 9-1)'}
              </button>
            </div>
            <select
              value={sortColumn}
              onChange={(e) => setSortColumn(e.target.value as SortColumn)}
              className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3 py-1.5 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="partyName">Party Name</option>
              <option value="currentDepartment">Current Department</option>
              <option value="jobCardNo">Job Card No</option>
              <option value="itemName">Item Name</option>
              <option value="orderQty">Order Quantity</option>
            </select>
          </div>
        </div>

        {/* Title Editor toolbar */}
        <div className="px-4 py-2 bg-slate-100/50 dark:bg-slate-900/30 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2 text-xs print:hidden">
          <label className="font-bold uppercase tracking-wider text-slate-450 text-[10px] shrink-0">Manifest Title:</label>
          <input
            type="text"
            value={customTitle}
            onChange={(e) => setCustomTitle(e.target.value)}
            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3 py-1 rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-500"
            placeholder="Manifest heading banner..."
          />
        </div>

        {/* Manifest Preview Wrapper (Visible on screen, formatted for printing with ID bulk-manifest-printable-area) */}
        <div className="flex-1 overflow-y-auto bg-slate-50 dark:bg-slate-950 p-6 sm:p-10" id="bulk-manifest-printable-area">
          <div className="bg-white text-slate-900 p-8 sm:p-10 border border-slate-200 shadow-sm max-w-3xl mx-auto rounded-xl print:border-none print:shadow-none print:p-0 print:m-0 font-sans text-xs">
            
            {/* Manifest Header */}
            <div className="border-b-2 border-slate-900 pb-5 mb-6">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="bg-slate-900 text-white font-extrabold px-2 py-0.5 rounded text-[10px] tracking-widest uppercase">
                      OFFICIAL MANIFEST
                    </span>
                    <span className="font-mono text-slate-500 font-bold tracking-wider text-[11px]">{manifestId}</span>
                  </div>
                  <h1 className="text-xl font-extrabold text-slate-900 tracking-tight uppercase leading-none">
                    {customTitle || 'Production Routing & Batch Transfer Manifest'}
                  </h1>
                </div>
                <div className="text-right sm:text-right text-[10px] space-y-1 font-semibold text-slate-600 bg-slate-50 p-3 rounded-xl border border-slate-200/50 print:bg-transparent print:border-none">
                  <div className="flex items-center justify-end gap-1.5">
                    <Calendar className="h-3 w-3 text-slate-400" />
                    <span>Date: <strong className="text-slate-850">{printedAtStr}</strong></span>
                  </div>
                  <div className="flex items-center justify-end gap-1.5">
                    <User className="h-3 w-3 text-slate-400" />
                    <span>By: <strong className="text-slate-850">{currentUser?.name || 'Staff User'}</strong></span>
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Summary Cards */}
            <div className="grid grid-cols-3 gap-4 mb-6 border-b border-slate-200 pb-5">
              <div className="bg-slate-50/70 p-3 rounded-xl border border-slate-150 print:bg-transparent">
                <span className="text-[9px] uppercase tracking-wider font-bold text-slate-500 block mb-0.5">Total Selected Batches</span>
                <strong className="text-base font-black text-slate-900 font-mono">{selectedJobCards.length}</strong>
              </div>
              <div className="bg-slate-50/70 p-3 rounded-xl border border-slate-150 print:bg-transparent">
                <span className="text-[9px] uppercase tracking-wider font-bold text-slate-500 block mb-0.5">Accumulated Order Weight</span>
                <strong className="text-base font-black text-slate-900 font-mono">{totalQty.toLocaleString()} KG</strong>
              </div>
              <div className="bg-slate-50/70 p-3 rounded-xl border border-slate-150 print:bg-transparent">
                <span className="text-[9px] uppercase tracking-wider font-bold text-slate-500 block mb-0.5">Authentication Code</span>
                <strong className="text-xs font-bold font-mono text-slate-900 block mt-1 select-all">{manifestId.split('-')[2]}</strong>
              </div>
            </div>

            {/* Main Manifest Grid Table */}
            <div className="overflow-x-auto mb-8">
              <table className="w-full text-left border-collapse text-[11px] text-slate-800">
                <thead>
                  <tr className="border-b-2 border-slate-800 text-[10px] text-slate-700 uppercase font-bold bg-slate-50/50">
                    <th className="py-2.5 px-2 text-center w-8">#</th>
                    {renderSortHeader('jobCardNo', 'Job Card No', 'left', 'w-28')}
                    {showPartyName && renderSortHeader('partyName', 'Party Name', 'left')}
                    {renderSortHeader('itemName', 'Item Specifications / Details', 'left')}
                    {showOrderQty && renderSortHeader('orderQty', 'Order Qty', 'right', 'w-24')}
                    {showStatus && renderSortHeader('currentDepartment', 'Current Stage', 'center', 'w-28')}
                    {showRemarksColumn && <th className="py-2.5 px-2 w-32 border-l border-slate-200 text-center">Verification Notes</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {sortedJobCards.map((j, idx) => {
                    const m = getJobCardProcessMetrics(j, movements);
                    return (
                      <tr key={j.jobCardNo} className="hover:bg-slate-50/20">
                        <td className="py-3 px-2 text-center font-mono text-slate-500 font-semibold">{idx + 1}</td>
                        <td className="py-3 px-2 font-mono font-black text-slate-900">{j.jobCardNo}</td>
                        {showPartyName && (
                          <td className="py-3 px-2 font-bold text-slate-800 max-w-[120px] truncate" title={j.partyName}>
                            {j.partyName}
                          </td>
                        )}
                        <td className="py-3 px-2">
                          <p className="font-bold text-slate-900 leading-tight">{j.itemName}</p>
                          <p className="text-[9px] text-slate-450 font-mono mt-0.5">Item Code: {j.itemCode}</p>
                        </td>
                        {showOrderQty && (
                          <td className="py-3 px-2 text-right font-mono font-bold text-slate-900">
                            {j.orderQty.toLocaleString()} KG
                          </td>
                        )}
                        {showStatus && (
                          <td className="py-3 px-2 text-center">
                            <span className="font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded text-[9px] uppercase">
                              {j.currentDepartment || 'Production'}
                            </span>
                            {j.heatTreatmentRequired && (
                              <span className="block text-[8px] uppercase font-bold text-amber-700 mt-1">
                                HT REQUIRED
                              </span>
                            )}
                          </td>
                        )}
                        {showRemarksColumn && (
                          <td className="py-3 px-2 border-l border-slate-150 align-middle">
                            <div className="flex flex-col gap-2.5">
                              {/* Empty line for physical checkmark, or manual weights */}
                              <div className="flex items-center gap-1.5">
                                <div className="h-4 w-4 rounded border border-slate-400 shrink-0" />
                                <span className="text-[9px] text-slate-400 italic font-mono">Counted</span>
                              </div>
                              <div className="h-4 border-b border-dashed border-slate-300 w-full" />
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Instruction Warning and Disclaimer Section */}
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-150 text-[10px] text-slate-500 mb-8 space-y-1.5 leading-relaxed print:bg-transparent print:border-slate-300">
              <h5 className="font-bold text-slate-700 uppercase tracking-wider text-[9px]">Floor Routing Compliance Instructions</h5>
              <p>
                1. Please verify batch sizes physically before loading onto transport trolleys or executing physical department-to-department transfers.
              </p>
              <p>
                2. Verify that heat-treated components comply with specified microhardness test guidelines. Do not route HT-labeled job cards directly to plating without an authorized metallurgist's validation tag.
              </p>
              <p>
                3. Signed copy of this transfer manifest must accompany material containers and be verified at the destination department.
              </p>
            </div>

            {/* Signature Authorizations (Perfect for Printed Manifests) */}
            <div className="grid grid-cols-3 gap-8 pt-10 border-t border-slate-200 mt-12 text-[10px] text-slate-500">
              <div className="space-y-10">
                <div className="h-0.5 bg-slate-200 w-full" />
                <div className="text-center">
                  <strong className="text-slate-800 block uppercase font-bold text-[9px]">Authorized Issuer</strong>
                  <span className="font-mono mt-0.5 block">{currentUser?.name || 'Staff Signature'}</span>
                </div>
              </div>
              <div className="space-y-10">
                <div className="h-0.5 bg-slate-200 w-full" />
                <div className="text-center">
                  <strong className="text-slate-800 block uppercase font-bold text-[9px]">Floor Dispatcher</strong>
                  <span className="mt-0.5 block">Signature & Date</span>
                </div>
              </div>
              <div className="space-y-10">
                <div className="h-0.5 bg-slate-200 w-full" />
                <div className="text-center">
                  <strong className="text-slate-800 block uppercase font-bold text-[9px]">Receiving Supervisor</strong>
                  <span className="mt-0.5 block">Signature & Date</span>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Footer actions - Print / Cancel (Hidden on Print) */}
        <div className="p-5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 flex items-center gap-2.5 shrink-0 print:hidden">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-850 text-slate-700 dark:text-slate-300 font-bold transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handlePrint}
            className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold transition flex items-center justify-center gap-1.5 shadow-sm shadow-indigo-600/10 cursor-pointer"
          >
            <Printer className="h-4 w-4" />
            <span>Open Browser Print Dialog</span>
          </button>
        </div>
      </div>
    </div>
  );
}
