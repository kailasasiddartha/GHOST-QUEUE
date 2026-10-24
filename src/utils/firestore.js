/**
 * firestore.js — Spark-plan client-side Firestore implementation.
 * All business logic formerly in Cloud Functions is implemented here
 * using the Firestore client SDK (runTransaction, writeBatch, increment).
 * No firebase-functions or httpsCallable is needed.
 */

import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { auth, db } from "../firebase";

// ─── INTERNAL HELPERS ────────────────────────────────────────────────────────

function sanitizePhoneNumber(phone) {
  return String(phone || "").replace(/\D/g, "").slice(0, 10);
}

export function sanitizeEntryInput(payload = {}) {
  const displayName = String(payload.name || payload.display_name || "").trim();
  const phoneNumber = sanitizePhoneNumber(payload.phone || payload.phone_number);
  const memberCount = Number(payload.members ?? payload.member_count ?? 1);
  const partyNote = String(payload.party_note || "").trim().slice(0, 120);
  const staffNote = String(payload.staff_note || "").trim().slice(0, 160);
  const priorityLevel = Number(payload.priority_level ?? 0) > 0 ? 1 : 0;
  const serviceCounter = String(payload.service_counter || "").trim().slice(0, 40);

  if (!displayName) throw new Error("Please enter your name");
  if (phoneNumber.length !== 10) throw new Error("Phone number must be exactly 10 digits");
  if (!Number.isInteger(memberCount) || memberCount < 1 || memberCount > 20) throw new Error("Members must be 1–20");

  return { display_name: displayName, phone_number: phoneNumber, member_count: memberCount, party_note: partyNote, staff_note: staffNote, priority_level: priorityLevel, service_counter: serviceCounter };
}

// Firestore document reference helpers
const storeDocRef            = (storeId)          => doc(db, "stores", storeId);
const metaDocRef             = (storeId)          => doc(db, "stores", storeId, "meta", "info");
const publicDocRef           = (storeId)          => doc(db, "publicStores", storeId);
const publicLiveQueueDocRef  = (storeId, entryId) => doc(db, "publicStores", storeId, "liveQueue", entryId);
const publicLiveQueueCol     = (storeId)          => collection(db, "publicStores", storeId, "liveQueue");
const entryDocRef            = (storeId, entryId) => doc(db, "stores", storeId, "entries", entryId);
const historyCol             = (storeId)          => collection(db, "stores", storeId, "history");
const auditCol               = (storeId)          => collection(db, "stores", storeId, "audit");

const DEFAULT_SCHEDULE = {
  mon: { enabled: true,  open: "09:00", close: "18:00" },
  tue: { enabled: true,  open: "09:00", close: "18:00" },
  wed: { enabled: true,  open: "09:00", close: "18:00" },
  thu: { enabled: true,  open: "09:00", close: "18:00" },
  fri: { enabled: true,  open: "09:00", close: "18:00" },
  sat: { enabled: false, open: "10:00", close: "16:00" },
  sun: { enabled: false, open: "10:00", close: "14:00" },
};

/** Fields written to publicStores/{storeId} — the customer-facing projection. */
function buildPublicPayload(storeId, data) {
  return {
    storeId,
    store_name:            data.store_name            ?? "",
    category:              data.category              ?? "Restaurant",
    location:              data.location              ?? "",
    is_open:               data.is_open               ?? false,
    queue_paused:          data.queue_paused          ?? false,
    join_disabled:         data.join_disabled         ?? false,
    holiday_mode:          data.holiday_mode          ?? false,
    live_party_count:      data.live_party_count      ?? 0,
    live_member_count:     data.live_member_count     ?? 0,
    avg_service_mins:      data.avg_service_mins      ?? 8,
    current_serving_index: data.current_serving_index ?? 0,
    announcement:          data.announcement          ?? "",
    brand_primary:         data.brand_primary         ?? "#7C3AED",
    brand_secondary:       data.brand_secondary       ?? "#22D3EE",
    store_logo:            data.store_logo            ?? "storefront",
    cover_image_url:       data.cover_image_url       ?? "",
    ghost_score:           data.ghost_score           ?? 0,
    current_broadcast:     data.current_broadcast     ?? null,
    lobby_content:         data.lobby_content         ?? null,
    closed_reason:         data.closed_reason         ?? "",
    paused_reason:         data.paused_reason         ?? "",
    join_disabled_reason:  data.join_disabled_reason  ?? "",
    holiday_reason:        data.holiday_reason        ?? "",
    fast_pass_price:       data.fast_pass_price       ?? 0,
    timezone:              data.timezone              ?? "Asia/Kolkata",
    schedule_enabled:      data.schedule_enabled      ?? false,
    schedule:              data.schedule              ?? null,
    max_queue_size:        data.max_queue_size        ?? 0,
  };
}

