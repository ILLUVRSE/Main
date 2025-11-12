import { createContext, useCallback, useContext, useMemo, useState } from "react";
import ToastContainer from "../components/Toast";
const ToastContext = createContext(null);
export function ToastProvider({ children }) {
    const [toasts, setToasts] = useState([]);
    const push = useCallback((t) => {
        const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const ttl = typeof t.ttlMs === "number" ? t.ttlMs : 4500;
        const item = {
            id,
            title: t.title,
            message: t.message,
            type: t.type ?? "info",
            ttlMs: ttl
        };
        setToasts((prev) => [item, ...prev]);
        return id;
    }, []);
    const remove = useCallback((id) => {
        setToasts((prev) => prev.filter((x) => x.id !== id));
    }, []);
    const value = useMemo(() => ({ toasts, push, remove }), [toasts, push, remove]);
    return value = { value } >
        { children }
        < ToastContainer;
    toasts = { toasts };
    onRemove = { remove } /  >
        /ToastContext.Provider>;
    ;
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
