import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import ToastContainer, { ToastItem } from "../components/Toast";

/**
 * useToast + ToastProvider
 *
 * Provide a lightweight toast system. Wrap your app with <ToastProvider>
 * (e.g., in Layout or main entry). Call `const { push, remove } = useToast()`
 * from components to show or dismiss toasts.
 *
 * Example:
 *   const { push } = useToast();
 *   push({ title: "Saved", message: "File saved", type: "success" });
 */

type ToastContextValue = {
  toasts: ToastItem[];
  push: (t: Omit<ToastItem, "id">) => string;
  remove: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const push = useCallback((t: Omit<ToastItem, "id">) => {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const ttl = typeof t.ttlMs === "number" ? t.ttlMs : 4500;
    const item: ToastItem = {
      id,
      title: t.title,
      message: t.message,
      type: t.type ?? "info",
      ttlMs: ttl
    };
    setToasts((prev) => [item, ...prev]);
    return id;
  }, []);

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const value = useMemo(() => ({ toasts, push, remove }), [toasts, push, remove]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onRemove={remove} />
    </ToastContext.Provider>
  );
}

/** Hook to use the toast context (push/remove). */
export default function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return {
    push: ctx.push,
    remove: ctx.remove,
    toasts: ctx.toasts
  };
}

