import { useCallback, useState } from "react";

/**
 * useToast — Shared toast notification hook.
 * Eliminates the duplicated toast logic across QueuePage and AdminDashboard.
 *
 * Returns { toasts, pushToast, dismissToast }
 *
 * @param {number} [duration=3200] Auto-dismiss duration in milliseconds.
 */
export function useToast(duration = 3200) {
  const [toasts, setToasts] = useState([]);

  const pushToast = useCallback((message, tone = "default", title = "") => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((current) => [...current, { id, message, tone, title }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, duration);
  }, [duration]);

  const dismissToast = useCallback((toastId) => {
    setToasts((current) => current.filter((toast) => toast.id !== toastId));
  }, []);

  return { toasts, pushToast, dismissToast };
}