/** Generates a URL-friendly slug from a store name. */
function generateSlug(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40) || "store";
}

/** Writes an audit log entry (non-fatal — fire and forget). */
function logAudit(storeId, action, details = {}) {
  addDoc(auditCol(storeId), {
    action,
    ...details,
    created_at: serverTimestamp(),
  }).catch(() => {});
}

// ─── STORE REGISTRATION ───────────────────────────────────────────────────────

/**
 * Creates a new store. Replaces the registerStoreOwner Cloud Function.
 * Writes to stores/{storeId}, stores/{storeId}/meta/info, publicStores/{storeId}.
 */
export async function registerStore({ storeName, category, location, timezone = "Asia/Kolkata" }) {
  const user = auth.currentUser;
  if (!user || user.isAnonymous) throw new Error("You must be signed in to register a store.");

  const name = String(storeName || "").trim();
  const loc  = String(location  || "").trim();
  if (!name) throw new Error("Store name is required.");
  if (!loc)  throw new Error("Location is required.");

  // Find a unique slug / storeId using publicStores which has open read permission
  const baseSlug = generateSlug(name) || "store";
  let storeId = baseSlug;
  let suffix = 1;
  while ((await getDoc(publicDocRef(storeId))).exists()) {
    storeId = `${baseSlug}-${suffix++}`;
  }

  const payload = {
    ownerId:               user.uid,
    slug:                  storeId,
    store_name:            name,
    category:              String(category || "Restaurant").trim(),
    location:              loc,
    timezone,
    announcement:          "",
    closed_reason:         "",
    holiday_mode:          false,
    holiday_reason:        "",
    is_open:               false,
    queue_paused:          false,
    paused_reason:         "",
    join_disabled:         false,
    join_disabled_reason:  "",
    max_queue_size:        0,
    fast_pass_price:       0,
    store_logo:            "storefront",
    cover_image_url:       "",
    brand_primary:         "#7C3AED",
    brand_secondary:       "#22D3EE",
    schedule_enabled:      false,
    schedule:              DEFAULT_SCHEDULE,
    current_serving_index: 0,
    live_party_count:      0,
    live_member_count:     0,
    next_queue_index:      1,
    next_front_queue_index: 0,
    avg_service_mins:      8,
    ghost_score:           0,
    last_active:           serverTimestamp(),
    updated_at:            serverTimestamp(),
    created_at:            serverTimestamp(),
  };

  const batch = writeBatch(db);
  batch.set(storeDocRef(storeId),  payload);
  batch.set(metaDocRef(storeId),   payload);
  batch.set(publicDocRef(storeId), buildPublicPayload(storeId, payload));
  await batch.commit();

  return { ok: true, storeId };
}

// ─── CUSTOMER QUEUE ACTIONS ───────────────────────────────────────────────────

/**
 * Customer joins the queue. Replaces joinQueueCustomer Cloud Function.
 * Uses a transaction to safely assign a sequential queue_index.
 */
