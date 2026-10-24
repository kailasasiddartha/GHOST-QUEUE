import React, { useState, useEffect, useRef } from "react";
import { playCallChime, playSuccessChime } from "../utils/soundEffects";

export default function InteractiveDemoModal({ isOpen, onClose }) {
  const [step, setStep] = useState("setup"); // 'setup' | 'queue'
  const [guestName, setGuestName] = useState("Alex Morgan");
  const [partySize, setPartySize] = useState(2);
  const [isFastPass, setIsFastPass] = useState(false);
  const [position, setPosition] = useState(4);
  const [totalInQueue, setTotalInQueue] = useState(12);
  const [waitMins, setWaitMins] = useState(12);
  const [showQR, setShowQR] = useState(false);
  const [activityLog, setActivityLog] = useState([
    "Party #32 called to Counter 1",
    "Party #33 completed service",
    "Party #34 called to Counter 2",
  ]);

  const intervalRef = useRef(null);

  // Auto-advance simulated queue every 7 seconds
  useEffect(() => {
    if (step !== "queue") return;

    intervalRef.current = setInterval(() => {
      setPosition((prev) => {
        if (prev <= 1) {
          playCallChime();
          return 1;
        }
        const next = prev - 1;
        if (next === 1) {
          playCallChime();
        }
        return next;
      });

      setWaitMins((prev) => Math.max(1, prev - 3));
      setTotalInQueue((prev) => Math.max(1, prev - 1));
      setActivityLog((prev) => [
        `Party #${Math.floor(Math.random() * 80) + 10} served at counter`,
        ...prev.slice(0, 4),
      ]);
    }, 7000);

    return () => clearInterval(intervalRef.current);
  }, [step]);

  if (!isOpen) return null;

  const handleStartDemo = (e) => {
    e.preventDefault();
    playSuccessChime();
    const initialPos = isFastPass ? 2 : 4;
    setPosition(initialPos);
    setWaitMins(initialPos * 3);
    setStep("queue");
  };

  const handleAdvanceManually = () => {
    if (position <= 1) return;
    const next = position - 1;
    setPosition(next);
    setWaitMins(Math.max(1, (next - 1) * 3));
    setTotalInQueue((prev) => Math.max(1, prev - 1));
    if (next === 1) {
      playCallChime();
    }
  };

  const isCalled = position === 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-[fade-in_0.2s_ease-out]">
      <div className="relative w-full max-w-md rounded-3xl glass-panel-elevated p-6 border border-white/15 overflow-hidden text-white shadow-2xl">
        {/* Glow ambient */}
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-primary/25 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-secondary/25 rounded-full blur-3xl pointer-events-none" />

        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10 relative z-10">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-2xl animate-pulse">
              vital_signs
            </span>
            <div>
              <h3 className="font-headline font-bold text-base bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
                Interactive Live Simulator
              </h3>
              <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-label">
                Real-Time Experience Demo
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-on-surface-variant transition-colors"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>

        {/* Content */}
        <div className="mt-5 relative z-10">
          {step === "setup" ? (
            <form onSubmit={handleStartDemo} className="space-y-4">
              <p className="text-xs text-on-surface-variant leading-relaxed">
                Experience how Ghost Queue notifies customers, updates live wait times, and alerts guests when called.
              </p>

              <div>
                <label className="block text-[11px] uppercase tracking-wider text-on-surface-variant font-label mb-1">
                  Guest Name
                </label>
                <input
                  type="text"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  className="w-full rounded-xl bg-surface-container border border-white/10 px-4 py-2.5 text-sm text-white focus:border-primary/50 outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-[11px] uppercase tracking-wider text-on-surface-variant font-label mb-1">
                  Party Size
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {[1, 2, 4, 6].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setPartySize(num)}
                      className={`py-2 rounded-xl text-xs font-bold transition-all border ${
                        partySize === num
                          ? "bg-primary-container text-white border-primary"
                          : "bg-surface-container text-on-surface-variant border-white/5 hover:bg-white/5"
                      }`}
                    >
                      {num} {num === 1 ? "Person" : "People"}
                    </button>
                  ))}
                </div>
              </div>

              <div
                onClick={() => setIsFastPass(!isFastPass)}
                className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between ${
                  isFastPass
                    ? "bg-secondary/10 border-secondary/30 neon-border-cyan"
                    : "bg-surface-container-low border-white/5 hover:border-white/10"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-secondary text-2xl">
                    bolt
                  </span>
                  <div>
                    <p className="text-xs font-bold text-white">VIP Fast Pass Mode</p>
                    <p className="text-[10px] text-on-surface-variant">
                      Skips ahead to priority tier (#2 in queue)
                    </p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={isFastPass}
                  onChange={() => {}}
                  className="rounded text-secondary focus:ring-0"
                />
              </div>

              <button
                type="submit"
                className="w-full mt-4 py-3.5 rounded-2xl bg-gradient-to-r from-primary-container to-secondary font-headline font-bold text-sm text-white shadow-lg hover:opacity-95 transition-all flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-base">confirmation_number</span>
                Join Live Demo Queue
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              {/* Stepper */}
              <div className="grid grid-cols-4 gap-1 text-center py-2 px-1 bg-surface-container-low/70 rounded-2xl border border-white/5">
                {[
                  { label: "Joined", done: true },
                  { label: "In Line", done: position <= 3 },
                  { label: "Almost Up", done: position <= 2 },
                  { label: "Called!", done: position === 1 },
                ].map((s, idx) => (
                  <div key={idx} className="flex flex-col items-center">
                    <span
                      className={`w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center mb-1 transition-all ${
                        s.done
                          ? "bg-emerald-400 text-slate-950 shadow-md shadow-emerald-400/30"
                          : "bg-white/10 text-on-surface-variant/60"
                      }`}
                    >
                      {s.done ? "✓" : idx + 1}
                    </span>
                    <span className="text-[9px] font-label uppercase tracking-tight text-on-surface-variant">
                      {s.label}
                    </span>
                  </div>
                ))}
              </div>

              {/* Holographic Ticket Card */}
              <div
                className={`ticket-notch-container rounded-3xl p-5 border transition-all ${
                  isCalled
                    ? "bg-emerald-500/10 border-emerald-400/40 neon-border-emerald"
                    : "bg-surface-container border-white/10 neon-border-violet"
                }`}
              >
                <div className="ticket-notch-left" />
                <div className="ticket-notch-right" />

                <div className="flex items-center justify-between pb-3 border-b border-white/10">
                  <div>
                    <span className="text-[10px] uppercase tracking-widest text-secondary font-label font-bold">
                      Demo Restaurant & Cafe
                    </span>
                    <h4 className="font-bold text-sm text-white">{guestName}</h4>
                  </div>
                  <span
                    className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                      isCalled
                        ? "bg-emerald-400 text-slate-950 animate-pulse"
                        : "bg-primary/20 text-primary"
                    }`}
                  >
                    {isCalled ? "⚡ YOUR TURN NOW" : isFastPass ? "VIP Pass" : "Standard"}
                  </span>
                </div>

                <div className="py-6 text-center">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-on-surface-variant font-label mb-1">
                    Your Queue Position
                  </p>
                  <div className="text-6xl font-headline font-bold text-white tracking-tight flex items-center justify-center gap-1">
                    #{position}
                  </div>
                  <p className="text-xs text-on-surface-variant mt-2 font-medium">
                    {isCalled ? (
                      <span className="text-emerald-400 font-bold">
                        Please proceed directly to Counter 1!
                      </span>
                    ) : (
                      <>
                        Estimated wait: <strong className="text-white">~{waitMins} min</strong> ·{" "}
                        {position - 1} {position - 1 === 1 ? "party" : "parties"} ahead
                      </>
                    )}
                  </p>
                </div>

                <div className="ticket-perforation pt-3 flex items-center justify-between text-xs text-on-surface-variant">
                  <span>Party of {partySize} · {totalInQueue} in line</span>
                  <button
                    type="button"
                    onClick={() => setShowQR(!showQR)}
                    className="text-primary hover:underline text-xs flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-sm">qr_code_2</span>
                    {showQR ? "Hide QR" : "Show Counter QR"}
                  </button>
                </div>

                {showQR && (
                  <div className="mt-3 p-3 bg-white rounded-xl flex flex-col items-center justify-center animate-[fade-in_0.2s_ease-out]">
                    <div className="w-24 h-24 bg-slate-900 rounded-lg flex items-center justify-center text-white text-xs text-center p-2 font-mono">
                      [DEMO-QR-{position}]
                    </div>
                    <p className="text-[10px] text-slate-800 font-bold mt-1">Scan at Counter</p>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleAdvanceManually}
                  disabled={position <= 1}
                  className="py-2.5 px-3 rounded-xl bg-surface-container-high border border-white/10 text-xs font-bold hover:bg-white/10 disabled:opacity-40 transition-all flex items-center justify-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-sm">fast_forward</span>
                  Advance Queue (Test)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStep("setup");
                    setShowQR(false);
                  }}
                  className="py-2.5 px-3 rounded-xl border border-white/10 text-xs font-bold text-on-surface-variant hover:text-white hover:bg-white/5 transition-all flex items-center justify-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-sm">replay</span>
                  Reset Demo
                </button>
              </div>

              {/* Live Ticker */}
              <div className="p-2.5 rounded-xl bg-surface-container-low/80 border border-white/5 text-[11px] text-on-surface-variant/80">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="font-label uppercase tracking-wider text-[9px] text-emerald-400">
                    Live Counter Feed
                  </span>
                </div>
                <div className="space-y-1 font-mono text-[10px]">
                  {activityLog.slice(0, 2).map((item, i) => (
                    <p key={i} className="truncate">
                      › {item}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
