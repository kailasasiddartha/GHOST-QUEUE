import React from "react";

export default function ToastStack({ toasts = [], onDismiss }) {
  if (!toasts.length) {
    return null;
  }

  return (
    <div className="fixed top-4 right-4 z-[80] flex w-full max-w-sm flex-col gap-3 px-4 sm:px-0">
      {toasts.map((toast) => {
        const toneClass = toast.tone === "error"
          ? "border-error/30 bg-error/10 text-white"
          : toast.tone === "success"
            ? "border-tertiary/30 bg-tertiary/10 text-white"
            : "border-white/10 bg-surface-container/95 text-white";

        return (
          <div
            key={toast.id}
            className={`rounded-2xl border px-4 py-3 shadow-[0_18px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl ${toneClass}`}
          >
            <div className="flex items-start gap-3">
              <div className="flex-1">
                {toast.title && (
                  <p className="text-sm font-semibold">{toast.title}</p>
                )}
                <p className={`text-sm ${toast.title ? "mt-1 text-white/80" : ""}`}>{toast.message}</p>
              </div>
              <button
                type="button"
                onClick={() => onDismiss?.(toast.id)}
                className="rounded-full bg-white/5 p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
                aria-label="Dismiss"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