export async function joinQueue(storeId, _ignored, payload = {}) {
  // Support both joinQueue(storeId, payload) and joinQueue(storeId, userId, payload)
  const entryPayload = (typeof _ignored === "object" && _ignored !== null) ? _ignored : payload;
  const user = auth.currentUser;
  if (!user) throw new Error("You must be signed in to join the queue.");

  const sanitized = sanitizeEntryInput(entryPayload);

  // Customer entries are keyed by their UID so they can only appear once
  const newEntryRef = entryDocRef(storeId, user.uid);
  const publicEntryRef = publicLiveQueueDocRef(storeId, user.uid);

  return runTransaction(db, async (tx) => {
    const metaSnap = await tx.get(metaDocRef(storeId));
    if (!metaSnap.exists()) throw new Error("Store not found.");

    const meta = metaSnap.data();
    if (meta.holiday_mode)  throw new Error("The store is on holiday.");
    if (!meta.is_open)       throw new Error("STORE_CLOSED");
    if (meta.queue_paused)   throw new Error("QUEUE_PAUSED");
    if (meta.join_disabled)  throw new Error("QUEUE_DISABLED");
    if (meta.max_queue_size > 0 && (meta.live_party_count ?? 0) >= meta.max_queue_size) {
      throw new Error("QUEUE_FULL");
    }

    const existingEntry = await tx.get(newEntryRef);
    if (existingEntry.exists()) throw new Error("You are already in this queue.");

    const nextIndex   = Number(meta.next_queue_index   ?? 1);
    const newParty    = (meta.live_party_count   ?? 0) + 1;
    const newMembers  = (meta.live_member_count  ?? 0) + sanitized.member_count;

    const counterUpdate = {
      next_queue_index:  nextIndex + 1,
      live_party_count:  newParty,
      live_member_count: newMembers,
      last_active:       serverTimestamp(),
    };

    tx.set(newEntryRef, {
      ...sanitized,
      userId:      user.uid,
      queue_index: nextIndex,
      joined_at:   serverTimestamp(),
      last_active: Timestamp.now(),
      skips_used:  0,
      fcm_token:   null,
      source:      "online",
    });
    tx.set(publicEntryRef, {
      display_name: sanitized.display_name,
      member_count: sanitized.member_count,
      party_note:   sanitized.party_note,
      queue_index:  nextIndex,
      joined_at:    serverTimestamp(),
      last_active:  Timestamp.now(),
      source:       "online",
    });
    tx.set(metaDocRef(storeId),   counterUpdate, { merge: true });
    tx.set(storeDocRef(storeId),  counterUpdate, { merge: true });
    tx.set(publicDocRef(storeId), { live_party_count: newParty, live_member_count: newMembers }, { merge: true });
  });
}

/**
 * Customer leaves the queue. Replaces leaveQueueCustomer Cloud Function.
 */
export async function leaveQueue(storeId) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not authenticated.");

  return runTransaction(db, async (tx) => {
    const entryRef = entryDocRef(storeId, user.uid);
    const entrySnap = await tx.get(entryRef);
    if (!entrySnap.exists()) throw new Error("You are not in this queue.");

    const entry   = entrySnap.data();
    const metaSnap = await tx.get(metaDocRef(storeId));
    const meta = metaSnap.data() || {};
    const updatedParty   = Math.max(0, (meta.live_party_count   ?? 1) - 1);
    const updatedMembers = Math.max(0, (meta.live_member_count  ?? entry.member_count) - (entry.member_count || 1));

    const histRef = doc(historyCol(storeId));
    tx.set(histRef, { ...entry, history_type: "left", completed_at: serverTimestamp(), left_at: serverTimestamp() });
    tx.delete(entryRef);
    tx.delete(publicLiveQueueDocRef(storeId, user.uid));
    tx.set(metaDocRef(storeId),   { live_party_count: updatedParty, live_member_count: updatedMembers, last_active: serverTimestamp() }, { merge: true });
    tx.set(storeDocRef(storeId),  { live_party_count: updatedParty, live_member_count: updatedMembers }, { merge: true });
    tx.set(publicDocRef(storeId), { live_party_count: updatedParty, live_member_count: updatedMembers }, { merge: true });
  });
}

/**
 * Customer skips back one position (Smart Skip). Replaces smartSkipCustomer Cloud Function.
 */
