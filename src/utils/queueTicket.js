const ACTIVE_QUEUE_KEY = "ghost-queue-active-ticket";
const LOCALE_KEY = "ghost-queue-locale";
const TICKET_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export function saveActiveQueueTicket(ticket) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    ACTIVE_QUEUE_KEY,
    JSON.stringify({ ...ticket, _savedAt: Date.now() })
  );
}

export function getActiveQueueTicket() {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(ACTIVE_QUEUE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw);

    // Auto-expire tickets that are older than TICKET_TTL_MS (12 hours).
    if (parsed._savedAt && Date.now() - parsed._savedAt > TICKET_TTL_MS) {
      window.localStorage.removeItem(ACTIVE_QUEUE_KEY);
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export function clearActiveQueueTicket() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(ACTIVE_QUEUE_KEY);
}

export function getSavedLocale() {
  if (typeof window === "undefined") {
    return "en";
  }

  return window.localStorage.getItem(LOCALE_KEY) || "en";
}

export function saveLocale(locale) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(LOCALE_KEY, locale);
}
