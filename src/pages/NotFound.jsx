import React from "react";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background text-on-background flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-surface-container p-10 text-center">
        {/* Ghost icon */}
        <div className="w-20 h-20 rounded-3xl bg-surface-container-high mx-auto mb-6 flex items-center justify-center border border-white/10 shadow-[0_0_32px_rgba(124,58,237,0.2)]">
          <span className="material-symbols-outlined text-4xl text-primary">blur_on</span>
        </div>

        <p className="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant font-label mb-2">404</p>
        <h1 className="text-3xl font-headline font-bold text-on-surface mb-3">Page not found</h1>
        <p className="text-sm text-on-surface-variant leading-relaxed mb-8">
          This link is either broken or the page has been removed.
          If you&apos;re looking for a queue, ask the store to share their link directly.
        </p>

        <div className="flex flex-col gap-3">
          <a
            href="/"
            className="w-full rounded-xl bg-gradient-to-r from-primary-container to-secondary py-3 font-headline font-bold text-white text-center block shadow-[0_4px_14px_rgba(124,58,237,0.25)]"
          >
            Find a store
          </a>
          <a
            href="/admin"
            className="w-full rounded-xl border border-white/10 py-3 text-sm font-semibold text-on-surface-variant text-center block hover:bg-white/5 transition-colors"
          >
            Admin login
          </a>
        </div>
      </div>
    </div>
  );
}