export async function smartSkip(storeId) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not authenticated.");

  return runTransaction(db, async (tx) => {
    const entryRef  = entryDocRef(storeId, user.uid);
    const entrySnap = await tx.get(entryRef);
    if (!entrySnap.exists()) throw new Error("You are not in this queue.");

    const entry = entrySnap.data();
    if ((entry.skips_used ?? 0) >= 2) throw new Error("MAX_SKIPS_REACHED");

    // Fetch the entry directly after this one from public liveQueue
    const nextSnap = await getDocs(
      query(publicLiveQueueCol(storeId),
        where("queue_index", ">", entry.queue_index), orderBy("queue_index", "asc"), limit(1))
    );
    if (nextSnap.empty) throw new Error("ALREADY_LAST");

    const nextDoc  = nextSnap.docs[0];
    const nextData = nextDoc.data();

    // Swap queue_index values in private entries
    tx.update(entryRef,                         { queue_index: nextData.queue_index, skips_used: (entry.skips_used ?? 0) + 1 });
    tx.update(entryDocRef(storeId, nextDoc.id), { queue_index: entry.queue_index });

    // Swap queue_index values in public liveQueue
    tx.update(publicLiveQueueDocRef(storeId, user.uid),   { queue_index: nextData.queue_index });
    tx.update(publicLiveQueueDocRef(storeId, nextDoc.id), { queue_index: entry.queue_index });
  });
}

// ─── CUSTOMER HEARTBEAT ───────────────────────────────────────────────────────

export async function updateHeartbeat(storeId, userId) {
  try {
    await updateDoc(entryDocRef(storeId, userId), { last_active: Timestamp.now() });
  } catch { /* ignore stale */ }
}

export async function updateFcmToken(storeId, userId, token) {
  await updateDoc(entryDocRef(storeId, userId), { fcm_token: token });
}

// ─── ADMIN QUEUE ACTIONS ──────────────────────────────────────────────────────

/**
 * Calls the next customer. Replaces callNextCustomer Cloud Function.
 * Query runs outside the transaction; re-reads entry inside for safety.
 */
export async function callNext(storeId) {
  const qSnap = await getDocs(
    query(collection(db, "stores", storeId, "entries"), orderBy("queue_index", "asc"), limit(1))
  );
  if (qSnap.empty) return { ok: true, empty: true };

  const firstDoc = qSnap.docs[0];

  await runTransaction(db, async (tx) => {
    const entrySnap = await tx.get(firstDoc.ref);
    if (!entrySnap.exists()) return; // already called by another tab

    const metaSnap = await tx.get(metaDocRef(storeId));
    const meta  = metaSnap.data() || {};
    const entry = entrySnap.data();

    const newServing = (meta.current_serving_index ?? 0) + 1;
    const newParty   = Math.max(0, (meta.live_party_count   ?? 0) - 1);
    const newMembers = Math.max(0, (meta.live_member_count  ?? 0) - (entry.member_count || 1));

    const histRef = doc(historyCol(storeId));
    tx.set(histRef, { ...entry, history_type: "served", completed_at: serverTimestamp() });
    tx.delete(firstDoc.ref);
    tx.delete(publicLiveQueueDocRef(storeId, firstDoc.id));
    tx.set(metaDocRef(storeId),   { current_serving_index: newServing, live_party_count: newParty, live_member_count: newMembers, last_active: serverTimestamp() }, { merge: true });
    tx.set(storeDocRef(storeId),  { current_serving_index: newServing, live_party_count: newParty, live_member_count: newMembers }, { merge: true });
    tx.set(publicDocRef(storeId), { current_serving_index: newServing, live_party_count: newParty, live_member_count: newMembers }, { merge: true });
  });

  logAudit(storeId, "call_next", { display_name: firstDoc.data().display_name || "" });
  return { ok: true };
}

/**
 * Staff adds a walk-in customer. Replaces addWalkInCustomer Cloud Function.
 */
