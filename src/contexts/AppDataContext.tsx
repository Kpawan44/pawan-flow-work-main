import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { DBService } from '../lib/firebase';
import { runDailyAutoBackupIfNeeded } from '../lib/backup';
import {
  UserProfile, JobCard, MaterialMovement, AppNotification,
  AuditLog, CompanyConfig, SyncQueueItem
} from '../types';

// ─── Shape ───────────────────────────────────────────────────────────────────

interface AppDataContextValue {
  // Data
  users: UserProfile[];
  jobCards: JobCard[];
  movements: MaterialMovement[];
  notifications: AppNotification[];
  auditLogs: AuditLog[];
  companyConfig: CompanyConfig | null;
  syncQueue: SyncQueueItem[];

  // Connectivity
  isOnline: boolean;
  showSyncDrawer: boolean;
  retryingIds: Record<string, boolean>;
  setShowSyncDrawer: (v: boolean) => void;
  setRetryingIds: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;

  // Actions
  refreshAllStates: () => Promise<void>;
  refreshUsers: () => Promise<void>;
  refreshJobCards: () => Promise<void>;
  setSelectedJobFresh: (prev: JobCard | null, freshCards: JobCard[]) => JobCard | null;

  // Setters needed by child components that update local state optimistically
  setUsers: React.Dispatch<React.SetStateAction<UserProfile[]>>;
  setJobCards: React.Dispatch<React.SetStateAction<JobCard[]>>;
  setMovements: React.Dispatch<React.SetStateAction<MaterialMovement[]>>;
  setNotifications: React.Dispatch<React.SetStateAction<AppNotification[]>>;
  setCompanyConfig: React.Dispatch<React.SetStateAction<CompanyConfig | null>>;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const AppDataContext = createContext<AppDataContextValue | null>(null);

export function useAppData(): AppDataContextValue {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error('useAppData must be used inside <AppDataProvider>');
  return ctx;
}

// ─── Provider ────────────────────────────────────────────────────────────────

interface Props {
  children: React.ReactNode;
  currentUser: UserProfile | null;
  setCurrentUser: (u: UserProfile | null) => void;
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

export function AppDataProvider({ children, currentUser, setCurrentUser, showToast }: Props) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [jobCards, setJobCards] = useState<JobCard[]>([]);
  const [movements, setMovements] = useState<MaterialMovement[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [companyConfig, setCompanyConfig] = useState<CompanyConfig | null>(null);
  const [syncQueue, setSyncQueue] = useState<SyncQueueItem[]>([]);
  const [showSyncDrawer, setShowSyncDrawer] = useState(false);
  const [retryingIds, setRetryingIds] = useState<Record<string, boolean>>({});

  const [isOnline, setIsOnline] = useState(() => {
    const forcedOffline = localStorage.getItem('mfr_force_offline') === 'true';
    if (forcedOffline) return false;
    return navigator.onLine && !DBService.isOfflineMode();
  });

  // ── Incremental merge helpers ─────────────────────────────────────────────

  const applyMovementChanges = useCallback(
    (changes: { type: 'added' | 'modified' | 'removed'; doc: MaterialMovement }[]) => {
      setMovements(prev => {
        const map = new Map<string, MaterialMovement>(prev.map(m => [m.movementId, m]));
        for (const change of changes) {
          if (change.type === 'removed') map.delete(change.doc.movementId);
          else map.set(change.doc.movementId, change.doc);
        }
        return Array.from(map.values()).sort(
          (a, b) => new Date(b.transferDate).getTime() - new Date(a.transferDate).getTime()
        );
      });
    },
    []
  );

  const applyAuditLogChanges = useCallback(
    (changes: { type: 'added' | 'modified' | 'removed'; doc: AuditLog }[]) => {
      setAuditLogs(prev => {
        const map = new Map<string, AuditLog>(prev.map(l => [l.id, l]));
        for (const change of changes) {
          if (change.type === 'removed') map.delete(change.doc.id);
          else map.set(change.doc.id, change.doc);
        }
        return Array.from(map.values()).sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
      });
    },
    []
  );

  // ── Refresh helpers ───────────────────────────────────────────────────────

  const refreshUsers = useCallback(async () => {
    try {
      const u = await DBService.getUsers();
      setUsers(u);
      const savedUid = sessionStorage.getItem('mfr_active_user_uid');
      if (savedUid && !currentUser) {
        const found = u.find(user => user.userId === savedUid);
        if (found) setCurrentUser(found);
      }
    } catch (err) {
      console.error('Failed to refresh users', err);
    }
  }, [currentUser, setCurrentUser]);

  const refreshJobCards = useCallback(async () => {
    try {
      const jc = await DBService.getJobCards();
      setJobCards(jc);
    } catch (err) {
      console.error('Failed to refresh job cards', err);
    }
  }, []);

  const refreshNotifications = useCallback(async () => {
    try {
      const n = await DBService.getNotifications();
      setNotifications(n);
    } catch (err) {
      console.error('Failed to refresh notifications', err);
    }
  }, []);

  const refreshCompanyConfig = useCallback(async () => {
    try {
      const config = await DBService.getCompanyConfig();
      setCompanyConfig(config);
    } catch (err) {
      console.error('Failed to refresh company config', err);
    }
  }, []);

  const refreshAllStates = useCallback(async () => {
    try {
      const [u, jc, mov, n, logs, config] = await Promise.all([
        DBService.getUsers(),
        DBService.getJobCards(),
        DBService.getMovements(),
        DBService.getNotifications(),
        DBService.getAuditLogs(),
        DBService.getCompanyConfig(),
      ]);
      setUsers(u);
      setJobCards(jc);
      setMovements(mov);
      setNotifications(n);
      setAuditLogs(logs);
      setCompanyConfig(config);

      const savedUid = sessionStorage.getItem('mfr_active_user_uid');
      if (savedUid && !currentUser) {
        const found = u.find(user => user.userId === savedUid);
        if (found) setCurrentUser(found);
      }

      // Deep link support for QR code scans
      const urlParams = new URLSearchParams(window.location.search);
      const queryJobCardNo = urlParams.get('jobCardNo');
      if (queryJobCardNo && jc.length > 0) {
        const foundJob = jc.find(j => j.jobCardNo.toLowerCase() === queryJobCardNo.toLowerCase());
        if (foundJob) {
          window.history.replaceState({}, document.title, window.location.pathname);
          // Dispatch a custom event so App.tsx can open the job card modal
          window.dispatchEvent(new CustomEvent('open-job-card', { detail: foundJob }));
        }
      }
    } catch (err) {
      console.error('Failed to refresh all states', err);
    }
  }, [currentUser, setCurrentUser]);

  const setSelectedJobFresh = useCallback(
    (prev: JobCard | null, freshCards: JobCard[]): JobCard | null => {
      if (!prev) return null;
      return freshCards.find(j => j.jobCardNo.toLowerCase() === prev.jobCardNo.toLowerCase()) || prev;
    },
    []
  );

  // ── Connectivity & sync queue ─────────────────────────────────────────────

  useEffect(() => {
    setSyncQueue(DBService.getSyncQueue());

    const handleSyncQueueUpdate = () => setSyncQueue(DBService.getSyncQueue());

    const handleOnline = () => {
      if (localStorage.getItem('mfr_force_offline') === 'true') return;
      DBService.setOnline();
      setIsOnline(true);
      showToast('Connection restored! Synchronizing offline changes...', 'success');
      refreshAllStates();
      DBService.retryAllSyncItems();
    };

    const handleOffline = () => {
      setIsOnline(false);
      showToast('System offline. Working from local cache.', 'info');
    };

    const handleFirestoreStatus = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail?.isOffline === 'boolean') {
        if (localStorage.getItem('mfr_force_offline') === 'true') {
          setIsOnline(false);
        } else {
          setIsOnline(!detail.isOffline);
        }
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('sync-queue-updated', handleSyncQueueUpdate);
    window.addEventListener('firestore-status-change', handleFirestoreStatus);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('sync-queue-updated', handleSyncQueueUpdate);
      window.removeEventListener('firestore-status-change', handleFirestoreStatus);
    };
  }, [refreshAllStates, showToast]);

