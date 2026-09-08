import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, 
  CheckCircle2, 
  ArrowRight, 
  Eye, 
  AlertTriangle, 
  Package, 
  Truck, 
  Layers, 
  Clock, 
  ShieldCheck,
  RefreshCw
} from 'lucide-react';
import { JobCard, MaterialMovement, UserProfile } from '../../types';
import JobStatusBadge from '../../components/JobStatusBadge';

export interface ScanResultEntity {
  type: 'job_card' | 'movement' | 'unknown';
  rawCode: string;
  jobCard?: JobCard;
  movement?: MaterialMovement;
  pendingIngressMovement?: MaterialMovement;
}

interface ScanActionBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  entity: ScanResultEntity | null;
  currentUser: UserProfile;
  onAcceptIngress?: (movement: MaterialMovement) => Promise<void> | void;
  onTransferJob?: (jobCard: JobCard) => void;
  onViewDetails?: (jobCardNo: string) => void;
  isOnline: boolean;
}

export const ScanActionBottomSheet: React.FC<ScanActionBottomSheetProps> = ({
  isOpen,
  onClose,
  entity,
  currentUser,
  onAcceptIngress,
  onTransferJob,
  onViewDetails,
  isOnline
}) => {
  const [confirmingAction, setConfirmingAction] = useState<'accept' | 'transfer' | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);
  const [actionErrorMsg, setActionErrorMsg] = useState<string | null>(null);

  if (!isOpen || !entity) return null;

  const { jobCard, movement, pendingIngressMovement, rawCode, type } = entity;

  // Determine if user can accept ingress at their station
  const targetIngress = pendingIngressMovement || (movement && !movement.accepted ? movement : undefined);
  const isTargetForUserDept = targetIngress && (
    targetIngress.toDepartment.toLowerCase() === currentUser.department.toLowerCase() ||
    currentUser.role === 'super_admin' ||
    currentUser.role === 'admin'
  );

  // Handle Accept Ingress Action
  const handleExecuteAcceptIngress = async () => {
    if (!targetIngress || !onAcceptIngress) return;
    setIsProcessing(true);
    setActionErrorMsg(null);
    try {
      await onAcceptIngress(targetIngress);
      setActionSuccessMsg(`Successfully accepted ${targetIngress.quantity} KG at ${currentUser.department}!`);
      setTimeout(() => {
        setActionSuccessMsg(null);
        setConfirmingAction(null);
        onClose();
      }, 1400);
    } catch (err: any) {
      console.error("Failed to accept ingress movement", err);
      setActionErrorMsg(err?.message || "Failed to accept ingress. Please check network and retry.");
      setConfirmingAction(null);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end select-none print:hidden">
      {/* Dark overlay backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={isProcessing ? undefined : onClose}
        className="absolute inset-0 bg-slate-950/75 backdrop-blur-xs"
      />

      {/* Action Bottom Sheet */}
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        className="relative w-full max-h-[85vh] bg-white dark:bg-slate-900 rounded-t-3xl border-t border-slate-200 dark:border-slate-800 shadow-2xl overflow-y-auto pb-[max(env(safe-area-inset-bottom,0px),1.25rem)]"
      >
        {/* Grab bar */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-12 h-1.5 rounded-full bg-slate-300 dark:bg-slate-700" />
        </div>

        {/* Sheet Header */}
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-blue-500/10 text-[#3B82F6] dark:text-blue-400">
              <Package className="h-5 w-5" />
            </span>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="text-sm font-extrabold uppercase tracking-wide text-slate-900 dark:text-white">
                  {jobCard ? jobCard.jobCardNo : (movement ? movement.movementId : 'Scanned Code')}
                </h3>
                {jobCard && <JobStatusBadge status={jobCard.status} size="xs" />}
              </div>
              <p className="text-[11px] text-slate-500 font-mono">
                {type === 'job_card' ? 'Authoritative Job Card' : type === 'movement' ? 'Material Movement' : 'Barcode Entity'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={isProcessing}
            className="p-1.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-900 dark:hover:text-white transition cursor-pointer disabled:opacity-50"
            aria-label="Close Action Sheet"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Success / Error notification alerts */}
        {actionSuccessMsg && (
          <div className="m-4 p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs font-bold flex items-center gap-2 animate-fade-in">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
            <span>{actionSuccessMsg}</span>
          </div>
        )}

        {actionErrorMsg && (
          <div className="m-4 p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 text-xs font-bold flex items-center gap-2 animate-fade-in">
            <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0" />
            <span>{actionErrorMsg}</span>
          </div>
        )}

        {/* Scanned Entity Detail Cards */}
        <div className="p-4 space-y-3">
          {jobCard ? (
            <div className="p-3.5 bg-slate-50 dark:bg-slate-850/60 rounded-2xl border border-slate-200/80 dark:border-slate-800 space-y-2.5">
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-bold text-xs text-slate-900 dark:text-white">{jobCard.partyName}</h4>
                  <p className="text-[11px] text-slate-600 dark:text-slate-300">{jobCard.itemName}</p>
                </div>
                <div className="text-right">
                  <span className="text-[9px] uppercase font-bold text-slate-400 block">Current Station</span>
                  <span className="text-xs font-bold text-[#3B82F6]">{jobCard.currentDepartment}</span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200/60 dark:border-slate-800 text-[11px] font-mono">
                <div>
                  <span className="text-[9px] uppercase font-bold text-slate-400 block">Target Mass</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">{jobCard.orderQty.toLocaleString()} KG</span>
                </div>
                <div>
                  <span className="text-[9px] uppercase font-bold text-slate-400 block">Grade</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">{jobCard.materialGrade || 'Standard'}</span>
                </div>
                <div>
                  <span className="text-[9px] uppercase font-bold text-slate-400 block">Heat / Batch</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">{jobCard.heatNo || 'N/A'}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-3.5 bg-slate-50 dark:bg-slate-850/60 rounded-2xl border border-slate-200/80 dark:border-slate-800 text-xs">
              <span className="text-[9px] uppercase font-bold text-slate-400 block">Raw Decoded Value</span>
              <p className="font-mono text-slate-800 dark:text-slate-200 break-all">{rawCode}</p>
            </div>
          )}

          {/* Incoming Ingress Alert Banner if pending transfer exists */}
          {targetIngress && isTargetForUserDept && (
            <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 flex items-start gap-2.5">
              <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs">
                <span className="font-bold text-amber-900 dark:text-amber-300 block">
                  Incoming Transit Batch Awaiting Custody!
                </span>
                <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">
                  {targetIngress.fromDepartment} transferred <strong>{targetIngress.quantity} KG</strong> to your station ({currentUser.department}).
                </p>
              </div>
            </div>
          )}

          {/* Confirmation Step for Accept Ingress */}
          <AnimatePresence>
            {confirmingAction === 'accept' && targetIngress && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="p-4 rounded-2xl bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 space-y-3"
              >
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-[#3B82F6]" />
                  <h4 className="text-xs font-bold text-blue-950 dark:text-blue-200">
                    Confirm Custody Acceptance?
                  </h4>
                </div>
                <p className="text-[11px] text-blue-800 dark:text-blue-300">
                  You are accepting <strong>{targetIngress.quantity} KG</strong> of material for Job <strong>{targetIngress.jobCardNo}</strong> at station <strong>{currentUser.department}</strong>.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmingAction(null)}
                    disabled={isProcessing}
                    className="flex-1 py-2.5 rounded-xl bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-xs border border-slate-200 dark:border-slate-700 cursor-pointer disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleExecuteAcceptIngress}
                    disabled={isProcessing}
                    className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md cursor-pointer disabled:opacity-50"
                  >
                    {isProcessing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    <span>Confirm Acceptance</span>
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Contextual Action Triggers */}
          {!confirmingAction && (
            <div className="space-y-2 pt-1">
              {/* 1. Accept Ingress (If pending for user's station) */}
              {targetIngress && isTargetForUserDept && (
                <button
                  onClick={() => setConfirmingAction('accept')}
                  className="w-full min-h-[50px] p-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-between shadow-md transition cursor-pointer active:scale-98"
                >
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2 className="h-5 w-5" />
                    <div className="text-left">
                      <span className="block">Accept in Ingress ({targetIngress.quantity} KG)</span>
                      <span className="text-[10px] text-emerald-100 font-normal">Take verified custody at {currentUser.department}</span>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-emerald-200" />
                </button>
              )}

              {/* 2. Route / Quick Transfer to Downstream */}
              {jobCard && onTransferJob && jobCard.currentDepartment !== 'Completed' && (
                <button
                  onClick={() => {
                    onTransferJob(jobCard);
                    onClose();
                  }}
                  className="w-full min-h-[48px] p-3 rounded-2xl bg-[#3B82F6] hover:bg-blue-600 text-white font-bold text-xs flex items-center justify-between shadow-sm transition cursor-pointer active:scale-98"
                >
                  <div className="flex items-center gap-2.5">
                    <Truck className="h-5 w-5" />
                    <div className="text-left">
                      <span className="block">Route & Transfer to Downstream</span>
                      <span className="text-[10px] text-blue-100 font-normal">Create inter-department movement</span>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-blue-200" />
                </button>
              )}

              {/* 3. 360° Job Card History Details */}
              {jobCard && onViewDetails && (
                <button
                  onClick={() => {
                    onViewDetails(jobCard.jobCardNo);
                    onClose();
                  }}
                  className="w-full min-h-[48px] p-3 rounded-2xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-750 text-slate-800 dark:text-slate-100 font-bold text-xs flex items-center justify-between transition cursor-pointer active:scale-98"
                >
                  <div className="flex items-center gap-2.5">
                    <Eye className="h-5 w-5 text-slate-500" />
                    <div className="text-left">
                      <span className="block">Inspect 360° History & Genealogy</span>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 font-normal">View timeline, split batches, and audit logs</span>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-slate-400" />
                </button>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default ScanActionBottomSheet;
