import { useState } from 'react';

export interface ToastState {
  message: string;
  type: 'success' | 'error' | 'info';
  action?: { label: string; onClick: () => void };
}

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = (
    message: string,
    type: 'success' | 'error' | 'info' = 'success',
    action?: { label: string; onClick: () => void }
  ) => {
    setToast({ message, type, action });
    const duration = action ? 7500 : 4500;
    setTimeout(() => {
      setToast(prev => (prev?.message === message ? null : prev));
    }, duration);
  };

  return { toast, showToast };
}
