import React, { useState } from 'react';
import { motion, useMotionValue, useTransform } from 'motion/react';
import { 
  CheckCircle2, 
  ArrowRight, 
  Clock, 
  Package, 
  Layers, 
  Eye, 
  Truck,
  Sparkles
} from 'lucide-react';
import { MaterialMovement, JobCard } from '../../types';

interface SwipeableQueueItemProps {
  movement: MaterialMovement;
  jobCard?: JobCard;
  onAccept?: (movement: MaterialMovement) => void;
  onTransfer?: (jobCard: JobCard) => void;
  onViewDetails?: (jobCardNo: string) => void;
  isAcceptable?: boolean;
}

export const SwipeableQueueItem: React.FC<SwipeableQueueItemProps> = ({
  movement,
  jobCard,
  onAccept,
  onTransfer,
  onViewDetails,
  isAcceptable = true
}) => {
  const [swipedAction, setSwipedAction] = useState<'accept' | 'transfer' | null>(null);
  const [lastActionTime, setLastActionTime] = useState<number>(0);
  const x = useMotionValue(0);

  // Background action indicators driven by drag distance
  const bgAcceptOpacity = useTransform(x, [20, 80], [0, 1]);
  const bgTransferOpacity = useTransform(x, [-80, -20], [1, 0]);

  // Debounced action triggers
  const handleAcceptClick = () => {
    const now = Date.now();
    if (now - lastActionTime < 1000) return;
    setLastActionTime(now);
    if (onAccept) {
      onAccept(movement);
    }
  };

  const handleTransferClick = () => {
    const now = Date.now();
    if (now - lastActionTime < 1000) return;
    setLastActionTime(now);
    if (onTransfer && jobCard) {
      onTransfer(jobCard);
    }
  };

  const handleDragEnd = (_: any, info: any) => {
    if (info.offset.x > 80 && isAcceptable) {
      handleAcceptClick();
    } else if (info.offset.x < -80 && jobCard) {
      handleTransferClick();
    }
  };

  return (
    <div className="relative overflow-hidden rounded-2xl bg-slate-100 dark:bg-slate-800/80 mb-3 shadow-xs">
      {/* Background Revealed Actions */}
      {isAcceptable && (
        <motion.div
          style={{ opacity: bgAcceptOpacity }}
          className="absolute inset-y-0 left-0 w-1/2 bg-emerald-600 flex items-center px-6 text-white font-bold text-xs gap-2 rounded-l-2xl"
        >
          <CheckCircle2 className="h-5 w-5" />
          <span>Swipe to Accept</span>
        </motion.div>
      )}

      {jobCard && (
        <motion.div
          style={{ opacity: bgTransferOpacity }}
          className="absolute inset-y-0 right-0 w-1/2 bg-[#3B82F6] flex items-center justify-end px-6 text-white font-bold text-xs gap-2 rounded-r-2xl"
        >
          <span>Swipe to Transfer</span>
          <Truck className="h-5 w-5" />
        </motion.div>
      )}

      {/* Foreground Draggable Card */}
      <motion.div
        drag="x"
        dragConstraints={{ left: jobCard ? -90 : 0, right: isAcceptable ? 90 : 0 }}
        dragElastic={0.15}
        onDragEnd={handleDragEnd}
        style={{ x }}
        className="relative bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/90 dark:border-slate-800 space-y-3 z-10"
      >
        {/* Header: IDs and Timestamp */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-mono text-xs font-extrabold text-[#3B82F6] bg-blue-50 dark:bg-blue-950/60 px-2 py-0.5 rounded-md border border-blue-200/60 dark:border-blue-900/40">
                {movement.jobCardNo}
              </span>
              <span className="text-[10px] font-mono text-slate-400">
                {movement.movementId}
              </span>
            </div>
            {jobCard && (
              <h4 className="text-xs font-bold text-slate-900 dark:text-white mt-1">
                {jobCard.partyName}
              </h4>
            )}
          </div>

          <div className="text-right shrink-0">
            <span className="text-[10px] text-slate-400 font-mono flex items-center justify-end gap-1">
              <Clock className="h-3 w-3" />
              {(() => {
                const d = movement.transferDate ? new Date(movement.transferDate) : null;
                return d && !isNaN(d.getTime()) ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Recorded';
              })()}
            </span>
            <span className="text-[9px] uppercase font-bold text-slate-400 block mt-0.5">
              By {movement.transferBy || 'Crew'}
            </span>
          </div>
        </div>

        {/* Item Description & Station Route */}
        <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-850/60 border border-slate-100 dark:border-slate-800 text-xs">
          <p className="font-semibold text-slate-800 dark:text-slate-200">
            {jobCard?.itemName || 'Manufacturing Batch'}
          </p>
          <div className="flex items-center justify-between mt-1 text-[11px] font-mono text-slate-500">
            <span>{movement.fromDepartment} → <strong className="text-[#3B82F6]">{movement.toDepartment}</strong></span>
            <span className="font-extrabold text-slate-900 dark:text-white text-xs">{movement.quantity} KG</span>
          </div>
        </div>

        {/* Metadata Grid (Grade, Heat, Remarks) */}
        {(jobCard?.materialGrade || jobCard?.heatNo || movement.remarks) && (
          <div className="flex items-center gap-3 text-[10px] text-slate-500 font-mono overflow-x-auto no-scrollbar">
            {jobCard?.materialGrade && (
              <span>Grade: <strong className="text-slate-700 dark:text-slate-300">{jobCard.materialGrade}</strong></span>
            )}
            {jobCard?.heatNo && (
              <span>Heat: <strong className="text-slate-700 dark:text-slate-300">{jobCard.heatNo}</strong></span>
            )}
            {movement.remarks && (
              <span className="truncate max-w-[120px]" title={movement.remarks}>
                Note: {movement.remarks}
              </span>
            )}
          </div>
        )}

        {/* Action Buttons (Large touch targets for gloves & fast factory taps) */}
        <div className="flex items-center gap-2 pt-1 border-t border-slate-100 dark:border-slate-800/80">
          {isAcceptable && (
            <button
              onClick={handleAcceptClick}
              className="flex-1 min-h-[44px] py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs transition cursor-pointer active:scale-98"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>Accept Ingress</span>
            </button>
          )}

          {jobCard && onTransfer && (
            <button
              onClick={handleTransferClick}
              className="flex-1 min-h-[44px] py-2 px-3 rounded-xl bg-[#3B82F6] hover:bg-blue-600 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-xs transition cursor-pointer active:scale-98"
            >
              <Truck className="h-4 w-4" />
              <span>Transfer</span>
            </button>
          )}

          {onViewDetails && (
            <button
              onClick={() => onViewDetails(movement.jobCardNo)}
              className="min-h-[44px] px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 font-bold text-xs flex items-center justify-center gap-1 transition cursor-pointer active:scale-98"
              title="View 360° Details"
            >
              <Eye className="h-4 w-4" />
              <span className="hidden sm:inline">Details</span>
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
};

export default SwipeableQueueItem;
