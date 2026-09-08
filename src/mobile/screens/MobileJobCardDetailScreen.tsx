import React, { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import QRCode from 'qrcode';
import { 
  ArrowLeft, 
  Share2, 
  QrCode, 
  Download, 
  Truck, 
  CheckCircle2, 
  Clock, 
  AlertTriangle, 
  Scale, 
  Layers, 
  User, 
  Calendar, 
  ShieldCheck, 
  FileText, 
  ArrowRight,
  Sparkles,
  Flame,
  Factory,
  Warehouse,
  Box
} from 'lucide-react';
import { JobCard, MaterialMovement, UserProfile, Department } from '../../types';
import { getJobCardProcessMetrics } from '../../lib/metrics';
import { JobStatusBadge } from '../../components/JobStatusBadge';
import MobileTransferSplitSheet from '../shared/MobileTransferSplitSheet';

interface MobileJobCardDetailScreenProps {
  jobCard: JobCard;
  movements?: MaterialMovement[];
  currentUser?: UserProfile | null;
  onBack: () => void;
  onAcceptMovement?: (movementId: string, remarks?: string) => Promise<void> | any;
  onSubmitTransfer?: (movements: {
    jobCardNo: string;
    fromDepartment: Department;
    toDepartment: Department | 'Completed';
    quantity: number;
    remarks?: string;
  }[]) => Promise<void> | void;
}

export const MobileJobCardDetailScreen: React.FC<MobileJobCardDetailScreenProps> = ({
  jobCard,
  movements = [],
  currentUser,
  onBack,
  onAcceptMovement,
  onSubmitTransfer
}) => {
  const [showQRModal, setShowQRModal] = useState(false);
  const [showTransferSheet, setShowTransferSheet] = useState(false);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);

  // Compute 360° metrics
  const m = useMemo(() => getJobCardProcessMetrics(jobCard, movements), [jobCard, movements]);
  const filteredMovements = useMemo(
    () => (Array.isArray(movements) ? movements : []).filter(mov => mov && String(mov.jobCardNo || '').toLowerCase() === String(jobCard?.jobCardNo || '').toLowerCase()),
    [movements, jobCard]
  );

  // Pending ingress for current user's department
  const pendingMovementForUser = useMemo(() => {
    if (!currentUser?.department || !jobCard?.jobCardNo) return null;
    const targetJc = String(jobCard.jobCardNo).toLowerCase();
    const userDept = String(currentUser.department).toLowerCase();
    return (Array.isArray(movements) ? movements : []).find(
      mov =>
        mov &&
        String(mov.jobCardNo || '').toLowerCase() === targetJc &&
        String(mov.toDepartment || '').toLowerCase() === userDept &&
        !mov.accepted &&
        mov.issueStatus !== 'Rejected'
    );
  }, [movements, jobCard, currentUser]);

  // Generate QR code when QR modal is opened
  useEffect(() => {
    if (showQRModal && qrCanvasRef.current && jobCard?.jobCardNo) {
      QRCode.toCanvas(
        qrCanvasRef.current,
        jobCard.jobCardNo,
        {
          width: 220,
          margin: 1,
          color: { dark: '#000000', light: '#FFFFFF' }
        },
        (err) => {
          if (err) console.error("Error rendering QR code:", err);
        }
      );
    }
  }, [showQRModal, jobCard?.jobCardNo]);

  // Share tracking link
  const handleShare = () => {
    if (!jobCard?.jobCardNo) return;
    const url = `${window.location.origin}?jobCardNo=${jobCard.jobCardNo}`;
    if (navigator.share) {
      navigator.share({
        title: `Job Card ${jobCard.jobCardNo}`,
        text: `Trace live status for Job Card ${jobCard.jobCardNo} (${jobCard.itemName || ''})`,
        url
      }).catch(console.error);
    } else {
      navigator.clipboard.writeText(url);
      alert("Tracking link copied to clipboard!");
    }
  };

  if (!jobCard) return null;

  return (
    <div className="space-y-4 pb-20 select-none">
      {/* Top Header Card */}
      <div className="p-4 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <button
              onClick={onBack}
              className="p-2 rounded-2xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition cursor-pointer"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <span className="font-mono text-sm font-extrabold text-[#3B82F6] block">
                {jobCard.jobCardNo}
              </span>
              <h2 className="text-xs font-bold text-slate-900 dark:text-white">
                {jobCard.partyName || 'PMW Internal Customer'}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowQRModal(true)}
              className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition cursor-pointer"
              title="Show Workshop Barcode"
            >
              <QrCode className="h-4 w-4" />
            </button>
            <button
              onClick={handleShare}
              className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition cursor-pointer"
              title="Share Tracking Link"
            >
              <Share2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
          <JobStatusBadge 
            status={jobCard.status} 
            completed={jobCard.completed} 
            currentDepartment={jobCard.currentDepartment} 
          />
          <div className="text-right font-mono text-xs">
            <span className="text-[10px] text-slate-400 block uppercase">Target Mass</span>
            <span className="font-extrabold text-slate-900 dark:text-white">{jobCard.orderQty || 0} KG</span>
          </div>
        </div>
      </div>

      {/* Production & Engineering Specs */}
      <div className="p-4 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-3">
        <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 pb-1 border-b border-slate-100 dark:border-slate-800">
          Manufacturing Specifications
        </h3>

        <div className="grid grid-cols-2 gap-3 text-xs font-mono">
          <div>
            <span className="text-[10px] text-slate-400 uppercase block">Finished Item</span>
            <span className="font-bold text-slate-800 dark:text-slate-200">{jobCard.itemName || 'Batch Part'}</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-400 uppercase block">Material Grade</span>
            <span className="font-bold text-slate-800 dark:text-slate-200">{jobCard.materialGrade || 'Standard Grade'}</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-400 uppercase block">Raw Wire Size</span>
            <span className="font-bold text-slate-800 dark:text-slate-200">{jobCard.wireSize || 'Std Wire'}</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-400 uppercase block">Heat Batch No</span>
            <span className="font-bold text-slate-800 dark:text-slate-200">{jobCard.heatNo || 'Auto'}</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-400 uppercase block">Heat Treatment</span>
            <span className={`font-bold ${jobCard.heatTreatmentRequired ? 'text-rose-600' : 'text-slate-500'}`}>
              {jobCard.heatTreatmentRequired ? 'Furnace Required' : 'Bypassed'}
            </span>
          </div>
          <div>
            <span className="text-[10px] text-slate-400 uppercase block">Plating Coating</span>
            <span className="font-bold text-pink-600 truncate block">{jobCard.platingType || 'Natural'}</span>
          </div>
        </div>
      </div>

      {/* 360° Vertical Node Timeline */}
      <div className="p-4 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-xs space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
          <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500">
            360° Movement Ledger ({filteredMovements.length})
          </h3>
          <span className="text-[10px] font-mono text-slate-400">Chronological</span>
        </div>

        {filteredMovements.length === 0 ? (
          <div className="py-6 text-center text-slate-400 text-xs font-mono">
            No inter-station movements recorded yet.
          </div>
        ) : (
          <div className="relative pl-6 space-y-4 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-800">
            {filteredMovements.map((mov) => {
              const transDate = mov.transferDate ? new Date(mov.transferDate) : null;
              const dateStr = transDate && !isNaN(transDate.getTime()) 
                ? transDate.toLocaleDateString([], { hour: '2-digit', minute: '2-digit' }) 
                : 'Recorded';
              return (
                <div key={mov.movementId} className="relative space-y-1 text-xs">
                  {/* Node Bullet */}
                  <div className={`absolute -left-6 top-1 h-3.5 w-3.5 rounded-full border-2 bg-white dark:bg-slate-900 ${
                    mov.accepted ? 'border-emerald-500' : 'border-amber-500 animate-pulse'
                  }`} />

                  <div className="flex items-center justify-between font-mono text-[11px]">
                    <span className="font-bold text-slate-800 dark:text-slate-200">
                      {mov.fromDepartment} &rarr; {mov.toDepartment}
                    </span>
                    <span className="font-extrabold text-[#3B82F6]">
                      {mov.quantity || 0} KG
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                    <span>By: {mov.transferBy || 'Operator'}</span>
                    <span>{dateStr}</span>
                  </div>

                  {mov.accepted ? (
                    <div className="p-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      <span>Accepted by {mov.acceptedBy || 'Crew'}</span>
                    </div>
                  ) : (
                    <div className="p-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 text-[10px] font-bold flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      <span>Transit verification pending at {mov.toDepartment}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Sticky Bottom Contextual Actions */}
      <div className="fixed bottom-0 left-0 right-0 p-3 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 flex gap-2 z-40 pb-[max(env(safe-area-inset-bottom,0px),0.75rem)]">
        {pendingMovementForUser && onAcceptMovement ? (
          <button
            onClick={() => onAcceptMovement(pendingMovementForUser.movementId)}
            className="flex-1 min-h-[46px] py-2.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md active:scale-98 transition cursor-pointer"
          >
            <CheckCircle2 className="h-4 w-4" />
            <span>Accept Ingress ({pendingMovementForUser.quantity} KG)</span>
          </button>
        ) : (
          <button
            onClick={() => setShowTransferSheet(true)}
            className="flex-1 min-h-[46px] py-2.5 rounded-2xl bg-[#3B82F6] hover:bg-blue-600 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md active:scale-98 transition cursor-pointer"
          >
            <Truck className="h-4 w-4" />
            <span>Transfer / Partial Split</span>
          </button>
        )}
      </div>

      {/* Workshop QR Code Modal */}
      <AnimatePresence>
        {showQRModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 select-none">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowQRModal(false)}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-xs"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-xs bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200 dark:border-slate-800 shadow-2xl z-10 text-center space-y-4"
            >
              <h3 className="text-sm font-extrabold uppercase text-slate-900 dark:text-white">
                Job Card Barcode QR
              </h3>
              <div className="flex justify-center p-3 bg-white rounded-2xl border border-slate-200 shadow-inner">
                <canvas ref={qrCanvasRef} />
              </div>
              <p className="font-mono text-xs font-bold text-slate-700 dark:text-slate-300">
                {jobCard.jobCardNo}
              </p>
              <button
                onClick={() => setShowQRModal(false)}
                className="w-full py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs cursor-pointer"
              >
                Close
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Transfer & Partial Split Sheet */}
      <AnimatePresence>
        {showTransferSheet && currentUser && (
          <MobileTransferSplitSheet
            isOpen={showTransferSheet}
            onClose={() => setShowTransferSheet(false)}
            jobCard={jobCard}
            movements={movements}
            currentUser={currentUser}
            onSubmitTransfer={async (movList) => {
              if (onSubmitTransfer) {
                for (const mov of movList) {
                  await onSubmitTransfer([mov]);
                }
              }
              setShowTransferSheet(false);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

export default MobileJobCardDetailScreen;
