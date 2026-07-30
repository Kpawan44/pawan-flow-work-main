import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Search, 
  X, 
  FileText, 
  ArrowRight, 
  WifiOff, 
  Filter, 
  Clock, 
  CheckCircle2, 
  AlertTriangle, 
  Sparkles,
  Layers,
  ArrowUpDown,
  Tag,
  Building2,
  Package,
  ChevronRight,
  Hash,
  Boxes,
  UserCheck
} from 'lucide-react';
import { JobCard, MaterialMovement } from '../types';

interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  jobCards: JobCard[];
  movements: MaterialMovement[];
  onSelectJobCard: (jobCard: JobCard) => void;
  isOnline: boolean;
}

type SearchFieldFilter = 'all' | 'jobCardNo' | 'party' | 'itemCode' | 'itemName' | 'dept';

export default function GlobalSearchModal({
  isOpen,
  onClose,
  jobCards,
  movements,
  onSelectJobCard,
  isOnline
}: GlobalSearchModalProps) {
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<'all' | 'jobs' | 'movements'>('all');
  const [searchFieldFilter, setSearchFieldFilter] = useState<SearchFieldFilter>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Reset search when opening
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setActiveCategory('all');
      setSearchFieldFilter('all');
      setStatusFilter('all');
    }
  }, [isOpen]);

  // Handle ESC key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Create quick lookup map for job cards by JobCardNo
  const jobCardMap = useMemo(() => {
    const map = new Map<string, JobCard>();
    jobCards.forEach(j => {
      map.set(j.jobCardNo.toLowerCase(), j);
    });
    return map;
  }, [jobCards]);

  // Filtered Job Cards
  const filteredJobs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return jobCards.filter(j => {
      // Status filter
      if (statusFilter !== 'all') {
        if (statusFilter === 'Pending Acceptance' && j.status !== 'Pending Acceptance') return false;
        if (statusFilter === 'In Process' && j.status !== 'In Process') return false;
        if (statusFilter === 'Rejected' && j.status !== 'Rejected') return false;
        if (statusFilter === 'Completed' && j.status !== 'Completed') return false;
      }

      if (!q) return true;

      if (searchFieldFilter === 'jobCardNo') {
        return j.jobCardNo.toLowerCase().includes(q) || (j.orderNo && j.orderNo.toLowerCase().includes(q));
      }
      if (searchFieldFilter === 'party') {
        return j.partyName.toLowerCase().includes(q);
      }
      if (searchFieldFilter === 'itemCode') {
        return j.itemCode.toLowerCase().includes(q);
      }
      if (searchFieldFilter === 'itemName') {
        return j.itemName.toLowerCase().includes(q);
      }
      if (searchFieldFilter === 'dept') {
        return j.currentDepartment.toLowerCase().includes(q);
      }

      // Default 'all'
      return (
        j.jobCardNo.toLowerCase().includes(q) ||
        j.partyName.toLowerCase().includes(q) ||
        j.itemName.toLowerCase().includes(q) ||
        j.itemCode.toLowerCase().includes(q) ||
        j.currentDepartment.toLowerCase().includes(q) ||
        j.status.toLowerCase().includes(q) ||
        (j.orderNo && j.orderNo.toLowerCase().includes(q)) ||
        (j.materialType && j.materialType.toLowerCase().includes(q)) ||
        (j.createdBy && j.createdBy.toLowerCase().includes(q)) ||
        (j.operatorName && j.operatorName.toLowerCase().includes(q))
      );
    });
  }, [jobCards, query, statusFilter, searchFieldFilter]);

  // Filtered Material Movements
  const filteredMovements = useMemo(() => {
    const q = query.trim().toLowerCase();
    return movements.filter(m => {
      const parentJob = jobCardMap.get(m.jobCardNo.toLowerCase());

      // Status filter check
      if (statusFilter !== 'all') {
        if (statusFilter === 'Accepted' && !m.accepted) return false;
        if (statusFilter === 'Pending Acceptance' && m.accepted) return false;
        if (statusFilter === 'Rejected' && !m.remarks?.toLowerCase().includes('reject')) return false;
      }

      if (!q) return true;

      if (searchFieldFilter === 'jobCardNo') {
        return m.jobCardNo.toLowerCase().includes(q) || m.movementId.toLowerCase().includes(q);
      }
      if (searchFieldFilter === 'party') {
        return parentJob ? parentJob.partyName.toLowerCase().includes(q) : false;
      }
      if (searchFieldFilter === 'itemCode') {
        return parentJob ? parentJob.itemCode.toLowerCase().includes(q) : false;
      }
      if (searchFieldFilter === 'itemName') {
        return parentJob ? parentJob.itemName.toLowerCase().includes(q) : false;
      }
      if (searchFieldFilter === 'dept') {
        return m.fromDepartment.toLowerCase().includes(q) || m.toDepartment.toLowerCase().includes(q);
      }

      // Match against movement properties
      const matchMovement =
        m.movementId.toLowerCase().includes(q) ||
        m.jobCardNo.toLowerCase().includes(q) ||
        m.fromDepartment.toLowerCase().includes(q) ||
        m.toDepartment.toLowerCase().includes(q) ||
        (m.transferBy && m.transferBy.toLowerCase().includes(q)) ||
        (m.acceptedBy && m.acceptedBy.toLowerCase().includes(q)) ||
        (m.remarks && m.remarks.toLowerCase().includes(q)) ||
        (m.allottedLocation && m.allottedLocation.toLowerCase().includes(q)) ||
        (m.rackNo && m.rackNo.toLowerCase().includes(q)) ||
        m.quantity.toString().includes(q);

      // Match against parent job card properties if available
      const matchParentJob = parentJob
        ? parentJob.partyName.toLowerCase().includes(q) ||
          parentJob.itemName.toLowerCase().includes(q) ||
          parentJob.itemCode.toLowerCase().includes(q)
        : false;

      return matchMovement || matchParentJob;
    });
  }, [movements, query, statusFilter, searchFieldFilter, jobCardMap]);

  if (!isOpen) return null;

  const totalMatches = filteredJobs.length + filteredMovements.length;

  const searchChips: { id: SearchFieldFilter; label: string; icon: React.ReactNode }[] = [
    { id: 'all', label: 'All Fields', icon: <Search className="h-3 w-3" /> },
    { id: 'jobCardNo', label: 'Job Card No', icon: <Hash className="h-3 w-3" /> },
    { id: 'party', label: 'Party Name', icon: <Building2 className="h-3 w-3" /> },
    { id: 'itemCode', label: 'Item Code', icon: <Tag className="h-3 w-3" /> },
    { id: 'itemName', label: 'Item Name', icon: <Package className="h-3 w-3" /> },
    { id: 'dept', label: 'Department', icon: <Layers className="h-3 w-3" /> },
  ];

  const getPlaceholder = () => {
    switch (searchFieldFilter) {
      case 'jobCardNo': return 'Search specifically by Job Card No (e.g., JC-1002, ORD-55)...';
      case 'party': return 'Search specifically by Party / Customer Name...';
      case 'itemCode': return 'Search specifically by Item Code (e.g., ITM-808)...';
      case 'itemName': return 'Search specifically by Item Description / Name...';
      case 'dept': return 'Search specifically by Department name...';
      default: return 'Type Job Card No, Transfer Ref ID, Party Name, Item Code, Dept or Operator...';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-8 sm:pt-16 px-3 pb-6 bg-slate-900/65 backdrop-blur-sm animate-fade-in print:hidden">
      <div 
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[88vh] flex flex-col overflow-hidden text-slate-800 dark:text-slate-100"
        onClick={e => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <div className="p-2 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 shrink-0">
                <Search className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h3 className="font-sans font-extrabold text-sm sm:text-base text-slate-850 dark:text-white uppercase tracking-wider flex items-center gap-2">
                  <span>Offline Instant Search Engine</span>
                  {!isOnline && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 font-bold flex items-center gap-1">
                      <WifiOff className="h-3 w-3" /> Offline Active
                    </span>
                  )}
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  Search across active Job Cards and recent Material Movements directly from persistent local storage
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition cursor-pointer"
              title="Close search modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Search Input Control */}
          <div className="relative">
            <Search className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
            <input
              type="text"
              autoFocus
              placeholder={getPlaceholder()}
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="w-full pl-10 pr-10 py-2.5 text-xs sm:text-sm bg-white dark:bg-slate-850 border border-slate-300 dark:border-slate-700 rounded-xl focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 shadow-inner transition-all"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-3 top-3 p-0.5 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                title="Clear query"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Category-based Search Field Chips */}
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mr-1 flex items-center gap-1">
              <Filter className="h-3 w-3" /> Field Filter:
            </span>
            {searchChips.map(chip => {
              const isActive = searchFieldFilter === chip.id;
              return (
                <button
                  key={chip.id}
                  onClick={() => setSearchFieldFilter(chip.id)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold font-sans transition-all duration-200 cursor-pointer flex items-center gap-1.5 border ${
                    isActive
                      ? 'bg-amber-500 text-white border-amber-600 shadow-xs scale-[1.02]'
                      : 'bg-white dark:bg-slate-850 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-750 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {chip.icon}
                  <span>{chip.label}</span>
                </button>
              );
            })}
          </div>

          {/* Controls & Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-1 border-t border-slate-200/60 dark:border-slate-800/60">
            {/* Category Switcher Tabs */}
            <div className="flex items-center gap-1 bg-slate-200/70 dark:bg-slate-800/70 p-1 rounded-xl border border-slate-200 dark:border-slate-750">
              <button
                onClick={() => setActiveCategory('all')}
                className={`px-3 py-1 rounded-lg text-[11px] font-bold font-sans transition cursor-pointer flex items-center gap-1.5 ${
                  activeCategory === 'all'
                    ? 'bg-white dark:bg-slate-900 text-amber-600 dark:text-amber-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Layers className="h-3.5 w-3.5" />
                <span>All Data ({totalMatches})</span>
              </button>
              <button
                onClick={() => setActiveCategory('jobs')}
                className={`px-3 py-1 rounded-lg text-[11px] font-bold font-sans transition cursor-pointer flex items-center gap-1.5 ${
                  activeCategory === 'jobs'
                    ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <FileText className="h-3.5 w-3.5" />
                <span>Job Cards ({filteredJobs.length})</span>
              </button>
              <button
                onClick={() => setActiveCategory('movements')}
                className={`px-3 py-1 rounded-lg text-[11px] font-bold font-sans transition cursor-pointer flex items-center gap-1.5 ${
                  activeCategory === 'movements'
                    ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <ArrowUpDown className="h-3.5 w-3.5" />
                <span>Material Movements ({filteredMovements.length})</span>
              </button>
            </div>

            {/* Quick Filter Select */}
            <div className="flex items-center gap-2">
              <Filter className="h-3.5 w-3.5 text-slate-400" />
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="bg-white dark:bg-slate-850 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 focus:outline-none"
              >
                <option value="all">All Statuses</option>
                <option value="In Process">In Process</option>
                <option value="Pending Acceptance">Pending Acceptance</option>
                <option value="Accepted">Accepted / Verified</option>
                <option value="Completed">Completed</option>
                <option value="Rejected">Rejected</option>
              </select>
            </div>
          </div>
        </div>

        {/* Search Results Body with Smooth Transition Animations */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-6">
          
          {/* Offline Cache Notice Banner */}
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2.5 text-amber-800 dark:text-amber-300">
              <Sparkles className="h-4 w-4 shrink-0 text-amber-500" />
              <span className="font-semibold">
                Instant Offline Search Engine querying {jobCards.length} Job Cards & {movements.length} Material Movements stored in local persistent cache.
              </span>
            </div>
            <span className="font-mono text-[10px] text-amber-600 dark:text-amber-400 shrink-0 font-bold">
              100% DISCONNECTED READY
            </span>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={`${query}-${searchFieldFilter}-${activeCategory}-${statusFilter}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className="space-y-6"
            >
              {totalMatches === 0 ? (
                <div className="py-12 text-center space-y-3">
                  <div className="h-12 w-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
                    <Search className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                      No matching record found in offline cache
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Try searching for a different Job Card No, Transfer Ref ID, Party Name, or Item Code.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {/* JOB CARDS RESULTS SECTION */}
                  {(activeCategory === 'all' || activeCategory === 'jobs') && filteredJobs.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5">
                          <FileText className="h-4 w-4" />
                          <span>Active Job Cards ({filteredJobs.length})</span>
                        </h4>
                        <span className="text-[10px] text-slate-400">Click entry to open detail modal</span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {filteredJobs.slice(0, 30).map((job, idx) => (
                          <motion.div
                            key={job.jobCardNo}
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.18, delay: Math.min(idx * 0.02, 0.2) }}
                            onClick={() => {
                              onSelectJobCard(job);
                              onClose();
                            }}
                            className="group bg-slate-50 hover:bg-indigo-50/50 dark:bg-slate-850 dark:hover:bg-indigo-950/30 border border-slate-200 hover:border-indigo-300 dark:border-slate-800 dark:hover:border-indigo-700/60 p-3.5 rounded-xl transition cursor-pointer space-y-2 relative"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <span className="font-mono font-extrabold text-xs text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                                  {job.jobCardNo}
                                </span>
                                <h5 className="font-bold text-xs text-slate-850 dark:text-white mt-1 group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition">
                                  {job.itemName}
                                </h5>
                              </div>
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                                job.status === 'Completed'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300'
                                  : job.status === 'In Process'
                                  ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300'
                                  : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300'
                              }`}>
                                {job.status}
                              </span>
                            </div>

                            <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600 dark:text-slate-350">
                              <div className="flex items-center gap-1.5 truncate">
                                <Building2 className="h-3 w-3 text-slate-400 shrink-0" />
                                <span className="truncate">{job.partyName}</span>
                              </div>
                              <div className="flex items-center gap-1.5 truncate">
                                <Tag className="h-3 w-3 text-slate-400 shrink-0" />
                                <span className="font-mono text-[10px]">{job.itemCode || 'N/A'}</span>
                              </div>
                              <div className="flex items-center gap-1.5 truncate">
                                <Layers className="h-3 w-3 text-slate-400 shrink-0" />
                                <span className="truncate">{job.currentDepartment}</span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <Package className="h-3 w-3 text-slate-400 shrink-0" />
                                <span className="font-bold text-slate-800 dark:text-slate-200">{job.orderQty.toLocaleString()} {job.unit || 'KGS'}</span>
                              </div>
                            </div>

                            <div className="pt-2 border-t border-slate-200/80 dark:border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400">
                              <span>Created {new Date(job.createdAt).toLocaleDateString()}</span>
                              <span className="text-indigo-600 dark:text-indigo-400 font-bold flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition">
                                View Job Details <ChevronRight className="h-3 w-3" />
                              </span>
                            </div>
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* MATERIAL MOVEMENTS RESULTS SECTION */}
                  {(activeCategory === 'all' || activeCategory === 'movements') && filteredMovements.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                          <ArrowUpDown className="h-4 w-4" />
                          <span>Material Movements & Transfer Logs ({filteredMovements.length})</span>
                        </h4>
                        <span className="text-[10px] text-slate-400">Click entry to navigate to job card</span>
                      </div>

                      <div className="space-y-2">
                        {filteredMovements.slice(0, 30).map((m, idx) => {
                          const parentJob = jobCardMap.get(m.jobCardNo.toLowerCase());
                          const isRejected = m.remarks?.toLowerCase().includes('reject');

                          return (
                            <motion.div
                              key={m.movementId}
                              initial={{ opacity: 0, y: 12 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={{ duration: 0.18, delay: Math.min(idx * 0.02, 0.2) }}
                              onClick={() => {
                                if (parentJob) {
                                  onSelectJobCard(parentJob);
                                  onClose();
                                }
                              }}
                              className="group bg-slate-50 hover:bg-emerald-50/50 dark:bg-slate-850 dark:hover:bg-emerald-950/30 border border-slate-200 hover:border-emerald-300 dark:border-slate-800 dark:hover:border-emerald-700/60 p-3 rounded-xl transition cursor-pointer space-y-2"
                            >
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono font-extrabold text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                                    {m.movementId}
                                  </span>
                                  <span className="font-mono text-xs font-bold text-slate-700 dark:text-slate-300">
                                    {m.jobCardNo}
                                  </span>
                                  {parentJob && (
                                    <span className="text-xs text-slate-600 dark:text-slate-300 font-semibold truncate max-w-[200px]">
                                      • {parentJob.itemName} ({parentJob.partyName})
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-2">
                                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                                    m.accepted
                                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300'
                                      : isRejected
                                      ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300'
                                      : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300'
                                  }`}>
                                    {m.accepted ? 'Accepted' : (isRejected ? 'Rejected' : 'Pending Acceptance')}
                                  </span>
                                  <span className="font-mono font-bold text-xs text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-900 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-750">
                                    {m.quantity.toLocaleString()} {m.requestedUnit || parentJob?.unit || 'KGS'}
                                  </span>
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-600 dark:text-slate-350">
                                <div className="flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-200">
                                  <span className="text-slate-500">{m.fromDepartment}</span>
                                  <ArrowRight className="h-3 w-3 text-slate-400" />
                                  <span className="text-emerald-600 dark:text-emerald-400">{m.toDepartment}</span>
                                </div>

                                <div className="flex items-center gap-3 text-[10px] text-slate-400">
                                  <span>Transfer By: <strong className="text-slate-600 dark:text-slate-300">{m.transferBy}</strong></span>
                                  {m.acceptedBy && <span>Received By: <strong className="text-slate-600 dark:text-slate-300">{m.acceptedBy}</strong></span>}
                                  <span>{new Date(m.transferDate).toLocaleDateString()} {new Date(m.transferDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                              </div>

                              {m.remarks && (
                                <p className="text-[11px] text-slate-500 dark:text-slate-400 bg-white/60 dark:bg-slate-900/60 p-2 rounded border border-slate-200/50 dark:border-slate-800/50 italic">
                                  "{m.remarks}"
                                </p>
                              )}
                            </motion.div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </motion.div>
          </AnimatePresence>

        </div>

        {/* Modal Footer */}
        <div className="p-3 bg-slate-100 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-2">
            <span className="font-mono bg-slate-200 dark:bg-slate-800 px-1.5 py-0.5 rounded text-[10px]">Esc</span>
            <span>to close window</span>
          </div>
          <div>
            Showing <strong>{totalMatches}</strong> cached entries
          </div>
        </div>
      </div>
    </div>
  );
}

