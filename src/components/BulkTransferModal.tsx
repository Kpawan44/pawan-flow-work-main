import React, { useState, useEffect } from 'react';
import { X, ArrowRight, Save, Info, AlertTriangle, ArrowUpDown, ChevronDown } from 'lucide-react';
import { JobCard, MaterialMovement, Department, UserProfile } from '../types';
import { getJobCardProcessMetrics } from '../lib/metrics';

interface BulkTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedJobCards: JobCard[];
  movements: MaterialMovement[];
  currentUser: UserProfile | null;
  onSubmit: (transfers: {
    jobCardNo: string;
    fromDepartment: Department;
    toDepartment: Department | 'Completed';
    quantity: number;
    remarks?: string;
  }[]) => Promise<void>;
}

// Helper to determine the next logical department step
const getNextLogicalDepartment = (from: Department, htRequired: boolean, jCard?: JobCard | null): Department | 'Completed' => {
  if (from === 'Purchase') {
    const matType = jCard?.materialType || jCard?.outsourceDetails?.outsourceMaterialType;
    if (matType === 'Finished Goods') {
      return 'Packing';
    } else {
      return htRequired ? 'Heat Treatment' : 'Production';
    }
  }
  if (from === 'Production') return htRequired ? 'Heat Treatment' : 'Plating';
  if (from === 'Heat Treatment') return 'Plating';
  if (from === 'Plating') return 'Packing';
  if (from === 'Packing') return 'Store';
  if (from === 'Store') return 'Dispatch';
  if (from === 'Dispatch') return 'Completed';
  return 'Completed';
};

// Helper to compute available weight
const getAvailableWeight = (jobCard: JobCard, movements: MaterialMovement[]): number => {
  const current = jobCard.currentDepartment;
  const fromDept = (current === 'Completed' || !current) ? 'Production' : (current as Department);
  const m = getJobCardProcessMetrics(jobCard, movements);
  
  if (fromDept === 'Production') {
    return m.qtyRemainingAtProd > 0 ? m.qtyRemainingAtProd : jobCard.orderQty;
  } else if (fromDept === 'Heat Treatment') {
    const remainingAtHt = Math.max(0, m.qtyReceivedFromProd - m.qtyRoutedToPlating - m.htRejections);
    return remainingAtHt > 0 ? remainingAtHt : jobCard.orderQty;
  } else if (fromDept === 'Plating') {
    return m.qtyRemainingAtPlating > 0 ? m.qtyRemainingAtPlating : jobCard.orderQty;
  } else if (fromDept === 'Packing') {
    return m.qtyRemainingAtPacking > 0 ? m.qtyRemainingAtPacking : jobCard.orderQty;
  } else if (fromDept === 'Store') {
    return m.qtyRemainingInStock > 0 ? m.qtyRemainingInStock : jobCard.orderQty;
  } else {
    const totalTransferred = movements
      .filter(mov => mov.jobCardNo.toLowerCase() === jobCard.jobCardNo.toLowerCase())
      .reduce((acc, curr) => acc + curr.quantity, 0);
    return Math.max(0, jobCard.orderQty - totalTransferred);
  }
};