export async function addWalkInCustomer(storeId, payload) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not authenticated.");

  const sanitized = sanitizeEntryInput(payload);
  const newEntryRef = doc(collection(db, "stores", storeId, "entries"));
  const publicEntryRef = publicLiveQueueDocRef(storeId, newEntryRef.id);

  await runTransaction(db, async (tx) => {
    const metaSnap = await tx.get(metaDocRef(storeId));
    if (!metaSnap.exists()) throw new Error("Store not found.");

    const meta       = metaSnap.data();
    const isPriority = sanitized.priority_level > 0;
    const nextIndex  = isPriority
      ? Number(meta.next_front_queue_index ?? 0) - 1
      : Number(meta.next_queue_index       ?? 1);
    const newParty   = (meta.live_party_count  ?? 0) + 1;
    const newMembers = (meta.live_member_count ?? 0) + sanitized.member_count;

    const counterUpdate = isPriority
      ? { next_front_queue_index: nextIndex }
      : { next_queue_index: nextIndex + 1 };

    tx.set(newEntryRef, {
      ...sanitized,
      queue_index: nextIndex,
      joined_at:   serverTimestamp(),
      last_active: Timestamp.now(),
      skips_used:  0,
      fcm_token:   null,
      source:      "walk_in",
      created_by:  user.uid,
    });
    tx.set(publicEntryRef, {
      display_name: sanitized.display_name,
      member_count: sanitized.member_count,
      party_note:   sanitized.party_note,
      queue_index:  nextIndex,
      joined_at:    serverTimestamp(),
      last_active:  Timestamp.now(),
      source:       "walk_in",
    });
    tx.set(metaDocRef(storeId),   { ...counterUpdate, live_party_count: newParty, live_member_count: newMembers, last_active: serverTimestamp() }, { merge: true });
    tx.set(storeDocRef(storeId),  { ...counterUpdate, live_party_count: newParty, live_member_count: newMembers }, { merge: true });
    tx.set(publicDocRef(storeId), { live_party_count: newParty, live_member_count: newMembers }, { merge: true });
  });

  logAudit(storeId, "walk_in_added", { display_name: sanitized.display_name });
  return { ok: true, id: newEntryRef.id };
}

/**
 * Staff edits an existing queue entry. Replaces updateQueueEntryAdmin Cloud Function.
 */
export async function updateQueueEntry(storeId, entryId, payload) {
  const sanitized = sanitizeEntryInput(payload);
  await updateDoc(entryDocRef(storeId, entryId), { ...sanitized, updated_at: serverTimestamp() });
  try {
    await updateDoc(publicLiveQueueDocRef(storeId, entryId), {
      display_name: sanitized.display_name,
      member_count: sanitized.member_count,
      party_note:   sanitized.party_note,
    });
  } catch { /* ignore if not present in public projection */ }
  logAudit(storeId, "entry_updated", { target_entry_id: entryId });
  return { ok: true };
}

/**
 * Moves an entry one position back. Replaces skipQueueEntry Cloud Function.
 */
export async function skipEntryForward(storeId, entryId) {
  return runTransaction(db, async (tx) => {
    const eRef  = entryDocRef(storeId, entryId);
    const eSnap = await tx.get(eRef);
    if (!eSnap.exists()) throw new Error("Entry not found.");

    const entry = eSnap.data();
    const nextSnap = await getDocs(
      query(collection(db, "stores", storeId, "entries"),
        where("queue_index", ">", entry.queue_index), orderBy("queue_index", "asc"), limit(1))
    );
    if (nextSnap.empty) return { ok: true }; // already last

    const nextDoc  = nextSnap.docs[0];
    tx.update(eRef,         { queue_index: nextDoc.data().queue_index });
    tx.update(nextDoc.ref,  { queue_index: entry.queue_index });
    try {
      tx.update(publicLiveQueueDocRef(storeId, entryId),    { queue_index: nextDoc.data().queue_index });
      tx.update(publicLiveQueueDocRef(storeId, nextDoc.id), { queue_index: entry.queue_index });
    } catch { /* ignore */ }
  });
}

/**
 * Recalls an entry (moves served customer back to queue). Replaces recallQueueEntry Cloud Function.
 */
