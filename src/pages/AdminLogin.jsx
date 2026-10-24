import React, { useState } from "react";
import { signInWithPopup, signInWithEmailAndPassword } from "firebase/auth";
import { auth, googleProvider } from "../firebase";

export default function AdminLogin({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showEmailForm, setShowEmailForm] = useState(false);

  const handleGoogleLogin = async (e) => {
    e.preventDefault();
    setGoogleLoading(true);
    setError(null);
    try {
      await signInWithPopup(auth, googleProvider);
      if (onLogin) onLogin();
    } catch (err) {
      console.error(err);
      setError("Failed to authenticate with Google. Please try again.");
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleEmailLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      if (onLogin) onLogin();
    } catch {
      setError("Invalid email or password. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-[#07070a] text-white flex items-center justify-center p-4 sm:p-6 overflow-hidden font-body selection:bg-violet-500/30">
      {/* Ambient background glows */}
      <div className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 w-[600px] h-[350px] bg-gradient-to-b from-violet-600/20 via-indigo-600/10 to-transparent blur-[120px] rounded-full" />
      <div className="pointer-events-none absolute bottom-0 right-0 w-[400px] h-[400px] bg-cyan-500/10 blur-[130px] rounded-full" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(#ffffff08_1px,transparent_1px)] [background-size:24px_24px] opacity-40" />

      {/* Floating Back to Home button */}
      <button
        onClick={() => { window.location.href = "/"; }}
        className="fixed top-6 left-6 z-20 flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white backdrop-blur-xl transition-all shadow-lg text-xs font-semibold uppercase tracking-wider group"
        title="Return to home"
      >
        <span className="material-symbols-outlined text-base transition-transform group-hover:-translate-x-0.5">arrow_back</span>
        <span>Back to Portal</span>
      </button>

      {/* Main card */}
      <div className="relative z-10 w-full max-w-[440px] rounded-3xl border border-white/10 bg-[#0e0e14]/85 backdrop-blur-2xl p-7 sm:p-9 shadow-[0_20px_70px_rgba(0,0,0,0.6)]">
        {/* Glowing border highlight */}
        <div className="absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-violet-400/50 to-transparent" />

        {/* Brand header */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="relative mb-4 flex items-center justify-center">
            <div className="absolute inset-0 bg-violet-600/30 blur-xl rounded-2xl" />
            <div className="relative w-14 h-14 rounded-2xl bg-gradient-to-tr from-violet-600 to-indigo-500 p-0.5 shadow-lg shadow-violet-600/30 flex items-center justify-center">
              <div className="w-full h-full bg-[#0e0e14] rounded-[14px] flex items-center justify-center">
                <span className="material-symbols-outlined text-2xl text-violet-400">admin_panel_settings</span>
              </div>
            </div>
          </div>

          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300 text-[11px] font-semibold tracking-wider uppercase mb-3">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
            Operator Portal
          </div>

          <h1 className="text-2xl font-bold font-headline tracking-tight text-white">Ghost Queue Admin</h1>
          <p className="text-xs text-white/50 mt-1.5 max-w-xs">
            Authenticate to manage store queues, broadcast alerts, and view live counter intelligence.
          </p>
        </div>

        {/* Google OAuth Button */}
        <button
          onClick={handleGoogleLogin}
          disabled={googleLoading || loading}
          className="w-full relative flex items-center justify-center gap-3 py-3.5 px-4 rounded-xl bg-white text-gray-900 font-semibold text-sm hover:bg-gray-100 active:scale-[0.99] transition-all shadow-[0_4px_20px_rgba(255,255,255,0.12)] disabled:opacity-60 cursor-pointer"
        >
          {googleLoading ? (
            <span className="material-symbols-outlined text-xl animate-spin text-gray-800">sync</span>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
          )}
          <span>{googleLoading ? "Verifying with Google..." : "Continue with Google"}</span>
        </button>

        {/* Divider */}
        <div className="flex items-center gap-3 my-5">
          <div className="flex-1 h-px bg-white/10" />
          <span className="text-[10px] uppercase font-bold tracking-widest text-white/40">or with password</span>
          <div className="flex-1 h-px bg-white/10" />
        </div>

        {/* Email Form Toggle or Form */}
        {!showEmailForm ? (
          <button
            onClick={() => setShowEmailForm(true)}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 hover:text-white text-xs font-semibold tracking-wide transition-all"
          >
            <span className="material-symbols-outlined text-base">mail</span>
            <span>Sign in with Email & Password</span>
          </button>
        ) : (
          <form onSubmit={handleEmailLogin} className="space-y-4">
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-white/50 mb-1.5">
                Staff / Owner Email
              </label>
              <div className="relative">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="operator@store.com"
                  className="w-full bg-[#14141e] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-violet-500 focus:outline-none transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-white/50 mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                className="w-full bg-[#14141e] border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-violet-500 focus:outline-none transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={loading || googleLoading}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-semibold text-sm transition-all shadow-lg shadow-violet-600/25 active:scale-[0.99] disabled:opacity-50"
            >
              {loading ? "Authenticating..." : "Sign In to Console"}
            </button>

            <button
              type="button"
              onClick={() => { setShowEmailForm(false); setError(null); }}
              className="w-full text-center text-xs text-white/40 hover:text-white/80 transition-colors pt-1"
            >
              ← Back to Google sign in
            </button>
          </form>
        )}

        {/* Error notification */}
        {error && (
          <div className="mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs text-center flex items-center justify-center gap-2">
            <span className="material-symbols-outlined text-sm">warning</span>
            <span>{error}</span>
          </div>
        )}

        {/* Footer info & link to register */}
        <div className="mt-6 pt-5 border-t border-white/5 text-center flex flex-col items-center gap-2">
          <p className="text-xs text-white/50">
            Don't have a registered venue yet?{" "}
            <a href="/register" className="text-violet-400 hover:text-violet-300 font-semibold underline underline-offset-4">
              Register store
            </a>
          </p>
          <p className="text-[10px] text-white/30 uppercase tracking-widest mt-1">
            Zero-App Cloud Architecture • Ghost Queue 2.0
          </p>
        </div>
      </div>
    </div>
  );
}
