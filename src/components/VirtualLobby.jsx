import React from "react";

/**
 * VirtualLobby — L-1: Store's Virtual Waiting Room
 * Displayed on the customer queue page while they wait.
 * Shows store-curated content: headline, promo, menu items, CTA.
 * Content is managed by the store owner from their Admin Dashboard.
 */
export default function VirtualLobby({ lobby, storeMeta }) {
  if (!lobby) return null;

  const hasContent = lobby.headline || lobby.promo_text || (lobby.show_menu_items && lobby.menu_items?.length > 0);
  if (!hasContent) return null;

  const primary = storeMeta?.brand_primary || "#7C3AED";
  const secondary = storeMeta?.brand_secondary || "#22D3EE";

  return (
    <div className="rounded-2xl border border-white/8 bg-surface-container overflow-hidden" aria-label="Store waiting room content">
      {/* Header */}
      <div
        className="px-4 py-3 flex items-center gap-2"
        style={{ background: `linear-gradient(135deg, ${primary}20, ${secondary}10)` }}
      >
        <span className="material-symbols-outlined text-sm" style={{ color: primary }}>storefront</span>
        <p className="text-[10px] font-label uppercase tracking-widest" style={{ color: primary }}>
          While You Wait · From {storeMeta?.store_name || "The Store"}
        </p>
      </div>

      <div className="p-4 flex flex-col gap-4">
        {/* Headline + Subtext */}
        {lobby.headline && (
          <div>
            <h3 className="font-headline text-base font-bold text-on-surface">{lobby.headline}</h3>
            {lobby.subtext && (
              <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">{lobby.subtext}</p>
            )}
          </div>
        )}

        {/* Promo Banner */}
        {lobby.promo_text && (
          <div
            className="rounded-xl px-4 py-3 flex items-center gap-3"
            style={{ background: `${primary}15`, border: `1px solid ${primary}25` }}
          >
            <span className="material-symbols-outlined text-lg" style={{ color: primary }}>local_offer</span>
            <p className="text-sm font-medium" style={{ color: primary }}>{lobby.promo_text}</p>
          </div>
        )}

        {/* Menu Items */}
        {lobby.show_menu_items && lobby.menu_items?.length > 0 && (
          <div>
            <p className="text-[10px] font-label text-on-surface-variant uppercase tracking-widest mb-2.5">Today&apos;s Highlights</p>
            <div className="flex flex-col gap-2">
              {lobby.menu_items.map((item, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between gap-3 py-2.5 px-3 rounded-xl border border-white/5 bg-surface-container-low"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-on-surface truncate">{item.name}</p>
                    {item.description && (
                      <p className="text-xs text-on-surface-variant truncate mt-0.5">{item.description}</p>
                    )}
                  </div>
                  {item.price && (
                    <div
                      className="shrink-0 text-sm font-bold font-mono rounded-lg px-2.5 py-1"
                      style={{ color: primary, background: `${primary}15` }}
                    >
                      {item.price}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CTA Button */}
        {lobby.cta_url && lobby.cta_label && (
          <a
            href={lobby.cta_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold text-white transition-all hover:opacity-90 active:scale-[0.98]"
            style={{ background: `linear-gradient(135deg, ${primary}, ${secondary})` }}
          >
            <span className="material-symbols-outlined text-base">open_in_new</span>
            {lobby.cta_label}
          </a>
        )}
      </div>
    </div>
  );
}
