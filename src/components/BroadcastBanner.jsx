import React, { useEffect, useState } from "react";

/**
 * BroadcastBanner — L-3: Live Store Broadcast
 * Displays an active broadcast message sent by the store owner to all waiting customers.
 * Auto-dismisses when the broadcast expires.
 */
export default function BroadcastBanner({ broadcast, onDismiss }) {
  const [dismissed, setDismissed] = useState(false);
  const [isExpired, setIsExpired] = useState(false);

  const expiresAt = broadcast?.expires_at?.toMillis?.() ?? Infinity;
  const isVisible = Boolean(broadcast?.message && !dismissed && !isExpired);

  useEffect(() => {
    if (!broadcast?.message || dismissed) {
      return;
    }

    const now = Date.now();
    if (expiresAt !== Infinity && now >= expiresAt) {
      const timer = setTimeout(() => setIsExpired(true), 0);
      return () => clearTimeout(timer);
    }

    const msToExpiry = expiresAt - now;
    if (msToExpiry > 0 && msToExpiry < 60 * 60 * 1000) {
      const timer = setTimeout(() => setIsExpired(true), msToExpiry);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [broadcast?.message, dismissed, expiresAt]);

  if (!isVisible || !broadcast?.message) return null;

  const handleDismiss = () => {
    setDismissed(true);
    onDismiss?.();
  };

  return (
    <div
      className="relative mx-4 mb-4 rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 flex items-start gap-3 animate-[fade-in_0.4s_ease-out]"
      role="alert"
      aria-live="polite"
    >
      <span className="material-symbols-outlined text-amber-400 text-xl mt-0.5 shrink-0">campaign</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-label text-amber-400 uppercase tracking-widest mb-0.5">Message from the store</p>
        <p className="text-sm text-white/90 leading-relaxed">{broadcast.message}</p>
        {broadcast.sent_at && (
          <p className="text-[10px] text-white/30 mt-1 font-mono">
            {broadcast.sent_at.toDate
              ? broadcast.sent_at.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
              : ""}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss message"
        className="shrink-0 text-white/30 hover:text-white/70 transition-colors mt-0.5"
      >
        <span className="material-symbols-outlined text-base">close</span>
      </button>
    </div>
  );
}
