import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, 
  ArrowRight, 
  Plus, 
  Trash2, 
  Scale, 
  AlertTriangle, 
  CheckCircle2, 
  Truck, 
  ShieldCheck,
  RefreshCw,
  Sliders
} from 'lucide-react';
import { JobCard, MaterialMovement, Department, UserProfile } from '../../types';
import { assertHeatTreatmentRouting, process2SendAvailableQty, remainingAtDepartment } from '../../hardening/process2Manufacturing';

interface SplitBatchEntry {
  id: string;
  quantity: number;
  toDepartment: Department | 'Completed';
  remarks?: string;
  operationId: string;
}

interface MobileTransferSplitSheetProps {
  isOpen: boolean;
  onClose: () => void;
  jobCard: JobCard | null;
  movements: MaterialMovement[];
  currentUser: UserProfile;
  onSubmitTransfer: (movements: {
    jobCardNo: string;
    fromDepartment: Department;
    toDepartment: Department | 'Completed';
    quantity: number;
    remarks?: string;
    operationId?: string;
  }[]) => Promise<void> | void;
}

const ALL_DESTINATIONS: (Department | 'Completed')[] = [
  'Production',
  'Heat Treatment',
  'Plating',
  'Packing',
  'Store',
  'Dispatch',
  'Completed'
];

