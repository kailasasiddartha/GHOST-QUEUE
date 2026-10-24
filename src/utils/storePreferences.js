const FAVORITES_KEY = "ghost-queue-favorite-stores";
const RECENTS_KEY = "ghost-queue-recent-stores";
const MAX_RECENT_STORES = 6;

function readJson(key, fallback) {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(key, JSON.stringify(value));
}

export function getFavoriteStoreIds() {
  return readJson(FAVORITES_KEY, []);
}

export function isFavoriteStore(storeId) {
  return getFavoriteStoreIds().includes(storeId);
}

export function toggleFavoriteStore(store) {
  const storeId = store?.id || store?.storeId;
  if (!storeId) {
    return [];
  }

  const current = getFavoriteStoreIds();
  const next = current.includes(storeId)
    ? current.filter((id) => id !== storeId)
    : [storeId, ...current].slice(0, 24);

  writeJson(FAVORITES_KEY, next);
  return next;
}

export function getRecentStores() {
  return readJson(RECENTS_KEY, []);
}

export function saveRecentStore(store) {
  const storeId = store?.id || store?.storeId;
  if (!storeId) {
    return [];
  }

  const entry = {
    storeId,
    storeName: store?.store_name || store?.storeName || storeId,
    storeLogo: store?.store_logo || store?.storeLogo || "storefront",
    updatedAt: Date.now(),
  };

  const current = getRecentStores().filter((item) => item.storeId !== storeId);
  const next = [entry, ...current].slice(0, MAX_RECENT_STORES);
  writeJson(RECENTS_KEY, next);
  return next;
}
