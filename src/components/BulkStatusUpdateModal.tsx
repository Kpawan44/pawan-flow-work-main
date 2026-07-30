import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  FileCheck, 
  RotateCcw, 
  Sparkles,
  Loader2,
  ShieldCheck
} from 'lucide-react';
import { JobCardStatus } from '../types';

interface BulkStatusUpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedJobNos: string[];
  onConfirmUpdate: (targetStatus: JobCardStatus) => Promise<void>;
}

const STATUS_OPTIONS: {
  status: JobCardStatus;
  label: string;
  description: string;
  icon: React.ElementType;
  colorClass: string;
  badgeClass: string;
}[] = [
  {
    status: 'In Process',
    label: 'In Process',
    description: 'Set jobs to active production milling or processing on shop floor',
    icon: Clock,
    colorClass: 'border-blue-500/40 bg-blue-50/50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300',
    badgeClass: 'bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200'
  },
  {
    status: 'Pending Acceptance',
    label: 'Pending Acceptance',
    description: 'Awaiting department supervisor inspection or sign-off',
    icon: Clock,
    colorClass: 'border-amber-500/40 bg-amber-50/50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300',
    badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200'
  },
  {
    status: 'Completed',
    label: 'Completed',
    description: 'Mark production and quality verification as fully finished',
    icon: FileCheck,
    colorClass: 'border-emerald-500/40 bg-emerald-50/50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300',
    badgeClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200'
  },
  {
    status: 'Pending',
    label: 'Pending',
    description: 'Reset status back to initial pending scheduling queue',
    icon: RotateCcw,
    colorClass: 'border-slate-500/40 bg-slate-50/50 dark:bg-slate-850 text-slate-700 dark:text-slate-300',
    badgeClass: 'bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200'
  },
  {
    status: 'Rejected',
    label: 'Rejected',
    description: 'Flag jobs under quality rejection or rework review',
    icon: AlertCircle,
    colorClass: 'border-rose-500/40 bg-rose-50/50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300',
    badgeClass: 'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200'
  }
];

export default function BulkStatusUpdateModal({
  isOpen,
  onClose,
  selectedJobNos,
  onConfirmUpdate
}: BulkStatusUpdateModalProps) {
  const [selectedStatus, setSelectedStatus] = useState<JobCardStatus>('In Process');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleConfirm = async () => {
    try {
      setIsSubmitting(true);
      await onConfirmUpdate(selectedStatus);
      onClose();
    } catch (err) {
      console.error("Bulk status update failed:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentOption = STATUS_OPTIONS.find(o => o.status === selectedStatus) || STATUS_OPTIONS[0];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm print:hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
        >
          <motion.div 
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col text-slate-800 dark:text-slate-100"
            initial={{ opacity: 0, scale: 0.95, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{ type: 'spring', damping: 25, stiffness: 350 }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 shrink-0">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="font-sans font-extrabold text-sm sm:text-base text-slate-850 dark:text-white uppercase tracking-wider">
                    Bulk Update Status
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Change job card status for {selectedJobNos.length} selected item{selectedJobNos.length > 1 ? 's' : ''}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                disabled={isSubmitting}
                className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4">
              
              {/* Selected Job Cards Pills */}
              <div className="bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-slate-600 dark:text-slate-300">
                  <span className="flex items-center gap-1.5">
                    <ShieldCheck className="h-3.5 w-3.5 text-amber-500" />
                    Target Job Cards ({selectedJobNos.length})
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pt-1">
                  {selectedJobNos.slice(0, 12).map(no => (
                    <span 
                      key={no} 
                      className="font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-750 text-indigo-600 dark:text-indigo-400 shadow-2xs"
                    >
                      {no}
                    </span>
                  ))}
                  {selectedJobNos.length > 12 && (
                    <span className="text-[10px] font-bold text-slate-400 px-1 py-0.5">
                      +{selectedJobNos.length - 12} more
                    </span>
                  )}
                </div>
              </div>

              {/* Status Selection Cards */}
              <div className="space-y-2">
                <label className="text-xs font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Select New Status:
                </label>
                <div className="grid grid-cols-1 gap-2">
                  {STATUS_OPTIONS.map(opt => {
                    const Icon = opt.icon;
                    const isSelected = selectedStatus === opt.status;

                    return (
                      <div
                        key={opt.status}
                        onClick={() => !isSubmitting && setSelectedStatus(opt.status)}
                        className={`p-3 rounded-xl border transition cursor-pointer flex items-center justify-between gap-3 ${
                          isSelected 
                            ? `${opt.colorClass} border-2 shadow-sm` 
                            : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-850 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg ${opt.badgeClass}`}>
                            <Icon className="h-4 w-4" />
                          </div>
                          <div>
                            <div className="text-xs font-bold font-sans flex items-center gap-2">
                              <span>{opt.label}</span>
                              {isSelected && (
                                <span className="text-[10px] px-1.5 py-0.2 rounded font-extrabold uppercase bg-amber-500 text-white">
                                  Selected
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                              {opt.description}
                            </p>
                          </div>
                        </div>
                        <input
                          type="radio"
                          name="status_option"
                          checked={isSelected}
                          onChange={() => setSelectedStatus(opt.status)}
                          className="h-4 w-4 text-amber-500 accent-amber-500 cursor-pointer"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Single Confirmation Summary Banner */}
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 flex items-start gap-2.5 text-xs text-amber-800 dark:text-amber-300">
                <Sparkles className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Confirmation Summary</p>
                  <p className="text-[11px] text-amber-700 dark:text-amber-300/90 mt-0.5">
                    All <strong>{selectedJobNos.length}</strong> selected job cards will be updated to status <strong>"{currentOption.label}"</strong> in a single batch operation.
                  </p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 font-bold text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={isSubmitting}
                className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-extrabold text-xs shadow-md shadow-amber-500/20 transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Updating {selectedJobNos.length} Jobs...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Confirm Bulk Status Update</span>
                  </>
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
