import React from "react";

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  onConfirm,
  onCancel,
}) {
  if (!open) {
    return null;
  }

  const confirmToneClass = tone === "danger"
    ? "bg-error/90 text-white"
    : "bg-gradient-to-r from-primary-container to-secondary text-white";

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-surface-container p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
        <h3 className="text-xl font-headline font-bold text-on-surface">{title}</h3>
        <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">{message}</p>
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl border border-white/10 px-4 py-3 text-sm font-semibold text-on-surface"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`flex-1 rounded-xl px-4 py-3 text-sm font-semibold ${confirmToneClass}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