export async function recallEntry(storeId, entryId) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not authenticated.");

  return runTransaction(db, async (tx) => {
    const histRef  = doc(db, "stores", storeId, "history", entryId);
    const histSnap = await tx.get(histRef);
    if (!histSnap.exists()) throw new Error("History entry not found.");

    const metaSnap = await tx.get(metaDocRef(storeId));
    const meta     = metaSnap.data() || {};
    const entry    = histSnap.data();
    const nextIndex  = Number(meta.next_front_queue_index ?? 0) - 1;
    const newParty   = (meta.live_party_count  ?? 0) + 1;
    const newMembers = (meta.live_member_count ?? 0) + (entry.member_count || 1);

    const newEntryRef = doc(collection(db, "stores", storeId, "entries"));
    tx.set(newEntryRef, { ...entry, queue_index: nextIndex, source: "recalled", recalled_at: serverTimestamp() });
    tx.set(publicLiveQueueDocRef(storeId, newEntryRef.id), {
      display_name: entry.display_name || "",
      member_count: entry.member_count || 1,
      party_note:   entry.party_note   || "",
      queue_index:  nextIndex,
      joined_at:    serverTimestamp(),
      last_active:  Timestamp.now(),
      source:       "recalled",
    });
    tx.set(metaDocRef(storeId),   { next_front_queue_index: nextIndex, live_party_count: newParty, live_member_count: newMembers, last_active: serverTimestamp() }, { merge: true });
    tx.set(storeDocRef(storeId),  { live_party_count: newParty, live_member_count: newMembers }, { merge: true });
    tx.set(publicDocRef(storeId), { live_party_count: newParty, live_member_count: newMembers }, { merge: true });
  });
}

/**
 * Marks an entry as no-show. Replaces markNoShowEntry Cloud Function.
 */
export async function markNoShow(storeId, entryId) {
  return runTransaction(db, async (tx) => {
    const eRef  = entryDocRef(storeId, entryId);
    const eSnap = await tx.get(eRef);
    if (!eSnap.exists()) throw new Error("Entry not found.");

    const entry    = eSnap.data();
    const metaSnap = await tx.get(metaDocRef(storeId));
    const meta     = metaSnap.data() || {};
    const newParty   = Math.max(0, (meta.live_party_count  ?? 0) - 1);
    const newMembers = Math.max(0, (meta.live_member_count ?? 0) - (entry.member_count || 1));

    const histRef = doc(historyCol(storeId));
    tx.set(histRef, { ...entry, history_type: "no_show", completed_at: serverTimestamp() });
    tx.delete(eRef);
    tx.delete(publicLiveQueueDocRef(storeId, entryId));
    tx.set(metaDocRef(storeId),   { live_party_count: newParty, live_member_count: newMembers, last_active: serverTimestamp() }, { merge: true });
    tx.set(storeDocRef(storeId),  { live_party_count: newParty, live_member_count: newMembers }, { merge: true });
    tx.set(publicDocRef(storeId), { live_party_count: newParty, live_member_count: newMembers }, { merge: true });
  });
}

/**
 * Clears the entire queue, logging all entries to history. Replaces clearQueueWithHistory Cloud Function.
 */
export async function clearQueueWithHistory(storeId, reason = "Store closed by admin") {
  const entriesSnap = await getDocs(collection(db, "stores", storeId, "entries"));
  const publicSnap  = await getDocs(publicLiveQueueCol(storeId));

  // Process in chunks of 400 (Firestore batch limit is 500)
  const CHUNK = 400;
  const docs  = entriesSnap.docs;
  for (let i = 0; i < docs.length; i += CHUNK) {
    const batch = writeBatch(db);
    docs.slice(i, i + CHUNK).forEach((d) => {
      batch.set(doc(historyCol(storeId)), { ...d.data(), history_type: "stale", cleared_reason: reason, completed_at: serverTimestamp() });
      batch.delete(d.ref);
    });
    await batch.commit();
  }

  // Clear public liveQueue projection
  const pDocs = publicSnap.docs;
  for (let i = 0; i < pDocs.length; i += CHUNK) {
    const batch = writeBatch(db);
    pDocs.slice(i, i + CHUNK).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }

  const reset = { live_party_count: 0, live_member_count: 0, last_active: serverTimestamp() };
  const batchFinal = writeBatch(db);
  batchFinal.set(metaDocRef(storeId),   reset, { merge: true });
  batchFinal.set(storeDocRef(storeId),  reset, { merge: true });
  batchFinal.set(publicDocRef(storeId), reset, { merge: true });
  await batchFinal.commit();

  logAudit(storeId, "queue_cleared", { reason });
  return { ok: true };
}

