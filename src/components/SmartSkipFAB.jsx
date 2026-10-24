import React, { useState } from "react";
import { smartSkip } from "../utils/firestore";

/**
 * SmartSkipFAB — Appears only when the user is in the top 5 (position <= 5).
 * Clicking it calls smartSkip() to swap their position with the next person.
 */
export default function SmartSkipFAB({ storeId, userId, skipsUsed = 0 }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const MAX_SKIPS = 2;
  const skipsLeft = MAX_SKIPS - skipsUsed;

  const handleSkip = async () => {
    if (skipsLeft <= 0 || loading) return;
    setLoading(true);
    setError(null);
    try {
      await smartSkip(storeId, userId);
    } catch (err) {
      if (err.message === "MAX_SKIPS_REACHED") {
        setError("You've used all your delays for this visit.");
      } else if (err.message === "ALREADY_LAST") {
        setError("You're already at the back of the queue.");
      } else {
        setError("Something went wrong. Try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: "fixed", bottom: "5rem", right: "1.5rem", zIndex: 100, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.5rem" }}>
      {error && (
        <div
          className="glass-card"
          style={{
            padding: "0.625rem 1rem",
            fontSize: "0.75rem",
            color: "var(--error)",
            maxWidth: 220,
            textAlign: "right",
          }}
        >
          {error}
        </div>
      )}
      <button
        className="fab"
        onClick={handleSkip}
        disabled={loading || skipsLeft <= 0}
        style={{ opacity: skipsLeft <= 0 ? 0.5 : 1 }}
        title={skipsLeft <= 0 ? "No delays left" : `Delay 5 mins (${skipsLeft} left)`}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
          {loading ? "hourglass_top" : "skip_next"}
        </span>
        {loading ? "Delaying…" : `Delay 5 mins (${skipsLeft} left)`}
      </button>
    </div>
  );
}
