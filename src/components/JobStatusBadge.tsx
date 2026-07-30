import React from 'react';
import { 
  Clock, 
  Activity, 
  CheckCircle2, 
  XCircle, 
  ArrowRightCircle, 
  HelpCircle 
} from 'lucide-react';
import { JobCardStatus } from '../types';

interface JobStatusBadgeProps {
  status: JobCardStatus | string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  showIcon?: boolean;
  className?: string;
}

export const JobStatusBadge: React.FC<JobStatusBadgeProps> = ({
  status,
  size = 'md',
  showIcon = true,
  className = ''
}) => {
  const getStatusConfig = (st: string) => {
    switch (st) {
      case 'Pending':
        return {
          bg: 'bg-amber-100 dark:bg-amber-950/50',
          text: 'text-amber-800 dark:text-amber-300',
          border: 'border-amber-200 dark:border-amber-900/50',
          iconColor: 'text-amber-600 dark:text-amber-400',
          Icon: Clock,
          label: 'Pending'
        };
      case 'In Process':
        return {
          bg: 'bg-blue-100 dark:bg-blue-950/50',
          text: 'text-blue-800 dark:text-blue-300',
          border: 'border-blue-200 dark:border-blue-900/50',
          iconColor: 'text-blue-600 dark:text-blue-400',
          Icon: Activity,
          label: 'In Process'
        };
      case 'Completed':
        return {
          bg: 'bg-emerald-100 dark:bg-emerald-950/50',
          text: 'text-emerald-800 dark:text-emerald-300',
          border: 'border-emerald-200 dark:border-emerald-900/50',
          iconColor: 'text-emerald-600 dark:text-emerald-400',
          Icon: CheckCircle2,
          label: 'Completed'
        };
      case 'Rejected':
        return {
          bg: 'bg-red-100 dark:bg-red-950/50',
          text: 'text-red-800 dark:text-red-300',
          border: 'border-red-200 dark:border-red-900/50',
          iconColor: 'text-red-600 dark:text-red-400',
          Icon: XCircle,
          label: 'Rejected'
        };
      case 'Pending Acceptance':
        return {
          bg: 'bg-purple-100 dark:bg-purple-950/50',
          text: 'text-purple-800 dark:text-purple-300',
          border: 'border-purple-200 dark:border-purple-900/50',
          iconColor: 'text-purple-600 dark:text-purple-400',
          Icon: ArrowRightCircle,
          label: 'Pending Acceptance'
        };
      default:
        return {
          bg: 'bg-slate-100 dark:bg-slate-800',
          text: 'text-slate-700 dark:text-slate-300',
          border: 'border-slate-200 dark:border-slate-700',
          iconColor: 'text-slate-500',
          Icon: HelpCircle,
          label: st || 'Unknown'
        };
    }
  };

  const config = getStatusConfig(status);
  const { Icon } = config;

  const sizeClasses = {
    xs: 'text-[8.5px] px-1.5 py-0.5 gap-1 font-bold',
    sm: 'text-[9.5px] sm:text-[10px] px-2 py-0.5 gap-1 font-bold',
    md: 'text-[10px] sm:text-[11px] px-2.5 py-1 gap-1.5 font-bold',
    lg: 'text-xs px-3 py-1.5 gap-2 font-extrabold'
  };

  const iconSizes = {
    xs: 'h-2.5 w-2.5',
    sm: 'h-3 w-3',
    md: 'h-3.5 w-3.5',
    lg: 'h-4 w-4'
  };

  return (
    <span className={`inline-flex items-center rounded-md uppercase tracking-wider border shrink-0 font-sans shadow-2xs ${config.bg} ${config.text} ${config.border} ${sizeClasses[size]} ${className}`}>
      {showIcon && <Icon className={`${iconSizes[size]} ${config.iconColor} shrink-0`} />}
      <span className="truncate">{config.label}</span>
    </span>
  );
};

export default JobStatusBadge;
