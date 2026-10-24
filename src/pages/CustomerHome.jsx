import React, { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { getActiveQueueTicket } from "../utils/queueTicket";
import { SUPPORTED_LOCALES, useLocale } from "../utils/i18n";
import { getEffectiveStoreStatus, getStoreTheme } from "../utils/storeStatus";
import { getFavoriteStoreIds, getRecentStores, saveRecentStore, toggleFavoriteStore } from "../utils/storePreferences";
import InteractiveDemoModal from "../components/InteractiveDemoModal";

export default function CustomerHome() {
  const { locale, setLocale, t } = useLocale();
  const [search, setSearch] = useState("");
  const [openOnly, setOpenOnly] = useState(false);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [allStores, setAllStores] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retryKey, setRetryKey] = useState(0);
  const [activeTicket] = useState(() => getActiveQueueTicket());
  const [favoriteStoreIds, setFavoriteStoreIds] = useState(() => getFavoriteStoreIds());
  const [recentStores, setRecentStores] = useState(() => getRecentStores());
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [installPromptEvent, setInstallPromptEvent] = useState(null);
  const [isDemoOpen, setIsDemoOpen] = useState(false);
  const [storeCode, setStoreCode] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getDocs(collection(db, "publicStores"))
      .then((snapshot) => {
        if (cancelled) return;
        setAllStores(snapshot.docs.map((entryDoc) => ({ id: entryDoc.id, ...entryDoc.data() })));
        setLoading(false);
        setError(null);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Failed to load stores. Please check your connection.");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [retryKey]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPromptEvent(event);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  const term = search.toLowerCase().trim();
  const categories = useMemo(
    () => ["all", ...new Set(allStores.map((store) => store.category).filter(Boolean))],
    [allStores]
  );
  const results = useMemo(() => {
    const filtered = allStores.filter((store) => {
      const matchesTerm = !term
        || (store.store_name || store.id || "").toLowerCase().includes(term)
        || (store.category || "").toLowerCase().includes(term)
        || (store.location || "").toLowerCase().includes(term);

      if (!matchesTerm) {
        return false;
      }

      if (categoryFilter !== "all" && store.category !== categoryFilter) {
        return false;
      }

      return true;
    });

    return filtered
      .map((store) => ({
        ...store,
        effectiveStatus: getEffectiveStoreStatus(store),
        theme: getStoreTheme(store),
        isFavorite: favoriteStoreIds.includes(store.id),
      }))
      .filter((store) => !openOnly || store.effectiveStatus.isOpen)
      .filter((store) => !favoritesOnly || store.isFavorite)
      .sort((a, b) => {
        if (Number(b.isFavorite) !== Number(a.isFavorite)) {
          return Number(b.isFavorite) - Number(a.isFavorite);
        }
        return Number(b.effectiveStatus.isOpen) - Number(a.effectiveStatus.isOpen);
      });
  }, [allStores, categoryFilter, favoriteStoreIds, favoritesOnly, openOnly, term]);

  const openNowCount = results.filter((store) => store.effectiveStatus.isOpen).length;
  const closedCount = results.length - openNowCount;

  const favoriteStores = useMemo(
    () => results.filter((store) => store.isFavorite).slice(0, 6),
    [results]
  );

  const handleFavoriteToggle = (event, store) => {
    event.preventDefault();
    event.stopPropagation();
    setFavoriteStoreIds(toggleFavoriteStore(store));
  };

  const handleStoreOpen = (store) => {
    setRecentStores(saveRecentStore(store));
  };

  const handleInstallApp = async () => {
    if (!installPromptEvent) {
      return;
    }

    try {
      await installPromptEvent.prompt();
      await installPromptEvent.userChoice;
    } catch {
      // ignore dismissed prompt
    } finally {
      setInstallPromptEvent(null);
    }
  };

  return (
    <div className="min-h-screen bg-background text-white flex flex-col font-body">
      <header className="px-6 py-5 flex items-center justify-between border-b border-white/5 bg-[#131318]/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-violet-500">blur_on</span>
          <span className="font-headline font-bold text-lg bg-gradient-to-r from-[#7C3AED] to-[#22D3EE] bg-clip-text text-transparent">
            Ghost Queue
          </span>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={locale}
            onChange={(event) => setLocale(event.target.value)}
            className="bg-surface-container-high text-[11px] uppercase tracking-wider text-on-surface-variant rounded-full border border-white/10 px-3 py-2 outline-none"
            aria-label={t("language", "Language")}
          >
            {SUPPORTED_LOCALES.map((item) => (
              <option key={item} value={item}>
                {item.toUpperCase()}
              </option>
            ))}
          </select>
          <a
            href="/admin"
            className="text-xs text-on-surface-variant hover:text-white transition-colors flex items-center gap-1 font-label uppercase tracking-wider"
          >
            <span className="material-symbols-outlined text-sm">admin_panel_settings</span>
            Admin
          </a>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center px-6 py-12 relative overflow-hidden">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[300px] bg-primary/10 blur-[120px] rounded-full pointer-events-none" />
        <div className="absolute bottom-10 right-10 w-48 h-48 bg-secondary/10 blur-[80px] rounded-full pointer-events-none" />

        <div className="relative z-10 w-full max-w-md">
          {!isOnline && (
            <div className="mb-5 rounded-2xl border border-error/20 bg-error/10 px-4 py-4 glass-glow">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-error">wifi_off</span>
                <div>
                  <p className="text-sm font-semibold text-on-surface">You are offline</p>
                  <p className="mt-1 text-xs text-on-surface-variant">
                    You can still reopen your saved ticket, but store search and live updates need a connection.
                  </p>
                </div>
              </div>
            </div>
          )}

          {installPromptEvent && (
            <div className="mb-5 rounded-2xl border border-secondary/20 bg-secondary/10 px-4 py-4 glass-glow">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-on-surface">Install Ghost Queue</p>
                  <p className="mt-1 text-xs text-on-surface-variant">
                    Save the app to your home screen for faster queue access and better ticket recovery.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleInstallApp}
                  className="rounded-full bg-secondary px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-950"
                >
                  Install
                </button>
              </div>
            </div>
          )}

          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/25 text-[11px] font-bold text-primary mb-4 uppercase tracking-widest animate-pulse-slow">
              <span className="w-2 h-2 rounded-full bg-primary animate-ping" />
              Next-Gen Virtual Queueing
            </div>

            <h1 className="font-headline text-4xl sm:text-5xl font-bold mb-3 tracking-tight text-white">
              Skip The Line.{" "}
              <span className="bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
                Not The Life.
              </span>
            </h1>
            <p className="text-on-surface-variant text-sm sm:text-base leading-relaxed max-w-sm mx-auto mb-6">
              Join virtual queues instantly at restaurants, clinics, temples, and shops. Real-time ticket updates, zero app download required.
            </p>

            {/* CTA action buttons */}
            <div className="flex flex-col sm:flex-row gap-3 justify-center mb-6">
              <button
                type="button"
                onClick={() => setIsDemoOpen(true)}
                className="py-3 px-5 rounded-2xl bg-gradient-to-r from-primary-container to-secondary font-headline font-bold text-xs uppercase tracking-wider text-white shadow-lg shadow-purple-500/20 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 glass-glow"
              >
                <span className="material-symbols-outlined text-base">play_circle</span>
                Try Live Simulator
              </button>

              <a
                href="/register"
                className="py-3 px-5 rounded-2xl bg-surface-container-high border border-white/10 font-headline font-bold text-xs uppercase tracking-wider text-on-surface hover:bg-white/10 hover:border-white/20 transition-all flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-base">add_business</span>
                Launch Store Queue
              </a>
            </div>

            {/* Quick store code join */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const code = storeCode.trim();
                if (code) window.location.href = `/q/${encodeURIComponent(code)}`;
              }}
              className="flex gap-2 p-1.5 rounded-2xl bg-surface-container-low border border-white/10 max-w-sm mx-auto shadow-inner mb-6"
            >
              <input
                type="text"
                value={storeCode}
                onChange={(e) => setStoreCode(e.target.value)}
                placeholder="Have a store ID? (e.g. cafe-central)"
                className="flex-1 bg-transparent px-3 py-2 text-xs text-white placeholder:text-on-surface-variant/50 outline-none"
              />
              <button
                type="submit"
                disabled={!storeCode.trim()}
                className="px-4 py-2 rounded-xl bg-primary text-slate-950 font-bold text-xs uppercase tracking-wider disabled:opacity-40 hover:bg-primary-fixed transition-all"
              >
                Go
              </button>
            </form>

            {/* Value props */}
            <div className="grid grid-cols-3 gap-2 py-3 border-y border-white/5 text-[10px] text-on-surface-variant">
              <div className="flex items-center justify-center gap-1.5">
                <span className="material-symbols-outlined text-secondary text-sm">bolt</span>
                <span>Live Sync</span>
              </div>
              <div className="flex items-center justify-center gap-1.5">
                <span className="material-symbols-outlined text-emerald-400 text-sm">notifications_active</span>
                <span>Audio Chime</span>
              </div>
              <div className="flex items-center justify-center gap-1.5">
                <span className="material-symbols-outlined text-primary text-sm">qr_code</span>
                <span>No App Needed</span>
              </div>
            </div>
          </div>

          {activeTicket && (
            <a
              href={`/q/${activeTicket.storeId}`}
              onClick={() => handleStoreOpen({ id: activeTicket.storeId, store_name: activeTicket.storeName, store_logo: activeTicket.storeLogo })}
              className="block mb-5 rounded-2xl border border-white/10 bg-surface-container-low/70 px-4 py-4 glass-glow"
            >
              <p className="text-[10px] uppercase tracking-[0.18em] text-on-surface-variant">
                {t("activeTicket", "Resume your active ticket")}
              </p>
              <p className="text-sm font-semibold text-on-surface mt-2">
                {activeTicket.storeName || activeTicket.storeId}
              </p>
              <p className="mt-2 text-xs text-on-surface-variant">
                Jump straight back into your saved queue ticket without searching again.
              </p>
              {activeTicket.savedAt && (
                <p className="mt-1 text-xs text-on-surface-variant">
                  Saved {new Date(activeTicket.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
              )}
            </a>
          )}

          {recentStores.length > 0 && (
            <div className="mb-5">
              <p className="text-[10px] uppercase tracking-[0.18em] text-on-surface-variant mb-3">
                Recent stores
              </p>
              <div className="flex flex-wrap gap-2">
                {recentStores.map((store) => (
                  <a
                    key={store.storeId}
                    href={`/q/${store.storeId}`}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-surface-container-low/70 px-3 py-2 text-xs text-on-surface"
                  >
                    <span className="material-symbols-outlined text-sm text-secondary">{store.storeLogo || "storefront"}</span>
                    <span>{store.storeName}</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          {!term && favoriteStores.length > 0 && (
            <div className="mb-5">
              <p className="text-[10px] uppercase tracking-[0.18em] text-on-surface-variant mb-3">
                Favorite stores
              </p>
              <div className="flex flex-wrap gap-2">
                {favoriteStores.map((store) => (
                  <a
                    key={store.id}
                    href={`/q/${store.id}`}
                    onClick={() => handleStoreOpen(store)}
                    className="inline-flex items-center gap-2 rounded-full border border-secondary/20 bg-secondary/10 px-3 py-2 text-xs text-on-surface"
                  >
                    <span className="material-symbols-outlined text-sm text-secondary">favorite</span>
                    <span>{store.store_name || store.id}</span>
                  </a>
                ))}
              </div>
            </div>
          )}

          <div className="mb-4 flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-on-surface-variant">
            <span>{openNowCount} open now</span>
            <span>{closedCount} closed</span>
          </div>

          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("searchPlaceholder", "Search store, category or city...")}
              className="flex-1 bg-surface-container border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-on-surface-variant/50 outline-none focus:border-primary/50 focus:bg-white/5 transition-all"
            />
          </div>

          <div className="mb-6 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setOpenOnly((value) => !value)}
              className={`rounded-full px-3 py-2 text-[11px] uppercase tracking-[0.16em] ${openOnly ? "bg-tertiary/10 text-tertiary border border-tertiary/20" : "bg-surface-container-high text-on-surface-variant border border-white/10"}`}
            >
              Open now
            </button>
            <button
              type="button"
              onClick={() => setFavoritesOnly((value) => !value)}
              className={`rounded-full px-3 py-2 text-[11px] uppercase tracking-[0.16em] ${favoritesOnly ? "bg-secondary/10 text-secondary border border-secondary/20" : "bg-surface-container-high text-on-surface-variant border border-white/10"}`}
            >
              Favorites
            </button>
            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              className="rounded-full border border-white/10 bg-surface-container-high px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-on-surface-variant outline-none"
            >
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category === "all" ? "All categories" : category}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <div className="mb-4 rounded-2xl border border-error/20 bg-error/10 px-4 py-4 text-center">
              <p className="text-error text-sm mb-3">{error}</p>
              <button
                type="button"
                onClick={() => setRetryKey((k) => k + 1)}
                className="rounded-full bg-error/20 px-4 py-2 text-xs font-bold uppercase tracking-widest text-error hover:bg-error/30 transition-colors"
              >
                Retry
              </button>
            </div>
          )}

          {loading && (
            <div className="space-y-3">
              {[1, 2, 3].map((item) => (
                <div key={item} className="overflow-hidden rounded-2xl border border-white/5 bg-surface-container-low/60 animate-pulse">
                  <div className="h-20 w-full bg-white/5"></div>
                  <div className="space-y-3 p-4">
                    <div className="h-4 w-1/2 rounded bg-white/10"></div>
                    <div className="h-3 w-2/3 rounded bg-white/5"></div>
                    <div className="h-3 w-1/3 rounded bg-white/5"></div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && results.length > 0 && (
            <div className="flex flex-col gap-3">
              {search ? (
                <p className="text-xs text-on-surface-variant mb-1">
                  {results.length} result{results.length !== 1 ? "s" : ""} for <span className="text-white">"{search}"</span>
                </p>
              ) : (
                <p className="text-xs text-on-surface-variant mb-1 uppercase tracking-widest font-label">All Stores</p>
              )}

              {results.map((store) => (
                <a
                  key={store.id}
                  href={`/q/${store.id}`}
                  onClick={() => handleStoreOpen(store)}
                  className="overflow-hidden flex flex-col bg-surface-container-low/60 border border-white/5 rounded-2xl hover:bg-white/5 hover:border-primary/20 transition-all group glass-glow"
                >
                  {store.cover_image_url ? (
                    <div
                      className="h-28 w-full bg-cover bg-center border-b border-white/5"
                      style={{ backgroundImage: `linear-gradient(rgba(19,19,24,0.15), rgba(19,19,24,0.7)), url(${store.cover_image_url})` }}
                    ></div>
                  ) : (
                    <div className="h-16 w-full border-b border-white/5" style={{ backgroundImage: store.theme.mutedGradient }}></div>
                  )}
                  <div className="flex items-center gap-4 p-4">
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center border border-white/10 shrink-0"
                      style={{ backgroundImage: store.theme.mutedGradient }}
                    >
                      <span className="material-symbols-outlined text-primary">
                        {store.store_logo || "storefront"}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm text-on-surface truncate">
                        {store.store_name || store.id}
                      </p>
                      <p className="text-xs text-on-surface-variant truncate mt-0.5">
                        {[store.category, store.location].filter(Boolean).join(" · ")}
                      </p>
                      {Number(store.ghost_score || 0) > 0 && (
                        <div className="mt-1 flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold" style={{ color: store.theme.primary }}>
                          <span className="material-symbols-outlined text-[12px]">verified</span>
                          Ghost Score {store.ghost_score}
                        </div>
                      )}
                      <p className="text-[10px] text-on-surface-variant/80 mt-1 truncate">
                        {store.effectiveStatus.reason}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2 items-center">
                        {Number(store.live_party_count ?? 0) > 0 && (
                          <span className="rounded-full bg-surface-container px-2 py-1 text-[10px] uppercase tracking-wider text-on-surface-variant flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-tertiary animate-pulse inline-block"></span>
                            {store.live_party_count} waiting
                          </span>
                        )}
                        {Number(store.avg_service_mins ?? 0) > 0 && Number(store.live_party_count ?? 0) > 0 && (
                          <span className="rounded-full bg-surface-container px-2 py-1 text-[10px] uppercase tracking-wider text-on-surface-variant">
                            ~{Math.round(Number(store.live_party_count) * Number(store.avg_service_mins))} min wait
                          </span>
                        )}
                        {Number(store.max_queue_size ?? 0) > 0 && (
                          <span className="rounded-full bg-surface-container px-2 py-1 text-[10px] uppercase tracking-wider text-on-surface-variant">
                            Max {Number(store.max_queue_size)} parties
                          </span>
                        )}
                        {Number(store.fast_pass_price ?? 0) > 0 && (
                          <span className="rounded-full bg-secondary/10 px-2 py-1 text-[10px] uppercase tracking-wider text-secondary">
                            ⚡ Fast Pass
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={(event) => handleFavoriteToggle(event, store)}
                        className={`w-9 h-9 rounded-full border flex items-center justify-center transition-colors ${store.isFavorite ? "border-secondary/20 bg-secondary/10 text-secondary" : "border-white/10 bg-surface-container text-on-surface-variant hover:text-white"}`}
                        aria-label={store.isFavorite ? "Remove favorite" : "Add favorite"}
                      >
                        <span className="material-symbols-outlined text-base" style={store.isFavorite ? { fontVariationSettings: "'FILL' 1" } : {}}>
                          favorite
                        </span>
                      </button>
                      {store.effectiveStatus.isOpen ? (
                        <span className="text-[10px] font-bold text-tertiary bg-tertiary/10 px-2 py-0.5 rounded-full uppercase tracking-wider">
                          {store.effectiveStatus.canJoin === false ? store.effectiveStatus.joinLabel : t("open", "Open")}
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold text-error bg-error/10 px-2 py-0.5 rounded-full uppercase tracking-wider">
                          {store.effectiveStatus.label}
                        </span>
                      )}
                      <span className="material-symbols-outlined text-on-surface-variant group-hover:text-white transition-colors text-sm">arrow_forward</span>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          )}

          {!loading && results.length === 0 && term && (
            <div className="text-center py-8 border border-dashed border-white/10 rounded-2xl">
              <span className="material-symbols-outlined text-4xl text-on-surface-variant mb-2 block">search_off</span>
              <p className="text-on-surface-variant text-sm">No stores found for "{search}"</p>
              <p className="text-on-surface-variant/50 text-xs mt-1">Ask your store admin to share the link</p>
            </div>
          )}

          {!loading && allStores.length === 0 && !error && (
            <div className="text-center py-10 px-6 border border-white/10 rounded-3xl glass-panel-elevated">
              <span className="material-symbols-outlined text-5xl text-primary mb-3 block animate-pulse">store</span>
              <h3 className="font-headline font-bold text-lg text-white mb-2">No Public Stores Yet</h3>
              <p className="text-on-surface-variant text-xs mb-6 max-w-xs mx-auto leading-relaxed">
                Experience how real-time queues work in the live interactive simulator, or register your store to start serving customers.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <button
                  type="button"
                  onClick={() => setIsDemoOpen(true)}
                  className="py-2.5 px-4 rounded-xl bg-gradient-to-r from-primary-container to-secondary text-xs font-bold text-white shadow-md hover:opacity-95"
                >
                  🎮 Launch Live Demo
                </button>
                <a
                  href="/register"
                  className="py-2.5 px-4 rounded-xl bg-surface-container-high border border-white/10 text-xs font-bold text-on-surface hover:bg-white/10"
                >
                  Create Your Store
                </a>
              </div>
            </div>
          )}
        </div>

        <InteractiveDemoModal isOpen={isDemoOpen} onClose={() => setIsDemoOpen(false)} />

        <style>{`@keyframes spin { to { transform: rotate(360deg); } } .animate-spin { animation: spin 1s linear infinite; }`}</style>
      </main>
    </div>
  );
}