/**
 * Marks an entry as VIP and moves them to the front. Replaces markEntryVIP Cloud Function.
 */
export async function markVIPEntry(storeId, entryId) {
  return runTransaction(db, async (tx) => {
    const eRef  = entryDocRef(storeId, entryId);
    const eSnap = await tx.get(eRef);
    if (!eSnap.exists()) throw new Error("Entry not found.");

    const metaSnap = await tx.get(metaDocRef(storeId));
    const meta     = metaSnap.data() || {};
    const nextFront = Number(meta.next_front_queue_index ?? 0) - 1;

    tx.update(eRef, { priority_level: 1, queue_index: nextFront, vip_granted_at: serverTimestamp() });
    try {
      tx.update(publicLiveQueueDocRef(storeId, entryId), { queue_index: nextFront });
    } catch { /* ignore */ }
    tx.set(metaDocRef(storeId), { next_front_queue_index: nextFront }, { merge: true });
  });
}

// Keep old alias used in AdminDashboard
export const markEntryVIP = markVIPEntry;

/**
 * Re-serves a customer (adds them back as first in next batch). Replaces reServeEntry Cloud Function.
 */
export async function reServeQueueEntry(storeId, entryId) {
  return runTransaction(db, async (tx) => {
    const histRef  = doc(db, "stores", storeId, "history", entryId);
    const histSnap = await tx.get(histRef);
    if (!histSnap.exists()) throw new Error("History entry not found.");

    const metaSnap = await tx.get(metaDocRef(storeId));
    const meta     = metaSnap.data() || {};
    const entry    = histSnap.data();
    const nextFront  = Number(meta.next_front_queue_index ?? 0) - 1;
    const newParty   = (meta.live_party_count  ?? 0) + 1;
    const newMembers = (meta.live_member_count ?? 0) + (entry.member_count || 1);

    const newEntryRef = doc(collection(db, "stores", storeId, "entries"));
    tx.set(newEntryRef, { ...entry, queue_index: nextFront, source: "re_served", re_served_at: serverTimestamp(), history_type: deleteField() });
    tx.set(publicLiveQueueDocRef(storeId, newEntryRef.id), {
      display_name: entry.display_name || "",
      member_count: entry.member_count || 1,
      party_note:   entry.party_note   || "",
      queue_index:  nextFront,
      joined_at:    serverTimestamp(),
      last_active:  Timestamp.now(),
      source:       "re_served",
    });
    tx.set(metaDocRef(storeId),   { next_front_queue_index: nextFront, live_party_count: newParty, live_member_count: newMembers, last_active: serverTimestamp() }, { merge: true });
    tx.set(storeDocRef(storeId),  { live_party_count: newParty, live_member_count: newMembers }, { merge: true });
    tx.set(publicDocRef(storeId), { live_party_count: newParty, live_member_count: newMembers }, { merge: true });
  });
}

/**
 * Adds an emergency-priority entry at position #1. Replaces emergencyAddEntry Cloud Function.
 */
export async function addEmergencyEntry(storeId, entryPayload) {
  return addWalkInCustomer(storeId, { ...entryPayload, priority_level: 1 });
}

// ─── STORE OPERATIONAL STATE ──────────────────────────────────────────────────

/**
 * Saves any set of operational updates (open/close, pause, holiday etc.).
 * Replaces setStoreOperationalState Cloud Function.
 */
