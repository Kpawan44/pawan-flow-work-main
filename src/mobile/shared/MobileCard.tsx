import React from 'react';

interface MobileCardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  variant?: 'default' | 'accent' | 'warning' | 'success' | 'danger';
  highlightBorder?: boolean;
}

export const MobileCard: React.FC<MobileCardProps> = ({
  children,
  className = '',
  onClick,
  variant = 'default',
  highlightBorder = false
}) => {
  const getVariantStyles = () => {
    switch (variant) {
      case 'accent':
        return 'bg-blue-50/70 dark:bg-blue-950/30 border-blue-200 dark:border-blue-850';
      case 'warning':
        return 'bg-amber-50/70 dark:bg-amber-950/30 border-amber-200 dark:border-amber-850';
      case 'success':
        return 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-850';
      case 'danger':
        return 'bg-rose-50/70 dark:bg-rose-950/30 border-rose-200 dark:border-rose-850';
      default:
        return 'bg-white dark:bg-slate-900 border-slate-200/90 dark:border-slate-800';
    }
  };

  return (
    <div
      onClick={onClick}
      className={`rounded-2xl border p-4 shadow-xs transition-all ${getVariantStyles()} ${
        highlightBorder ? 'ring-2 ring-blue-500/40' : ''
      } ${onClick ? 'cursor-pointer active:scale-[0.99]' : ''} ${className}`}
    >
      {children}
    </div>
  );
};

export default MobileCard;
