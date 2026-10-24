/**
 * queueIntelligence.js
 * Phase 3 — All client-side algorithms for Queue Health Score, Smart ETA,
 * No-Show Prediction, and related intelligence features.
 */

const AVG_SERVICE_FALLBACK = 3; // minutes

// ─────────────────────────────────────────────────────────────────────────────
// G-3: No-Show Risk Score — per-entry prediction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes a no-show risk score (0–100) for a given queue entry.
 * Higher = more likely to no-show.
 *
 * @param {object} entry - Queue entry document data
 * @param {number} avgServiceMins - Store's average service time
 * @param {number} position - Entry's current position
 */
export function computeNoShowRisk(entry, avgServiceMins, position) {
  if (!entry) return 0;

  let risk = 0;

  // Factor 1: Time since last heartbeat (last_active)
  const lastActive = entry.last_active?.toMillis?.() ?? Date.now();
  const minutesSinceActive = (Date.now() - lastActive) / 60000;
  if (minutesSinceActive > 20) risk += 40;
  else if (minutesSinceActive > 10) risk += 20;
  else if (minutesSinceActive > 5) risk += 10;

  // Factor 2: Position vs expected wait — if they're about to be called but went quiet
  const expectedWaitMins = (position - 1) * (Number(avgServiceMins) || AVG_SERVICE_FALLBACK);
  if (position <= 2 && minutesSinceActive > 5) risk += 25;
  else if (position <= 3 && minutesSinceActive > 8) risk += 15;

  // Factor 3: "Running late" flag reduces risk slightly (they acknowledged)
  if (entry.running_late) risk = Math.max(0, risk - 15);

  // Factor 4: Customer has been in queue far longer than expected
  const joinedAt = entry.joined_at?.toMillis?.() ?? Date.now();
  const waitedMins = (Date.now() - joinedAt) / 60000;
  const overdue = waitedMins - expectedWaitMins;
  if (overdue > 30) risk += 20;
  else if (overdue > 15) risk += 10;

  return Math.min(100, Math.max(0, risk));
}

// ─────────────────────────────────────────────────────────────────────────────
// G-1: Queue Health Score — composite operational health (0–100)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes the live Queue Health Score (0–100) for the admin dashboard.
 *
 * @param {object} params
 * @param {object} meta - Store meta document data
 * @param {object[]} entries - Current queue entries
 * @param {object[]} recentHistory - Recent history documents
 * @param {number} targetMaxWaitMins - Owner's desired max wait (default 20)
 */
export function computeQueueHealthScore({
  meta = {},
  entries = [],
  recentHistory = [],
  targetMaxWaitMins = 20,
}) {
  if (!meta || entries.length === 0) return { score: 100, level: "excellent", factors: [] };

  const factors = [];
  let deductions = 0;

  const avgServiceMins = Number(meta.avg_service_mins) || AVG_SERVICE_FALLBACK;
  const livePartyCount = Number(meta.live_party_count) || 0;
  const estimatedMaxWait = livePartyCount * avgServiceMins;

  // Factor 1: Wait time vs target
  if (estimatedMaxWait > targetMaxWaitMins * 2) {
    deductions += 30;
    factors.push({ label: "Very long wait", severity: "critical" });
  } else if (estimatedMaxWait > targetMaxWaitMins) {
    deductions += 15;
    factors.push({ label: "Above target wait", severity: "warning" });
  }

  // Factor 2: No-show risk across queue
  const highRiskCount = entries.filter((e, i) => computeNoShowRisk(e, avgServiceMins, i + 1) >= 70).length;
  if (highRiskCount >= 3) {
    deductions += 20;
    factors.push({ label: `${highRiskCount} high no-show risk`, severity: "warning" });
  } else if (highRiskCount >= 1) {
    deductions += 8;
    factors.push({ label: `${highRiskCount} at-risk customer`, severity: "info" });
  }

  // Factor 3: Serve velocity — how fast queue is moving vs 30 min ago
  const now = Date.now();
  const last30min = recentHistory.filter(
    (h) => h.history_type === "served" && h.completed_at?.toMillis?.() > now - 30 * 60 * 1000
  ).length;
  const last60min = recentHistory.filter(
    (h) => h.history_type === "served" && h.completed_at?.toMillis?.() > now - 60 * 60 * 1000
  ).length;

  if (last30min === 0 && livePartyCount > 0) {
    deductions += 20;
    factors.push({ label: "No serves in 30 min", severity: "critical" });
  } else if (last30min < last60min * 0.4 && last60min > 2) {
    deductions += 10;
    factors.push({ label: "Slowing down", severity: "warning" });
  } else if (last30min > 0) {
    factors.push({ label: "Moving well", severity: "good" });
  }

  // Factor 4: Queue size ratio vs max
  const maxSize = Number(meta.max_queue_size) || 0;
  if (maxSize > 0 && livePartyCount >= maxSize * 0.9) {
    deductions += 15;
    factors.push({ label: "Near capacity", severity: "warning" });
  }

  // Factor 5: Running late count
  const runningLateCount = entries.filter((e) => e.running_late).length;
  if (runningLateCount >= 3) {
    deductions += 10;
    factors.push({ label: `${runningLateCount} running late`, severity: "info" });
  }

  const score = Math.max(0, Math.min(100, 100 - deductions));
  const level = score >= 80 ? "excellent" : score >= 60 ? "good" : score >= 40 ? "warning" : "critical";

  return { score, level, factors, estimatedMaxWait, last30min };
}

// ─────────────────────────────────────────────────────────────────────────────
// Health UI Helpers
// ─────────────────────────────────────────────────────────────────────────────

export function getHealthColor(level) {
  if (level === "excellent") return "text-emerald-400";
  if (level === "good") return "text-green-400";
  if (level === "warning") return "text-amber-400";
  return "text-red-500";
}

export function getHealthBgColor(level) {
  if (level === "excellent") return "bg-emerald-500/10 border-emerald-500/20";
  if (level === "good") return "bg-green-500/10 border-green-500/20";
  if (level === "warning") return "bg-amber-500/10 border-amber-500/20";
  return "bg-red-500/10 border-red-500/20";
}

export function getHealthIcon(level) {
  if (level === "excellent") return "verified";
  if (level === "good") return "check_circle";
  if (level === "warning") return "warning";
  return "emergency";
}
