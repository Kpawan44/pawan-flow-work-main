import React from 'react';
import { X, Layers, Factory, Sparkles, Package, Store, CheckCircle2, Info } from 'lucide-react';
import { JobCard, MaterialMovement } from '../types';
import { getJobCardProcessMetrics, getJobCardDepartmentPending } from '../lib/metrics';

interface PendingBreakdownModalProps {
  jobCard: JobCard;
  movements: MaterialMovement[];
  onClose: () => void;
}

export default function PendingBreakdownModal({ jobCard, movements, onClose }: PendingBreakdownModalProps) {
  const m = getJobCardProcessMetrics(jobCard, movements);
  const deptPending = getJobCardDepartmentPending(jobCard, movements);

  const isPurchase = jobCard.processType === 'Purchase';

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in print:hidden">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl w-full max-w-md overflow-hidden transition-all transform scale-100">
        
        {/* Header */}
        <div className="p-5 border-b border-slate-150 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-2xl border border-amber-500/20">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-xs text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 px-2 py-0.5 rounded border border-indigo-200 dark:border-indigo-800/50">
                  {jobCard.jobCardNo}
                </span>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Pending Breakdown
                </span>
              </div>
              <h3 className="text-sm font-bold text-slate-850 dark:text-slate-100 mt-0.5 truncate max-w-[240px]">
                {jobCard.partyName}
              </h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4">
          {/* Main Summary Metric */}
          <div className="p-4 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/20 border border-amber-200/80 dark:border-amber-800/40 rounded-2xl flex items-center justify-between">
            <div>
              <span className="text-[10px] font-extrabold text-amber-700 dark:text-amber-400 uppercase tracking-wider block">
                Total Pending (Prod to Packing)
              </span>
              <span className="text-2xl font-black font-mono text-amber-900 dark:text-amber-200 mt-0.5 block">
                {deptPending.totalPending.toLocaleString()} <span className="text-xs font-normal text-amber-700 dark:text-amber-400">KG</span>
              </span>
            </div>
            <div className="text-right">
              <span className="text-[10px] text-slate-400 uppercase font-bold block">Target Order Qty</span>
              <span className="text-sm font-bold font-mono text-slate-700 dark:text-slate-300">
                {jobCard.orderQty.toLocaleString()} KG
              </span>
            </div>
          </div>

          <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1.5 px-1">
            <Info className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
            <span>Breakdown of quantity pending at shopfloor departments (Excluding Store):</span>
          </div>

          {/* Department Breakdown Cards */}
          <div className="space-y-2.5">
            {/* Production / HT */}
            <div className="p-3.5 rounded-2xl bg-blue-50/60 dark:bg-blue-950/20 border border-blue-200/60 dark:border-blue-900/40 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-xl">
                  <Factory className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    {isPurchase ? 'Purchase / Incoming' : 'Production / Machining'}
                  </h4>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">
                    {isPurchase ? 'Received or awaiting HT' : 'Machining stage before Plating'}
                  </p>
                </div>
              </div>
              <div className="text-right font-mono">
                <span className="text-sm font-extrabold text-blue-700 dark:text-blue-300 block">
                  {deptPending.prodPending.toLocaleString()} KG
                </span>
                <span className="text-[9px] text-slate-400">
                  {deptPending.prodPending > 0 ? 'Pending' : 'Cleared'}
                </span>
              </div>
            </div>

            {/* Plating */}
            <div className="p-3.5 rounded-2xl bg-purple-50/60 dark:bg-purple-950/20 border border-purple-200/60 dark:border-purple-900/40 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-500/10 text-purple-600 dark:text-purple-400 rounded-xl">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    Plating / Coating
                  </h4>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">
                    Surface treatment stage before Packing
                  </p>
                </div>
              </div>
              <div className="text-right font-mono">
                <span className="text-sm font-extrabold text-purple-700 dark:text-purple-300 block">
                  {deptPending.platingPending.toLocaleString()} KG
                </span>
                <span className="text-[9px] text-slate-400">
                  {deptPending.platingPending > 0 ? 'Pending' : 'Cleared'}
                </span>
              </div>
            </div>

            {/* Packing */}
            <div className="p-3.5 rounded-2xl bg-pink-50/60 dark:bg-pink-950/20 border border-pink-200/60 dark:border-pink-900/40 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-pink-500/10 text-pink-600 dark:text-pink-400 rounded-xl">
                  <Package className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    Packing & Box Count
                  </h4>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">
                    Boxing stage before Store release
                  </p>
                </div>
              </div>
              <div className="text-right font-mono">
                <span className="text-sm font-extrabold text-pink-700 dark:text-pink-300 block">
                  {deptPending.packingPending.toLocaleString()} KG
                </span>
                <span className="text-[9px] text-slate-400">
                  {deptPending.packingPending > 0 ? 'Pending' : 'Cleared'}
                </span>
              </div>
            </div>
          </div>

          {/* Additional reference metrics (Store & Dispatch) */}
          <div className="pt-3 border-t border-slate-150 dark:border-slate-800 grid grid-cols-2 gap-2 text-[11px] font-mono">
            <div className="p-2.5 rounded-xl bg-emerald-50/40 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Store className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                <span className="text-slate-600 dark:text-slate-300 font-sans font-medium text-[10px]">In Store Stock:</span>
              </div>
              <span className="font-bold text-emerald-700 dark:text-emerald-300">
                {m.qtyRemainingInStock.toLocaleString()} KG
              </span>
            </div>

            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-indigo-500" />
                <span className="text-slate-600 dark:text-slate-300 font-sans font-medium text-[10px]">Dispatched:</span>
              </div>
              <span className="font-bold text-slate-700 dark:text-slate-300">
                {m.qtyDispatched.toLocaleString()} KG
              </span>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-150 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/30 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 text-white rounded-xl text-xs font-bold transition cursor-pointer"
          >
            Close Breakdown
          </button>
        </div>

      </div>
    </div>
  );
}