  // ── Initial load + real-time subscriptions ────────────────────────────────

  useEffect(() => {
    refreshAllStates();

    runDailyAutoBackupIfNeeded()
      .then(backup => {
        if (backup) showToast(`Daily backup completed: ${backup.filename}`, 'success');
      })
      .catch(err => console.warn('Daily auto-backup check failed:', err));

    const debounce = (fn: () => void, delay = 100) => {
      let timer: NodeJS.Timeout | null = null;
      return () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(fn, delay);
      };
    };

    const unsubUsers = DBService.subscribeToUpdates('mfr_users', debounce(refreshUsers));
    const unsubJobs = DBService.subscribeToUpdates('mfr_job_cards', debounce(refreshJobCards));
    const unsubNotifs = DBService.subscribeToUpdates('mfr_notifications', debounce(refreshNotifications));
    const unsubCompany = DBService.subscribeToUpdates('mfr_company_config', debounce(refreshCompanyConfig));
    const unsubMoves = DBService.subscribeMovementsIncremental(setMovements, applyMovementChanges);
    const unsubAudits = DBService.subscribeAuditLogsIncremental(setAuditLogs, applyAuditLogChanges);

    return () => {
      unsubUsers();
      unsubJobs();
      unsubNotifs();
      unsubCompany();
      unsubMoves();
      unsubAudits();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <AppDataContext.Provider
      value={{
        users, jobCards, movements, notifications, auditLogs, companyConfig, syncQueue,
        isOnline, showSyncDrawer, retryingIds,
        setShowSyncDrawer, setRetryingIds,
        refreshAllStates, refreshUsers, refreshJobCards,
        setSelectedJobFresh,
        setUsers, setJobCards, setMovements, setNotifications, setCompanyConfig,
      }}
    >
      {children}
    </AppDataContext.Provider>
  );
}