export default function BulkTransferModal({
  isOpen,
  onClose,
  selectedJobCards,
  movements,
  currentUser,
  onSubmit
}: BulkTransferModalProps) {
  const [toDept, setToDept] = useState<Department | 'Completed'>('Heat Treatment');
  const [remarks, setRemarks] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string>('');
  
  // Keep track of quantities per job card in a state dictionary
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  // Filter out any selected job cards that are already Completed
  const activeSelectedCards = selectedJobCards.filter(j => j.currentDepartment !== 'Completed');

  // Initialize target department and individual transfer weights
  useEffect(() => {
    if (!isOpen || activeSelectedCards.length === 0) return;

    setError('');
    setRemarks('');

    // Pre-fill target department using the next logical step of the first selected job card
    const firstCard = activeSelectedCards[0];
    const initialFromDept = (firstCard.currentDepartment === 'Completed' || !firstCard.currentDepartment) 
      ? 'Production' 
      : (firstCard.currentDepartment as Department);
    
    const nextTarget = getNextLogicalDepartment(initialFromDept, firstCard.heatTreatmentRequired, firstCard);
    setToDept(nextTarget);

    // Initialize quantities with the available weight for each job card
    const initialQtys: Record<string, number> = {};
    activeSelectedCards.forEach(j => {
      initialQtys[j.jobCardNo] = getAvailableWeight(j, movements);
    });
    setQuantities(initialQtys);
  }, [isOpen, selectedJobCards, movements]);

  if (!isOpen) return null;

  const handleQtyChange = (jobCardNo: string, val: number) => {
    setQuantities(prev => ({
      ...prev,
      [jobCardNo]: val < 0 ? 0 : val
    }));
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (activeSelectedCards.length === 0) {
      setError('No transferrable job cards selected (exclude completed job cards).');
      return;
    }

    // Prepare transfer payload
    const transfersPayload = [];
    for (const j of activeSelectedCards) {
      const qty = quantities[j.jobCardNo] || 0;
      if (qty <= 0) {
        setError(`Please specify a positive material transfer weight for Job Card ${j.jobCardNo}.`);
        return;
      }

      const fromDept = (j.currentDepartment as Department) || 'Production';
      if (fromDept === toDept) {
        setError(`Job Card ${j.jobCardNo} source department (${fromDept}) cannot be the same as the target department.`);
        return;
      }

      transfersPayload.push({
        jobCardNo: j.jobCardNo,
        fromDepartment: fromDept,
        toDepartment: toDept,
        quantity: qty,
        remarks: remarks.trim() || `Bulk transfer execution via grid ledger view.`
      });
    }

    setIsSubmitting(true);
    try {
      await onSubmit(transfersPayload);
      setIsSubmitting(false);
      onClose();
    } catch (err: any) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'An error occurred during bulk transfer submission.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto animate-fade-in" id="bulk_transfer_modal">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-2xl w-full overflow-hidden shadow-2xl relative my-8 flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/40 shrink-0 select-none">
          <div className="flex items-center gap-2">
            <ArrowUpDown className="h-5 w-5 text-indigo-500" />
            <h3 className="font-sans font-bold text-base text-slate-800 dark:text-white uppercase tracking-wider">
              Bulk Material Transit ({activeSelectedCards.length} Selected)
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-400 hover:text-slate-600 dark:hover:text-slate-250 transition cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form Body - Scrollable */}
        <form onSubmit={handleFormSubmit} className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
          
          {/* Target Department Selector */}
          <div className="p-4 bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100/40 dark:border-indigo-900/30 rounded-2xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <label className="block text-indigo-950 dark:text-indigo-200 font-bold uppercase tracking-wider mb-0.5">
                  Target Department (Destination)
                </label>
                <p className="text-[10px] text-slate-500 dark:text-slate-400">
                  Select the common destination department where all these selected material batches will be transferred.
                </p>
              </div>
              <div className="relative min-w-[200px]">
                <select
                  value={toDept}
                  onChange={(e) => setToDept(e.target.value as Department | 'Completed')}
                  className="w-full bg-white dark:bg-slate-800 border border-indigo-200 dark:border-slate-700 px-3.5 py-2.5 rounded-xl text-slate-800 dark:text-slate-100 font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                >
                  <option value="Production">Production Milling</option>
                  <option value="Heat Treatment">Heat Treatment Line</option>
                  <option value="Plating">Surface Plating</option>
                  <option value="Packing">Packing Line</option>
                  <option value="Store">Storehouse Stock</option>
                  <option value="Dispatch">Dispatch Yard</option>
                  <option value="Completed">Completed / Dispatched</option>
                </select>
              </div>
            </div>
          </div>

          {/* List of Selected Job Cards with Editable Weights */}
          <div className="space-y-2">
            <h4 className="text-slate-500 font-bold uppercase tracking-wider">
              Batch Transfer Configuration Weights
            </h4>
            
            <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden divide-y divide-slate-150 dark:divide-slate-850">
              {activeSelectedCards.length === 0 ? (
                <div className="p-6 text-center text-slate-450 italic font-mono bg-slate-50/50 dark:bg-slate-900/20">
                  No transferrable job cards selected (exclude completed ones).
                </div>
              ) : (
                activeSelectedCards.map(j => {
                  const available = getAvailableWeight(j, movements);
                  const fromDept = j.currentDepartment || 'Production';
                  const isSameDept = fromDept === toDept;
                  
                  return (
                    <div 
                      key={j.jobCardNo} 
                      className={`p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 bg-slate-50/20 dark:bg-slate-900/10 ${
                        isSameDept ? 'border-l-4 border-l-red-500 bg-red-50/5 dark:bg-red-950/5' : ''
                      }`}
                    >
                      {/* Left: Job Info */}
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-black text-indigo-600 dark:text-indigo-400 text-xs">
                            {j.jobCardNo}
                          </span>
                          <span className="text-[9px] uppercase font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                            From: {fromDept}
                          </span>
                          {j.heatTreatmentRequired && (
                            <span className="text-[9px] uppercase font-bold text-amber-600 bg-amber-50 dark:bg-amber-950/20 px-2 py-0.5 rounded-full border border-amber-200/35">
                              HT Required
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] font-bold text-slate-700 dark:text-slate-300 truncate" title={j.itemName}>
                          {j.itemName}
                        </p>
                        <p className="text-[10px] text-slate-400 truncate">
                          Party: {j.partyName}
                        </p>
                      </div>

                      {/* Right: Available & Weight Input */}
                      <div className="flex items-center gap-4 shrink-0 justify-between sm:justify-end">
                        <div className="text-right">
                          <span className="text-[10px] text-slate-400 block">Available Floor Weight</span>
                          <strong className="font-mono text-slate-700 dark:text-slate-300">{available.toLocaleString()} KG</strong>
                        </div>
                        
                        <div className="flex flex-col gap-1 items-end">
                          <div className="relative w-36">
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              required
                              value={quantities[j.jobCardNo] || ''}
                              onChange={(e) => {
                                const clean = e.target.value.replace(/[^0-9.]/g, '');
                                handleQtyChange(j.jobCardNo, clean === '' ? 0 : Number(clean));
                              }}
                              disabled={isSameDept}
                              className={`w-full bg-white dark:bg-slate-800 border px-3 py-2 pr-10 rounded-xl text-xs font-mono font-bold focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                                isSameDept 
                                  ? 'border-red-200 dark:border-red-900/40 text-red-400 cursor-not-allowed bg-red-50/50' 
                                  : 'border-slate-200 dark:border-slate-750 text-slate-850 dark:text-slate-100'
                              }`}
                              placeholder="0.00"
                            />
                            <span className="absolute right-3 top-2 text-[10px] font-bold text-slate-400">KG</span>
                          </div>
                          
                          {quantities[j.jobCardNo] > available && available > 0 && (
                            <span className="text-[9px] font-semibold text-amber-500 flex items-center gap-0.5">
                              ⚠️ Overdraft ({ (quantities[j.jobCardNo] - available).toFixed(1) } KG over)
                            </span>
                          )}
                          {isSameDept && (
                            <span className="text-[9px] font-bold text-rose-500">
                              Can't transfer to same department
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Remarks Section */}
          <div>
            <label className="block text-slate-500 font-bold uppercase tracking-wider mb-1.5">Common Transit Details & Remarks</label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={2}
              className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-750 px-3 py-2 rounded-xl text-slate-850 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="E.g., Bulk batch transfer to next routing line..."
            />
          </div>

          {/* Warnings & Errors */}
          {error && (
            <div className="p-3 bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400 border border-red-200 dark:border-red-900/30 rounded-xl flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {activeSelectedCards.some(j => (quantities[j.jobCardNo] || 0) > getAvailableWeight(j, movements)) && (
            <div className="p-3 bg-amber-50 text-amber-700 dark:bg-amber-950/10 dark:text-amber-400 border border-amber-100 dark:border-amber-900/20 rounded-xl flex items-start gap-2">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <span>Note: One or more requested quantities exceed the available floor balance. Overdraft state will be created for those job cards.</span>
            </div>
          )}
        </form>

        {/* Footer actions */}
        <div className="p-5 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-850 text-slate-700 dark:text-slate-300 font-bold transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleFormSubmit}
            disabled={isSubmitting || activeSelectedCards.length === 0}
            className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold transition flex items-center justify-center gap-1.5 shadow-sm shadow-indigo-600/10 disabled:opacity-50 cursor-pointer"
          >
            {isSubmitting ? (
              <span>Executing transfers...</span>
            ) : (
              <>
                <Save className="h-4 w-4" />
                <span>Execute {activeSelectedCards.length} Transfers</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