export async function saveStoreOperationalState(storeId, updates) {
  if (!updates || typeof updates !== "object") return { ok: true };
  const safe = {};
  const ALLOWED = ["is_open","queue_paused","paused_reason","join_disabled","join_disabled_reason","holiday_mode","holiday_reason","closed_reason","announcement"];
  ALLOWED.forEach((k) => { if (k in updates) safe[k] = updates[k]; });
  if (!Object.keys(safe).length) return { ok: true };

  safe.last_active = serverTimestamp();

  const batch = writeBatch(db);
  batch.set(metaDocRef(storeId),   safe, { merge: true });
  batch.set(storeDocRef(storeId),  safe, { merge: true });
  batch.set(publicDocRef(storeId), safe, { merge: true });
  await batch.commit();
  return { ok: true };
}

export async function toggleStoreOpen(storeId, isOpen) {
  return saveStoreOperationalState(storeId, { is_open: isOpen });
}

// ─── STORE SETTINGS ───────────────────────────────────────────────────────────

/**
 * Saves full store settings. Replaces saveStoreSettingsOwner Cloud Function.
 */
export async function saveStoreSettings(storeId, updates) {
  const ALLOWED = [
    "fast_pass_price","announcement","closed_reason","holiday_mode","holiday_reason",
    "queue_paused","paused_reason","join_disabled","join_disabled_reason","max_queue_size",
    "store_logo","cover_image_url","brand_primary","brand_secondary","timezone",
    "schedule_enabled","schedule",
  ];
  const safe = { updated_at: serverTimestamp() };
  ALLOWED.forEach((k) => { if (k in updates) safe[k] = updates[k]; });

  const batch = writeBatch(db);
  batch.set(metaDocRef(storeId),   safe, { merge: true });
  batch.set(storeDocRef(storeId),  safe, { merge: true });
  // Sync public fields that customers see
  const publicSafe = {};
  ["fast_pass_price","store_logo","cover_image_url","brand_primary","brand_secondary","timezone","schedule_enabled","schedule","holiday_mode","holiday_reason","queue_paused","paused_reason","announcement","max_queue_size"].forEach((k) => {
    if (k in safe) publicSafe[k] = safe[k];
  });
  if (Object.keys(publicSafe).length) batch.set(publicDocRef(storeId), publicSafe, { merge: true });
  await batch.commit();
  return { ok: true };
}

// ─── STAFF MANAGEMENT ─────────────────────────────────────────────────────────

/**
 * Adds or updates a staff member. Replaces saveStoreStaffMemberOwner Cloud Function.
 */
export async function saveStoreStaffMember(storeId, email, role) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) throw new Error("Email is required");
  await setDoc(doc(db, "stores", storeId, "staffByEmail", normalizedEmail), {
    email: normalizedEmail,
    role:  role || "staff",
    added_at: serverTimestamp(),
  });
  return { ok: true };
}

/**
 * Removes a staff member. Replaces removeStoreStaffMemberOwner Cloud Function.
 */
export async function removeStoreStaffMember(storeId, email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return { ok: true };
  await deleteDoc(doc(db, "stores", storeId, "staffByEmail", normalizedEmail));
  return { ok: true };
}

// ─── BROADCAST & LOBBY ───────────────────────────────────────────────────────

/**
 * Sends a broadcast message to all waiting customers. Replaces sendBroadcastMessage Cloud Function.
 */
export async function sendBroadcast(storeId, message) {
  const sanitized = String(message || "").trim().slice(0, 280);
  if (!sanitized) throw new Error("Broadcast message cannot be empty.");
  const payload = { current_broadcast: { message: sanitized, sent_at: serverTimestamp() } };
  const batch   = writeBatch(db);
  batch.set(metaDocRef(storeId),   payload, { merge: true });
  batch.set(publicDocRef(storeId), payload, { merge: true });
  await batch.commit();
  return { ok: true };
}

/**
 * Clears the broadcast. Replaces clearBroadcast Cloud Function.
 */
export async function clearStoreBroadcast(storeId) {
  const payload = { current_broadcast: null };
  const batch   = writeBatch(db);
  batch.set(metaDocRef(storeId),   payload, { merge: true });
  batch.set(publicDocRef(storeId), payload, { merge: true });
  await batch.commit();
  return { ok: true };
}
