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
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        background: "var(--background)",
        position: "relative",
      }}
    >
      {/* Back to Home Button — anchored to the page, not the card */}
      <button
        onClick={() => window.location.href = "/"}
        style={{
          position: "fixed",
          top: "1.5rem",
          left: "1.5rem",
          background: "var(--surface-container)",
          border: "1px solid var(--outline-variant)",
          borderRadius: "50%",
          width: 44,
          height: 44,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--on-surface-variant)",
          cursor: "pointer",
          transition: "all 0.2s",
          zIndex: 100,
          boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "white"; e.currentTarget.style.background = "var(--surface-container-high)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--on-surface-variant)"; e.currentTarget.style.background = "var(--surface-container)"; }}
        title="Back to Home"
      >
        <span className="material-symbols-outlined" style={{ fontSize: 22 }}>arrow_back</span>
      </button>

      <div
        className="glass-card kinetic-glow"
        style={{
          width: "100%",
          maxWidth: 400,
          padding: "2.5rem",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        {/* Brand Header */}
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            background: "var(--surface-container)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "1px solid rgba(255,255,255,0.08)",
            boxShadow: "0 0 24px rgba(124,58,237,0.3)",
            marginBottom: "1.25rem",
          }}
        >
          <span
            className="material-symbols-outlined"
            style={{ fontSize: 28, color: "#7C3AED" }}
          >
            blur_on
          </span>
        </div>

        <h1
          className="font-headline text-center"
          style={{ fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.25rem" }}
        >
          Ghost Queue
        </h1>
        <p
          className="font-body text-center"
          style={{
            color: "var(--on-surface-variant)",
            fontSize: "0.8rem",
            marginBottom: "2rem",
          }}
        >
          Sign in to manage your store queue.
        </p>

        {/* Google Button */}
        <button
          onClick={handleGoogleLogin}
          disabled={googleLoading || loading}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            background: "white",
            color: "#111",
            padding: "0.85rem 1rem",
            borderRadius: "0.75rem",
            fontFamily: "Inter, sans-serif",
            fontWeight: 700,
            fontSize: "0.9rem",
            border: "none",
            cursor: "pointer",
            opacity: googleLoading ? 0.7 : 1,
            transition: "all 0.2s",
            boxShadow: "0 4px 12px rgba(255,255,255,0.08)",
          }}
        >
          {googleLoading ? (
            <span className="material-symbols-outlined" style={{ fontSize: 20, animation: "spin 1s linear infinite" }}>sync</span>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              <path d="M1 1h22v22H1z" fill="none"/>
            </svg>
          )}
          {googleLoading ? "Authenticating..." : "Continue with Google"}
        </button>

        {/* Divider */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            width: "100%",
            margin: "1.25rem 0",
          }}
        >
          <div style={{ flex: 1, height: 1, background: "var(--outline-variant)" }}></div>
          <span style={{ fontSize: "0.7rem", color: "var(--on-surface-variant)", fontFamily: "Inter, sans-serif", textTransform: "uppercase", letterSpacing: "0.1em" }}>or</span>
          <div style={{ flex: 1, height: 1, background: "var(--outline-variant)" }}></div>
        </div>

        {/* Email/Password Toggle */}
        {!showEmailForm ? (
          <button
            onClick={() => setShowEmailForm(true)}
            style={{
              width: "100%",
              background: "var(--surface-container)",
              border: "1px solid var(--outline-variant)",
              borderRadius: "0.75rem",
              padding: "0.85rem 1rem",
              color: "var(--on-surface)",
              fontFamily: "Inter, sans-serif",
              fontWeight: 600,
              fontSize: "0.875rem",
              cursor: "pointer",
              transition: "all 0.2s",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>email</span>
            Sign in with Email & Password
          </button>
        ) : (
          <form onSubmit={handleEmailLogin} style={{ display: "flex", flexDirection: "column", gap: "0.875rem", width: "100%" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
              <label
                className="font-label"
                style={{ fontSize: "0.7rem", color: "var(--on-surface-variant)", textTransform: "uppercase", letterSpacing: "0.08em" }}
              >
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={{
                  background: "var(--surface-container)",
                  border: "1px solid var(--outline-variant)",
                  borderRadius: "0.5rem",
                  padding: "0.75rem 1rem",
                  color: "var(--on-surface)",
                  fontSize: "0.9rem",
                  outline: "none",
                  fontFamily: "Inter, sans-serif",
                }}
                placeholder="admin@example.com"
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
              <label
                className="font-label"
                style={{ fontSize: "0.7rem", color: "var(--on-surface-variant)", textTransform: "uppercase", letterSpacing: "0.08em" }}
              >
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{
                  background: "var(--surface-container)",
                  border: "1px solid var(--outline-variant)",
                  borderRadius: "0.5rem",
                  padding: "0.75rem 1rem",
                  color: "var(--on-surface)",
                  fontSize: "0.9rem",
                  outline: "none",
                  fontFamily: "Inter, sans-serif",
                }}
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              className="btn-primary"
              style={{ marginTop: "0.25rem", width: "100%", fontSize: "0.9rem" }}
              disabled={loading || googleLoading}
            >
              {loading ? "Signing in…" : "Sign In"}
            </button>

            <button
              type="button"
              onClick={() => { setShowEmailForm(false); setError(null); }}
              style={{
                background: "none",
                border: "none",
                color: "var(--on-surface-variant)",
                fontSize: "0.75rem",
                cursor: "pointer",
                fontFamily: "Inter, sans-serif",
                textAlign: "center",
              }}
            >
              ← Back
            </button>
          </form>
        )}

        {error && (
          <p style={{ color: "var(--error)", fontSize: "0.8rem", marginTop: "1rem", textAlign: "center", fontWeight: 600 }}>
            {error}
          </p>
        )}

        <div style={{ marginTop: "2rem", paddingTop: "1.25rem", borderTop: "1px solid rgba(255,255,255,0.05)", width: "100%", textAlign: "center" }}>
          <p style={{ fontSize: "0.625rem", color: "var(--on-surface-variant)", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "Inter, sans-serif" }}>
            By continuing, you agree to our Terms of Service
          </p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
