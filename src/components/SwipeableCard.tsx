import React, { useState } from 'react';
import { motion, PanInfo, useMotionValue, useTransform } from 'motion/react';
import { ArrowRight, Truck, Check, Sparkles } from 'lucide-react';

interface SwipeableCardProps {
  children: React.ReactNode;
  onSwipeRight?: () => void;
  onSwipeLeft?: () => void;
  rightLabel?: string;
  leftLabel?: string;
  rightIcon?: React.ReactNode;
  leftIcon?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}

export const SwipeableCard: React.FC<SwipeableCardProps> = ({
  children,
  onSwipeRight,
  onSwipeLeft,
  rightLabel = 'Quick Transfer',
  leftLabel = 'Move to Next Dept',
  rightIcon = <ArrowRight className="h-4 w-4" />,
  leftIcon = <Truck className="h-4 w-4" />,
  disabled = false,
  className = '',
}) => {
  const [isSwiping, setIsSwiping] = useState(false);
  const [swipeAction, setSwipeAction] = useState<'right' | 'left' | null>(null);
  const x = useMotionValue(0);

  // Background color opacity & scale transforms based on swipe drag distance
  const opacityRight = useTransform(x, [20, 100], [0.3, 1]);
  const opacityLeft = useTransform(x, [-100, -20], [1, 0.3]);
  const scaleRight = useTransform(x, [0, 100], [0.85, 1.1]);
  const scaleLeft = useTransform(x, [-100, 0], [1.1, 0.85]);

  const handleDrag = (_: any, info: PanInfo) => {
    if (disabled) return;
    setIsSwiping(true);
    if (info.offset.x > 40 && onSwipeRight) {
      setSwipeAction('right');
    } else if (info.offset.x < -40 && onSwipeLeft) {
      setSwipeAction('left');
    } else {
      setSwipeAction(null);
    }
  };

  const handleDragEnd = (_: any, info: PanInfo) => {
    setIsSwiping(false);
    const threshold = 80; // Minimum drag distance to trigger gesture

    if (info.offset.x > threshold && onSwipeRight && !disabled) {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate(40); } catch (_) {}
      }
      onSwipeRight();
    } else if (info.offset.x < -threshold && onSwipeLeft && !disabled) {
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate(40); } catch (_) {}
      }
      onSwipeLeft();
    }

    setSwipeAction(null);
  };

  return (
    <div className={`relative overflow-hidden rounded-xl touch-pan-y ${className}`}>
      {/* Background action reveal indicator when dragging RIGHT (Rightwards swipe) */}
      {onSwipeRight && (
        <motion.div
          style={{ opacity: opacityRight }}
          className="absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-emerald-600 to-teal-600 text-white flex items-center justify-start pl-4 gap-2 rounded-l-xl z-0"
        >
          <motion.div style={{ scale: scaleRight }} className="flex items-center gap-1.5 font-bold text-xs">
            {rightIcon}
            <span>{rightLabel}</span>
          </motion.div>
        </motion.div>
      )}

      {/* Background action reveal indicator when dragging LEFT (Leftwards swipe) */}
      {onSwipeLeft && (
        <motion.div
          style={{ opacity: opacityLeft }}
          className="absolute inset-y-0 right-0 w-1/2 bg-gradient-to-l from-indigo-600 to-purple-600 text-white flex items-center justify-end pr-4 gap-2 rounded-r-xl z-0"
        >
          <motion.div style={{ scale: scaleLeft }} className="flex items-center gap-1.5 font-bold text-xs">
            <span>{leftLabel}</span>
            {leftIcon}
          </motion.div>
        </motion.div>
      )}

      {/* Interactive Card Body */}
      <motion.div
        drag={disabled ? false : 'x'}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.4}
        dragSnapToOrigin={true}
        onDrag={handleDrag}
        onDragEnd={handleDragEnd}
        style={{ x }}
        className={`relative z-10 transition-shadow ${
          isSwiping ? 'shadow-xl cursor-grabbing' : 'cursor-grab'
        }`}
      >
        {children}

        {/* Swipe hint handle for touch/mobile devices */}
        {!disabled && (onSwipeRight || onSwipeLeft) && (
          <div className="absolute top-2 right-2 md:hidden flex items-center gap-1 text-[9px] text-slate-400 dark:text-slate-500 bg-slate-100/80 dark:bg-slate-800/80 px-1.5 py-0.5 rounded-full backdrop-blur-xs pointer-events-none select-none">
            <Sparkles className="h-2.5 w-2.5 text-indigo-500" />
            <span>Swipe card</span>
          </div>
        )}
      </motion.div>
    </div>
  );
};

export default SwipeableCard;
