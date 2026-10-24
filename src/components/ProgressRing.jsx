import React from "react";

/**
 * ProgressRing — SVG-based animated ring.
 *
 * Props:
 *  - progress: 0..1  (1 = at front / done)
 *  - position: number (current queue position)
 *  - waitMins: number
 *  - isTopFive: boolean (enables pulse animation)
 *  - size: number (default 200)
 *  - strokeWidth: number (default 14)
 */
export default function ProgressRing({
  progress = 0,
  position = null,
  waitMins = 0,
  isTopFive = false,
  size = 200,
  strokeWidth = 14,
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - progress);

  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg
        width={size}
        height={size}
        style={{ transform: "rotate(-90deg)" }}
        className={isTopFive ? "ring-pulse" : ""}
      >
        {/* Background track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(74, 68, 85, 0.4)"
          strokeWidth={strokeWidth}
        />
        {/* Progress arc */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="url(#ringGradient)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)" }}
        />
        <defs>
          <linearGradient id="ringGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor="#7c3aed" />
            <stop offset="100%" stopColor="#4edea3" />
          </linearGradient>
        </defs>
      </svg>

      {/* Center text */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 4,
        }}
      >
        {position !== null ? (
          <>
            <span
              className="font-headline gradient-text"
              style={{ fontSize: size * 0.22, fontWeight: 700, lineHeight: 1 }}
            >
              #{position}
            </span>
            <span
              className="font-body"
              style={{ fontSize: size * 0.09, color: "var(--on-surface-variant)" }}
            >
              {waitMins > 0 ? `~${waitMins} min` : "Up next!"}
            </span>
          </>
        ) : (
          <span
            className="font-body"
            style={{ fontSize: size * 0.09, color: "var(--on-surface-variant)" }}
          >
            Not in queue
          </span>
        )}
      </div>
    </div>
  );
}