export const MobileTransferSplitSheet: React.FC<MobileTransferSplitSheetProps> = ({
  isOpen,
  onClose,
  jobCard,
  movements,
  currentUser,
  onSubmitTransfer
}) => {
  const [fromDept, setFromDept] = useState<Department>('Production');
  const [splitEntries, setSplitEntries] = useState<SplitBatchEntry[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Helper to determine next logical department
  const getNextLogicalDepartment = (from: Department, htRequired: boolean): Department | 'Completed' => {
    if (from === 'Purchase') return htRequired ? 'Heat Treatment' : 'Production';
    if (from === 'Production') return htRequired ? 'Heat Treatment' : 'Plating';
    if (from === 'Heat Treatment') return 'Plating';
    if (from === 'Plating') return 'Packing';
    if (from === 'Packing') return 'Store';
    if (from === 'Store') return 'Dispatch';
    if (from === 'Dispatch') return 'Completed';
    return 'Completed';
  };

  const mintSplitOperationId = () =>
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? `op-msplit-${crypto.randomUUID()}`
      : `op-msplit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const availableMass = useMemo(() => {
    if (!jobCard) return 0;
    const cap = process2SendAvailableQty(fromDept, jobCard, movements, { compulsory: true });
    if (cap !== null) return cap;
    return remainingAtDepartment(jobCard, movements, fromDept);
  }, [jobCard, movements, fromDept]);

  useEffect(() => {
    if (!isOpen || !jobCard) return;
    setErrorMessage(null);
    setShowConfirmModal(false);

    const initialFrom = (jobCard.currentDepartment === 'Completed' || !jobCard.currentDepartment)
      ? 'Production'
      : (jobCard.currentDepartment as Department);
    setFromDept(initialFrom);

    const nextTarget = getNextLogicalDepartment(initialFrom, !!jobCard.heatTreatmentRequired);
    const ledgerQty = process2SendAvailableQty(initialFrom, jobCard, movements, { compulsory: true });
    const initialQty = ledgerQty === null ? remainingAtDepartment(jobCard, movements, initialFrom) : ledgerQty;

    setSplitEntries([
      {
        id: `split-${Date.now()}-0`,
        quantity: initialQty,
        toDepartment: nextTarget,
        remarks: '',
        operationId: mintSplitOperationId()
      }
    ]);
  }, [isOpen, jobCard]);

  if (!isOpen || !jobCard) return null;

  // Sum of all child split entries
  const totalSplitQuantity = splitEntries.reduce((sum, e) => sum + (Number(e.quantity) || 0), 0);
  const remainingMass = availableMass - totalSplitQuantity;
  const isConservationValid = totalSplitQuantity > 0 && totalSplitQuantity <= availableMass && remainingMass >= 0;

  // Apply percentage preset to first entry
  const applyPresetPercentage = (pct: number) => {
    const targetQty = Math.round((availableMass * pct) / 100);
    if (splitEntries.length === 0) {
      const nextTarget = getNextLogicalDepartment(fromDept, !!jobCard.heatTreatmentRequired);
      setSplitEntries([{ id: `split-${Date.now()}`, quantity: targetQty, toDepartment: nextTarget, operationId: mintSplitOperationId() }]);
    } else {
      setSplitEntries(prev => {
        const copy = [...prev];
        copy[0] = { ...copy[0], quantity: targetQty };
        return copy;
      });
    }
  };

  // Add another split child entry
  const handleAddSplitEntry = () => {
    if (remainingMass <= 0) {
      setErrorMessage("No remaining mass available to allocate another child split.");
      return;
    }
    setErrorMessage(null);
    const nextTarget = getNextLogicalDepartment(fromDept, !!jobCard.heatTreatmentRequired);
    setSplitEntries(prev => [
      ...prev,
      {
        id: `split-${Date.now()}-${prev.length}`,
        quantity: Math.max(0, remainingMass),
        toDepartment: nextTarget,
        remarks: '',
        operationId: mintSplitOperationId()
      }
    ]);
  };

  // Remove child split entry
  const handleRemoveSplitEntry = (id: string) => {
    if (splitEntries.length <= 1) return;
    setSplitEntries(prev => prev.filter(e => e.id !== id));
  };

  // Update entry fields
  const handleUpdateEntry = (id: string, updates: Partial<SplitBatchEntry>) => {
    setSplitEntries(prev =>
      prev.map(e => (e.id === id ? { ...e, ...updates } : e))
    );
  };

  // Execute transfer after confirmation
  const handleConfirmSubmit = async () => {
    if (!isConservationValid) {
      setErrorMessage(`Invalid split mass. Total split (${totalSplitQuantity} KG) cannot exceed available (${availableMass} KG).`);
      return;
    }
    for (const e of splitEntries) {
      const htGate = assertHeatTreatmentRouting(jobCard, fromDept, String(e.toDepartment));
      if (!htGate.ok) {
        setErrorMessage(htGate.error || "Invalid department routing.");
        return;
      }
    }

    setIsProcessing(true);
    setErrorMessage(null);
    try {
      const payload = splitEntries.map(e => ({
        jobCardNo: jobCard.jobCardNo,
        fromDepartment: fromDept,
        toDepartment: e.toDepartment,
        quantity: Number(e.quantity),
        remarks: e.remarks?.trim() || `Inter-department transfer of ${e.quantity} KG from ${fromDept} to ${e.toDepartment}.`,
        operationId: e.operationId
      }));

      await onSubmitTransfer(payload);
      setShowConfirmModal(false);
      onClose();
    } catch (err: any) {
      console.error("Split transfer failed", err);
      setErrorMessage(err?.message || "Transfer failed. Please check network and retry.");
      setShowConfirmModal(false);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end select-none print:hidden">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={isProcessing ? undefined : onClose}
        className="absolute inset-0 bg-slate-950/75 backdrop-blur-xs"
      />

      {/* Main Sheet */}
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        className="relative w-full max-h-[90vh] bg-white dark:bg-slate-900 rounded-t-3xl border-t border-slate-200 dark:border-slate-800 shadow-2xl overflow-y-auto pb-[max(env(safe-area-inset-bottom,0px),1.5rem)]"
      >
        {/* Grab Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-12 h-1.5 rounded-full bg-slate-300 dark:bg-slate-700" />
        </div>

        {/* Header */}
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-blue-500/10 text-[#3B82F6]">
              <Truck className="h-5 w-5" />
            </span>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="text-sm font-extrabold text-slate-900 dark:text-white uppercase tracking-tight">
                  Transfer & Batch Split
                </h3>
                <span className="font-mono text-xs font-bold text-blue-600 bg-blue-50 dark:bg-blue-950/60 px-1.5 py-0.2 rounded">
                  {jobCard.jobCardNo}
                </span>
              </div>
              <p className="text-[11px] text-slate-500">{jobCard.itemName} • {jobCard.partyName}</p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={isProcessing}
            className="p-1.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-900 dark:hover:text-white transition cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Error Alert Banner */}
        {errorMessage && (
          <div className="m-4 p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 text-xs font-bold flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        <div className="p-4 space-y-4">
          {/* Station & Mass Conservation Bar */}
          <div className="p-3.5 bg-slate-50 dark:bg-slate-850/60 rounded-2xl border border-slate-200/80 dark:border-slate-800 space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-500 font-bold uppercase text-[10px]">Source Station</span>
              <span className="font-extrabold text-slate-900 dark:text-white font-mono">{fromDept}</span>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200/60 dark:border-slate-800 text-[11px] font-mono text-center">
              <div className="bg-white dark:bg-slate-900 p-2 rounded-xl border border-slate-200/80 dark:border-slate-800">
                <span className="text-[9px] text-slate-400 uppercase font-bold block">Available</span>
                <span className="font-extrabold text-slate-800 dark:text-slate-200">{availableMass} KG</span>
              </div>
              <div className="bg-blue-50 dark:bg-blue-950/40 p-2 rounded-xl border border-blue-200/60 dark:border-blue-900/40">
                <span className="text-[9px] text-blue-600 dark:text-blue-400 uppercase font-bold block">Splitting</span>
                <span className="font-extrabold text-blue-700 dark:text-blue-300">{totalSplitQuantity} KG</span>
              </div>
              <div className={`p-2 rounded-xl border ${
                remainingMass < 0 
                  ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 text-rose-600' 
                  : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 text-emerald-700 dark:text-emerald-300'
              }`}>
                <span className="text-[9px] uppercase font-bold block">Remaining</span>
                <span className="font-extrabold">{remainingMass} KG</span>
              </div>
            </div>
          </div>

          {/* Quick Percentage Presets */}
          <div className="flex gap-2">
            {[25, 50, 75, 100].map(pct => (
              <button
                key={pct}
                type="button"
                onClick={() => applyPresetPercentage(pct)}
                className="flex-1 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-950/50 hover:text-blue-600 text-slate-700 dark:text-slate-300 font-bold text-xs font-mono transition cursor-pointer border border-slate-200/70 dark:border-slate-700/60 active:scale-95"
              >
                {pct}%
              </button>
            ))}
          </div>

          {/* Split Batch Entries List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Child Transfer Batches ({splitEntries.length})
              </span>
              <button
                type="button"
                onClick={handleAddSplitEntry}
                className="px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 border border-blue-200/60 dark:border-blue-800/40 text-[11px] font-bold flex items-center gap-1 hover:bg-blue-100 transition cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Split</span>
              </button>
            </div>

            {splitEntries.map((entry, idx) => (
              <div
                key={entry.id}
                className="p-3.5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-3 shadow-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono font-bold text-slate-400">
                    Child Split #{idx + 1}
                  </span>
                  {splitEntries.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveSplitEntry(entry.id)}
                      className="p-1 text-rose-500 hover:bg-rose-50 rounded-lg transition"
                      title="Remove Split Batch"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {/* Quantity Input */}
                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                      Mass (KG)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={availableMass}
                      value={entry.quantity || ''}
                      onChange={(e) => handleUpdateEntry(entry.id, { quantity: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono font-bold text-slate-900 dark:text-white focus:outline-hidden focus:border-blue-500"
                    />
                  </div>

                  {/* Destination Station */}
                  <div>
                    <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                      Destination
                    </label>
                    <select
                      value={entry.toDepartment}
                      onChange={(e) => handleUpdateEntry(entry.id, { toDepartment: e.target.value as any })}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:outline-hidden focus:border-blue-500 cursor-pointer"
                    >
                      {ALL_DESTINATIONS.map(d => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Remarks */}
                <div>
                  <input
                    type="text"
                    value={entry.remarks || ''}
                    onChange={(e) => handleUpdateEntry(entry.id, { remarks: e.target.value })}
                    placeholder="Batch remarks (e.g. Partial split for urgent lot)..."
                    className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-850/60 border border-slate-200/80 dark:border-slate-800 rounded-xl text-[11px] text-slate-700 dark:text-slate-300 placeholder-slate-400 focus:outline-hidden focus:border-blue-500"
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Primary Action Button */}
          <button
            type="button"
            disabled={!isConservationValid || isProcessing}
            onClick={() => setShowConfirmModal(true)}
            className="w-full min-h-[50px] py-3 rounded-2xl bg-[#3B82F6] hover:bg-blue-600 text-white font-bold text-xs shadow-md transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 active:scale-98"
          >
            <Truck className="h-4 w-4" />
            <span>Review & Execute Transfer ({totalSplitQuantity} KG)</span>
          </button>
        </div>
      </motion.div>

      {/* Final Safety Confirmation Modal */}
      <AnimatePresence>
        {showConfirmModal && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 select-none">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowConfirmModal(false)}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-xs"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200 dark:border-slate-800 shadow-2xl z-10 space-y-4"
            >
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="h-6 w-6 text-[#3B82F6]" />
                <div>
                  <h3 className="text-sm font-extrabold uppercase text-slate-900 dark:text-white">
                    Confirm Batch Movement?
                  </h3>
                  <p className="text-[11px] text-slate-500">Job Card: {jobCard.jobCardNo}</p>
                </div>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-2xl space-y-1.5 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-slate-500">From Station:</span>
                  <span className="font-bold text-slate-900 dark:text-white">{fromDept}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Total Mass Moved:</span>
                  <span className="font-bold text-[#3B82F6]">{totalSplitQuantity} KG</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Remaining Balance:</span>
                  <span className="font-bold text-slate-900 dark:text-white">{remainingMass} KG</span>
                </div>
                <div className="pt-2 border-t border-slate-200 dark:border-slate-700 text-[10.5px]">
                  {splitEntries.map((e, idx) => (
                    <div key={e.id} className="flex justify-between text-slate-600 dark:text-slate-300">
                      <span>Split #{idx + 1} &rarr; {e.toDepartment}:</span>
                      <span className="font-bold">{e.quantity} KG</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowConfirmModal(false)}
                  disabled={isProcessing}
                  className="flex-1 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmSubmit}
                  disabled={isProcessing}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md cursor-pointer"
                >
                  {isProcessing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  <span>Confirm & Dispatch</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default MobileTransferSplitSheet;
