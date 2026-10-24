const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function normalizeTime(value, fallback) {
  return typeof value === "string" && /^\d{2}:\d{2}$/.test(value) ? value : fallback;
}

export function createDefaultSchedule() {
  return {
    mon: { enabled: true, open: "09:00", close: "21:00" },
    tue: { enabled: true, open: "09:00", close: "21:00" },
    wed: { enabled: true, open: "09:00", close: "21:00" },
    thu: { enabled: true, open: "09:00", close: "21:00" },
    fri: { enabled: true, open: "09:00", close: "21:00" },
    sat: { enabled: true, open: "09:00", close: "21:00" },
    sun: { enabled: false, open: "09:00", close: "21:00" },
  };
}

export function normalizeSchedule(schedule) {
  const fallback = createDefaultSchedule();

  return DAY_KEYS.reduce((acc, key) => {
    const raw = schedule?.[key];
    acc[key] = {
      enabled: raw?.enabled ?? fallback[key].enabled,
      open: normalizeTime(raw?.open, fallback[key].open),
      close: normalizeTime(raw?.close, fallback[key].close),
    };
    return acc;
  }, {});
}

function timeToMinutes(timeValue) {
  const [hours, minutes] = String(timeValue).split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }

  return hours * 60 + minutes;
}

function formatTime(timeValue) {
  const minutes = timeToMinutes(timeValue);
  if (minutes === null) {
    return timeValue;
  }

  const date = new Date();
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function getLocalTimeParts(date, timezone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone || "Asia/Kolkata",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const read = (type) => parts.find((part) => part.type === type)?.value || "";

  return {
    dayKey: read("weekday").toLowerCase().slice(0, 3),
    currentMinutes: Number(read("hour")) * 60 + Number(read("minute")),
  };
}

export function getEffectiveStoreStatus(meta, now = new Date()) {
  if (!meta) {
    return {
      isOpen: false,
      canJoin: false,
      label: "Loading",
      joinLabel: "Loading",
      badgeTone: "neutral",
      reason: "Checking live store status",
    };
  }

  if (meta.holiday_mode) {
    return {
      isOpen: false,
      canJoin: false,
      label: "Holiday",
      joinLabel: "Holiday",
      badgeTone: "closed",
      reason: meta.holiday_reason || meta.closed_reason || "Closed for a holiday",
    };
  }

  if (meta.is_open === false) {
    return {
      isOpen: false,
      canJoin: false,
      label: "Closed",
      joinLabel: "Closed",
      badgeTone: "closed",
      reason: meta.closed_reason || "The queue is not active right now.",
    };
  }

  if (meta.schedule_enabled) {
    const schedule = normalizeSchedule(meta.schedule);
    const { dayKey, currentMinutes } = getLocalTimeParts(now, meta.timezone);
    const today = schedule[dayKey];

    if (!today.enabled) {
      return {
        isOpen: false,
        canJoin: false,
        label: "Closed",
        joinLabel: "Closed",
        badgeTone: "closed",
        reason: "Closed today",
      };
    }

    const openMinutes = timeToMinutes(today.open);
    const closeMinutes = timeToMinutes(today.close);

    if (openMinutes !== null && closeMinutes !== null) {
      if (currentMinutes < openMinutes) {
        return {
          isOpen: false,
          canJoin: false,
          label: "Opens Soon",
          joinLabel: "Opens Soon",
          badgeTone: "closed",
          reason: `Opens at ${formatTime(today.open)}`,
        };
      }

      if (currentMinutes >= closeMinutes) {
        return {
          isOpen: false,
          canJoin: false,
          label: "Closed",
          joinLabel: "Closed",
          badgeTone: "closed",
          reason: `Closed after ${formatTime(today.close)}`,
        };
      }
    }
  }

  if (meta.queue_paused) {
    return {
      isOpen: true,
      canJoin: false,
      label: "Open",
      joinLabel: "Paused",
      badgeTone: "open",
      reason: meta.paused_reason || "Queue is paused for a short break.",
    };
  }

  if (meta.join_disabled) {
    return {
      isOpen: true,
      canJoin: false,
      label: "Open",
      joinLabel: "Busy",
      badgeTone: "open",
      reason: meta.join_disabled_reason || "Queue is open, but new joins are temporarily paused.",
    };
  }

  return {
    isOpen: true,
    canJoin: true,
    label: "Open",
    joinLabel: "Open",
    badgeTone: "open",
    reason: meta.announcement || "Queue is live right now.",
  };
}

export function getStoreTheme(meta) {
  const primary = meta?.brand_primary || "#7C3AED";
  const secondary = meta?.brand_secondary || "#22D3EE";

  return {
    primary,
    secondary,
    gradient: `linear-gradient(135deg, ${primary}, ${secondary})`,
    mutedGradient: `linear-gradient(135deg, ${primary}22, ${secondary}22)`,
  };
}
