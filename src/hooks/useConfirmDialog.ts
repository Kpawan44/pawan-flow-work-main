import { useState } from 'react';

export interface ConfirmDialogState {
  title: string;
  message: string;
  onConfirm: () => void | Promise<void>;
  confirmText?: string;
  cancelText?: string;
}

export function useConfirmDialog() {
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);

  const showConfirm = (
    title: string,
    message: string,
    onConfirm: () => void | Promise<void>,
    confirmText = 'Confirm',
    cancelText = 'Cancel'
  ) => {
    setConfirmDialog({ title, message, onConfirm, confirmText, cancelText });
  };

  const closeConfirm = () => setConfirmDialog(null);

  return { confirmDialog, showConfirm, closeConfirm, setConfirmDialog };
}
