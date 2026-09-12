import React, { useState, useEffect, useRef } from 'react';
import { X, ArrowRight, Save, Info, AlertTriangle, ArrowUpDown } from 'lucide-react';
import { JobCard, MaterialMovement, Department, UserProfile, CompanyConfig } from '../types';
import { assertHeatTreatmentRouting, process2SendAvailableQty, remainingAtDepartment } from '../hardening/process2Manufacturing';

interface QuickTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  jobCard: JobCard | null;
  movements: MaterialMovement[];
  currentUser: UserProfile | null;
  companyConfig?: CompanyConfig | null;
  onSubmit: (mov: {
    jobCardNo: string;
    fromDepartment: Department;
    toDepartment: Department | 'Completed';
    quantity: number;
    remarks?: string;
    operationId?: string;
    unit?: 'KGS' | 'PCS' | 'KG';
  }) => Promise<void>;
}

export default function QuickTransferModal({
  isOpen,
  onClose,
  jobCard,
  movements,
  currentUser,
  companyConfig,
  onSubmit
}: QuickTransferModalProps) {
  const [fromDept, setFromDept] = useState<Department>('Production');
  const [toDept, setToDept] = useState<Department | 'Completed'>('Heat Treatment');
  const [quantity, setQuantity] = useState<number>(0);
  const [remarks, setRemarks] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string>('');
  const retryOperationIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isOpen) retryOperationIdRef.current = null;
  }, [isOpen]);

  // Ordered sequence of normal departments
  const departmentSequence: (Department | 'Completed')[] = [
    'Purchase',
    'Production',
    'Heat Treatment',
    'Plating',
    'Packing',
    'Store',
    'Dispatch',
    'Completed'
  ];

  // Helper to determine the next logical department step
  const getNextLogicalDepartment = (from: Department, htRequired: boolean, jCard?: JobCard | null): Department | 'Completed' => {
    if (from === 'Purchase') {
      const matType = jCard?.materialType || jCard?.outsourceDetails?.outsourceMaterialType;
      if (matType === 'Finished Goods') {
        return 'Packing';
      } else {
        // Semi-Finished Goods or Default Purchase Inward
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

  const suggestedQty = (from: Department, card: JobCard): number => {
    const cap = process2SendAvailableQty(from, card, movements, {
      compulsory: companyConfig?.requireRawMaterialForProduction !== false
    });
    if (cap !== null) return cap;
    return remainingAtDepartment(card, movements, from);
  };

  // Calculate metrics and set defaults when modal opens or job card changes
  useEffect(() => {
    if (!isOpen || !jobCard) return;

    // Reset error & states
    setError('');
    setRemarks('');

    // Pre-fill "From" department based on job card's current state
    const current = jobCard.currentDepartment;
    const initialFromDept = (current === 'Completed' || !current) ? 'Production' : (current as Department);
    setFromDept(initialFromDept);

    // Pre-fill "To" department based on logical step
    const nextTarget = getNextLogicalDepartment(initialFromDept, jobCard.heatTreatmentRequired, jobCard);
    setToDept(nextTarget);
    setQuantity(suggestedQty(initialFromDept, jobCard));
  }, [isOpen, jobCard, movements, companyConfig]);

  // Handle change in From department to recalculate logical To department and Qty
  const handleFromDeptChange = (selectedFrom: Department) => {
    setFromDept(selectedFrom);
    if (jobCard) {
      const nextTarget = getNextLogicalDepartment(selectedFrom, jobCard.heatTreatmentRequired, jobCard);
      setToDept(nextTarget);
      setQuantity(suggestedQty(selectedFrom, jobCard));
    }
  };

  if (!isOpen || !jobCard) return null;

  const rmCompulsory = companyConfig?.requireRawMaterialForProduction !== false;
  const ledgerAvailable = process2SendAvailableQty(fromDept, jobCard, movements, { compulsory: rmCompulsory });
  let availableWeightInDept = ledgerAvailable === null ? remainingAtDepartment(jobCard, movements, fromDept) : ledgerAvailable;
  let labelText = "Ledger available at source";

  if (fromDept === 'Production') {
    labelText = rmCompulsory
      ? "Remaining Production capacity (accepted RM)"
      : "Remaining Production quantity (movement ledger)";
  } else if (fromDept === 'Heat Treatment') {
    labelText = "Available Weight at Heat Treatment";
  } else if (fromDept === 'Plating') {
    labelText = "Remaining Weight at Plating";
  } else if (fromDept === 'Packing') {
    labelText = "Remaining Weight at Packing Line";
  } else if (fromDept === 'Store') {
    labelText = "Remaining Weight in Storehouse Stock";
  }

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (quantity <= 0) {
      setError(
        fromDept === 'Store' && String(toDept) === 'Plating'
          ? 'Please specify a positive material transfer quantity in KG. PCS is not allowed for Store → Plating Unit.'
          : 'Please specify a positive material transfer weight quantity (KG).'
      );
      return;
    }

    if (fromDept === toDept) {
      setError('Source ("From") and Target ("To") departments cannot be the same.');
      return;
    }

    const htGate = assertHeatTreatmentRouting(jobCard, fromDept, String(toDept));
    if (!htGate.ok) {
      setError(htGate.error || 'Invalid department routing.');
      return;
    }

    if (ledgerAvailable !== null && quantity > ledgerAvailable) {
      setError(`Cannot transfer ${quantity}. Only ${ledgerAvailable} is available in ${fromDept}.`);
      return;
    }

    if (!retryOperationIdRef.current) {
      retryOperationIdRef.current =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? `op-quick-${crypto.randomUUID()}`
          : `op-quick-${Date.now()}`;
    }

    setIsSubmitting(true);
    try {
      await onSubmit({
        jobCardNo: jobCard.jobCardNo,
        fromDepartment: fromDept,
        toDepartment: toDept,
        quantity,
        remarks: remarks.trim() || `Quick transfer initiated from All Orders database view.`,
        operationId: retryOperationIdRef.current,
        ...(fromDept === 'Store' && String(toDept) === 'Plating' ? { unit: 'KGS' as const } : {})
      });
      setIsSubmitting(false);
      onClose();
    } catch (err: any) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'An error occurred during transfer submission.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto animate-fade-in" id="quick_transfer_modal">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-lg w-full overflow-hidden shadow-2xl relative my-8">
        
        {/* Header */}
        <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/40">
          <div className="flex items-center gap-2">
            <ArrowUpDown className="h-5 w-5 text-indigo-500" />
            <h3 className="font-sans font-bold text-base text-slate-800 dark:text-white uppercase tracking-wider">
              Quick Material Transit
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-400 hover:text-slate-600 dark:hover:text-slate-250 transition"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleFormSubmit} className="p-6 space-y-4 text-xs">
          
          {/* Job Card Context Info */}
          <div className="p-4 bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-100/40 dark:border-indigo-900/30 rounded-2xl space-y-2">
            <div className="flex justify-between items-center">
              <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400 text-sm">{jobCard.jobCardNo}</span>
              <span className="text-[10px] uppercase font-bold text-slate-400 bg-white dark:bg-slate-850 px-2.5 py-0.5 rounded-full border border-slate-100 dark:border-slate-800">
                Current Position: {jobCard.currentDepartment}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <div>
                <span className="text-slate-400 text-[10px]">Party Name:</span>
                <p className="font-bold text-slate-800 dark:text-slate-200 truncate">{jobCard.partyName}</p>
              </div>
              <div>
                <span className="text-slate-400 text-[10px]">Item Details:</span>
                <p className="font-bold text-slate-800 dark:text-slate-200 truncate">{jobCard.itemName}</p>
              </div>
              <div className="mt-1">
                <span className="text-slate-400 text-[10px]">Total Order Weight:</span>
                <p className="font-bold font-mono text-slate-800 dark:text-slate-200">{jobCard.orderQty.toLocaleString()} KG</p>
              </div>
              <div className="mt-1">
                <span className="text-slate-400 text-[10px]">HT Required Spec:</span>
                <p className={`font-bold ${jobCard.heatTreatmentRequired ? 'text-amber-500' : 'text-slate-400'}`}>
                  {jobCard.heatTreatmentRequired ? 'YES (Heat Treatment Required)' : 'NO (Skip HT Step)'}
                </p>
              </div>
            </div>
          </div>

          {/* Form Fields Grid */}
          <div className="grid grid-cols-2 gap-4">
            
            {/* From Department */}
            <div>
              <label className="block text-slate-500 font-bold uppercase tracking-wider mb-1.5">From Department (Source)</label>
              <select
                value={fromDept}
                onChange={(e) => handleFromDeptChange(e.target.value as Department)}
                className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-750 px-3 py-2 rounded-xl text-slate-800 dark:text-slate-100 font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
              >
                <option value="Purchase">Purchase Inward</option>
                <option value="Production">Production Milling</option>
                <option value="Heat Treatment">Heat Treatment Line</option>
                <option value="Plating">Surface Plating</option>
                <option value="Packing">Packing Line</option>
                <option value="Store">Storehouse</option>
                <option value="Dispatch">Dispatch</option>
              </select>
            </div>

            {/* To Department */}
            <div>
              <label className="block text-slate-500 font-bold uppercase tracking-wider mb-1.5">To Department (Target)</label>
              <select
                value={toDept}
                onChange={(e) => {
                  const next = e.target.value as Department | 'Completed';
                  const htGate = assertHeatTreatmentRouting(jobCard, fromDept, String(next));
                  if (!htGate.ok) {
                    setError(htGate.error || 'Invalid department routing.');
                    return;
                  }
                  setError('');
                  setToDept(next);
                }}
                className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-750 px-3 py-2 rounded-xl text-slate-800 dark:text-slate-100 font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
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

          {/* Quantity and Availability Box */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <label className="text-slate-500 font-bold uppercase tracking-wider">
                {fromDept === 'Store' && String(toDept) === 'Plating'
                  ? 'Transfer Quantity (KG only)'
                  : 'Transfer Weight (KG)'}
              </label>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${
                availableWeightInDept > 0 
                  ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400' 
                  : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
              }`}>
                {labelText}: <strong className="font-mono">{availableWeightInDept.toLocaleString()} KG</strong>
              </span>
            </div>
            
            <div className="relative">
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                required
                value={quantity || ''}
                onChange={(e) => {
                  const clean = e.target.value.replace(/[^0-9.]/g, '');
                  setQuantity(clean === '' ? 0 : Number(clean));
                }}
                className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-750 pl-3 pr-12 py-2.5 rounded-xl text-slate-800 dark:text-slate-100 font-mono font-bold text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                placeholder="0"
              />
              <span className="absolute right-3.5 top-3 text-[10px] font-bold text-slate-400">KG</span>
            </div>
          </div>

          {/* Remarks */}
          <div>
            <label className="block text-slate-500 font-bold uppercase tracking-wider mb-1.5">Transit Details & Remarks</label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={3}
              className="w-full bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-750 px-3 py-2 rounded-xl text-slate-850 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="E.g., Batch completed Shift-A, routing to next step..."
            />
          </div>

          {/* Warnings & Errors */}
          {error && (
            <div className="p-3 bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400 border border-red-200 dark:border-red-900/30 rounded-xl flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {quantity > availableWeightInDept && availableWeightInDept >= 0 && fromDept !== 'Production' && (
            <div className="p-3 bg-amber-50 text-amber-700 dark:bg-amber-950/10 dark:text-amber-400 border border-amber-100 dark:border-amber-900/20 rounded-xl flex items-start gap-2">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <span>Note: Requested quantity exceeds the current floor balance of this department. This will create a negative or over-draft state if authorized.</span>
            </div>
          )}

          {/* Submit Action buttons */}
          <div className="flex items-center gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-850 text-slate-700 dark:text-slate-300 font-bold transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold transition flex items-center justify-center gap-1.5 shadow-sm shadow-indigo-600/10 disabled:opacity-50"
            >
              {isSubmitting ? (
                <span>Processing...</span>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  <span>Execute Transfer</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
