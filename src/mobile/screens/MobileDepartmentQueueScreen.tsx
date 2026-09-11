import React, { useState, useMemo } from 'react';
import { 
  ArrowLeft, 
  Search, 
  Layers, 
  Package, 
  CheckCircle2, 
  Truck, 
  Clock, 
  AlertCircle, 
  RefreshCw,
  SlidersHorizontal,
  ChevronRight,
  GitBranch
} from 'lucide-react';
import { JobCard, MaterialMovement, UserProfile, Department } from '../../types';
import SwipeableQueueItem from '../shared/SwipeableQueueItem';
import ConfirmationBottomSheet from '../shared/ConfirmationBottomSheet';
import { SplitJobModal } from '../../components/SplitJobModal';
import { remainingAtDepartment, remainingAtProduction, unproducedOrderQty } from '../../hardening/process2Manufacturing';

interface MobileDepartmentQueueScreenProps {
  department: Department;
  currentUser?: UserProfile | null;
  jobCards?: JobCard[];
  movements?: MaterialMovement[];
  onBack: () => void;
  onAcceptMovement?: (movementId: string, remarks?: string) => Promise<void> | any;
  onSelectJobCard?: (jobCardNo: string) => void;
  onQuickTransfer?: (jobCard: JobCard) => void;
  onOpenScanner?: () => void;
  isOnline?: boolean;
}

