import { DBService } from './firebase';

export interface DatabaseBackup {
  id: string;
  filename: string;
  timestamp: string;
  size: number; // in bytes
  data: Record<string, any>;
  type: 'auto' | 'manual';
}

const BACKUP_STORAGE_KEY = 'mfr_browser_backups';
const AUTO_BACKUP_ENABLED_KEY = 'mfr_auto_backup_enabled';
const LAST_BACKUP_DATE_KEY = 'mfr_last_backup_date';

export function isAutoBackupEnabled(): boolean {
  const stored = localStorage.getItem(AUTO_BACKUP_ENABLED_KEY);
  return stored === null ? true : stored === 'true';
}

export function setAutoBackupEnabled(enabled: boolean): void {
  localStorage.setItem(AUTO_BACKUP_ENABLED_KEY, enabled ? 'true' : 'false');
}

export function getLastBackupDate(): string | null {
  return localStorage.getItem(LAST_BACKUP_DATE_KEY);
}

export function getStoredBackups(): DatabaseBackup[] {
  try {
    const stored = localStorage.getItem(BACKUP_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (err) {
    console.error('Failed to parse backups from localStorage', err);
    return [];
  }
}

export function saveBackupsList(backups: DatabaseBackup[]): void {
  try {
    localStorage.setItem(BACKUP_STORAGE_KEY, JSON.stringify(backups));
  } catch (err) {
    console.error('Failed to write backups to localStorage', err);
    throw err;
  }
}

/**
 * Creates a new database snapshot and stores it in browser storage.
 * It also handles safety pruning of older backups if storage limits are approached.
 */
export async function createDatabaseBackup(type: 'auto' | 'manual' = 'manual'): Promise<DatabaseBackup> {
  const dump = await DBService.exportDatabaseDump();
  const dateStr = new Date().toISOString().split('T')[0];
  const timestampStr = new Date().toLocaleString();
  const filename = `mfr_backup_${dateStr}_${Date.now()}.json`;
  
  const serializedData = JSON.stringify(dump);
  const sizeInBytes = new Blob([serializedData]).size;

  const newBackup: DatabaseBackup = {
    id: `backup-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    filename,
    timestamp: new Date().toISOString(),
    size: sizeInBytes,
    data: dump,
    type
  };

  const backups = getStoredBackups();
  
  // Safely insert new backup at the beginning
  backups.unshift(newBackup);

  // Prune down to last 5 backups to prevent local storage quota exceeded errors (5MB limit)
  if (backups.length > 5) {
    backups.splice(5);
  }

  // Attempt to save to localStorage
  try {
    saveBackupsList(backups);
  } catch (err) {
    // If it fails (quota exceeded), prune more aggressively (keep only the latest 1 or 2)
    console.warn('LocalStorage quota exceeded. Pruning old backups aggressively.', err);
    if (backups.length > 2) {
      backups.splice(2);
      try {
        saveBackupsList(backups);
      } catch (innerErr) {
        // If still fails, keep only the current one
        backups.splice(1);
        saveBackupsList(backups);
      }
    } else {
      throw err;
    }
  }

  // Track the successful backup date
  localStorage.setItem(LAST_BACKUP_DATE_KEY, new Date().toISOString());
  
  return newBackup;
}

/**
 * Delete a specific backup from browser storage.
 */
export function deleteDatabaseBackup(id: string): void {
  const backups = getStoredBackups();
  const filtered = backups.filter(b => b.id !== id);
  saveBackupsList(filtered);
}

/**
 * Automatically triggers a backup if the day has changed and auto-backup is enabled.
 */
export async function runDailyAutoBackupIfNeeded(): Promise<DatabaseBackup | null> {
  if (!isAutoBackupEnabled()) return null;

  const todayStr = new Date().toISOString().split('T')[0];
  const lastBackup = getLastBackupDate();
  
  if (lastBackup) {
    const lastBackupDateStr = lastBackup.split('T')[0];
    if (lastBackupDateStr === todayStr) {
      // Already backed up today
      return null;
    }
  }

  try {
    console.log('Triggering daily automated database backup...');
    const backup = await createDatabaseBackup('auto');
    return backup;
  } catch (err) {
    console.error('Daily auto-backup failed', err);
    return null;
  }
}

/**
 * Download a backup as an actual JSON file onto the user's computer.
 */
export function downloadBackupAsJsonFile(backup: DatabaseBackup): void {
  const jsonStr = JSON.stringify(backup.data, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = backup.filename;
  document.body.appendChild(a);
  a.click();
  
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
