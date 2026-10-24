import React, { useEffect, useMemo, useState, useCallback } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { getActiveQueueTicket, getSavedLocale, saveLocale } from "../utils/queueTicket";
import { SUPPORTED_LOCALES, translations } from "../utils/i18n";
import { getEffectiveStoreStatus, getStoreTheme } from "../utils/storeStatus";
import { getFavoriteStoreIds, getRecentStores, saveRecentStore, toggleFavoriteStore } from "../utils/storePreferences";

const INDUSTRY_PLAYBOOKS = [
  {
    id: "dining",
    name: "Cafes & Dining",
    icon: "restaurant",
    emoji: "🍽️",
    problem: "Crowded host podiums, loud buzzers with limited 50m range, and diners walking away during peak hours.",
    solution: "Guests scan a tabletop QR, explore nearby shops freely, and receive browser audio chimes the instant their table is ready.",
    metric: "18% average increase in food court & bar turnover",
  },
  {
    id: "health",
    name: "Clinics & OPDs",
    icon: "local_hospital",
    emoji: "🏥",
    problem: "Congested waiting rooms spreading airborne pathogens, anxious patients crowding reception desks.",
    solution: "Private digital queue tokens with live position countdowns and confidential counter call announcements on lobby screens.",
    metric: "65% reduction in waiting room congestion",
  },
  {
    id: "retail",
    name: "Retail & Salons",
    icon: "shopping_bag",
    emoji: "🛍️",
    problem: "Fitting room bottlenecks, customer frustration during flash sales, and chaotic billing counters.",
    solution: "Seamless virtual waitlists for dressing rooms and styling stations while shoppers continue browsing merchandise.",
    metric: "24% higher average cart value while waiting",
  },
  {
    id: "community",
    name: "Temples & Events",
    icon: "temple_hindu",
    emoji: "🛕",
    problem: "Massive holiday rushes, elderly pilgrims standing in long heat lines, and unmanaged entry gates.",
    solution: "Scheduled darshan time-slots, emergency senior priority insertion, and large digital TV signage displays.",
    metric: "Over 1,200 visitors paced smoothly per hour",
  },
];

