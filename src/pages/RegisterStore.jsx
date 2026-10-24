import React, { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth, googleProvider } from "../firebase";
import { signInWithPopup } from "firebase/auth";
import { registerStore } from "../utils/auth";

const CATEGORIES = [
  { value: "Restaurant", label: "Restaurant & Cafe", icon: "restaurant", emoji: "🍽️" },
  { value: "Clinic", label: "Medical & Dental", icon: "local_hospital", emoji: "🏥" },
  { value: "Retail", label: "Retail & Boutique", icon: "shopping_bag", emoji: "🛍️" },
  { value: "Salon", label: "Salon & Spa Care", icon: "content_cut", emoji: "✂️" },
  { value: "Temple", label: "Temple & Shrine", icon: "temple_hindu", emoji: "🛕" },
  { value: "Gym", label: "Gym & Fitness Club", icon: "fitness_center", emoji: "💪" },
  { value: "Bank", label: "Bank & Financial", icon: "account_balance", emoji: "🏦" },
  { value: "Event", label: "Events & Ticketing", icon: "confirmation_number", emoji: "🎟️" },
  { value: "Other", label: "Service Counter", icon: "store", emoji: "📋" },
];

const TIMEZONES = [
  { value: "Asia/Kolkata", label: "India (IST, UTC+5:30)" },
  { value: "Asia/Dubai", label: "Dubai / Gulf (GST, UTC+4)" },
  { value: "Asia/Singapore", label: "Singapore / KL (SGT, UTC+8)" },
  { value: "Europe/London", label: "London / UK (GMT/BST)" },
  { value: "America/New_York", label: "US Eastern (EST/EDT)" },
  { value: "America/Los_Angeles", label: "US Pacific (PST/PDT)" },
  { value: "Australia/Sydney", label: "Sydney / Melbourne (AEST)" },
];

