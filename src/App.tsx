/**
 * App.tsx — root component.
 *
 * Responsibilities:
 *  - Theme management
 *  - Sidebar / navigation layout
 *  - Composing AuthProvider + AppDataProvider
 *  - Rendering the active tab view
 *
 * Business logic has been extracted to:
 *  - src/contexts/AuthContext.tsx   — login, logout, PIN verification
 *  - src/contexts/AppDataContext.tsx — Firestore data + subscriptions
 *  - src/hooks/useToast.ts          — toast notifications
 *  - src/hooks/useConfirmDialog.ts  — confirmation dialogs
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Factory, Bell, Search, Filter, Download, Activity, Truck,
  LogOut, Mail, Flame, ArrowRight, Lock, X, Plus, Key, UserPlus,
  CheckCircle, CheckCircle2, ArrowLeft, FileSpreadsheet, Menu,
  Trash2, Printer, QrCode, ArrowUpDown, Layers, Wifi, WifiOff,
  RefreshCw, ChevronUp, ChevronDown, Warehouse, List, Database,
  AlertTriangle, FileText, Users, Sun, Moon, LayoutGrid, Table,
  Eye, EyeOff, Info, RotateCcw
} from 'lucide-react';
import { DBService, auth } from './lib/firebase';
import { UserProfile, JobCard, MaterialMovement, AppNotification, AuditLog, Department, CompanyConfig, JobCardStatus, SyncQueueItem } from './types';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import {
  getSpreadsheetDetails, isSheetsConnected, setGoogleAccessToken,
  initializeSpreadsheet, disconnectSheets
} from './lib/googleSheets';
import {
  exportJobCards, exportMaterialMovements, exportAuditLogs, exportDepartmentUpdates
} from './lib/csvExport';
import { exportComprehensiveExcelBackup } from './lib/excelExport';
import { triggerWhatsAppMovementNotification } from './lib/whatsapp';

// Contexts & hooks
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { AppDataProvider, useAppData } from './contexts/AppDataContext';
import { useToast } from './hooks/useToast';
import { useConfirmDialog } from './hooks/useConfirmDialog';

// Components
import Sidebar from './components/Sidebar';
import AppLogo from './components/AppLogo';
import DashboardStats from './components/DashboardStats';
import DepartmentOperations from './components/DepartmentOperations';
import JobCardDetailsModal from './components/JobCardDetailsModal';
import GlobalSearchModal from './components/GlobalSearchModal';
import ScannerModal from './components/ScannerModal';
import ReportView from './components/ReportView';
import AdminConsole from './components/AdminConsole';
import TimelineVisual from './components/TimelineVisual';
import GoogleSheetViewer from './components/GoogleSheetViewer';
import QuickTransferModal from './components/QuickTransferModal';
import BulkTransferModal from './components/BulkTransferModal';
import BulkPrintManifestModal from './components/BulkPrintManifestModal';
import BulkStatusUpdateModal from './components/BulkStatusUpdateModal';
import PendingBreakdownModal from './components/PendingBreakdownModal';
import JobStatusBadge from './components/JobStatusBadge';
import ConnectivityHealthWidget from './components/ConnectivityHealthWidget';
import { OutsourceManager } from './components/OutsourceManager';
import { getJobCardProcessMetrics, getRawMaterialIssuedQty, getJobCardDepartmentPending } from './lib/metrics';

// ─── Avatar helper (kept here — pure UI) ──────────────────────────────────────

const getAvatarBg = (dept: string) => {
  switch (dept) {
    case 'Admin': return 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300 border-purple-200 dark:border-purple-900/30';
    case 'Purchase': return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 border-indigo-200 dark:border-indigo-900/30';
    case 'Raw Material Store': return 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border-blue-200 dark:border-blue-900/30';
    case 'Dispatch': return 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200 dark:border-amber-900/30';
    case 'Production': return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300 border-cyan-200 dark:border-cyan-900/30';
    case 'Heat Treatment': return 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border-rose-200 dark:border-rose-900/30';
    case 'Plating': return 'bg-pink-100 text-pink-700 dark:bg-pink-950/40 dark:text-pink-300 border-pink-200 dark:border-pink-900/30';
    case 'Packing': return 'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300 border-violet-200 dark:border-violet-900/30';
    case 'Store': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900/30';
    default: return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700';
  }
};

// ─── Root export — wraps with providers ───────────────────────────────────────

export default function App() {
  const { toast, showToast } = useToast();
  const { confirmDialog, showConfirm, closeConfirm, setConfirmDialog } = useConfirmDialog();

  // Theme is outside providers so the whole tree gets it
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('theme');
      if (saved === 'light' || saved === 'dark') return saved;
    }
    return 'light';
  });

  useEffect(() => {
    if (theme === 'dark') document.documentElement.classList.add('dark');
    else document.documentElement.classList.remove('dark');
    localStorage.setItem('theme', theme);
  }, [theme]);

  return (
    <AuthProvider showToast={showToast}>
      <AppInner
        theme={theme}
        setTheme={setTheme}
        toast={toast}
        showToast={showToast}
        confirmDialog={confirmDialog}
        showConfirm={showConfirm}
        closeConfirm={closeConfirm}
        setConfirmDialog={setConfirmDialog}
      />
    </AuthProvider>
  );
}

// ─── Inner app — has access to AuthContext, wraps AppDataProvider ─────────────

function AppInner({
  theme, setTheme, toast, showToast, confirmDialog, showConfirm, closeConfirm, setConfirmDialog
}: {
  theme: 'light' | 'dark';
  setTheme: (t: 'light' | 'dark') => void;
  toast: any;
  showToast: any;
  confirmDialog: any;
  showConfirm: any;
  closeConfirm: () => void;
  setConfirmDialog: any;
}) {
  const { currentUser, setCurrentUser, handleLogout } = useAuth();

  return (
    <AppDataProvider
      currentUser={currentUser}
      setCurrentUser={setCurrentUser}
      showToast={showToast}
    >
      <AppShell
        theme={theme}
        setTheme={setTheme}
        toast={toast}
        showToast={showToast}
        confirmDialog={confirmDialog}
        showConfirm={showConfirm}
        closeConfirm={closeConfirm}
        setConfirmDialog={setConfirmDialog}
        handleLogout={handleLogout}
      />
    </AppDataProvider>
  );
}

// ─── AppShell — navigation layout + tab routing ───────────────────────────────
// All the original rendering logic lives here, now reading from context
// instead of local state. The JSX is unchanged — only state/data access updated.

function AppShell({
  theme, setTheme, toast, showToast, confirmDialog, showConfirm, closeConfirm,
  setConfirmDialog, handleLogout
}: {
  theme: 'light' | 'dark';
  setTheme: (t: 'light' | 'dark') => void;
  toast: any;
  showToast: any;
  confirmDialog: any;
  showConfirm: any;
  closeConfirm: () => void;
  setConfirmDialog: any;
  handleLogout: () => void;
}) {
  const {
    currentUser, setCurrentUser,
    loginName, loginPin, showPin, authError, isVerifyingPin,
    selectedLoginUser, selectedDeptFilter, userSearchQuery,
    setLoginName, setLoginPin, setShowPin, setAuthError,
    setSelectedLoginUser, setSelectedDeptFilter, setUserSearchQuery,
    isRegistering, regName, regSuccess,
    setIsRegistering, setRegName, setRegSuccess,
    handleUsernamePinLogin,
  } = useAuth();

  const {
    users, jobCards, movements, notifications, auditLogs, companyConfig,
    syncQueue, isOnline, showSyncDrawer, retryingIds,
    setShowSyncDrawer, setRetryingIds,
    refreshAllStates, refreshUsers, refreshJobCards,
    setUsers, setJobCards, setMovements, setNotifications, setCompanyConfig,
  } = useAppData();

  // ── UI-only state (stays here — pure presentation) ────────────────────────

  const [activeTab, setActiveTab] = useState<'dashboard' | 'all-orders' | 'timeline-live' | 'reports' | 'admin-users' | string>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window !== 'undefined') return window.innerWidth >= 1024;
    return true;
  });
  const [activeUrgentRequest, setActiveUrgentRequest] = useState<AppNotification | null>(null);
  const [selectedJob, setSelectedJob] = useState<JobCard | null>(null);
  const [quickTransferJob, setQuickTransferJob] = useState<JobCard | null>(null);
  const [pendingBreakdownJobCard, setPendingBreakdownJobCard] = useState<JobCard | null>(null);
  const [selectedJobCardNos, setSelectedJobCardNos] = useState<string[]>([]);
  const [showBulkTransferModal, setShowBulkTransferModal] = useState(false);
  const [showBulkPrintModal, setShowBulkPrintModal] = useState(false);
  const [showBulkStatusModal, setShowBulkStatusModal] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [showNotificationsDropdown, setShowNotificationsDropdown] = useState(false);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);

  // Sheets
  const [sheetsDetails, setSheetsDetails] = useState(getSpreadsheetDetails());
  const [isSheetsActive, setIsSheetsActive] = useState(isSheetsConnected());
  const [showSheetsModal, setShowSheetsModal] = useState(false);
  const [sheetsModalTab, setSheetsModalTab] = useState<'cloud' | 'offline'>('cloud');
  const [sheetsFeedback, setSheetsFeedback] = useState('');
  const [showSheetsInspector, setShowSheetsInspector] = useState(false);
  const [showEmulatedSheetsBtn, setShowEmulatedSheetsBtn] = useState(true);

  // All-orders filters
  const [allOrdersSearch, setAllOrdersSearch] = useState('');
  const [allOrdersSearchScope, setAllOrdersSearchScope] = useState<'all' | 'jobs' | 'movements'>('jobs');
  const [showGlobalSearchModal, setShowGlobalSearchModal] = useState(false);
  const [expandedJobCardNo, setExpandedJobCardNo] = useState<string | null>(null);
  const [allOrdersStageTab, setAllOrdersStageTab] = useState<'active' | 'store' | 'all'>('active');
  const [allOrdersDeptFilter, setAllOrdersDeptFilter] = useState<string>('All');
  const [allOrdersStatusFilter, setAllOrdersStatusFilter] = useState<string>('All');
  const [allOrdersPersonFilter, setAllOrdersPersonFilter] = useState<string>('All');
  const [allOrdersPartyFilter, setAllOrdersPartyFilter] = useState<string>('All');
  const [allOrdersOrderNoFilter, setAllOrdersOrderNoFilter] = useState<string>('All');
  const [allOrdersMyDeptOnly, setAllOrdersMyDeptOnly] = useState(false);
  const [mobileSortBy, setMobileSortBy] = useState<'Priority' | 'Newest' | 'Department'>('Priority');
  const [mobileViewMode, setMobileViewMode] = useState<'cards' | 'table'>('cards');
  const [freezeJobCardColumn, setFreezeJobCardColumn] = useState<boolean>(true);
  const [scrollState, setScrollState] = useState({ canScrollLeft: false, canScrollRight: false });

  const tableScrollRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // ── Auto-submit PIN ───────────────────────────────────────────────────────

  useEffect(() => {
    if (loginName.trim() && loginPin.length === 4 && !isVerifyingPin) {
      const timer = setTimeout(() => {
        handleUsernamePinLogin(users);
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [loginPin, loginName, isVerifyingPin, users]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Deep link: open job card from QR scan ────────────────────────────────

  useEffect(() => {
    const handler = (e: Event) => {
      const job = (e as CustomEvent).detail as JobCard;
      if (job) setSelectedJob(job);
    };
    window.addEventListener('open-job-card', handler);
    return () => window.removeEventListener('open-job-card', handler);
  }, []);

  // ── Auto-refresh ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!autoRefreshEnabled) return;
    const interval = setInterval(refreshAllStates, 30000);
    return () => clearInterval(interval);
  }, [autoRefreshEnabled, refreshAllStates]);

  // ── Responsive sidebar ────────────────────────────────────────────────────

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) setSidebarOpen(true);
      else setSidebarOpen(false);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // ── Keyboard shortcut Cmd+K ───────────────────────────────────────────────

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setShowGlobalSearchModal(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // ── Notification permission for store roles ───────────────────────────────

  useEffect(() => {
    if (currentUser && (currentUser.department === 'Store' || currentUser.department === 'Raw Material Store')) {
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
      }
    }
  }, [currentUser]);

  // ── Computed filter lists ─────────────────────────────────────────────────

  const uniqueParties = useMemo(() =>
    Array.from(new Set(jobCards.map(j => j.partyName).filter(Boolean))).sort(),
    [jobCards]
  );

  const uniquePersons = useMemo(() => {
    const set = new Set<string>();
    jobCards.forEach(j => {
      if (j.createdBy) set.add(j.createdBy);
      if (j.operatorName) set.add(j.operatorName);
      if (j.assignedToUserName) set.add(j.assignedToUserName);
      if (j.productionDetails?.operatorName) set.add(j.productionDetails.operatorName);
      if (j.purchaseDetails?.supplierName) set.add(j.purchaseDetails.supplierName);
      if (j.outsourceDetails?.poPlacedByUserName) set.add(j.outsourceDetails.poPlacedByUserName);
      if (j.outsourceDetails?.supplierName) set.add(j.outsourceDetails.supplierName);
    });
    movements.forEach(m => {
      if (m.transferBy) set.add(m.transferBy);
      if (m.acceptedBy) set.add(m.acceptedBy);
    });
    return Array.from(set).sort();
  }, [jobCards, movements]);

  const uniqueOrderNos = useMemo(() => {
    const set = new Set<string>();
    jobCards.forEach(j => {
      if (j.orderNo) set.add(j.orderNo);
      if (j.outsourceOrderId) set.add(j.outsourceOrderId);
      if (j.outsourceDetails?.poNumber) set.add(j.outsourceDetails.poNumber);
      if (j.purchaseDetails?.billNo) set.add(j.purchaseDetails.billNo);
    });
    return Array.from(set).sort();
  }, [jobCards]);

  const filteredNotifications = notifications.filter(notif => {
    if (!currentUser) return false;
    return (
      notif.userId === currentUser.userId ||
      notif.userId === currentUser.department ||
      notif.department === 'All' ||
      notif.userId === 'All'
    );
  });

  // ── NOTE ──────────────────────────────────────────────────────────────────
  // The full JSX render (login screen, sidebar, tab views, modals) is
  // unchanged from the original App.tsx. Copy everything from the original
  // `return (` block (line ~2095) to the end of the file into this function.
  //
  // The only replacements needed in that JSX are:
  //   OLD: setCurrentUser(...)     → already available via useAuth()
  //   OLD: refreshAllStates()      → already available via useAppData()
  //   OLD: showToast(...)          → passed as prop
  //   OLD: showConfirm(...)        → passed as prop
  //
  // Everything else (all the JSX, className strings, event handlers for
  // UI interactions) is identical to the original and does not need to change.
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen bg-[#F8FAFC] dark:bg-slate-950 transition-colors duration-200 font-sans overflow-hidden">
      {/* Paste the full original return JSX here */}
      <div className="flex items-center justify-center w-full h-full text-slate-400 text-sm">
        Paste original App.tsx JSX here (from line ~2095 to end of file)
      </div>
    </div>
  );
}
