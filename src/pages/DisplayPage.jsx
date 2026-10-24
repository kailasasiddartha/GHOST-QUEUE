import React, { useEffect, useRef, useState } from "react";
import { db } from "../firebase";
import { collection, doc, onSnapshot, orderBy, query } from "firebase/firestore";
import QRCode from "qrcode";
import { getEffectiveStoreStatus } from "../utils/storeStatus";
import { playCallChime } from "../utils/soundEffects";

/**
 * DisplayPage — Digital Signage Mode
 * Airport / VIP Lounge full-screen TV display showing live queue state.
 * Route: /display/:storeId
 * Auto-refreshing, real-time sound chimes, fullscreen support, and offline QR code.
 */
export default function DisplayPage({ storeIdParam }) {
  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const storeId = storeIdParam || params.get("store") || "";

  const [storeMeta, setStoreMeta] = useState(null);
  const [entries, setEntries] = useState([]);
  const [now, setNow] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState("");

  const prevServingIdRef = useRef(null);
  const soundEnabledRef = useRef(soundEnabled);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  // Digital clock tick
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  // Generate offline QR code for direct store join
  useEffect(() => {
    if (!storeId || typeof window === "undefined") return;
    const joinUrl = `${window.location.origin}/q/${storeId}`;
    QRCode.toDataURL(joinUrl, {
      margin: 1,
      width: 180,
      color: { dark: "#0c0c11", light: "#ffffff" },
    })
      .then(setQrCodeDataUrl)
      .catch((err) => console.error("QR Code generation error", err));
  }, [storeId]);

  // Live queue listener
  useEffect(() => {
    if (!storeId) return undefined;

    const unsubMeta = onSnapshot(doc(db, "publicStores", storeId), (snap) => {
      setStoreMeta(snap.exists() ? { id: snap.id, ...snap.data() } : null);
      setLoading(false);
    });

    const unsubQueue = onSnapshot(
      query(collection(db, "publicStores", storeId, "liveQueue"), orderBy("queue_index", "asc")),
      (snap) => {
        const queueEntries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setEntries(queueEntries);

        // Detect if currently serving ticket has changed
        const currentFirstId = queueEntries[0]?.id;
        if (currentFirstId && currentFirstId !== prevServingIdRef.current) {
          if (prevServingIdRef.current !== null && soundEnabledRef.current) {
            playCallChime();
          }
          prevServingIdRef.current = currentFirstId;
        }
      }
    );

    return () => {
      unsubMeta();
      unsubQueue();
    };
  }, [storeId]);

  const toggleFullscreen = () => {
    if (typeof document === "undefined") return;
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  if (!storeId) {
    return (
      <div className="h-screen bg-[#09090e] flex items-center justify-center p-6 text-center">
        <div className="p-8 rounded-3xl glass-panel border border-white/10 max-w-md">
          <span className="material-symbols-outlined text-4xl text-primary mb-3 block">tv</span>
          <h2 className="text-xl font-bold font-headline text-white mb-2">Signage Display Mode</h2>
          <p className="text-white/50 text-sm">No store ID provided. Access via: /display?store=YOUR_STORE_ID</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-screen bg-[#09090e] flex items-center justify-center gap-4 flex-col text-white">
        <div className="w-16 h-16 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
        <p className="text-white/50 text-sm font-mono uppercase tracking-widest">
          Syncing Live Signage Feed...
        </p>
      </div>
    );
  }

  if (!storeMeta) {
    return (
      <div className="h-screen bg-[#09090e] flex items-center justify-center p-6 text-center text-white">
        <div className="p-8 rounded-3xl glass-panel border border-white/10 max-w-md">
          <span className="material-symbols-outlined text-4xl text-error mb-3 block">error_outline</span>
          <h2 className="text-xl font-bold font-headline text-white mb-2">Store Not Found</h2>
          <p className="text-white/50 text-sm">No registered queue found for ID: {storeId}</p>
        </div>
      </div>
    );
  }

  const storeStatus = getEffectiveStoreStatus(storeMeta);
  const primary = storeMeta.brand_primary || "#7C3AED";
  const secondary = storeMeta.brand_secondary || "#22D3EE";
  const storeName = storeMeta.store_name || storeId;
  const liveCount = storeMeta.live_party_count || entries.length || 0;
  const avgMins = storeMeta.avg_service_mins || 3;
  const currentlyServing = entries[0] || null;
  const upNextEntries = entries.slice(1, 5);
  const announcement = storeMeta.announcement || storeMeta.current_broadcast?.message || "";

  const timeStr = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const dateStr = now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#08080c] text-white font-body select-none">
      {/* Top Airport Navigation Bar */}
      <header className="flex items-center justify-between px-8 py-5 border-b border-white/10 bg-[#0c0c12]/90 backdrop-blur-xl">
        <div className="flex items-center gap-4">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center text-white text-2xl font-bold shadow-lg"
            style={{ background: `linear-gradient(135deg, ${primary}, ${secondary})` }}
          >
            <span className="material-symbols-outlined text-2xl">{storeMeta.store_logo || "storefront"}</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold font-headline tracking-tight text-white">{storeName}</h1>
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                  storeStatus.isOpen ? "bg-emerald-400/10 text-emerald-400 border border-emerald-400/30" : "bg-red-400/10 text-red-400 border border-red-400/30"
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${storeStatus.isOpen ? "bg-emerald-400 animate-ping" : "bg-red-400"}`} />
                {storeStatus.isOpen ? "Live Queue" : "Closed"}
              </span>
            </div>
            <p className="text-xs text-white/40 uppercase tracking-widest font-label mt-0.5">
              {[storeMeta.category, storeMeta.location].filter(Boolean).join(" · ")}
            </p>
          </div>
        </div>

        {/* Controls & Live Clock */}
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setSoundEnabled(!soundEnabled);
                if (!soundEnabled) playCallChime();
              }}
              className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-all ${
                soundEnabled
                  ? "bg-white/10 border-white/20 text-white hover:bg-white/15"
                  : "bg-red-500/10 border-red-500/20 text-red-400"
              }`}
              title={soundEnabled ? "Mute Call Chimes" : "Enable Airport Chime"}
            >
              <span className="material-symbols-outlined text-lg">
                {soundEnabled ? "volume_up" : "volume_off"}
              </span>
            </button>

            <button
              type="button"
              onClick={toggleFullscreen}
              className="w-10 h-10 rounded-xl flex items-center justify-center border border-white/10 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-all"
              title="Toggle Fullscreen (F11)"
            >
              <span className="material-symbols-outlined text-lg">
                {isFullscreen ? "fullscreen_exit" : "fullscreen"}
              </span>
            </button>
          </div>

          <div className="text-right border-l border-white/10 pl-6">
            <p className="text-3xl font-mono font-bold tabular-nums text-white tracking-wider">{timeStr}</p>
            <p className="text-[11px] text-white/40 uppercase tracking-widest font-label">{dateStr}</p>
          </div>
        </div>
      </header>

      {/* Main Split Screen */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left Side: Massive NOW SERVING Hero Display (60% width) */}
        <section className="flex-[3] flex flex-col items-center justify-center p-8 border-r border-white/10 relative overflow-hidden bg-gradient-to-b from-[#0e0e16] to-[#08080c]">
          {/* Ambient Glows */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-primary/15 rounded-full blur-[130px] pointer-events-none" />

          <div className="relative z-10 w-full max-w-2xl text-center">
            <div className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-emerald-400/10 border border-emerald-400/30 text-emerald-300 font-headline font-bold text-sm uppercase tracking-[0.2em] mb-4 shadow-lg shadow-emerald-400/10">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
              Now Serving
            </div>

            {currentlyServing ? (
              <div className="my-2 p-10 rounded-3xl border border-emerald-400/30 bg-emerald-500/5 neon-border-emerald glass-glow">
                <p className="text-xs uppercase tracking-[0.25em] text-white/50 font-label mb-2">
                  Ticket Number
                </p>
                <div className="text-9xl font-headline font-bold text-white tracking-tighter drop-shadow-[0_0_35px_rgba(16,185,129,0.5)]">
                  #{currentlyServing.queue_index || 1}
                </div>
                <div className="mt-4 flex items-center justify-center gap-3">
                  <span className="text-xl font-bold text-emerald-300">
                    {currentlyServing.display_name || "Guest"}
                  </span>
                  <span className="px-3 py-1 rounded-full bg-white/10 text-xs font-bold uppercase tracking-wider text-white">
                    {currentlyServing.service_counter || "Counter 1"}
                  </span>
                </div>
              </div>
            ) : (
              <div className="my-6 p-12 rounded-3xl border border-white/10 bg-white/5 text-center">
                <span className="material-symbols-outlined text-6xl text-white/20 mb-3 block">
                  hourglass_empty
                </span>
                <p className="text-3xl font-bold text-white/40 font-headline">Queue is Empty</p>
                <p className="text-sm text-white/30 mt-2">Ready to welcome the next party</p>
              </div>
            )}

            {/* Quick Metrics Cards */}
            <div className="grid grid-cols-3 gap-4 mt-8">
              <div className="p-4 rounded-2xl glass-panel border border-white/10">
                <span className="text-[10px] uppercase tracking-widest text-white/40 font-label block">
                  Parties Waiting
                </span>
                <span className="text-4xl font-headline font-bold text-white block mt-1">
                  {liveCount}
                </span>
              </div>

              <div className="p-4 rounded-2xl glass-panel border border-white/10">
                <span className="text-[10px] uppercase tracking-widest text-white/40 font-label block">
                  Est. Wait Time
                </span>
                <span className="text-4xl font-headline font-bold text-secondary block mt-1">
                  ~{Math.round(liveCount * avgMins)}m
                </span>
              </div>

              <div className="p-4 rounded-2xl glass-panel border border-white/10">
                <span className="text-[10px] uppercase tracking-widest text-white/40 font-label block">
                  Average Pace
                </span>
                <span className="text-4xl font-headline font-bold text-primary block mt-1">
                  ~{avgMins}m
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Right Side: Up Next Board & Join QR (40% width) */}
        <section className="flex-[2] flex flex-col p-6 bg-[#0a0a10] border-l border-white/5 overflow-hidden">
          <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-4">
            <h2 className="text-xs uppercase tracking-[0.2em] font-headline font-bold text-white/60">
              Up Next In Line
            </h2>
            <span className="text-xs text-white/40 font-mono">
              {upNextEntries.length} queued
            </span>
          </div>

          {/* Up Next List */}
          <div className="space-y-3 flex-1 overflow-y-auto pr-1">
            {upNextEntries.length === 0 ? (
              <div className="h-40 flex items-center justify-center text-center">
                <p className="text-sm text-white/30">No other parties waiting currently</p>
              </div>
            ) : (
              upNextEntries.map((entry, index) => (
                <div
                  key={entry.id || index}
                  className="flex items-center justify-between p-3.5 rounded-2xl glass-panel border border-white/10 hover:border-white/20 transition-all"
                >
                  <div className="flex items-center gap-3">
                    <span className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center font-bold font-headline text-lg text-primary">
                      #{entry.queue_index || index + 2}
                    </span>
                    <div>
                      <p className="text-sm font-bold text-white truncate max-w-[150px]">
                        {entry.display_name || "Guest"}
                      </p>
                      <p className="text-[11px] text-white/40">
                        Party of {entry.member_count || 1}
                      </p>
                    </div>
                  </div>

                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-white/70">
                    Pos #{index + 2}
                  </span>
                </div>
              ))
            )}
          </div>

          {/* Join Queue Offline QR Code Panel */}
          <div className="mt-4 p-5 rounded-3xl glass-panel-elevated border border-white/15 text-center relative overflow-hidden">
            <p className="text-[11px] uppercase tracking-[0.18em] font-label font-bold text-secondary mb-3">
              Scan Phone Camera To Join
            </p>
            {qrCodeDataUrl ? (
              <div className="p-3 bg-white rounded-2xl mx-auto w-fit shadow-2xl">
                <img
                  src={qrCodeDataUrl}
                  alt="Join Queue QR Code"
                  className="w-32 h-32 block rounded-lg"
                />
              </div>
            ) : (
              <div className="w-32 h-32 bg-white/10 rounded-2xl mx-auto flex items-center justify-center">
                <span className="material-symbols-outlined text-white/40">qr_code</span>
              </div>
            )}
            <p className="text-xs font-mono text-white/70 mt-2 font-bold">
              ghost-queue-4ddef.web.app/q/{storeId}
            </p>
          </div>
        </section>
      </div>

      {/* Bottom Marquee Announcement Ticker */}
      <footer className="h-11 border-t border-white/10 bg-[#060609] flex items-center overflow-hidden px-4">
        <span className="px-3 py-1 rounded-lg bg-primary-container text-white text-[10px] font-bold uppercase tracking-wider shrink-0 mr-4 flex items-center gap-1">
          <span className="material-symbols-outlined text-xs">campaign</span>
          Notice
        </span>
        <div className="flex-1 overflow-hidden">
          <div className="animate-marquee text-xs text-white/80 font-medium">
            <span className="mx-8">
              {announcement || `Welcome to ${storeName}. Please watch the screen for your ticket number.`}
            </span>
            <span className="mx-8 text-secondary">
              ⚡ You can track your ticket live on your phone anytime.
            </span>
            <span className="mx-8">
              {announcement || `Welcome to ${storeName}. Please watch the screen for your ticket number.`}
            </span>
            <span className="mx-8 text-emerald-400">
              🔔 An airport chime will sound when your number is called.
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
