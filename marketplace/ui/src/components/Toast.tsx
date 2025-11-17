'use client';

import React, { createContext, useContext, useMemo, useState } from 'react';
import clsx from 'clsx';

type ToastLevel = 'info' | 'success' | 'error' | 'warn';

type ToastItem = {
  id: string;
  title?: string;
  message: string;
  level?: ToastLevel;
  durationMs?: number; // auto-dismiss after this many ms; 0 = sticky
};

type ToastContextValue = {
  toasts: ToastItem[];
  push: (t: Omit<Partial<ToastItem>, 'id'> & { message: string }) => string;
  remove: (id: string) => void;
  clear: () => void;
};

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

function genId() {
  return `toast_${Math.random().toString(36).slice(2, 9)}`;
}

function levelStyle(level: ToastLevel | undefined) {
  switch (level) {
    case 'success':
      return 'bg-green-50 border-green-200 text-green-800';
    case 'error':
      return 'bg-red-50 border-red-200 text-red-800';
    case 'warn':
      return 'bg-yellow-50 border-yellow-200 text-yellow-800';
    case 'info':
    default:
      return 'bg-white border-gray-200 text-[var(--text)]';
  }
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const push = (t: Omit<Partial<ToastItem>, 'id'> & { message: string }) => {
    const id = genId();
    const item: ToastItem = {
      id,
      title: (t.title as string) || undefined,
      message: t.message,
      level: (t.level as ToastLevel) || 'info',
      durationMs: typeof t.durationMs === 'number' ? t.durationMs : 5000,
    };
    setToasts((s) => [item, ...s]);

    if (item.durationMs && item.durationMs > 0) {
      setTimeout(() => {
        setToasts((s) => s.filter((x) => x.id !== id));
      }, item.durationMs);
    }

    return id;
  };

  const remove = (id: string) => setToasts((s) => s.filter((t) => t.id !== id));
  const clear = () => setToasts([]);

  const value = useMemo(() => ({ toasts, push, remove, clear }), [toasts]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onRemove={remove} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
}

/* ---------------------------
   ToastContainer + ToastItem
   --------------------------- */

function ToastContainer({ toasts, onRemove }: { toasts: ToastItem[]; onRemove: (id: string) => void }) {
  return (
    <div
      aria-live="polite"
      className="fixed z-50 right-4 bottom-6 flex flex-col items-end gap-3 pointer-events-none max-w-xs"
    >
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto w-full">
          <ToastNode toast={t} onClose={() => onRemove(t.id)} />
        </div>
      ))}
    </div>
  );
}

function ToastNode({ toast, onClose }: { toast: ToastItem; onClose: () => void }) {
  const style = levelStyle(toast.level);

  return (
    <div
      className={clsx(
        'flex items-start gap-3 p-3 rounded-md border shadow-illuvrse-soft',
        style
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex-1">
        {toast.title && <div className="font-semibold">{toast.title}</div>}
        <div className="text-sm mt-1">{toast.message}</div>
      </div>

      <div className="flex items-start gap-2">
        <button
          onClick={onClose}
          aria-label="Dismiss notification"
          className="text-sm text-muted hover:text-[var(--illuvrse-primary)]"
        >
          ×
        </button>
      </div>
    </div>
  );
}