export default function RegisterStore() {
  const [user, setUser] = useState(null);
  const [storeName, setStoreName] = useState("");
  const [category, setCategory] = useState("Restaurant");
  const [location, setLocation] = useState("");
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [fieldErrors, setFieldErrors] = useState({});
  const [googleLoading, setGoogleLoading] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setLoadingUser(false);
    });
    return unsub;
  }, []);

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    setError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setError("Failed to authenticate with Google: " + err.message);
    } finally {
      setGoogleLoading(false);
    }
  };

  const validate = () => {
    const errors = {};
    if (!storeName.trim()) {
      errors.storeName = "Store name is required.";
    } else if (storeName.trim().length < 3) {
      errors.storeName = "Must be at least 3 characters.";
    }
    if (!location.trim()) {
      errors.location = "City / neighborhood is required.";
    }
    return errors;
  };

  const handleRegister = async (event) => {
    event.preventDefault();
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    if (!user) {
      setError("Please sign in with Google first to claim store ownership.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await registerStore({
        storeName: storeName.trim(),
        category,
        location: location.trim(),
        timezone,
      });
      window.location.href = "/admin";
    } catch (err) {
      setError(err?.message || "Failed to register store. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Generate a mock slug for live preview
  const slugPreview = storeName
    ? storeName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    : "your-store";

  const selectedCategoryObj = CATEGORIES.find((c) => c.value === category) || CATEGORIES[0];

  if (loadingUser) {
    return (
      <div className="min-h-screen bg-[#07070a] text-white flex items-center justify-center flex-col gap-4">
        <div className="w-12 h-12 rounded-2xl border-2 border-violet-500 border-t-transparent animate-spin" />
        <p className="text-white/40 text-xs uppercase tracking-widest font-mono">Initializing Console...</p>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-[#07070a] text-white selection:bg-violet-500/30 font-body py-10 px-4 sm:px-6 lg:px-8">
      {/* Background ambient lighting */}
      <div className="pointer-events-none fixed -top-40 left-1/3 w-[600px] h-[400px] bg-violet-600/15 blur-[140px] rounded-full" />
      <div className="pointer-events-none fixed bottom-10 right-10 w-[500px] h-[500px] bg-cyan-500/10 blur-[150px] rounded-full" />
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(#ffffff08_1px,transparent_1px)] [background-size:24px_24px] opacity-40" />

      {/* Top bar */}
      <div className="max-w-6xl mx-auto mb-8 flex items-center justify-between relative z-10">
        <button
          onClick={() => { window.location.href = "/"; }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white backdrop-blur-xl transition-all text-xs font-semibold uppercase tracking-wider group"
        >
          <span className="material-symbols-outlined text-base transition-transform group-hover:-translate-x-0.5">arrow_back</span>
          <span>Ghost Queue Portal</span>
        </button>

        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300 text-xs font-mono">
          <span className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
          <span>Provisioning Engine</span>
        </div>
      </div>

      {/* Main Container */}
      <div className="max-w-6xl mx-auto relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* Left Column: Form & Ownership */}
          <div className="lg:col-span-7">
            <div className="rounded-3xl border border-white/10 bg-[#0e0e14]/90 backdrop-blur-2xl p-6 sm:p-8 shadow-2xl relative">
              <div className="absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-violet-400/50 to-transparent" />

              <div className="mb-6">
                <span className="text-xs font-mono text-cyan-400 uppercase tracking-widest">Step 01 of 02</span>
                <h1 className="text-2xl sm:text-3xl font-bold font-headline tracking-tight text-white mt-1">
                  Launch Your Digital Queue
                </h1>
                <p className="text-sm text-white/50 mt-1.5">
                  Set up your live customer boarding radar in under 60 seconds. Zero hardware required.
                </p>
              </div>

              {/* Owner account banner */}
              {user ? (
                <div className="mb-6 p-4 rounded-2xl bg-white/[0.03] border border-white/10 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-600 to-cyan-500 p-0.5 shrink-0">
                      <div className="w-full h-full bg-[#111118] rounded-full flex items-center justify-center font-bold text-xs">
                        {user.displayName ? user.displayName.charAt(0).toUpperCase() : "U"}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] font-mono text-white/40 uppercase tracking-wider">Store Owner Account</p>
                      <p className="text-sm font-semibold text-white truncate">{user.displayName || user.email}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { window.location.href = "/admin"; }}
                    className="text-xs text-violet-400 hover:text-violet-300 font-semibold shrink-0"
                  >
                    Switch
                  </button>
                </div>
              ) : (
                <div className="mb-6 p-5 rounded-2xl bg-violet-500/10 border border-violet-500/20 text-center">
                  <span className="material-symbols-outlined text-2xl text-violet-400 mb-1">lock</span>
                  <h3 className="text-sm font-bold text-white">Sign in to bind your store</h3>
                  <p className="text-xs text-white/60 mt-1 mb-4">
                    Your Google account will be assigned as the primary Store Administrator.
                  </p>
                  <button
                    onClick={handleGoogleLogin}
                    disabled={googleLoading}
                    className="inline-flex items-center justify-center gap-3 py-2.5 px-5 rounded-xl bg-white text-gray-900 font-semibold text-xs hover:bg-gray-100 transition-all shadow-md cursor-pointer disabled:opacity-50"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                    <span>{googleLoading ? "Verifying..." : "Sign in with Google"}</span>
                  </button>
                </div>
              )}

              {/* Form */}
              <form onSubmit={handleRegister} className="space-y-5">
                {/* Store Name */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-white/70 uppercase tracking-wider">
                      Business or Venue Name <span className="text-red-400">*</span>
                    </label>
                    <span className="text-[11px] text-white/30 font-mono">{storeName.length}/60</span>
                  </div>
                  <input
                    type="text"
                    required
                    value={storeName}
                    onChange={(e) => {
                      setStoreName(e.target.value);
                      setFieldErrors((prev) => ({ ...prev, storeName: null }));
                    }}
                    placeholder="e.g. Copper Chimney, Dr. Mehta Clinic, Lush Salon"
                    maxLength={60}
                    className={`w-full bg-[#14141e] border rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none transition-colors ${
                      fieldErrors.storeName ? "border-red-500/70 focus:border-red-400" : "border-white/10 focus:border-violet-500"
                    }`}
                  />
                  {fieldErrors.storeName && (
                    <p className="text-xs text-red-400 mt-1.5 flex items-center gap-1">
                      <span className="material-symbols-outlined text-xs">error</span>
                      {fieldErrors.storeName}
                    </p>
                  )}
                </div>

                {/* Category Grid Selection */}
                <div>
                  <label className="block text-xs font-semibold text-white/70 uppercase tracking-wider mb-2">
                    Industry Category
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {CATEGORIES.map((cat) => {
                      const isSelected = category === cat.value;
                      return (
                        <button
                          key={cat.value}
                          type="button"
                          onClick={() => setCategory(cat.value)}
                          className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left text-xs transition-all ${
                            isSelected
                              ? "bg-violet-600/20 border-violet-500/50 text-white font-semibold shadow-[0_0_15px_rgba(124,58,237,0.2)]"
                              : "bg-white/[0.02] border-white/5 text-white/60 hover:border-white/15 hover:text-white"
                          }`}
                        >
                          <span className="text-base">{cat.emoji}</span>
                          <span className="truncate">{cat.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* City / Location */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-white/70 uppercase tracking-wider">
                      Location / Neighborhood <span className="text-red-400">*</span>
                    </label>
                    <span className="text-[11px] text-white/30 font-mono">{location.length}/80</span>
                  </div>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40 text-base">location_on</span>
                    <input
                      type="text"
                      required
                      value={location}
                      onChange={(e) => {
                        setLocation(e.target.value);
                        setFieldErrors((prev) => ({ ...prev, location: null }));
                      }}
                      placeholder="e.g. Indiranagar, Bangalore"
                      maxLength={80}
                      className={`w-full bg-[#14141e] border rounded-xl pl-10 pr-4 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none transition-colors ${
                        fieldErrors.location ? "border-red-500/70 focus:border-red-400" : "border-white/10 focus:border-violet-500"
                      }`}
                    />
                  </div>
                  {fieldErrors.location && (
                    <p className="text-xs text-red-400 mt-1.5 flex items-center gap-1">
                      <span className="material-symbols-outlined text-xs">error</span>
                      {fieldErrors.location}
                    </p>
                  )}
                </div>

                {/* Timezone */}
                <div>
                  <label className="block text-xs font-semibold text-white/70 uppercase tracking-wider mb-1.5">
                    Operating Timezone
                  </label>
                  <div className="relative">
                    <select
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      className="w-full bg-[#14141e] border border-white/10 rounded-xl px-4 py-3 text-sm text-white appearance-none cursor-pointer focus:border-violet-500 focus:outline-none"
                    >
                      {TIMEZONES.map((tz) => (
                        <option key={tz.value} value={tz.value} className="bg-[#14141e] text-white">
                          {tz.label}
                        </option>
                      ))}
                    </select>
                    <span className="material-symbols-outlined absolute right-3.5 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none text-base">expand_more</span>
                  </div>
                  <p className="text-[11px] text-white/40 mt-1">Used for auto-open schedules and customer ticket timestamps.</p>
                </div>

                {/* Error Banner */}
                {error && (
                  <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
                    <span className="material-symbols-outlined text-sm shrink-0">warning</span>
                    <span>{error}</span>
                  </div>
                )}

                {/* Submit button */}
                <button
                  type="submit"
                  disabled={loading || !user}
                  className="w-full py-4 rounded-xl bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-500 hover:opacity-95 text-white font-headline font-bold text-sm tracking-wide transition-all shadow-[0_4px_24px_rgba(124,58,237,0.3)] active:scale-[0.99] disabled:opacity-40 flex items-center justify-center gap-2 cursor-pointer"
                >
                  {loading ? (
                    <>
                      <span className="material-symbols-outlined text-lg animate-spin">sync</span>
                      <span>Provisioning Cloud Store...</span>
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-lg">rocket_launch</span>
                      <span>Launch Store & Open Console</span>
                    </>
                  )}
                </button>

                <p className="text-center text-xs text-white/40">
                  By default, stores launch in <span className="text-white/70 font-semibold">Closed Mode</span>. You can open them instantly from the Admin Dashboard.
                </p>
              </form>
            </div>
          </div>

          {/* Right Column: Live Holographic Preview */}
          <div className="lg:col-span-5 space-y-6">
            <div className="rounded-3xl border border-white/10 bg-[#0e0e14]/90 backdrop-blur-2xl p-6 sm:p-7 shadow-2xl relative overflow-hidden">
              <div className="flex items-center justify-between pb-4 border-b border-white/10 mb-5">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-cyan-400 text-lg">visibility</span>
                  <span className="text-xs font-semibold uppercase tracking-wider text-white">Live Customer Preview</span>
                </div>
                <span className="px-2.5 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 font-mono text-[10px]">Real-time</span>
              </div>

              {/* Mock Pass Container */}
              <div className="rounded-2xl border border-white/10 bg-[#12121c] p-5 shadow-lg relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-violet-600/10 blur-2xl rounded-full pointer-events-none" />

                <div className="flex items-start justify-between gap-3 mb-4">
                  <div>
                    <span className="text-[10px] font-mono text-violet-400 uppercase tracking-widest">
                      {selectedCategoryObj.emoji} {selectedCategoryObj.label}
                    </span>
                    <h3 className="text-lg font-bold text-white mt-0.5 break-words">
                      {storeName.trim() || "Your Store Name"}
                    </h3>
                    <p className="text-xs text-white/50 flex items-center gap-1 mt-0.5">
                      <span className="material-symbols-outlined text-xs text-cyan-400">location_on</span>
                      {location.trim() || "City / Neighborhood"}
                    </p>
                  </div>
                  <div className="px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Live Pass
                  </div>
                </div>

                {/* Mock Queue Status */}
                <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/5 grid grid-cols-2 gap-3 mb-4 text-center">
                  <div>
                    <p className="text-[10px] font-mono text-white/40 uppercase tracking-wider">Queue Length</p>
                    <p className="text-lg font-headline font-bold text-white mt-0.5">3 Ahead</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-mono text-white/40 uppercase tracking-wider">Est. Wait</p>
                    <p className="text-lg font-headline font-bold text-cyan-300 mt-0.5">~12 Mins</p>
                  </div>
                </div>

                {/* Mock URL Slug Preview */}
                <div className="p-2.5 rounded-xl bg-[#09090d] border border-white/5 flex items-center gap-2 text-xs font-mono text-white/60">
                  <span className="material-symbols-outlined text-xs text-violet-400">link</span>
                  <span className="truncate">ghostqueue.com/q/{slugPreview}</span>
                </div>
              </div>

              {/* Value Highlights */}
              <div className="mt-6 space-y-3 pt-5 border-t border-white/10">
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-lg bg-violet-500/10 flex items-center justify-center shrink-0 mt-0.5 text-violet-400">
                    <span className="material-symbols-outlined text-sm">qr_code_scanner</span>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-white">Instant QR Code Posters</p>
                    <p className="text-[11px] text-white/50">Print high-resolution scan posters directly from your admin panel.</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-lg bg-cyan-500/10 flex items-center justify-center shrink-0 mt-0.5 text-cyan-400">
                    <span className="material-symbols-outlined text-sm">notifications_active</span>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-white">SMS & Live Chime Alerts</p>
                    <p className="text-[11px] text-white/50">Customers get real-time audio chimes and vibration pings when their turn is called.</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0 mt-0.5 text-emerald-400">
                    <span className="material-symbols-outlined text-sm">tv</span>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-white">Live TV Signage Included</p>
                    <p className="text-[11px] text-white/50">Turn any smart TV or tablet into a big-screen queue display at /signage.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
