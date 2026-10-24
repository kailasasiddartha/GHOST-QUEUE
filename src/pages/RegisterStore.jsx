import React, { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "../firebase";
import { registerStore } from "../utils/auth";

const CATEGORIES = [
  { value: "Restaurant", label: "🍽️ Restaurant & Cafe" },
  { value: "Temple", label: "🛕 Temple & Shrine" },
  { value: "Clinic", label: "🏥 Medical Clinic" },
  { value: "Hospital", label: "🏨 Hospital & OPD" },
  { value: "Retail", label: "🛍️ Retail Store" },
  { value: "Salon", label: "✂️ Salon & Spa" },
  { value: "Gym", label: "💪 Gym & Fitness" },
  { value: "Bank", label: "🏦 Bank & Finance" },
  { value: "Government", label: "🏛️ Government Office" },
  { value: "Event", label: "🎟️ Event & Ticketing" },
  { value: "Other", label: "📋 Other" },
];

const TIMEZONES = [
  { value: "Asia/Kolkata", label: "India (IST, UTC+5:30)" },
  { value: "Asia/Dubai", label: "Dubai (GST, UTC+4)" },
  { value: "Asia/Singapore", label: "Singapore (SGT, UTC+8)" },
  { value: "Asia/Colombo", label: "Sri Lanka (SLST, UTC+5:30)" },
  { value: "Asia/Dhaka", label: "Bangladesh (BST, UTC+6)" },
  { value: "Asia/Karachi", label: "Pakistan (PKT, UTC+5)" },
  { value: "Asia/Kathmandu", label: "Nepal (NPT, UTC+5:45)" },
  { value: "America/New_York", label: "US Eastern (EST, UTC-5)" },
  { value: "America/Los_Angeles", label: "US Pacific (PST, UTC-8)" },
  { value: "Europe/London", label: "UK (GMT, UTC+0)" },
  { value: "Europe/Paris", label: "Central Europe (CET, UTC+1)" },
  { value: "Australia/Sydney", label: "Australia Eastern (AEST, UTC+10)" },
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

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setLoadingUser(false);
    });
    return unsub;
  }, []);

  const validate = () => {
    const errors = {};
    if (!storeName.trim()) errors.storeName = "Store name is required.";
    else if (storeName.trim().length < 3) errors.storeName = "Store name must be at least 3 characters.";
    if (!location.trim()) errors.location = "City / area is required.";
    return errors;
  };

  const handleRegister = async (event) => {
    event.preventDefault();
    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    if (!user) {
      setError("You must be logged in to register a store.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await registerStore({ storeName: storeName.trim(), category, location: location.trim(), timezone });
      window.location.href = "/admin";
    } catch (err) {
      setError(err?.message || "Failed to register the store. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (loadingUser) {
    return (
      <div className="min-h-screen bg-background text-white flex items-center justify-center flex-col gap-4">
        <span className="material-symbols-outlined text-5xl text-primary" style={{ animation: "spin 1s linear infinite" }}>blur_on</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <p className="text-on-surface-variant text-sm uppercase tracking-widest font-label">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background text-white flex flex-col items-center justify-center p-6 text-center">
        <span className="material-symbols-outlined text-6xl text-error mb-4">lock</span>
        <h2 className="text-xl font-bold font-headline mb-2">Authentication Required</h2>
        <p className="text-on-surface-variant text-sm mb-6">You must sign in with Google to create a store.</p>
        <button
          type="button"
          onClick={() => { window.location.href = "/admin"; }}
          className="rounded-xl bg-gradient-to-r from-primary-container to-secondary px-6 py-3 font-headline font-bold text-white"
        >
          Sign In
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-white flex items-center justify-center p-6 font-body">
      <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-surface-container p-8 relative overflow-hidden shadow-[0_0_60px_rgba(124,58,237,0.15)]">
        <div className="absolute -top-20 -right-20 w-56 h-56 bg-primary/15 blur-[80px] rounded-full pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 w-48 h-48 bg-secondary/10 blur-[80px] rounded-full pointer-events-none" />

        <div className="relative z-10">
          {/* Header */}
          <div className="flex items-center gap-3 mb-8">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary-container to-secondary flex items-center justify-center shadow-lg">
              <span className="material-symbols-outlined text-white text-2xl">storefront</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold font-headline tracking-tight">Launch Your Store</h1>
              <p className="text-xs text-on-surface-variant uppercase tracking-widest font-label mt-0.5">Ghost Queue · Store Registration</p>
            </div>
          </div>

          {/* Logged in as */}
          <div className="mb-6 rounded-xl border border-white/5 bg-surface-container-high px-4 py-3 flex items-center gap-3">
            <span className="material-symbols-outlined text-tertiary text-sm">verified_user</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-on-surface-variant">Registering as</p>
              <p className="text-sm font-semibold text-on-surface truncate">{user.displayName || user.email}</p>
            </div>
            <button
              type="button"
              onClick={() => { window.location.href = "/admin"; }}
              className="text-xs text-on-surface-variant hover:text-white transition-colors"
            >
              Not you?
            </button>
          </div>

          <form onSubmit={handleRegister} className="flex flex-col gap-5">
            {/* Store Name */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-label text-on-surface-variant uppercase tracking-widest">
                Store Name <span className="text-error">*</span>
              </label>
              <input
                type="text"
                required
                value={storeName}
                onChange={(e) => { setStoreName(e.target.value); setFieldErrors((prev) => ({ ...prev, storeName: null })); }}
                className={`bg-surface-container-low border rounded-xl px-4 py-3 text-sm focus:bg-white/5 transition-all outline-none text-white placeholder:text-on-surface-variant/50 ${fieldErrors.storeName ? "border-error/50 focus:border-error" : "border-white/10 focus:border-primary/50"}`}
                placeholder="e.g. Chai Baba Mumbai"
                maxLength={60}
              />
              {fieldErrors.storeName && <p className="text-xs text-error">{fieldErrors.storeName}</p>}
            </div>

            {/* Category */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-label text-on-surface-variant uppercase tracking-widest">Category</label>
              <div className="relative">
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full bg-surface-container-low border border-white/10 rounded-xl px-4 py-3 text-sm focus:border-primary/50 focus:bg-white/5 transition-all outline-none text-white appearance-none cursor-pointer"
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat.value} value={cat.value}>{cat.label}</option>
                  ))}
                </select>
                <span className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none text-sm">expand_more</span>
              </div>
            </div>

            {/* Location */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-label text-on-surface-variant uppercase tracking-widest">
                City / Area <span className="text-error">*</span>
              </label>
              <input
                type="text"
                required
                value={location}
                onChange={(e) => { setLocation(e.target.value); setFieldErrors((prev) => ({ ...prev, location: null })); }}
                className={`bg-surface-container-low border rounded-xl px-4 py-3 text-sm focus:bg-white/5 transition-all outline-none text-white placeholder:text-on-surface-variant/50 ${fieldErrors.location ? "border-error/50 focus:border-error" : "border-white/10 focus:border-primary/50"}`}
                placeholder="Bandra West, Mumbai"
                maxLength={80}
              />
              {fieldErrors.location && <p className="text-xs text-error">{fieldErrors.location}</p>}
            </div>

            {/* Timezone */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-label text-on-surface-variant uppercase tracking-widest">Timezone</label>
              <div className="relative">
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="w-full bg-surface-container-low border border-white/10 rounded-xl px-4 py-3 text-sm focus:border-primary/50 focus:bg-white/5 transition-all outline-none text-white appearance-none cursor-pointer"
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>{tz.label}</option>
                  ))}
                </select>
                <span className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none text-sm">schedule</span>
              </div>
              <p className="text-[10px] text-on-surface-variant/60">Used for auto-open/close schedules and display times.</p>
            </div>

            {error && (
              <div className="rounded-xl border border-error/20 bg-error/10 px-4 py-3">
                <p className="text-xs text-error">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-2 w-full bg-gradient-to-r from-primary-container to-secondary text-white font-headline font-bold py-4 rounded-xl shadow-[0_4px_24px_rgba(124,58,237,0.2)] hover:shadow-[0_8px_32px_rgba(124,58,237,0.4)] transition-all active:scale-[0.98] disabled:opacity-60 tracking-wide flex justify-center items-center gap-2"
            >
              {loading ? (
                <>
                  <span className="material-symbols-outlined text-lg" style={{ animation: "spin 1s linear infinite" }}>sync</span>
                  Provisioning your store...
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-lg">rocket_launch</span>
                  Register Store
                </>
              )}
            </button>

            <p className="text-center text-xs text-on-surface-variant/60">
              Your store will be created as <strong className="text-on-surface-variant">closed</strong> by default. You can open it from the Admin Dashboard.
            </p>
          </form>
        </div>

        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
