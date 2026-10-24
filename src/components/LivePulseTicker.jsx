import React, { useEffect, useMemo, useState } from "react";

const ICONS = {
  served: { icon: "check_circle", color: "text-emerald-400", label: "served" },
  left: { icon: "exit_to_app", color: "text-amber-400", label: "left" },
  no_show: { icon: "person_off", color: "text-red-400", label: "no-show" },
  stale: { icon: "hourglass_disabled", color: "text-on-surface-variant", label: "expired" },
  closed: { icon: "store", color: "text-on-surface-variant", label: "closed" },
};

/**
 * LivePulseTicker — L-4: Activity Ticker
 * Shows the last few queue events as a scrolling ticker at the bottom of the queue page.
 * Makes the wait feel alive — customers see the queue is actively moving.
 *
 * @param {object[]} recentHistory - Array of recent history docs
 * @param {number} liveCount - Current number of people waiting
 * @param {number} avgMins - Average service time in minutes
 */
export default function LivePulseTicker({ recentHistory = [], liveCount = 0, avgMins = 3 }) {
  const [currentNow, setCurrentNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setCurrentNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const visibleEvents = useMemo(() => {
    const cutoff = currentNow - 30 * 60 * 1000;
    return (recentHistory || [])
      .filter((h) => (h.completed_at?.toMillis?.() ?? 0) > cutoff)
      .sort((a, b) => (b.completed_at?.toMillis?.() ?? 0) - (a.completed_at?.toMillis?.() ?? 0))
      .slice(0, 5);
  }, [recentHistory, currentNow]);

  const servedInLast30 = visibleEvents.filter((e) => e.history_type === "served").length;

  if (liveCount === 0 && visibleEvents.length === 0) return null;

  function timeAgo(ts) {
    if (!ts?.toMillis) return "";
    const mins = Math.floor((currentNow - ts.toMillis()) / 60000);
    if (mins < 1) return "just now";
    if (mins === 1) return "1 min ago";
    return `${mins} min ago`;
  }

  return (
    <div className="rounded-2xl border border-white/5 bg-surface-container-low overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <p className="text-[10px] text-on-surface-variant uppercase tracking-widest font-label">Live Queue Activity</p>
        </div>
        {servedInLast30 > 0 && (
          <p className="text-[10px] text-emerald-400 font-label">
            {servedInLast30} served in last 30 min · ~{avgMins} min avg
          </p>
        )}
      </div>

      {/* Velocity indicator */}
      {liveCount > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 border-b border-white/5 bg-primary/5">
          <span className="material-symbols-outlined text-primary text-base">bolt</span>
          <p className="text-xs text-on-surface-variant">
            Queue is currently{" "}
            <span className={servedInLast30 >= 3 ? "text-emerald-400 font-semibold" : servedInLast30 >= 1 ? "text-amber-400 font-semibold" : "text-red-400 font-semibold"}>
              {servedInLast30 >= 3 ? "moving quickly ⚡" : servedInLast30 >= 1 ? "moving steadily" : "moving slowly"}
            </span>
            {` · ${liveCount} ${liveCount === 1 ? "party" : "parties"} waiting`}
          </p>
        </div>
      )}

      {/* Event list */}
      <div className="divide-y divide-white/5">
        {visibleEvents.length === 0 ? (
          <div className="px-4 py-3 text-center">
            <p className="text-xs text-on-surface-variant/60">No activity in the last 30 minutes</p>
          </div>
        ) : (
          visibleEvents.map((event, idx) => {
            const config = ICONS[event.history_type] || ICONS.served;
            return (
              <div key={event.id || `${event.history_type || "event"}-${idx}`} className="flex items-center gap-3 px-4 py-2.5 text-xs">
                <span className={`material-symbols-outlined text-base shrink-0 ${config.color}`}>{config.icon}</span>
                <div className="flex-1 min-w-0">
                  <span className="text-on-surface/80">
                    {event.display_name
                      ? <><strong className="text-on-surface">{event.display_name}</strong> was {config.label}</>
                      : <>A customer was {config.label}</>}
                  </span>
                  {event.member_count > 1 && (
                    <span className="text-on-surface-variant"> · {event.member_count} members</span>
                  )}
                </div>
                <span className="text-on-surface-variant/50 shrink-0 font-mono">{timeAgo(event.completed_at)}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
