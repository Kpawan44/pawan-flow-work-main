import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, CheckCircle2, X, RefreshCw, ShieldAlert } from 'lucide-react';

interface ConfirmationBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'primary' | 'success';
}

export const ConfirmationBottomSheet: React.FC<ConfirmationBottomSheetProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm Action',
  cancelLabel = 'Cancel',
  variant = 'primary'
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastClickTime, setLastClickTime] = useState<number>(0);

  if (!isOpen) return null;

  const handleConfirmClick = async () => {
    const now = Date.now();
    // 1000ms double-tap protection
    if (now - lastClickTime < 1000 || isProcessing) {
      return;
    }
    setLastClickTime(now);
    setIsProcessing(true);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      console.error("Confirmation action failed", err);
    } finally {
      setIsProcessing(false);
    }
  };

  const getConfirmButtonStyles = () => {
    switch (variant) {
      case 'danger':
        return 'bg-rose-600 hover:bg-rose-700 text-white';
      case 'warning':
        return 'bg-amber-600 hover:bg-amber-700 text-white';
      case 'success':
        return 'bg-emerald-600 hover:bg-emerald-700 text-white';
      default:
        return 'bg-[#3B82F6] hover:bg-blue-600 text-white';
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

      {/* Sheet */}
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        className="relative w-full bg-white dark:bg-slate-900 rounded-t-3xl border-t border-slate-200 dark:border-slate-800 shadow-2xl p-5 pb-[max(env(safe-area-inset-bottom,0px),1.5rem)] space-y-4"
      >
        <div className="flex justify-center -mt-2 pb-1">
          <div className="w-12 h-1.5 rounded-full bg-slate-300 dark:bg-slate-700" />
        </div>

        <div className="flex items-start gap-3">
          <div className={`p-2.5 rounded-2xl shrink-0 ${
            variant === 'danger' ? 'bg-rose-500/20 text-rose-600' :
            variant === 'warning' ? 'bg-amber-500/20 text-amber-600' :
            variant === 'success' ? 'bg-emerald-500/20 text-emerald-600' :
            'bg-blue-500/20 text-[#3B82F6]'
          }`}>
            {variant === 'danger' ? <ShieldAlert className="h-6 w-6" /> :
             variant === 'warning' ? <AlertTriangle className="h-6 w-6" /> :
             <CheckCircle2 className="h-6 w-6" />}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-extrabold text-slate-900 dark:text-white uppercase tracking-tight">
              {title}
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
              {description}
            </p>
          </div>
        </div>

        {/* Action Buttons with Large Touch Targets */}
        <div className="flex gap-3 pt-2">
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="flex-1 min-h-[48px] py-3 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold text-xs border border-slate-200/80 dark:border-slate-700 cursor-pointer disabled:opacity-50 active:scale-98 transition"
          >
            {cancelLabel}
          </button>
          <button
            onClick={handleConfirmClick}
            disabled={isProcessing}
            className={`flex-1 min-h-[48px] py-3 rounded-2xl font-bold text-xs shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 active:scale-98 transition ${getConfirmButtonStyles()}`}
          >
            {isProcessing ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                <span>Executing...</span>
              </>
            ) : (
              <span>{confirmLabel}</span>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default ConfirmationBottomSheet;