export const MobileDepartmentQueueScreen: React.FC<MobileDepartmentQueueScreenProps> = ({
  department,
  currentUser,
  jobCards = [],
  movements = [],
  onBack,
  onAcceptMovement = async (_id: string, _remarks?: string) => {},
  onSelectJobCard,
  onQuickTransfer,
  onOpenScanner,
  isOnline = true
}) => {
  const [activeQueueTab, setActiveQueueTab] = useState<'ingress' | 'wip'>('ingress');
  const [searchQuery, setSearchQuery] = useState('');
  const [confirmMovement, setConfirmMovement] = useState<MaterialMovement | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [selectedJobNos, setSelectedJobNos] = useState<string[]>([]);
  const [splitTargetJob, setSplitTargetJob] = useState<JobCard | null>(null);

  const deptLower = String(department || '').toLowerCase();

  // 1. Pending Ingress Movements targeting this station
  const pendingIngress = useMemo(() => {
    if (!Array.isArray(movements)) return [];
    return movements.filter(
      (m) =>
        m &&
        String(m.toDepartment || '').toLowerCase() === deptLower &&
        !m.accepted &&
        m.issueStatus !== 'Rejected'
    );
  }, [movements, deptLower]);

  // 2. Active WIP Jobs currently residing at this station
  const currentWipJobs = useMemo(() => {
    if (!Array.isArray(jobCards)) return [];
    return jobCards.filter((j) => {
      if (!j || j.status === 'Completed' || j.currentDepartment === 'Completed' || j.completed) return false;
      if (String(j.currentDepartment || '').toLowerCase() === deptLower) return true;
      if (deptLower === 'production') {
        return unproducedOrderQty(j, movements) > 0 || remainingAtProduction(j, movements) > 0;
      }
      return remainingAtDepartment(j, movements, department) > 0;
    });
  }, [jobCards, deptLower, department, movements]);

  // Filtered lists based on search input
  const filteredIngress = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return pendingIngress;
    return pendingIngress.filter((m) => {
      if (!m) return false;
      const targetJc = String(m.jobCardNo || '').toLowerCase();
      const jc = (Array.isArray(jobCards) ? jobCards : []).find(
        (j) => j && String(j.jobCardNo || '').toLowerCase() === targetJc
      );
      return (
        String(m.jobCardNo || '').toLowerCase().includes(q) ||
        String(m.movementId || '').toLowerCase().includes(q) ||
        String(m.fromDepartment || '').toLowerCase().includes(q) ||
        (jc && (String(jc.partyName || '').toLowerCase().includes(q) || String(jc.itemName || '').toLowerCase().includes(q)))
      );
    });
  }, [pendingIngress, searchQuery, jobCards]);

  const filteredWipJobs = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return currentWipJobs;
    return currentWipJobs.filter((j) => {
      if (!j) return false;
      return (
        String(j.jobCardNo || '').toLowerCase().includes(q) ||
        String(j.partyName || '').toLowerCase().includes(q) ||
        String(j.itemName || '').toLowerCase().includes(q) ||
        (j.materialGrade && String(j.materialGrade).toLowerCase().includes(q)) ||
        (j.heatNo && String(j.heatNo).toLowerCase().includes(q))
      );
    });
  }, [currentWipJobs, searchQuery]);

  // Handle Confirmed Ingress Acceptance
  const handleExecuteAcceptance = async () => {
    if (!confirmMovement) return;
    try {
      await onAcceptMovement(confirmMovement.movementId);
      setToastMessage(`Accepted ${confirmMovement.quantity} KG at ${department}`);
      setTimeout(() => setToastMessage(null), 2500);
      setConfirmMovement(null);
    } catch (err: any) {
      console.error("Failed to accept movement in queue", err);
      setToastMessage(err?.message || "Failed to accept movement. Please retry.");
      setTimeout(() => setToastMessage(null), 3000);
    }
  };

  return (
    <div className="flex flex-col min-h-full space-y-3 select-none pb-8">
      {/* Top Station Header */}
      <div className="flex items-center justify-between gap-2 p-3 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
        <div className="flex items-center gap-2.5">
          <button
            onClick={onBack}
            className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-200 transition cursor-pointer"
            aria-label="Back to Stations"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h2 className="text-sm font-extrabold uppercase tracking-tight text-slate-900 dark:text-white">
              {department} Workstation
            </h2>
            <p className="text-[10.5px] text-slate-500 font-mono">
              {pendingIngress.length} Ingress Pending • {currentWipJobs.length} Active WIP
            </p>
          </div>
        </div>

        {onOpenScanner && (
          <button
            onClick={onOpenScanner}
            className="px-3 py-2 rounded-xl bg-[#3B82F6] hover:bg-blue-600 text-white font-bold text-xs flex items-center gap-1.5 shadow-xs transition cursor-pointer"
          >
            <span>Scan Ingress</span>
          </button>
        )}
      </div>

      {/* Toast feedback banner */}
      {toastMessage && (
        <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs font-bold flex items-center gap-2 animate-fade-in shadow-xs">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Search Input Bar */}
      <div className="relative">
        <Search className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={`Search ${department} queues...`}
          className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl text-xs text-slate-900 dark:text-white placeholder-slate-400 focus:outline-hidden focus:border-blue-500 shadow-xs"
        />
      </div>

      {/* Segmented Tab Toggles */}
      <div className="flex bg-slate-200/70 dark:bg-slate-800/60 p-1 rounded-2xl gap-1">
        <button
          onClick={() => setActiveQueueTab('ingress')}
          className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer min-h-[44px] ${
            activeQueueTab === 'ingress'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Clock className="h-4 w-4 text-amber-500" />
          <span>Pending Ingress</span>
          {pendingIngress.length > 0 && (
            <span className="px-1.5 py-0.2 bg-amber-500 text-slate-950 rounded-full text-[10px] font-extrabold">
              {pendingIngress.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveQueueTab('wip')}
          className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer min-h-[44px] ${
            activeQueueTab === 'wip'
              ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Layers className="h-4 w-4 text-[#3B82F6]" />
          <span>Current WIP</span>
          {currentWipJobs.length > 0 && (
            <span className="px-1.5 py-0.2 bg-blue-500 text-white rounded-full text-[10px] font-extrabold">
              {currentWipJobs.length}
            </span>
          )}
        </button>
      </div>

      {/* Queue Content List */}
      <div className="space-y-3">
        {/* PENDING INGRESS LIST */}
        {activeQueueTab === 'ingress' && (
          <div>
            {filteredIngress.length === 0 ? (
              <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 space-y-2">
                <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto" />
                <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase">
                  No Pending Ingress
                </h4>
                <p className="text-[11px] text-slate-500">
                  All incoming transfers for {department} have been accepted and processed.
                </p>
              </div>
            ) : (
              filteredIngress.map((mov) => {
                const targetJc = String(mov.jobCardNo || '').toLowerCase();
                const jc = (Array.isArray(jobCards) ? jobCards : []).find(
                  (j) => j && String(j.jobCardNo || '').toLowerCase() === targetJc
                );
                return (
                  <SwipeableQueueItem
                    key={mov.movementId}
                    movement={mov}
                    jobCard={jc}
                    onAccept={(m) => setConfirmMovement(m)}
                    onTransfer={onQuickTransfer}
                    onViewDetails={onSelectJobCard}
                    isAcceptable={true}
                  />
                );
              })
            )}
          </div>
        )}

        {/* CURRENT WIP LIST */}
        {activeQueueTab === 'wip' && (
          <div>
            {filteredWipJobs.length === 0 ? (
              <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 space-y-2">
                <Package className="h-8 w-8 text-blue-500 mx-auto" />
                <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase">
                  No Active WIP Batches
                </h4>
                <p className="text-[11px] text-slate-500">
                  No jobs currently stationed at {department}. Accept incoming transfers from Ingress to start work.
                </p>
              </div>
            ) : (
              <>
                {selectedJobNos.length > 0 && (
                  <div className="p-3 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 rounded-2xl flex items-center justify-between shadow-xs">
                    <span className="text-xs font-bold text-blue-900 dark:text-blue-200">
                      {selectedJobNos.length} Job{selectedJobNos.length > 1 ? 's' : ''} Selected for Batch Manifest
                    </span>
                    <button
                      onClick={() => {
                        const firstJob = filteredWipJobs.find(j => selectedJobNos.includes(j.jobCardNo));
                        if (firstJob && onQuickTransfer) {
                          onQuickTransfer(firstJob);
                        }
                      }}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl flex items-center gap-1 cursor-pointer"
                    >
                      <Truck className="h-3.5 w-3.5" />
                      <span>Batch Action</span>
                    </button>
                  </div>
                )}
                {filteredWipJobs.map((jc) => {
                  const isSelected = selectedJobNos.includes(jc.jobCardNo);
                  return (
                    <div
                      key={jc.jobCardNo}
                      className={`p-4 rounded-2xl border transition shadow-xs ${
                        isSelected
                          ? 'bg-blue-50/50 dark:bg-blue-950/30 border-blue-300 dark:border-blue-800'
                          : 'bg-white dark:bg-slate-900 border-slate-200/90 dark:border-slate-800'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedJobNos(prev => [...prev, jc.jobCardNo]);
                              } else {
                                setSelectedJobNos(prev => prev.filter(id => id !== jc.jobCardNo));
                              }
                            }}
                            className="rounded border-slate-300 dark:border-slate-700 text-blue-600 focus:ring-blue-500 h-4 w-4 accent-blue-600 cursor-pointer"
                          />
                          <div>
                            <span className="font-mono text-xs font-extrabold text-[#3B82F6] bg-blue-50 dark:bg-blue-950/60 px-2 py-0.5 rounded-md border border-blue-200/60 dark:border-blue-900/40">
                              {jc.jobCardNo}
                            </span>
                            <h4 className="text-xs font-bold text-slate-900 dark:text-white mt-1">
                              {jc.partyName || 'PMW Internal'}
                            </h4>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="text-[10px] font-mono text-slate-400 block">Target Mass</span>
                          <span className="text-xs font-extrabold font-mono text-slate-900 dark:text-white">{jc.orderQty || 0} {jc.unit || 'KG'}</span>
                        </div>
                      </div>

                      <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-850/60 border border-slate-100 dark:border-slate-800 text-xs">
                        <p className="font-semibold text-slate-800 dark:text-slate-200">{jc.itemName || 'Batch Item'}</p>
                        <div className="flex items-center gap-3 mt-1 text-[10.5px] font-mono text-slate-500">
                          <span>Grade: <strong className="text-slate-700 dark:text-slate-300">{jc.materialGrade || 'Std'}</strong></span>
                          <span>Heat: <strong className="text-slate-700 dark:text-slate-300">{jc.heatNo || 'N/A'}</strong></span>
                        </div>
                      </div>

                      {/* Actions for WIP Items */}
                      <div className="flex items-center gap-2 pt-1 border-t border-slate-100 dark:border-slate-800/80">
                        {onQuickTransfer && (
                          <button
                            onClick={() => onQuickTransfer(jc)}
                            className="flex-1 min-h-[44px] py-2 px-3 rounded-xl bg-[#3B82F6] hover:bg-blue-600 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs transition cursor-pointer active:scale-98"
                          >
                            <Truck className="h-4 w-4" />
                            <span>Transfer Downstream</span>
                          </button>
                        )}

                        <button
                          onClick={() => setSplitTargetJob(jc)}
                          className="min-h-[44px] px-3 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 font-bold text-xs flex items-center justify-center gap-1.5 transition cursor-pointer active:scale-98"
                          title="Split Job Card"
                        >
                          <GitBranch className="h-4 w-4" />
                          <span>Split</span>
                        </button>

                        {onSelectJobCard && (
                          <button
                            onClick={() => onSelectJobCard(jc.jobCardNo)}
                            className="min-h-[44px] px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 font-bold text-xs flex items-center justify-center gap-1 transition cursor-pointer active:scale-98"
                          >
                            <span>Details</span>
                            <ChevronRight className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}
      </div>

      {/* Confirmation Bottom Sheet for Ingress Acceptance */}
      <ConfirmationBottomSheet
        isOpen={!!confirmMovement}
        onClose={() => setConfirmMovement(null)}
        onConfirm={handleExecuteAcceptance}
        title="Confirm Custody Acceptance"
        description={
          confirmMovement
            ? `Accept custody of ${confirmMovement.quantity} KG of material for Job Card ${confirmMovement.jobCardNo} from ${confirmMovement.fromDepartment} into ${department}?`
            : ''
        }
        confirmLabel="Accept Ingress"
        variant="success"
      />

      {splitTargetJob && (
        <SplitJobModal
          isOpen={!!splitTargetJob}
          onClose={() => setSplitTargetJob(null)}
          jobCard={splitTargetJob}
          currentUser={currentUser}
          onSuccess={() => setSplitTargetJob(null)}
        />
      )}
    </div>
  );
};

export default MobileDepartmentQueueScreen;