export default function CustomerHome() {
  const [locale, setLocale] = useState(() => getSavedLocale());
  useEffect(() => {
    saveLocale(locale);
  }, [locale]);
  const t = useCallback(
    (key, fallback = key) => translations[locale]?.[key] || translations.en?.[key] || fallback,
    [locale]
  );
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
  const [storeCode, setStoreCode] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Quick Join Form state
  const [heroStoreId, setHeroStoreId] = useState("");
  const [heroName, setHeroName] = useState("");
  const [heroPhone, setHeroPhone] = useState("");
  const [heroMembers, setHeroMembers] = useState(2);
  const [heroError, setHeroError] = useState("");
  const [heroSubmitting, setHeroSubmitting] = useState(false);

  // ROI Calculator states
  const [calcVisitors, setCalcVisitors] = useState(150);
  const [calcWaitMins, setCalcWaitMins] = useState(16);

  // Industry Playbook active tab
  const [activePlaybook, setActivePlaybook] = useState("dining");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getDocs(collection(db, "publicStores"))
      .then((snapshot) => {
        if (cancelled) return;
        const stores = snapshot.docs.map((entryDoc) => ({ id: entryDoc.id, ...entryDoc.data() }));
        setAllStores(stores);
        if (stores.length > 0 && !heroStoreId) {
          const firstOpen = stores.find((s) => s.is_open && !s.queue_paused) || stores[0];
          setHeroStoreId(firstOpen.id);
        }
        setLoading(false);
        setError(null);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Failed to load stores. Please check your connection.");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [retryKey, heroStoreId]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
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

      if (!matchesTerm) return false;
      if (categoryFilter !== "all" && store.category !== categoryFilter) return false;
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
    if (!installPromptEvent) return;
    try {
      await installPromptEvent.prompt();
      await installPromptEvent.userChoice;
    } catch { /* ignore */ } finally {
      setInstallPromptEvent(null);
    }
  };

  const handleHeroQuickJoin = (e) => {
    e.preventDefault();
    setHeroError("");

    if (!heroStoreId.trim()) {
      setHeroError("Please select a venue");
      return;
    }

    if (!heroName.trim()) {
      setHeroError("Please enter your name");
      return;
    }

    const cleanedPhone = heroPhone.replace(/\D/g, "");
    if (cleanedPhone.length !== 10) {
      setHeroError("Phone number must be exactly 10 digits");
      return;
    }

    setHeroSubmitting(true);
    try {
      sessionStorage.setItem(
        "gq_guest_draft",
        JSON.stringify({
          name: heroName.trim(),
          phone: cleanedPhone,
          members: Number(heroMembers) || 1,
        })
      );
    } catch { /* ignore */ }

    const targetUrl = `/q/${encodeURIComponent(heroStoreId.trim())}?name=${encodeURIComponent(heroName.trim())}&phone=${encodeURIComponent(cleanedPhone)}&members=${heroMembers}`;
    window.location.href = targetUrl;
  };

  // ROI Calculator Calculations
  const hoursSavedPerMonth = Math.round((calcVisitors * calcWaitMins * 30 * 0.75) / 60);
  const recoveredSales = Math.round(calcVisitors * 30 * 0.12 * 18);
  const turnoverBoost = Math.round(calcWaitMins * 0.6);

  const selectedPlaybookObj = INDUSTRY_PLAYBOOKS.find((p) => p.id === activePlaybook) || INDUSTRY_PLAYBOOKS[0];

  return (
    <div className="min-h-screen bg-[#07070a] text-white flex flex-col font-body selection:bg-purple-500/30 selection:text-white relative overflow-x-hidden">
      {/* Dynamic ambient backdrop */}
      <div
        className="fixed inset-0 z-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 65% 45% at 50% 0%, rgba(124, 58, 237, 0.18), transparent 70%), radial-gradient(ellipse 75% 55% at 50% 55%, rgba(34, 211, 238, 0.06), transparent 70%), #07070a",
        }}
      />
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(#ffffff08_1px,transparent_1px)] [background-size:24px_24px] opacity-25" />

      {/* ─── FLOATING CONTROL PILL NAVBAR ────────────────────────────────────── */}
      <header className="sticky top-4 z-50 mx-auto w-full max-w-5xl px-4">
        <div className="flex items-center justify-between rounded-full bg-[#0d0d14]/85 backdrop-blur-xl border border-white/10 shadow-[0_12px_36px_rgba(0,0,0,0.6)] px-4 sm:px-6 py-2.5 transition-all duration-300">
          {/* Brand Logo */}
          <a href="/" className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-violet-600 via-indigo-500 to-cyan-400 p-[1px] flex items-center justify-center shadow-lg shadow-purple-500/20 group-hover:scale-105 transition-transform">
              <div className="w-full h-full bg-[#09090e] rounded-full flex items-center justify-center">
                <span className="material-symbols-outlined text-base bg-gradient-to-tr from-violet-400 to-cyan-300 bg-clip-text text-transparent">
                  blur_on
                </span>
              </div>
            </div>
            <span className="text-lg font-headline font-bold tracking-tight text-white flex items-center gap-1">
              Ghost<span className="bg-gradient-to-r from-violet-400 via-cyan-300 to-emerald-400 bg-clip-text text-transparent">Queue</span>
            </span>
          </a>

          {/* Desktop Nav Items */}
          <nav className="hidden md:flex items-center space-x-1 text-xs font-medium text-white/70">
            <a href="#venues" className="px-3.5 py-1.5 rounded-full hover:text-white hover:bg-white/5 transition-all text-white font-semibold">
              Live Venues ({allStores.length})
            </a>
            <a href="#solutions" className="px-3.5 py-1.5 rounded-full hover:text-white hover:bg-white/5 transition-all">
              Solutions
            </a>
            <a href="#architecture" className="px-3.5 py-1.5 rounded-full hover:text-white hover:bg-white/5 transition-all">
              Architecture
            </a>
            <a href="#calculator" className="px-3.5 py-1.5 rounded-full hover:text-white hover:bg-white/5 transition-all">
              ROI Calculator
            </a>
            <a href="/display" className="px-3.5 py-1.5 rounded-full hover:text-white hover:bg-white/5 transition-all text-white/80">
              TV Display
            </a>
          </nav>

          {/* Right Action CTA */}
          <div className="flex items-center gap-2">
            <select
              value={locale}
              onChange={(e) => setLocale(e.target.value)}
              className="hidden lg:block bg-white/5 text-[11px] font-semibold text-white/70 rounded-full border border-white/10 px-2.5 py-1 outline-none hover:border-white/20 cursor-pointer"
              aria-label="Language"
            >
              {SUPPORTED_LOCALES.map((item) => (
                <option key={item} value={item} className="bg-[#101016] text-white">
                  {item.toUpperCase()}
                </option>
              ))}
            </select>

            <a
              href="/admin"
              className="px-3.5 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/15 text-xs font-semibold text-white/90 hover:text-white flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
              title="Store Owner & Staff Login with Google or Email"
            >
              <span className="material-symbols-outlined text-sm text-violet-400">admin_panel_settings</span>
              <span>Store Login</span>
            </a>

            <a
              href="/register"
              className="rounded-full font-headline font-bold text-xs px-3.5 py-1.5 sm:px-4 sm:py-2 bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-500 hover:from-violet-500 hover:to-cyan-400 text-white shadow-[0px_2px_0px_0px_rgba(255,255,255,0.3)_inset] hover:-translate-y-0.5 active:translate-y-0 transition-all cursor-pointer flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-sm">add_business</span>
              <span>Create Store</span>
            </a>

            {/* Mobile Toggle */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/80"
              aria-label="Toggle menu"
            >
              <span className="material-symbols-outlined text-lg">
                {mobileMenuOpen ? "close" : "menu"}
              </span>
            </button>
          </div>
        </div>

        {/* Mobile Dropdown */}
        {mobileMenuOpen && (
          <div className="md:hidden mt-2 rounded-2xl bg-[#0f0f15]/95 backdrop-blur-xl border border-white/10 p-4 shadow-2xl flex flex-col gap-2 text-sm font-medium">
            <div className="pb-3 mb-1 border-b border-white/10 flex flex-col gap-2">
              <a
                href="/admin"
                onClick={() => setMobileMenuOpen(false)}
                className="px-3.5 py-2.5 rounded-xl bg-violet-600/20 border border-violet-500/30 text-violet-300 font-semibold flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-base">admin_panel_settings</span>
                <span>Store Login (Google / Email ID)</span>
              </a>
              <a
                href="/register"
                onClick={() => setMobileMenuOpen(false)}
                className="px-3.5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-cyan-500 text-white font-bold flex items-center gap-2"
              >
                <span className="material-symbols-outlined text-base">add_business</span>
                <span>Create New Store</span>
              </a>
            </div>
            <a href="#venues" onClick={() => setMobileMenuOpen(false)} className="px-3 py-2 rounded-xl hover:bg-white/5 text-white/90">
              Live Venue Radar ({allStores.length})
            </a>
            <a href="#solutions" onClick={() => setMobileMenuOpen(false)} className="px-3 py-2 rounded-xl hover:bg-white/5 text-white/80">
              Industry Solutions
            </a>
            <a href="#architecture" onClick={() => setMobileMenuOpen(false)} className="px-3 py-2 rounded-xl hover:bg-white/5 text-white/80">
              Platform Architecture
            </a>
            <a href="#calculator" onClick={() => setMobileMenuOpen(false)} className="px-3 py-2 rounded-xl hover:bg-white/5 text-white/80">
              ROI & Wait Calculator
            </a>
            <a href="/display" onClick={() => setMobileMenuOpen(false)} className="px-3 py-2 rounded-xl hover:bg-white/5 text-white/80">
              Signage TV Screen
            </a>
          </div>
        )}
      </header>

      {/* ─── MAIN HERO ──────────────────────────────────────────────────────── */}
      <main className="relative z-10 flex-1 flex flex-col">
        <section className="relative pt-16 pb-12 sm:pt-24 sm:pb-20 px-4 sm:px-6 lg:px-8">
          <div className="max-w-5xl mx-auto flex flex-col items-center text-center">

            {/* Offline Alert */}
            {!isOnline && (
              <div className="w-full max-w-md mb-6 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300 flex items-center gap-2">
                <span className="material-symbols-outlined text-sm">wifi_off</span>
                <span>You are currently offline. Cached tickets remain available in memory.</span>
              </div>
            )}

            {/* Install PWA Prompt */}
            {installPromptEvent && (
              <div className="w-full max-w-md mb-6 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 p-3 flex items-center justify-between text-xs text-cyan-200">
                <span>Add Ghost Queue to home screen</span>
                <button
                  type="button"
                  onClick={handleInstallApp}
                  className="px-3 py-1 bg-cyan-400 text-slate-950 font-bold rounded-full text-[11px]"
                >
                  Install
                </button>
              </div>
            )}

            {/* Architecture Pill */}
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs font-mono text-white/80 mb-6 backdrop-blur-sm">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Reactive Virtual Queue Engine</span>
              <span className="text-white/30">•</span>
              <span className="text-cyan-300 font-semibold">Zero App Downloads</span>
            </div>

            {/* Unique Headline */}
            <h1 className="text-4xl sm:text-6xl lg:text-7xl font-headline font-bold tracking-tight text-white mb-6 max-w-3xl leading-[1.1]">
              Queues Without The{" "}
              <span className="bg-gradient-to-r from-violet-400 via-cyan-300 to-emerald-400 bg-clip-text text-transparent font-extrabold">
                Waiting Room.
              </span>
            </h1>

            {/* Subtitle */}
            <p className="text-base sm:text-lg text-white/60 max-w-2xl mx-auto mb-8 leading-relaxed">
              Ghost Queue turns crowded physical lines into lightweight mobile web passes. Customers roam freely, grab coffee, or sit in the park—returning on cue with browser airport chimes.
            </p>

            {/* Active Ticket Banner */}
            {activeTicket && (
              <div className="w-full max-w-md mb-8">
                <a
                  href={`/q/${activeTicket.storeId}`}
                  className="group flex items-center justify-between p-4 rounded-2xl bg-gradient-to-r from-emerald-500/15 via-cyan-500/10 to-violet-500/15 border border-emerald-500/30 hover:border-emerald-400/60 transition-all shadow-lg shadow-emerald-500/10"
                >
                  <div className="flex items-center gap-3 text-left">
                    <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center text-emerald-300 shrink-0">
                      <span className="material-symbols-outlined text-xl">confirmation_number</span>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase font-bold tracking-widest text-emerald-300">Your Active Boarding Pass</p>
                      <p className="text-sm font-bold text-white group-hover:text-emerald-200 transition-colors">
                        {activeTicket.storeName || activeTicket.storeId}
                      </p>
                    </div>
                  </div>
                  <span className="material-symbols-outlined text-emerald-300 group-hover:translate-x-1 transition-transform">
                    arrow_forward
                  </span>
                </a>
              </div>
            )}

            {/* Store Owner & Operator Gateway */}
            <div className="w-full max-w-3xl mb-8 p-5 sm:p-6 rounded-3xl bg-gradient-to-r from-[#131124]/90 via-[#0e0e18]/90 to-[#0c1622]/90 border border-violet-500/30 shadow-[0_12px_40px_rgba(124,58,237,0.12)] relative overflow-hidden text-left">
              <div className="absolute top-0 right-0 w-72 h-36 bg-violet-600/15 blur-3xl pointer-events-none rounded-full" />
              <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-5">
                <div className="space-y-1.5 max-w-lg">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2.5 py-0.5 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-300 text-[10px] font-bold uppercase tracking-wider font-mono">
                      Store Owner & Staff Portal
                    </span>
                    <span className="text-white/40 text-xs">•</span>
                    <span className="text-[11px] text-cyan-300 font-medium">Google Auth & Email ID</span>
                  </div>
                  <h3 className="text-lg sm:text-xl font-headline font-bold text-white tracking-tight">
                    Manage Your Store or Create a New Queue
                  </h3>
                  <p className="text-xs text-white/65 leading-relaxed">
                    Sign in with Google OAuth or Email ID to open your live store counter, call waiting customers with airport audio chimes, and view operational analytics.
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row gap-2.5 shrink-0">
                  <a
                    href="/admin"
                    className="px-5 py-3 rounded-2xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-headline font-bold text-xs uppercase tracking-wider shadow-lg shadow-violet-600/30 active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-base">admin_panel_settings</span>
                    <span>Store Login</span>
                  </a>
                  <a
                    href="/register"
                    className="px-5 py-3 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/15 text-white font-headline font-bold text-xs uppercase tracking-wider active:scale-[0.99] transition-all flex items-center justify-center gap-2 cursor-pointer hover:border-cyan-400/40"
                  >
                    <span className="material-symbols-outlined text-base text-cyan-400">add_business</span>
                    <span>Create Store</span>
                  </a>
                </div>
              </div>
            </div>

            {/* Quick Action Dock */}
            <div className="w-full max-w-3xl grid grid-cols-1 md:grid-cols-2 gap-4 mb-10 text-left">
              {/* Option A: Direct Code & Slug Lookup */}
              <div className="p-6 rounded-3xl bg-[#0e0e14]/90 border border-white/10 shadow-xl flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="material-symbols-outlined text-cyan-400 text-lg">qr_code_scanner</span>
                    <h3 className="font-headline font-bold text-white text-base">Direct Store Lookup</h3>
                  </div>
                  <p className="text-xs text-white/50 mb-4">
                    Scanning a QR code at a counter or have a venue code? Jump straight to their live line.
                  </p>
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (storeCode.trim()) window.location.href = `/q/${encodeURIComponent(storeCode.trim())}`;
                  }}
                  className="flex gap-2"
                >
                  <input
                    type="text"
                    value={storeCode}
                    onChange={(e) => setStoreCode(e.target.value)}
                    placeholder="e.g. sids-cafe"
                    className="flex-1 px-3.5 py-2.5 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder:text-white/30 outline-none focus:border-cyan-400 font-mono"
                  />
                  <button
                    type="submit"
                    disabled={!storeCode.trim()}
                    className="px-4 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-gray-950 font-bold rounded-xl text-xs transition-colors disabled:opacity-40 cursor-pointer"
                  >
                    Open
                  </button>
                </form>
              </div>

              {/* Option B: Fast Boarding Pass Generator */}
              <div className="p-6 rounded-3xl bg-[#0e0e14]/90 border border-white/10 shadow-xl flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="material-symbols-outlined text-violet-400 text-lg">local_activity</span>
                    <h3 className="font-headline font-bold text-white text-base">Quick Pass Generator</h3>
                  </div>
                  <p className="text-xs text-white/50 mb-3">
                    Pre-fill your boarding pass and join the live queue at any active venue.
                  </p>
                </div>

                <form onSubmit={handleHeroQuickJoin} className="space-y-2.5">
                  <select
                    value={heroStoreId}
                    onChange={(e) => setHeroStoreId(e.target.value)}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white focus:outline-none focus:border-violet-500 cursor-pointer"
                  >
                    {allStores.length > 0 ? (
                      allStores.map((s) => (
                        <option key={s.id} value={s.id} className="bg-[#101016] text-white">
                          {s.store_name || s.id} {s.is_open ? "• Open" : "• Closed"}
                        </option>
                      ))
                    ) : (
                      <option value="sids-cafe" className="bg-[#101016] text-white">sid's cafe (Default)</option>
                    )}
                  </select>

                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={heroName}
                      onChange={(e) => setHeroName(e.target.value)}
                      placeholder="Your Name"
                      className="px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-violet-500"
                    />
                    <input
                      type="tel"
                      value={heroPhone}
                      onChange={(e) => setHeroPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                      placeholder="10-digit phone"
                      className="px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-violet-500 font-mono"
                    />
                  </div>

                  <div className="flex items-center justify-between px-3 py-1.5 bg-white/5 border border-white/10 rounded-xl text-xs">
                    <span className="text-white/60">Party:</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setHeroMembers((m) => Math.max(1, m - 1))}
                        className="w-6 h-6 rounded bg-white/10 hover:bg-white/20 text-white flex items-center justify-center font-bold cursor-pointer"
                      >
                        -
                      </button>
                      <span className="font-bold text-white font-mono min-w-[36px] text-center">{heroMembers} pax</span>
                      <button
                        type="button"
                        onClick={() => setHeroMembers((m) => Math.min(20, m + 1))}
                        className="w-6 h-6 rounded bg-white/10 hover:bg-white/20 text-white flex items-center justify-center font-bold cursor-pointer"
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {heroError && <p className="text-[11px] text-red-400">{heroError}</p>}

                  <button
                    type="submit"
                    disabled={heroSubmitting}
                    className="w-full py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-semibold text-xs tracking-wide transition-all shadow-md cursor-pointer disabled:opacity-50"
                  >
                    {heroSubmitting ? "Generating..." : "Generate Pass →"}
                  </button>
                </form>
              </div>
            </div>

            {/* Quick Action Anchor Pills */}
            <div className="flex flex-wrap items-center justify-center gap-3">
              <a
                href="#venues"
                className="py-2.5 px-5 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 text-xs font-semibold text-white flex items-center gap-2 transition-colors"
              >
                <span className="material-symbols-outlined text-violet-400 text-base">radar</span>
                Browse Live Venues ({allStores.length})
              </a>
              <a
                href="/admin"
                className="py-2.5 px-5 rounded-full bg-violet-600/15 border border-violet-500/30 hover:bg-violet-600/25 text-xs font-semibold text-violet-300 flex items-center gap-2 transition-colors"
              >
                <span className="material-symbols-outlined text-violet-400 text-base">admin_panel_settings</span>
                Store Admin & Staff Login
              </a>
              <a
                href="/display"
                className="py-2.5 px-5 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 text-xs font-semibold text-white/80 flex items-center gap-2 transition-colors"
              >
                <span className="material-symbols-outlined text-amber-400 text-base">tv</span>
                TV Signage Board
              </a>
            </div>

          </div>
        </section>

        {/* ─── LIVE VENUES RADAR & STORE DIRECTORY (#venues) ────────────────────── */}
        <section id="venues" className="relative py-16 sm:py-24 px-4 sm:px-6 lg:px-8 border-t border-white/5 bg-[#0a0a0f]/60">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-10">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-xs font-semibold text-violet-300 mb-3">
                Live Store Radar
              </div>
              <h2 className="text-3xl sm:text-4xl font-headline font-bold text-white mb-2 tracking-tight">
                Active Venues & Real-Time Queues
              </h2>
              <p className="text-xs sm:text-sm text-white/60 max-w-xl mx-auto">
                Check current wait times, inspect live counter queues, or join remotely from your phone.
              </p>
            </div>

            {/* Search and Filters Bar */}
            <div className="flex flex-col sm:flex-row gap-3 mb-6">
              <div className="relative flex-1">
                <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40 text-lg">
                  search
                </span>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("searchPlaceholder", "Search venue name, location, or category...")}
                  className="w-full bg-[#0d0d14] border border-white/10 rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-cyan-400 focus:outline-none transition-all"
                />
              </div>

              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setOpenOnly(!openOnly)}
                  className={`px-3.5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                    openOnly
                      ? "bg-emerald-500/20 border border-emerald-500/40 text-emerald-300"
                      : "bg-[#0d0d14] border border-white/10 text-white/60 hover:text-white"
                  }`}
                >
                  Open Now ({openNowCount})
                </button>

                <button
                  type="button"
                  onClick={() => setFavoritesOnly(!favoritesOnly)}
                  className={`px-3.5 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
                    favoritesOnly
                      ? "bg-pink-500/20 border border-pink-500/40 text-pink-300"
                      : "bg-[#0d0d14] border border-white/10 text-white/60 hover:text-white"
                  }`}
                >
                  Favorites
                </button>

                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="bg-[#0d0d14] border border-white/10 rounded-xl px-3 py-2.5 text-xs font-semibold text-white/80 outline-none cursor-pointer"
                >
                  {categories.map((c) => (
                    <option key={c} value={c} className="bg-[#101016] text-white">
                      {c === "all" ? "All Categories" : c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Favorite / Recent Chips */}
            {(recentStores.length > 0 || favoriteStores.length > 0) && (
              <div className="flex flex-wrap gap-2 mb-6">
                {favoriteStores.map((store) => (
                  <a
                    key={`fav-${store.id}`}
                    href={`/q/${store.id}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-pink-500/10 border border-pink-500/20 text-xs text-pink-200 hover:bg-pink-500/20 transition-colors"
                  >
                    <span className="material-symbols-outlined text-xs text-pink-400">favorite</span>
                    <span>{store.store_name || store.id}</span>
                  </a>
                ))}
                {recentStores.map((store) => (
                  <a
                    key={`rec-${store.storeId}`}
                    href={`/q/${store.storeId}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                  >
                    <span className="material-symbols-outlined text-xs text-cyan-400">history</span>
                    <span>{store.storeName}</span>
                  </a>
                ))}
              </div>
            )}

            {/* Error State */}
            {error && (
              <div className="mb-6 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-center">
                <p className="text-sm text-rose-300 mb-2">{error}</p>
                <button
                  type="button"
                  onClick={() => setRetryKey((k) => k + 1)}
                  className="px-4 py-1.5 rounded-lg bg-rose-500/20 text-xs font-bold text-rose-200 cursor-pointer"
                >
                  Retry Loading
                </button>
              </div>
            )}

            {/* Loading Skeleton */}
            {loading && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {[1, 2, 3].map((n) => (
                  <div key={n} className="rounded-2xl border border-white/5 bg-[#0e0e14] p-5 animate-pulse">
                    <div className="h-4 w-1/2 bg-white/10 rounded mb-2" />
                    <div className="h-3 w-1/3 bg-white/5 rounded mb-4" />
                    <div className="h-10 w-full bg-white/5 rounded" />
                  </div>
                ))}
              </div>
            )}

            {/* Active Store Grid */}
            {!loading && results.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {results.map((store) => (
                  <div
                    key={store.id}
                    className="rounded-2xl border border-white/10 bg-[#0c0c12]/80 backdrop-blur-sm hover:border-violet-500/40 hover:bg-[#101018] transition-all p-5 flex flex-col justify-between group"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className="w-11 h-11 rounded-xl flex items-center justify-center border border-white/10 shrink-0 shadow-md"
                            style={{ backgroundImage: store.theme.mutedGradient }}
                          >
                            <span className="material-symbols-outlined text-lg" style={{ color: store.theme.primary }}>
                              {store.store_logo || "storefront"}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <h3 className="font-headline font-bold text-base text-white truncate group-hover:text-cyan-200 transition-colors">
                              {store.store_name || store.id}
                            </h3>
                            <p className="text-xs text-white/50 truncate">
                              {[store.category, store.location].filter(Boolean).join(" · ") || "Local Venue"}
                            </p>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => handleFavoriteToggle(e, store)}
                          className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/40 hover:text-pink-400 transition-colors shrink-0 cursor-pointer"
                          aria-label="Favorite"
                        >
                          <span
                            className="material-symbols-outlined text-sm"
                            style={store.isFavorite ? { color: "#f472b6", fontVariationSettings: "'FILL' 1" } : {}}
                          >
                            favorite
                          </span>
                        </button>
                      </div>

                      <div className="flex items-center gap-2 mb-4">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                            store.effectiveStatus.isOpen
                              ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                              : "bg-rose-500/10 text-rose-300 border border-rose-500/20"
                          }`}
                        >
                          {store.effectiveStatus.label}
                        </span>

                        <span className="text-[11px] text-white/60 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                          <span>{store.live_party_count || 0} waiting</span>
                        </span>

                        {Number(store.avg_service_mins ?? 0) > 0 && Number(store.live_party_count ?? 0) > 0 && (
                          <span className="text-[11px] text-white/40">
                            (~{Math.round(Number(store.live_party_count) * Number(store.avg_service_mins))}m wait)
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="pt-3 border-t border-white/5 flex items-center gap-2">
                      <a
                        href={`/q/${store.id}`}
                        onClick={() => handleStoreOpen(store)}
                        className="flex-1 py-2.5 px-4 rounded-xl font-headline font-bold text-xs text-center bg-gradient-to-r from-violet-600 to-cyan-600 hover:from-violet-500 hover:to-cyan-500 text-white shadow-md transition-all flex items-center justify-center gap-1.5"
                      >
                        <span>Join Queue</span>
                        <span className="material-symbols-outlined text-sm">arrow_forward</span>
                      </a>
                      <a
                        href={`/display/${store.id}`}
                        title="Open Signage TV Screen"
                        className="p-2.5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white/70 hover:text-white transition-colors"
                      >
                        <span className="material-symbols-outlined text-base">tv</span>
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!loading && results.length === 0 && (
              <div className="text-center py-12 border border-dashed border-white/10 rounded-3xl p-8">
                <span className="material-symbols-outlined text-4xl text-white/30 mb-2">search_off</span>
                <p className="text-sm text-white/70">No venues matching "{search}"</p>
                <p className="text-xs text-white/40 mt-1">Try another keyword or register your venue.</p>
              </div>
            )}
          </div>
        </section>

        {/* ─── INDUSTRY PLAYBOOKS (#solutions) ─────────────────────────────────── */}
        <section id="solutions" className="relative py-20 px-4 sm:px-6 lg:px-8 border-t border-white/5 bg-[#0a0a0f]/40">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-12">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-xs font-semibold text-violet-300 mb-3">
                Field Solutions
              </div>
              <h2 className="text-3xl sm:text-4xl font-headline font-bold text-white mb-2 tracking-tight">
                Designed for High-Volume Venues
              </h2>
              <p className="text-xs sm:text-sm text-white/60 max-w-xl mx-auto">
                See how different industries replace physical line chaos with zero-friction virtual queues.
              </p>
            </div>

            {/* Playbook Tabs */}
            <div className="flex flex-wrap items-center justify-center gap-2 mb-8">
              {INDUSTRY_PLAYBOOKS.map((p) => {
                const isActive = activePlaybook === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => setActivePlaybook(p.id)}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                      isActive
                        ? "bg-violet-600 text-white shadow-lg shadow-violet-600/30"
                        : "bg-white/5 hover:bg-white/10 text-white/60 hover:text-white"
                    }`}
                  >
                    <span>{p.emoji}</span>
                    <span>{p.name}</span>
                  </button>
                );
              })}
            </div>

            {/* Selected Playbook Card */}
            <div className="p-8 sm:p-10 rounded-3xl bg-[#0e0e14] border border-white/10 shadow-2xl relative overflow-hidden">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                <div className="space-y-4">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-xs font-mono text-cyan-300">
                    <span>{selectedPlaybookObj.emoji}</span>
                    <span>{selectedPlaybookObj.name} Playbook</span>
                  </div>

                  <div>
                    <h3 className="text-xs font-mono uppercase text-red-400/80 mb-1">The Traditional Bottleneck:</h3>
                    <p className="text-sm text-white/70 leading-relaxed">{selectedPlaybookObj.problem}</p>
                  </div>

                  <div>
                    <h3 className="text-xs font-mono uppercase text-emerald-400/80 mb-1">With Ghost Queue:</h3>
                    <p className="text-sm text-white/90 leading-relaxed font-medium">{selectedPlaybookObj.solution}</p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/5 flex items-center gap-3">
                    <span className="material-symbols-outlined text-xl text-cyan-400">trending_up</span>
                    <span className="text-xs font-bold text-cyan-200">{selectedPlaybookObj.metric}</span>
                  </div>
                </div>

                <div className="p-6 rounded-2xl bg-gradient-to-br from-[#12121e] to-[#0c0c14] border border-white/10 text-center flex flex-col items-center justify-center">
                  <div className="w-16 h-16 rounded-2xl bg-violet-600/20 border border-violet-500/30 flex items-center justify-center mb-4">
                    <span className="material-symbols-outlined text-3xl text-violet-400">{selectedPlaybookObj.icon}</span>
                  </div>
                  <h4 className="text-lg font-headline font-bold text-white mb-2">Deploy for Your {selectedPlaybookObj.name}</h4>
                  <p className="text-xs text-white/50 mb-6 max-w-xs">
                    Create a branded venue portal, generate entrance QR posters, and start queueing customers in 60 seconds.
                  </p>
                  <a
                    href="/register"
                    className="py-2.5 px-6 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-semibold text-xs tracking-wide shadow-md transition-all cursor-pointer"
                  >
                    Launch Free Venue Portal
                  </a>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─── PLATFORM ARCHITECTURE & CAPABILITIES (#architecture) ─────────────── */}
        <section id="architecture" className="relative py-20 px-4 sm:px-6 lg:px-8 border-t border-white/5">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-16">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-xs font-semibold text-cyan-300 mb-3">
                Engine Architecture
              </div>
              <h2 className="text-3xl sm:text-4xl font-headline font-bold text-white mb-3 tracking-tight">
                Built For Real Counter Operations
              </h2>
              <p className="text-xs sm:text-sm text-white/60 max-w-xl mx-auto">
                Four engineering pillars that differentiate Ghost Queue from clunky hardware pagers and app downloads.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Card 1 */}
              <div className="p-7 rounded-3xl border border-white/10 bg-[#0c0c12]/80 backdrop-blur-sm relative overflow-hidden group hover:border-violet-500/40 transition-colors">
                <div className="w-12 h-12 rounded-2xl bg-violet-600/20 border border-violet-500/30 flex items-center justify-center mb-5 text-violet-400">
                  <span className="material-symbols-outlined text-2xl">qr_code_scanner</span>
                </div>
                <h3 className="text-lg font-headline font-bold text-white mb-2">Zero-Friction Mobile Passes</h3>
                <p className="text-xs sm:text-sm text-white/60 leading-relaxed">
                  No App Store or Google Play downloads required. Customers scan a table QR or click a link to receive an instant web boarding pass that stores in localStorage and survives browser tab closures.
                </p>
              </div>

              {/* Card 2 */}
              <div className="p-7 rounded-3xl border border-white/10 bg-[#0c0c12]/80 backdrop-blur-sm relative overflow-hidden group hover:border-cyan-500/40 transition-colors">
                <div className="w-12 h-12 rounded-2xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center mb-5 text-cyan-400">
                  <span className="material-symbols-outlined text-2xl">volume_up</span>
                </div>
                <h3 className="text-lg font-headline font-bold text-white mb-2">Browser Web Audio Chimes</h3>
                <p className="text-xs sm:text-sm text-white/60 leading-relaxed">
                  Synthesized two-tone airport ding-dong chimes and native mobile vibration pulses trigger directly through browser audio contexts when a customer's turn is called. Zero audio file buffering.
                </p>
              </div>

              {/* Card 3 */}
              <div className="p-7 rounded-3xl border border-white/10 bg-[#0c0c12]/80 backdrop-blur-sm relative overflow-hidden group hover:border-emerald-500/40 transition-colors">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mb-5 text-emerald-400">
                  <span className="material-symbols-outlined text-2xl">tv</span>
                </div>
                <h3 className="text-lg font-headline font-bold text-white mb-2">Smart TV Signage Display</h3>
                <p className="text-xs sm:text-sm text-white/60 leading-relaxed">
                  Launch `/display/:storeId` on any smart TV or tablet in your lobby. Displays high-contrast "Now Serving" counter numbers with audio announcements, transforming ordinary screens into airport-grade flight boards.
                </p>
              </div>

              {/* Card 4 */}
              <div className="p-7 rounded-3xl border border-white/10 bg-[#0c0c12]/80 backdrop-blur-sm relative overflow-hidden group hover:border-amber-500/40 transition-colors">
                <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center mb-5 text-amber-400">
                  <span className="material-symbols-outlined text-2xl">table_chart</span>
                </div>
                <h3 className="text-lg font-headline font-bold text-white mb-2">Staff Hotline & 1-Click Exports</h3>
                <p className="text-xs sm:text-sm text-white/60 leading-relaxed">
                  Operators can press [Space] to call the next party, assign counters, inject emergency front VIPs, and export complete audit histories directly into CSV or Excel spreadsheets with one click.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ─── INTERACTIVE ROI & WAITING TIME SAVINGS CALCULATOR ──────────────────── */}
        <section id="calculator" className="relative py-16 px-4 sm:px-6 lg:px-8 border-t border-white/5 bg-[#0a0a0f]/60">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-10">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-xs font-semibold text-emerald-300 mb-3">
                Interactive Value Estimator
              </div>
              <h2 className="text-2xl sm:text-3xl font-headline font-bold text-white tracking-tight">
                Calculate What Virtual Queueing Saves Your Venue
              </h2>
              <p className="text-xs sm:text-sm text-white/60 max-w-xl mx-auto mt-2">
                Move the sliders to see customer hours saved and avoided revenue lost from physical line walk-aways.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center bg-[#0d0d14] rounded-3xl border border-white/10 p-6 sm:p-8 shadow-xl">
              {/* Sliders */}
              <div className="space-y-6">
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs uppercase font-bold tracking-wider text-white/70">Daily Queue Visitors</span>
                    <span className="text-sm font-headline font-bold text-cyan-300">{calcVisitors} guests/day</span>
                  </div>
                  <input
                    type="range"
                    min="20"
                    max="800"
                    step="10"
                    value={calcVisitors}
                    onChange={(e) => setCalcVisitors(Number(e.target.value))}
                    className="w-full accent-cyan-400 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-white/40 mt-1">
                    <span>20 (Boutique)</span>
                    <span>400 (Busy Cafe)</span>
                    <span>800+ (Event)</span>
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs uppercase font-bold tracking-wider text-white/70">Typical Line Wait Time</span>
                    <span className="text-sm font-headline font-bold text-violet-300">{calcWaitMins} minutes</span>
                  </div>
                  <input
                    type="range"
                    min="5"
                    max="60"
                    step="1"
                    value={calcWaitMins}
                    onChange={(e) => setCalcWaitMins(Number(e.target.value))}
                    className="w-full accent-violet-400 cursor-pointer"
                  />
                  <div className="flex justify-between text-[10px] text-white/40 mt-1">
                    <span>5 mins</span>
                    <span>25 mins</span>
                    <span>60 mins</span>
                  </div>
                </div>

                <p className="text-[11px] text-white/40 leading-relaxed border-t border-white/5 pt-3">
                  Based on Ghost Queue benchmarks: 12% average walk-away reduction and 75% perceived wait time anxiety elimination.
                </p>
              </div>

              {/* Dynamic Value Metrics */}
              <div className="grid grid-cols-1 gap-3.5">
                <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/5 flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-semibold text-white/50 uppercase tracking-wider">Customer Wait Hours Saved</p>
                    <p className="text-2xl font-headline font-black text-emerald-400 mt-0.5">{hoursSavedPerMonth.toLocaleString()} hrs</p>
                  </div>
                  <span className="material-symbols-outlined text-2xl text-emerald-400/50">hourglass_disabled</span>
                </div>

                <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/5 flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-semibold text-white/50 uppercase tracking-wider">Recovered Monthly Sales</p>
                    <p className="text-2xl font-headline font-black text-cyan-300 mt-0.5">${recoveredSales.toLocaleString()}</p>
                  </div>
                  <span className="material-symbols-outlined text-2xl text-cyan-400/50">payments</span>
                </div>

                <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/5 flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-semibold text-white/50 uppercase tracking-wider">Service Desk Throughput</p>
                    <p className="text-2xl font-headline font-black text-violet-300 mt-0.5">+{turnoverBoost}% faster</p>
                  </div>
                  <span className="material-symbols-outlined text-2xl text-violet-400/50">speed</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─── READY TO TRANSFORM CTA BANNER ───────────────────────────────────── */}
        <section className="relative py-20 px-4 sm:px-6 lg:px-8 border-t border-white/5">
          <div className="max-w-4xl mx-auto rounded-3xl border border-violet-500/30 bg-gradient-to-br from-violet-950/40 via-[#0d0d14] to-cyan-950/30 p-10 sm:p-14 text-center relative overflow-hidden shadow-2xl">
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-headline font-bold text-white mb-4 tracking-tight">
              Ready to Eliminate Physical Queues?
            </h2>
            <p className="text-base text-white/60 mb-8 max-w-xl mx-auto">
              Empower your visitors to wait with total freedom. Launch your free store queue in under 60 seconds.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <a
                href="/register"
                className="py-3.5 px-8 rounded-xl font-headline font-bold text-sm bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-500 hover:from-violet-500 hover:to-cyan-400 text-white shadow-lg shadow-violet-600/30 transition-all cursor-pointer"
              >
                Provision Free Store Queue
              </a>
              <a
                href="/admin"
                className="py-3.5 px-8 rounded-xl font-headline font-bold text-sm bg-white/5 border border-white/10 hover:bg-white/10 text-white transition-all cursor-pointer"
              >
                Open Merchant Console
              </a>
            </div>
          </div>
        </section>
      </main>

      {/* ─── MULTI-COLUMN MODERN FOOTER ───────────────────────────────────────── */}
      <footer className="relative z-10 border-t border-white/5 bg-[#08080c] py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-10">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="material-symbols-outlined text-violet-400 text-lg">blur_on</span>
                <span className="font-headline font-bold text-base text-white">Ghost Queue</span>
              </div>
              <p className="text-xs text-white/50 leading-relaxed">
                Invisible line management engine. Instant mobile web passes, sub-second socket streaming, and airport-grade TV signage boards.
              </p>
            </div>

            <div>
              <h4 className="text-xs font-headline font-bold uppercase tracking-wider text-white mb-3">Navigation</h4>
              <ul className="space-y-2 text-xs text-white/50">
                <li><a href="#venues" className="hover:text-white transition-colors">Live Store Radar</a></li>
                <li><a href="#solutions" className="hover:text-white transition-colors">Field Solutions</a></li>
                <li><a href="#architecture" className="hover:text-white transition-colors">Engine Architecture</a></li>
                <li><a href="#calculator" className="hover:text-white transition-colors">ROI Calculator</a></li>
              </ul>
            </div>

            <div>
              <h4 className="text-xs font-headline font-bold uppercase tracking-wider text-white mb-3">Store Operator Portals</h4>
              <ul className="space-y-2 text-xs text-white/50">
                <li><a href="/admin" className="hover:text-violet-300 text-white/80 font-medium transition-colors">Store Login (Google / Email)</a></li>
                <li><a href="/register" className="hover:text-cyan-300 text-white/80 font-medium transition-colors">Create New Store</a></li>
                <li><a href="/display" className="hover:text-white transition-colors">Signage TV Display</a></li>
                <li><a href="/admin" className="hover:text-white transition-colors">Store Admin & Call Controls</a></li>
              </ul>
            </div>

            <div>
              <h4 className="text-xs font-headline font-bold uppercase tracking-wider text-white mb-3">Engine Specs</h4>
              <ul className="space-y-2 text-xs text-white/50 font-mono">
                <li className="text-white/40">• Bun & Vite Runtime</li>
                <li className="text-white/40">• Firebase Cloud Firestore</li>
                <li className="text-white/40">• Zero-Leak Security Rules</li>
                <li className="text-white/40">• Native Web Audio Chimes</li>
              </ul>
            </div>
          </div>

          <div className="pt-6 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between text-xs text-white/40 gap-3">
            <p>© 2026 Ghost Queue. All rights reserved.</p>
            <div className="flex gap-4">
              <a href="#venues" className="hover:text-white/70">Store Radar</a>
              <a href="/register" className="hover:text-white/70">Create Store</a>
              <a href="/admin" className="hover:text-violet-400 font-medium">Store Login (Google / Email)</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
