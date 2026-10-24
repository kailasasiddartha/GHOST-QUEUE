const admin = require("firebase-admin");
const { HttpsError, onCall } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");

admin.initializeApp();

const db = admin.firestore();
const messaging = admin.messaging();
const REGION = "asia-south1";
const DEFAULT_TIMEZONE = "Asia/Kolkata";

function sanitizePhoneNumber(phone) {
  return String(phone || "").replace(/\D/g, "").slice(0, 10);
}

function sanitizeEntryInput(data = {}) {
  const displayName = String(data.name || data.display_name || "").trim();
  const phoneNumber = sanitizePhoneNumber(data.phone || data.phone_number);
  const memberCount = Number(data.members ?? data.member_count ?? 1);
  const partyNote = String(data.party_note || "").trim().slice(0, 120);
  const staffNote = String(data.staff_note || "").trim().slice(0, 160);
  const priorityLevel = Number(data.priority_level ?? 0) > 0 ? 1 : 0;
  const serviceCounter = String(data.service_counter || "").trim().slice(0, 40);

  if (!displayName) {
    throw new HttpsError("invalid-argument", "Please enter a name.");
  }
  if (phoneNumber.length !== 10) {
    throw new HttpsError("invalid-argument", "Phone number must be exactly 10 digits.");
  }
  if (!Number.isInteger(memberCount) || memberCount < 1 || memberCount > 20) {
    throw new HttpsError("invalid-argument", "Members must be between 1 and 20.");
  }

  return {
    display_name: displayName,
    phone_number: phoneNumber,
    member_count: memberCount,
    party_note: partyNote,
    staff_note: staffNote,
    priority_level: priorityLevel,
    service_counter: serviceCounter,
  };
}

async function getStoreRole(storeId, auth) {
  if (!auth?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const storeSnap = await db.doc(`stores/${storeId}`).get();
  if (!storeSnap.exists) {
    throw new HttpsError("not-found", "Store not found.");
  }

  if (storeSnap.data().ownerId === auth.uid) {
    return "owner";
  }

  const email = String(auth.token?.email || "").toLowerCase();
  if (!email) {
    throw new HttpsError("permission-denied", "This account is not linked to a store role.");
  }

  const staffSnap = await db.doc(`stores/${storeId}/staffByEmail/${email}`).get();
  if (!staffSnap.exists) {
    throw new HttpsError("permission-denied", "This account does not have access to this store.");
  }

  return staffSnap.data().role || "staff";
}

function requireRole(role, allowedRoles) {
  if (!allowedRoles.includes(role)) {
    throw new HttpsError("permission-denied", "You do not have permission for this action.");
  }
}

async function logAuditAction(storeId, action, details = {}) {
  await db.collection(`stores/${storeId}/audit`).add({
    action,
    ...details,
    created_at: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function getOrderedEntries(storeId) {
  const snap = await db.collection(`stores/${storeId}/entries`).orderBy("queue_index", "asc").get();
  return snap.docs.map((entryDoc) => ({ id: entryDoc.id, ref: entryDoc.ref, ...entryDoc.data() }));
}

async function resequenceQueue(storeId, entries) {
  const batch = db.batch();
  entries.forEach((entry, index) => {
    batch.update(db.doc(`stores/${storeId}/entries/${entry.id}`), { queue_index: index + 1 });
  });
  await batch.commit();
}

function buildHistoryPayload(entry, userId, type, extra = {}) {
  return {
    ...entry,
    ...extra,
    userId,
    history_type: type,
    completed_at: admin.firestore.FieldValue.serverTimestamp(),
    left_at: type === "left" ? admin.firestore.FieldValue.serverTimestamp() : null,
  };
}

async function sendTurnNotification(entry, storeId) {
  if (!entry?.fcm_token) {
    return;
  }

  try {
    await messaging.send({
      token: entry.fcm_token,
      notification: {
        title: "It's your turn",
        body: `${entry.display_name || "Your party"} is now being called.`,
      },
      data: {
        storeId,
        type: "queue_turn",
      },
      webpush: {
        notification: {
          icon: "/favicon.svg",
        },
      },
    });
  } catch (error) {
    console.error("Failed to send FCM notification", error);
  }
}

exports.callNextCustomer = onCall({ region: REGION }, async (request) => {
  const { storeId } = request.data || {};
  const role = await getStoreRole(storeId, request.auth);
  requireRole(role, ["owner", "manager", "staff"]);

  const result = await db.runTransaction(async (transaction) => {
    const currentMetaRef = metaRef(storeId);
    const queueQuery = db.collection(`stores/${storeId}/entries`).orderBy("queue_index", "asc").limit(1);
    const [metaSnap, queueSnap] = await Promise.all([
      transaction.get(currentMetaRef),
      transaction.get(queueQuery),
    ]);

    if (queueSnap.empty) {
      return { ok: true, empty: true };
    }

    const firstDoc = queueSnap.docs[0];
    const firstData = firstDoc.data();
    const meta = metaSnap.exists ? (metaSnap.data() || {}) : {};
    const currentServing = Number(meta.current_serving_index || 0);
    const livePartyCount = Math.max(0, Number(meta.live_party_count ?? 0) - 1);
    const liveMemberCount = Math.max(0, Number(meta.live_member_count ?? 0) - projectionGetEntryWeight(firstData));
    const historyRef = db.collection(`stores/${storeId}/history`).doc();
    const metaUpdate = {
      current_serving_index: currentServing + 1,
      live_party_count: livePartyCount,
      live_member_count: liveMemberCount,
      last_active: admin.firestore.FieldValue.serverTimestamp(),
    };

    transaction.set(historyRef, buildHistoryPayload(firstData, firstDoc.id, "served"));
    transaction.set(currentMetaRef, metaUpdate, { merge: true });
    transaction.set(storeRef(storeId), metaUpdate, { merge: true });
    transaction.set(projectionPublicStoreRef(storeId), projectionBuildPublicStorePayload(storeId, {
      current_serving_index: currentServing + 1,
      live_party_count: livePartyCount,
      live_member_count: liveMemberCount,
    }), { merge: true });
    transaction.delete(firstDoc.ref);

    return { ok: true, entryId: firstDoc.id, entry: firstData };
  });

  if (result.empty) {
    return result;
  }

  await sendTurnNotification(result.entry, storeId);
  await logAuditAction(storeId, "call_next", { target_entry_id: result.entryId, display_name: result.entry.display_name || "" });
  return { ok: true };
});

exports.addWalkInCustomer = onCall({ region: REGION }, async (request) => {
  const { storeId, entry } = request.data || {};
  const role = await getStoreRole(storeId, request.auth);
  requireRole(role, ["owner", "manager", "staff"]);

  const normalized = sanitizeEntryInput(entry);
  const newRef = db.collection(`stores/${storeId}/entries`).doc();

  await db.runTransaction(async (transaction) => {
    const metaSnap = await transaction.get(metaRef(storeId));
    if (!metaSnap.exists) {
      throw new HttpsError("not-found", "Store not found.");
    }

    const meta = metaSnap.data() || {};
    const isPriority = Number(normalized.priority_level ?? 0) > 0;
    const nextQueueIndex = Number(meta.next_queue_index ?? 1);
    const nextFrontQueueIndex = Number(meta.next_front_queue_index ?? 0);
    const queueIndex = isPriority ? nextFrontQueueIndex - 1 : nextQueueIndex;
    const livePartyCount = Number(meta.live_party_count ?? 0) + 1;
    const liveMemberCount = Number(meta.live_member_count ?? 0) + normalized.member_count;
    const metaUpdate = {
      live_party_count: livePartyCount,
      live_member_count: liveMemberCount,
      last_active: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (isPriority) {
      metaUpdate.next_front_queue_index = queueIndex;
    } else {
      metaUpdate.next_queue_index = queueIndex + 1;
    }

    transaction.set(newRef, {
      queue_index: queueIndex,
      joined_at: admin.firestore.FieldValue.serverTimestamp(),
      last_active: admin.firestore.Timestamp.now(),
      skips_used: 0,
      fcm_token: null,
      source: "walk_in",
      created_by: request.auth.uid,
      ...normalized,
    });
    transaction.set(metaRef(storeId), metaUpdate, { merge: true });
    transaction.set(storeRef(storeId), metaUpdate, { merge: true });
    transaction.set(projectionPublicStoreRef(storeId), projectionBuildPublicStorePayload(storeId, {
      live_party_count: livePartyCount,
      live_member_count: liveMemberCount,
    }), { merge: true });
  });

  await logAuditAction(storeId, "walk_in_added", { target_entry_id: newRef.id, display_name: normalized.display_name });
  return { ok: true, id: newRef.id };
});

exports.updateQueueEntryAdmin = onCall({ region: REGION }, async (request) => {
  const { storeId, entryId, entry } = request.data || {};
  const role = await getStoreRole(storeId, request.auth);
  requireRole(role, ["owner", "manager", "staff"]);

  const normalized = sanitizeEntryInput(entry);
  await db.runTransaction(async (transaction) => {
    const currentMetaRef = metaRef(storeId);
    const currentEntryRef = entryRef(storeId, entryId);
    const metaSnap = await transaction.get(currentMetaRef);
    const queueEntrySnap = await transaction.get(currentEntryRef);
    if (!queueEntrySnap.exists) throw new HttpsError("not-found", "Entry not found.");
    const meta = metaSnap.exists ? (metaSnap.data() || {}) : {};
    const existingEntry = queueEntrySnap.data();
    const wasPriority = Number(existingEntry.priority_level ?? 0) > 0;
    const shouldBePriority = Number(normalized.priority_level ?? 0) > 0;
    let queueIndex = Number(existingEntry.queue_index ?? 0);
    const metaUpdate = { last_active: admin.firestore.FieldValue.serverTimestamp() };
    if (wasPriority !== shouldBePriority) {
      if (shouldBePriority) {
        queueIndex = Number(meta.next_front_queue_index ?? 0) - 1;
        metaUpdate.next_front_queue_index = queueIndex;
      } else {
        queueIndex = Number(meta.next_queue_index ?? Date.now());
        metaUpdate.next_queue_index = queueIndex + 1;
      }
    }
    transaction.set(currentEntryRef, { ...normalized, queue_index: queueIndex, updated_at: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    transaction.set(currentMetaRef, metaUpdate, { merge: true });
    transaction.set(storeRef(storeId), metaUpdate, { merge: true });
  });

  await logAuditAction(storeId, "entry_updated", { target_entry_id: entryId, display_name: normalized.display_name });
  return { ok: true };
});

exports.skipQueueEntry = onCall({ region: REGION }, async (request) => {
  const { storeId, entryId } = request.data || {};
  const role = await getStoreRole(storeId, request.auth);
  requireRole(role, ["owner", "manager", "staff"]);

  const result = await db.runTransaction(async (transaction) => {
    const currentEntryRef = entryRef(storeId, entryId);
    const currentEntrySnap = await transaction.get(currentEntryRef);
    if (!currentEntrySnap.exists) return { ok: true, missing: true };
    const currentEntry = currentEntrySnap.data();
    const nextQuery = db.collection(`stores/${storeId}/entries`).where("queue_index", ">", Number(currentEntry.queue_index ?? 0)).orderBy("queue_index", "asc").limit(1);
    const nextSnap = await transaction.get(nextQuery);
    if (nextSnap.empty) return { ok: true, unchanged: true };
    const nextDoc = nextSnap.docs[0];
    transaction.update(currentEntryRef, { queue_index: nextDoc.data().queue_index, updated_at: admin.firestore.FieldValue.serverTimestamp() });
    transaction.update(nextDoc.ref, { queue_index: currentEntry.queue_index, updated_at: admin.firestore.FieldValue.serverTimestamp() });
    return { ok: true };
  });

  if (result.unchanged || result.missing) return result;
  await logAuditAction(storeId, "entry_skipped", { target_entry_id: entryId });
  return { ok: true };
});

exports.recallQueueEntry = onCall({ region: REGION }, async (request) => {
  const { storeId, entryId } = request.data || {};
  const role = await getStoreRole(storeId, request.auth);
  requireRole(role, ["owner", "manager", "staff"]);

  // FIX C5: Use a transaction so that if callNext() deletes this entry concurrently,
  // we detect it (exists check) and avoid writing a recalled_at to a deleted document.
  const currentEntryRef = db.doc(`stores/${storeId}/entries/${entryId}`);
  let entryData = null;

  await db.runTransaction(async (transaction) => {
    const entrySnap = await transaction.get(currentEntryRef);
    if (!entrySnap.exists) {
      throw new HttpsError("not-found", "Entry not found or was already served.");
    }
    entryData = entrySnap.data();
    transaction.set(currentEntryRef, { recalled_at: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  });

  if (entryData) {
    await sendTurnNotification(entryData, storeId);
  }
  await logAuditAction(storeId, "entry_recalled", { target_entry_id: entryId });
  return { ok: true };
});

exports.markNoShowEntry = onCall({ region: REGION }, async (request) => {
  const { storeId, entryId } = request.data || {};
  const role = await getStoreRole(storeId, request.auth);
  requireRole(role, ["owner", "manager", "staff"]);

  const result = await db.runTransaction(async (transaction) => {
    const currentMetaRef = metaRef(storeId);
    const currentEntryRef = entryRef(storeId, entryId);
    const [metaSnap, queueEntrySnap] = await Promise.all([
      transaction.get(currentMetaRef),
      transaction.get(currentEntryRef),
    ]);

    if (!queueEntrySnap.exists) {
      return { ok: true, missing: true };
    }

    const queueEntry = queueEntrySnap.data();
    const meta = metaSnap.exists ? (metaSnap.data() || {}) : {};
    const livePartyCount = Math.max(0, Number(meta.live_party_count ?? 0) - 1);
    const liveMemberCount = Math.max(0, Number(meta.live_member_count ?? 0) - projectionGetEntryWeight(queueEntry));
    const historyRef = db.collection(`stores/${storeId}/history`).doc();
    const metaUpdate = {
      live_party_count: livePartyCount,
      live_member_count: liveMemberCount,
      last_active: admin.firestore.FieldValue.serverTimestamp(),
    };

    transaction.set(historyRef, buildHistoryPayload(queueEntry, entryId, "no_show"));
    transaction.delete(currentEntryRef);
    transaction.set(currentMetaRef, metaUpdate, { merge: true });
    transaction.set(storeRef(storeId), metaUpdate, { merge: true });
    transaction.set(projectionPublicStoreRef(storeId), projectionBuildPublicStorePayload(storeId, {
      live_party_count: livePartyCount,
      live_member_count: liveMemberCount,
    }), { merge: true });

    return { ok: true };
  });

  await logAuditAction(storeId, "entry_no_show", { target_entry_id: entryId });
  return result;
});

exports.clearQueueWithHistory = onCall({ region: REGION }, async (request) => {
  const { storeId, reason } = request.data || {};
  const role = await getStoreRole(storeId, request.auth);
  requireRole(role, ["owner", "manager"]);

  const orderedEntries = await getOrderedEntries(storeId);
  if (orderedEntries.length === 0) {
    return { ok: true, count: 0 };
  }

  const chunkSize = 200;
  for (let index = 0; index < orderedEntries.length; index += chunkSize) {
    const batch = db.batch();
    orderedEntries.slice(index, index + chunkSize).forEach((entry) => {
      batch.set(
        db.collection(`stores/${storeId}/history`).doc(),
        buildHistoryPayload(entry, entry.id, "closed", { closed_reason: reason || "Store closed by admin" })
      );
      batch.delete(db.doc(`stores/${storeId}/entries/${entry.id}`));
    });
    await batch.commit();
  }

  // FIX C3: Use FieldValue.increment to avoid overwriting concurrent joins that arrived
  // between the batch commits and the meta reset. Decrement by the exact count we cleared.
  const metaDecrement = {
    live_party_count: admin.firestore.FieldValue.increment(-orderedEntries.length),
    live_member_count: admin.firestore.FieldValue.increment(
      -orderedEntries.reduce((sum, entry) => sum + projectionGetEntryWeight(entry), 0)
    ),
    last_active: admin.firestore.FieldValue.serverTimestamp(),
  };
  await Promise.all([
    metaRef(storeId).set(metaDecrement, { merge: true }),
    storeRef(storeId).set(metaDecrement, { merge: true }),
    projectionPublicStoreRef(storeId).set(projectionBuildPublicStorePayload(storeId, {
      live_party_count: 0,
      live_member_count: 0,
    }), { merge: true }),
  ]);

  await logAuditAction(storeId, "queue_cleared", { reason: reason || "Store closed by admin", count: orderedEntries.length });
  return { ok: true, count: orderedEntries.length };
});

function getLocalTimeParts(date, timezone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone || DEFAULT_TIMEZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const read = (type) => parts.find((part) => part.type === type)?.value || "";
  return {
    weekday: read("weekday").toLowerCase().slice(0, 3),
    hour: Number(read("hour")),
    minute: Number(read("minute")),
  };
}

function toMinutes(value) {
  const [hours, minutes] = String(value || "").split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }
  return hours * 60 + minutes;
}

exports.syncStoreSchedules = onSchedule({ region: REGION, schedule: "every 5 minutes" }, async () => {
  const storesSnap = await db.collection("stores").where("schedule_enabled", "==", true).get();
  const now = new Date();
  const writes = [];

  storesSnap.forEach((storeDoc) => {
    const store = storeDoc.data();
    if (store.holiday_mode) {
      return;
    }

    const timezone = store.timezone || DEFAULT_TIMEZONE;
    const { weekday, hour, minute } = getLocalTimeParts(now, timezone);
    const schedule = store.schedule?.[weekday];
    const openMinutes = toMinutes(schedule?.open);
    const closeMinutes = toMinutes(schedule?.close);
    const currentMinutes = hour * 60 + minute;
    const shouldBeOpen = Boolean(schedule?.enabled) && openMinutes !== null && closeMinutes !== null && currentMinutes >= openMinutes && currentMinutes < closeMinutes;

    if (store.is_open !== shouldBeOpen) {
      writes.push(
        storeDoc.ref.set({ is_open: shouldBeOpen }, { merge: true }),
        db.doc(`stores/${storeDoc.id}/meta/info`).set({ is_open: shouldBeOpen }, { merge: true })
      );
    }
  });

  await Promise.all(writes);
});

exports.cleanupStaleEntries = onSchedule({ region: REGION, schedule: "every 30 minutes" }, async () => {
  const storesSnap = await db.collection("stores").get();
  const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - 6 * 60 * 60 * 1000);

  for (const storeDoc of storesSnap.docs) {
    const staleSnap = await db.collection(`stores/${storeDoc.id}/entries`).where("last_active", "<", cutoff).limit(100).get();
    if (staleSnap.empty) {
      continue;
    }

    const batch = db.batch();
    staleSnap.docs.forEach((entryDoc) => {
      batch.set(db.collection(`stores/${storeDoc.id}/history`).doc(), buildHistoryPayload(entryDoc.data(), entryDoc.id, "stale"));
      batch.delete(entryDoc.ref);
    });
    await batch.commit();
    await logAuditAction(storeDoc.id, "stale_cleanup", { count: staleSnap.size });
  }
});

const { onDocumentWritten: onProjectionDocumentWritten } = require("firebase-functions/v2/firestore");
const PROJECTION_AVG_SERVICE_MINS = 3;
const PROJECTION_DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function projectionPublicStoreRef(storeId) {
  return db.doc(`publicStores/${storeId}`);
}

function projectionPublicQueueRef(storeId, entryId) {
  return db.doc(`publicStores/${storeId}/liveQueue/${entryId}`);
}

function storeRef(storeId) {
  return db.doc(`stores/${storeId}`);
}

function metaRef(storeId) {
  return db.doc(`stores/${storeId}/meta/info`);
}

function entryRef(storeId, entryId) {
  return db.doc(`stores/${storeId}/entries/${entryId}`);
}

function projectionNormalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function projectionCreateDefaultSchedule() {
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

function projectionNormalizeTime(value, fallback) {
  return typeof value === "string" && /^\d{2}:\d{2}$/.test(value) ? value : fallback;
}

function projectionSanitizeSchedule(schedule) {
  const fallback = projectionCreateDefaultSchedule();

  return PROJECTION_DAY_KEYS.reduce((acc, key) => {
    const raw = schedule?.[key];
    acc[key] = {
      enabled: raw?.enabled ?? fallback[key].enabled,
      open: projectionNormalizeTime(raw?.open, fallback[key].open),
      close: projectionNormalizeTime(raw?.close, fallback[key].close),
    };
    return acc;
  }, {});
}

function projectionBuildPublicStorePayload(storeId, data = {}) {
  return {
    store_id: storeId,
    store_name: data.store_name || "",
    slug: data.slug || storeId,
    category: data.category || "",
    location: data.location || "",
    announcement: data.announcement || "",
    closed_reason: data.closed_reason || "",
    holiday_mode: Boolean(data.holiday_mode),
    holiday_reason: data.holiday_reason || "",
    is_open: data.is_open === true,
    queue_paused: Boolean(data.queue_paused),
    paused_reason: data.paused_reason || "",
    join_disabled: Boolean(data.join_disabled),
    join_disabled_reason: data.join_disabled_reason || "",
    max_queue_size: Math.max(0, Number(data.max_queue_size ?? 0) || 0),
    fast_pass_price: Math.max(0, Number(data.fast_pass_price ?? 0) || 0),
    store_logo: data.store_logo || "storefront",
    cover_image_url: data.cover_image_url || "",
    brand_primary: data.brand_primary || "#7C3AED",
    brand_secondary: data.brand_secondary || "#22D3EE",
    timezone: data.timezone || DEFAULT_TIMEZONE,
    schedule_enabled: Boolean(data.schedule_enabled),
    schedule: projectionSanitizeSchedule(data.schedule),
    avg_service_mins: Math.max(1, Number(data.avg_service_mins ?? PROJECTION_AVG_SERVICE_MINS) || PROJECTION_AVG_SERVICE_MINS),
    live_party_count: Math.max(0, Number(data.live_party_count ?? 0) || 0),
    live_member_count: Math.max(0, Number(data.live_member_count ?? 0) || 0),
    // Phase 3: Ghost Score (0–100 trust/accuracy composite)
    ghost_score: Math.min(100, Math.max(0, Number(data.ghost_score ?? 0) || 0)),
    // Phase 3: current broadcast message for waiting customers
    current_broadcast: data.current_broadcast || null,
    // Phase 3: virtual lobby CMS content
    lobby_content: data.lobby_content || null,
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  };
}


function projectionBuildPublicQueuePayload(entry = {}) {
  return {
    queue_index: Number(entry.queue_index ?? 0),
    member_count: Math.max(1, Number(entry.member_count ?? 1) || 1),
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  };
}

function projectionGenerateSlug(name) {
  return String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function projectionGetEntryWeight(entry) {
  return Math.max(1, Number(entry?.member_count ?? 1) || 1);
}

function projectionGetAverageServiceMinutes(historyEntries) {
  const servedEntries = historyEntries
    .filter((entry) => entry.history_type === "served" && entry.completed_at?.toDate)
    .map((entry) => ({ ...entry, completedAt: entry.completed_at.toDate() }))
    .sort((a, b) => a.completedAt - b.completedAt);

  if (servedEntries.length < 2) {
    return PROJECTION_AVG_SERVICE_MINS;
  }

  let totalMinutes = 0;
  let totalMembers = 0;

  for (let index = 1; index < servedEntries.length; index += 1) {
    const previous = servedEntries[index - 1];
    const current = servedEntries[index];
    const diffMinutes = Math.max(1, (current.completedAt - previous.completedAt) / 60000);
    totalMinutes += diffMinutes;
    totalMembers += projectionGetEntryWeight(previous);
  }

  if (!totalMembers) {
    return PROJECTION_AVG_SERVICE_MINS;
  }

  return Math.min(8, Math.max(1, Number((totalMinutes / totalMembers).toFixed(1))));
}

function projectionQueueJoinBlockedReason(meta = {}) {
  if (!meta || meta.is_open === false || meta.holiday_mode) return "STORE_CLOSED";
  if (meta.queue_paused) return "QUEUE_PAUSED";
  if (meta.join_disabled) return "QUEUE_DISABLED";
  const maxQueueSize = Number(meta.max_queue_size ?? 0);
  const liveCount = Number(meta.live_party_count ?? 0);
  if (maxQueueSize > 0 && liveCount >= maxQueueSize) return "QUEUE_FULL";
  return null;
}

function projectionSanitizeStoreSettings(updates = {}) {
  const normalized = {};
  if ("announcement" in updates) normalized.announcement = String(updates.announcement || "").trim().slice(0, 240);
  if ("closed_reason" in updates) normalized.closed_reason = String(updates.closed_reason || "").trim().slice(0, 160);
  if ("holiday_mode" in updates) normalized.holiday_mode = Boolean(updates.holiday_mode);
  if ("holiday_reason" in updates) normalized.holiday_reason = String(updates.holiday_reason || "").trim().slice(0, 160);
  if ("queue_paused" in updates) normalized.queue_paused = Boolean(updates.queue_paused);
  if ("paused_reason" in updates) normalized.paused_reason = String(updates.paused_reason || "").trim().slice(0, 160);
  if ("join_disabled" in updates) normalized.join_disabled = Boolean(updates.join_disabled);
  if ("join_disabled_reason" in updates) normalized.join_disabled_reason = String(updates.join_disabled_reason || "").trim().slice(0, 160);
  if ("max_queue_size" in updates) normalized.max_queue_size = Math.max(0, Number(updates.max_queue_size) || 0);
  if ("fast_pass_price" in updates) normalized.fast_pass_price = Math.max(0, Number(updates.fast_pass_price) || 0);
  if ("store_logo" in updates) normalized.store_logo = String(updates.store_logo || "storefront").trim().slice(0, 60) || "storefront";
  if ("cover_image_url" in updates) normalized.cover_image_url = String(updates.cover_image_url || "").trim().slice(0, 400);
  if ("brand_primary" in updates) normalized.brand_primary = String(updates.brand_primary || "#7C3AED").trim().slice(0, 20) || "#7C3AED";
  if ("brand_secondary" in updates) normalized.brand_secondary = String(updates.brand_secondary || "#22D3EE").trim().slice(0, 20) || "#22D3EE";
  if ("timezone" in updates) normalized.timezone = String(updates.timezone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
  if ("schedule_enabled" in updates) normalized.schedule_enabled = Boolean(updates.schedule_enabled);
  if ("schedule" in updates) normalized.schedule = projectionSanitizeSchedule(updates.schedule);
  if (normalized.holiday_mode) normalized.is_open = false;
  return normalized;
}

function projectionSanitizeOperationalState(updates = {}) {
  const normalized = {};
  if ("is_open" in updates) normalized.is_open = Boolean(updates.is_open);
  if ("queue_paused" in updates) normalized.queue_paused = Boolean(updates.queue_paused);
  if ("paused_reason" in updates) normalized.paused_reason = String(updates.paused_reason || "").trim().slice(0, 160);
  if ("join_disabled" in updates) normalized.join_disabled = Boolean(updates.join_disabled);
  if ("join_disabled_reason" in updates) normalized.join_disabled_reason = String(updates.join_disabled_reason || "").trim().slice(0, 160);
  if ("max_queue_size" in updates) normalized.max_queue_size = Math.max(0, Number(updates.max_queue_size) || 0);
  if ("closed_reason" in updates) normalized.closed_reason = String(updates.closed_reason || "").trim().slice(0, 160);
  return normalized;
}

exports.syncPublicStoreProjection = onProjectionDocumentWritten({ region: REGION, document: "stores/{storeId}/meta/info" }, async (event) => {
  const { storeId } = event.params;
  const after = event.data?.after;

  if (!after?.exists) {
    await projectionPublicStoreRef(storeId).delete().catch(() => {});
    return;
  }

  const storeSnap = await storeRef(storeId).get();
  const merged = {
    ...(storeSnap.exists ? storeSnap.data() : {}),
    ...after.data(),
  };

  await projectionPublicStoreRef(storeId).set(projectionBuildPublicStorePayload(storeId, merged), { merge: true });
});

exports.syncPublicQueueProjection = onProjectionDocumentWritten({ region: REGION, document: "stores/{storeId}/entries/{entryId}" }, async (event) => {
  const { storeId, entryId } = event.params;
  const after = event.data?.after;

  if (!after?.exists) {
    await projectionPublicQueueRef(storeId, entryId).delete().catch(() => {});
    return;
  }

  await projectionPublicQueueRef(storeId, entryId).set(projectionBuildPublicQueuePayload(after.data()), { merge: true });
});

exports.refreshPublicAvgService = onProjectionDocumentWritten({ region: REGION, document: "stores/{storeId}/history/{historyId}" }, async (event) => {
  const { storeId } = event.params;

  // FIX H12: Only recalculate when a "served" entry is written to avoid write amplification.
  // clearQueueWithHistory writes "closed" entries in bulk — without this guard the function
  // would fire N times and issue N concurrent reads+writes of 40 history docs each.
  if (!event.data?.after?.exists) {
    return;
  }
  const historyType = event.data.after.data()?.history_type;
  if (historyType !== "served") {
    return;
  }

  const historySnap = await db.collection(`stores/${storeId}/history`).orderBy("completed_at", "desc").limit(40).get();
  const avgServiceMins = projectionGetAverageServiceMinutes(historySnap.docs.map((docSnap) => docSnap.data()));

  await Promise.all([
    metaRef(storeId).set({ avg_service_mins: avgServiceMins }, { merge: true }),
    storeRef(storeId).set({ avg_service_mins: avgServiceMins }, { merge: true }),
    projectionPublicStoreRef(storeId).set(projectionBuildPublicStorePayload(storeId, { avg_service_mins: avgServiceMins }), { merge: true }),
  ]);
});

exports.registerStoreOwner = onCall({ region: REGION }, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to register a store.");
  }

  const storeName = String(request.data?.storeName || "").trim();
  const category = String(request.data?.category || "").trim() || "Restaurant";
  const location = String(request.data?.location || "").trim();
  const timezone = String(request.data?.timezone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;

  if (!storeName) throw new HttpsError("invalid-argument", "Store name is required.");
  if (!location) throw new HttpsError("invalid-argument", "Location is required.");

  const baseSlug = projectionGenerateSlug(storeName) || "store";
  let storeId = baseSlug;
  let suffix = 1;
  while ((await storeRef(storeId).get()).exists) {
    storeId = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  const schedule = projectionCreateDefaultSchedule();
  const basePayload = {
    ownerId: request.auth.uid,
    slug: storeId,
    store_name: storeName,
    category,
    location,
    announcement: "",
    closed_reason: "",
    holiday_mode: false,
    holiday_reason: "",
    is_open: false,
    queue_paused: false,
    paused_reason: "",
    join_disabled: false,
    join_disabled_reason: "",
    max_queue_size: 0,
    fast_pass_price: 0,
    store_logo: "storefront",
    cover_image_url: "",
    brand_primary: "#7C3AED",
    brand_secondary: "#22D3EE",
    timezone,
    schedule_enabled: false,
    schedule,
    current_serving_index: 0,
    live_party_count: 0,
    live_member_count: 0,
    next_queue_index: 1,
    next_front_queue_index: 0,
    avg_service_mins: PROJECTION_AVG_SERVICE_MINS,
    last_active: admin.firestore.FieldValue.serverTimestamp(),
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
    created_at: admin.firestore.FieldValue.serverTimestamp(),
  };

  const batch = db.batch();
  batch.set(storeRef(storeId), basePayload);
  batch.set(metaRef(storeId), basePayload);
  batch.set(projectionPublicStoreRef(storeId), projectionBuildPublicStorePayload(storeId, basePayload));
  await batch.commit();

  return { ok: true, storeId };
});
exports.joinQueueCustomer = onCall({ region: REGION }, async (request) => {
  const { storeId, entry } = request.data || {};
  const userId = request.auth?.uid;
  if (!userId) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const normalized = sanitizeEntryInput(entry);

  return db.runTransaction(async (transaction) => {
    const metaSnap = await transaction.get(metaRef(storeId));
    const existingSnap = await transaction.get(entryRef(storeId, userId));

    if (!metaSnap.exists) throw new HttpsError("not-found", "Store not found.");
    if (existingSnap.exists) return { ok: true, alreadyJoined: true };

    const meta = metaSnap.data() || {};
    const blockedReason = projectionQueueJoinBlockedReason(meta);
    if (blockedReason) throw new HttpsError("failed-precondition", blockedReason);

    const queueIndex = Number(meta.next_queue_index ?? Date.now());
    const livePartyCount = Number(meta.live_party_count ?? 0) + 1;
    const liveMemberCount = Number(meta.live_member_count ?? 0) + normalized.member_count;
    const entryData = {
      ...normalized,
      queue_index: queueIndex,
      joined_at: admin.firestore.FieldValue.serverTimestamp(),
      last_active: admin.firestore.Timestamp.now(),
      skips_used: 0,
      fcm_token: null,
      source: "customer",
    };

    transaction.set(entryRef(storeId, userId), entryData);
    transaction.set(metaRef(storeId), {
      live_party_count: livePartyCount,
      live_member_count: liveMemberCount,
      next_queue_index: queueIndex + 1,
      last_active: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(storeRef(storeId), {
      live_party_count: livePartyCount,
      live_member_count: liveMemberCount,
      next_queue_index: queueIndex + 1,
      last_active: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(projectionPublicStoreRef(storeId), projectionBuildPublicStorePayload(storeId, {
      live_party_count: livePartyCount,
      live_member_count: liveMemberCount,
    }), { merge: true });

    return { ok: true };
  });
});
exports.leaveQueueCustomer = onCall({ region: REGION }, async (request) => {
  const { storeId } = request.data || {};
  const userId = request.auth?.uid;
  if (!userId) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  return db.runTransaction(async (transaction) => {
    const metaSnap = await transaction.get(metaRef(storeId));
    const queueEntrySnap = await transaction.get(entryRef(storeId, userId));
    if (!queueEntrySnap.exists) return { ok: true, missing: true };

    const meta = metaSnap.data() || {};
    const queueEntry = queueEntrySnap.data();
    const livePartyCount = Math.max(0, Number(meta.live_party_count ?? 0) - 1);
    const liveMemberCount = Math.max(0, Number(meta.live_member_count ?? 0) - projectionGetEntryWeight(queueEntry));
    const historyRef = db.collection(`stores/${storeId}/history`).doc();

    transaction.set(historyRef, buildHistoryPayload(queueEntry, userId, "left"));
    transaction.delete(queueEntrySnap.ref);
    transaction.set(metaRef(storeId), {
      live_party_count: livePartyCount,
      live_member_count: liveMemberCount,
      last_active: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(storeRef(storeId), {
      live_party_count: livePartyCount,
      live_member_count: liveMemberCount,
      last_active: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(projectionPublicStoreRef(storeId), projectionBuildPublicStorePayload(storeId, {
      live_party_count: livePartyCount,
      live_member_count: liveMemberCount,
    }), { merge: true });

    return { ok: true };
  });
});
exports.smartSkipCustomer = onCall({ region: REGION }, async (request) => {
  const { storeId } = request.data || {};
  const userId = request.auth?.uid;
  if (!userId) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  return db.runTransaction(async (transaction) => {
    const myRef = entryRef(storeId, userId);
    const mySnap = await transaction.get(myRef);
    if (!mySnap.exists) throw new HttpsError("failed-precondition", "USER_NOT_IN_QUEUE");

    const myData = mySnap.data();
    if ((myData.skips_used || 0) >= 2) throw new HttpsError("failed-precondition", "MAX_SKIPS_REACHED");

    // FIX C2: Use transaction.get() for the next-entry query so the swap is fully atomic.
    const nextQuery = db.collection(`stores/${storeId}/entries`).where("queue_index", "==", myData.queue_index + 1).limit(1);
    const nextSnap = await transaction.get(nextQuery);
    if (nextSnap.empty) throw new HttpsError("failed-precondition", "ALREADY_LAST");

    const theirDoc = nextSnap.docs[0];
    const theirRef = theirDoc.ref;
    const theirIndex = theirDoc.data().queue_index;

    transaction.update(myRef, { queue_index: theirIndex, skips_used: (myData.skips_used || 0) + 1, updated_at: admin.firestore.FieldValue.serverTimestamp() });
    transaction.update(theirRef, { queue_index: myData.queue_index, updated_at: admin.firestore.FieldValue.serverTimestamp() });
    return { ok: true };
  });
});
exports.setStoreOperationalState = onCall({ region: REGION }, async (request) => {
  const { storeId, updates } = request.data || {};
  const role = await getStoreRole(storeId, request.auth);
  requireRole(role, ["owner", "manager"]);

  const normalized = projectionSanitizeOperationalState(updates);
  const batch = db.batch();
  batch.set(metaRef(storeId), normalized, { merge: true });
  batch.set(storeRef(storeId), normalized, { merge: true });
  await batch.commit();
  await logAuditAction(storeId, "store_operational_state", { keys: Object.keys(normalized) });
  return { ok: true };
});

exports.saveStoreSettingsOwner = onCall({ region: REGION }, async (request) => {
  const { storeId, updates } = request.data || {};
  const role = await getStoreRole(storeId, request.auth);
  requireRole(role, ["owner"]);

  const normalized = projectionSanitizeStoreSettings(updates);
  const batch = db.batch();
  batch.set(metaRef(storeId), normalized, { merge: true });
  batch.set(storeRef(storeId), normalized, { merge: true });
  await batch.commit();
  await logAuditAction(storeId, "settings_updated", { keys: Object.keys(normalized) });
  return { ok: true };
});
exports.saveStoreStaffMemberOwner = onCall({ region: REGION }, async (request) => {
  const { storeId, email, role } = request.data || {};
  const storeRole = await getStoreRole(storeId, request.auth);
  requireRole(storeRole, ["owner"]);

  const normalizedEmail = projectionNormalizeEmail(email);
  if (!normalizedEmail) {
    throw new HttpsError("invalid-argument", "Email is required.");
  }

  await db.doc(`stores/${storeId}/staffByEmail/${normalizedEmail}`).set({
    email: normalizedEmail,
    role: role === "manager" ? "manager" : "staff",
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  await logAuditAction(storeId, "staff_member_saved", { target_entry_id: normalizedEmail });
  return { ok: true };
});

exports.removeStoreStaffMemberOwner = onCall({ region: REGION }, async (request) => {
  const { storeId, email } = request.data || {};
  const storeRole = await getStoreRole(storeId, request.auth);
  requireRole(storeRole, ["owner"]);

  const normalizedEmail = projectionNormalizeEmail(email);
  if (!normalizedEmail) {
    return { ok: true };
  }

  await db.doc(`stores/${storeId}/staffByEmail/${normalizedEmail}`).delete();
  await logAuditAction(storeId, "staff_member_removed", { target_entry_id: normalizedEmail });
  return { ok: true };
});


// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3: New Cloud Functions
// ─────────────────────────────────────────────────────────────────────────────

// O-2: Customer signals "I'm Running Late" — sets a flag on their queue entry.
exports.runningLateSignal = onCall({ region: REGION }, async (request) => {
  const { storeId } = request.data || {};
  const userId = request.auth?.uid;
  if (!userId) throw new HttpsError("unauthenticated", "You must be signed in.");

  const currentEntryRef = entryRef(storeId, userId);
  const snap = await currentEntryRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "You are not in this queue.");

  await currentEntryRef.set({
    running_late: true,
    running_late_at: admin.firestore.FieldValue.serverTimestamp(),
    last_active: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { ok: true };
});

// H-3: Emergency Override — staff injects a new entry at position #1 (emergency priority).
exports.emergencyAddEntry = onCall({ region: REGION }, async (request) => {
  const { storeId, entry } = request.data || {};
  const role = await getStoreRole(storeId, request.auth);
  requireRole(role, ["owner", "manager", "staff"]);

  const normalized = sanitizeEntryInput(entry);
  const newRef = db.collection(`stores/${storeId}/entries`).doc();

  await db.runTransaction(async (transaction) => {
    const metaSnap = await transaction.get(metaRef(storeId));
    if (!metaSnap.exists) throw new HttpsError("not-found", "Store not found.");

    const meta = metaSnap.data() || {};
    const emergencyIndex = Number(meta.next_front_queue_index ?? 0) - 100;
    const livePartyCount = Number(meta.live_party_count ?? 0) + 1;
    const liveMemberCount = Number(meta.live_member_count ?? 0) + normalized.member_count;

    transaction.set(newRef, {
      ...normalized,
      queue_index: emergencyIndex,
      joined_at: admin.firestore.FieldValue.serverTimestamp(),
      last_active: admin.firestore.Timestamp.now(),
      skips_used: 0,
      fcm_token: null,
      source: "emergency",
      is_emergency: true,
      created_by: request.auth.uid,
    });
    transaction.set(metaRef(storeId), {
      live_party_count: livePartyCount,
      live_member_count: liveMemberCount,
      next_front_queue_index: emergencyIndex,
      last_active: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(storeRef(storeId), {
      live_party_count: livePartyCount,
      live_member_count: liveMemberCount,
      last_active: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(projectionPublicStoreRef(storeId), projectionBuildPublicStorePayload(storeId, {
      live_party_count: livePartyCount,
      live_member_count: liveMemberCount,
    }), { merge: true });
  });

  await logAuditAction(storeId, "emergency_entry_added", { target_entry_id: newRef.id, display_name: normalized.display_name });
  return { ok: true, id: newRef.id };
});

// H-4: VIP Mode — staff marks an entry as VIP and moves them to the front silently.
exports.markEntryVIP = onCall({ region: REGION }, async (request) => {
  const { storeId, entryId } = request.data || {};
  const role = await getStoreRole(storeId, request.auth);
  requireRole(role, ["owner", "manager", "staff"]);

  await db.runTransaction(async (transaction) => {
    const currentMetaRef = metaRef(storeId);
    const currentEntryRef = entryRef(storeId, entryId);
    const [metaSnap, entrySnap] = await Promise.all([
      transaction.get(currentMetaRef),
      transaction.get(currentEntryRef),
    ]);

    if (!entrySnap.exists) throw new HttpsError("not-found", "Entry not found.");

    const meta = metaSnap.exists ? (metaSnap.data() || {}) : {};
    const vipIndex = Number(meta.next_front_queue_index ?? 0) - 1;

    transaction.set(currentEntryRef, {
      queue_index: vipIndex,
      is_vip: true,
      vip_granted_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(currentMetaRef, {
      next_front_queue_index: vipIndex,
      last_active: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(storeRef(storeId), {
      last_active: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  await logAuditAction(storeId, "entry_vip_granted", { target_entry_id: entryId });
  return { ok: true };
});

// O-4: Re-Serve Entry — admin places a called customer back at position #1 without penalty.
exports.reServeEntry = onCall({ region: REGION }, async (request) => {
  const { storeId, entryId } = request.data || {};
  const role = await getStoreRole(storeId, request.auth);
  requireRole(role, ["owner", "manager", "staff"]);

  await db.runTransaction(async (transaction) => {
    const currentMetaRef = metaRef(storeId);
    const currentEntryRef = entryRef(storeId, entryId);
    const [metaSnap, entrySnap] = await Promise.all([
      transaction.get(currentMetaRef),
      transaction.get(currentEntryRef),
    ]);

    if (!entrySnap.exists) throw new HttpsError("not-found", "Entry not found.");

    const meta = metaSnap.exists ? (metaSnap.data() || {}) : {};
    const reServeIndex = Number(meta.next_front_queue_index ?? 0) - 1;

    transaction.set(currentEntryRef, {
      queue_index: reServeIndex,
      re_served: true,
      re_served_at: admin.firestore.FieldValue.serverTimestamp(),
      recalled_at: null,
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(currentMetaRef, {
      next_front_queue_index: reServeIndex,
      last_active: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    transaction.set(storeRef(storeId), {
      last_active: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  await logAuditAction(storeId, "entry_re_served", { target_entry_id: entryId });
  return { ok: true };
});

// L-3: Send Broadcast — store sends a live message to all waiting customers.
exports.sendBroadcastMessage = onCall({ region: REGION }, async (request) => {
  const { storeId, message } = request.data || {};
  const role = await getStoreRole(storeId, request.auth);
  requireRole(role, ["owner", "manager"]);

  const sanitized = String(message || "").trim().slice(0, 280);
  if (!sanitized) throw new HttpsError("invalid-argument", "Broadcast message cannot be empty.");

  const broadcast = {
    message: sanitized,
    sent_at: admin.firestore.FieldValue.serverTimestamp(),
    sent_by: request.auth.uid,
    expires_at: admin.firestore.Timestamp.fromMillis(Date.now() + 30 * 60 * 1000),
  };

  await Promise.all([
    db.doc(`stores/${storeId}/meta/info`).set({ current_broadcast: broadcast }, { merge: true }),
    projectionPublicStoreRef(storeId).set({ current_broadcast: broadcast }, { merge: true }),
  ]);

  await logAuditAction(storeId, "broadcast_sent", { message: sanitized });
  return { ok: true };
});

// L-3: Clear Broadcast — removes the active broadcast message.
exports.clearBroadcast = onCall({ region: REGION }, async (request) => {
  const { storeId } = request.data || {};
  const role = await getStoreRole(storeId, request.auth);
  requireRole(role, ["owner", "manager"]);

  await Promise.all([
    db.doc(`stores/${storeId}/meta/info`).set({ current_broadcast: null }, { merge: true }),
    projectionPublicStoreRef(storeId).set({ current_broadcast: null }, { merge: true }),
  ]);

  return { ok: true };
});

// L-1: Save Virtual Lobby Content — store owner saves mini-CMS content for the waiting room.
exports.saveVirtualLobbyContent = onCall({ region: REGION }, async (request) => {
  const { storeId, lobby } = request.data || {};
  const role = await getStoreRole(storeId, request.auth);
  requireRole(role, ["owner", "manager"]);

  const sanitized = {
    headline: String(lobby?.headline || "").trim().slice(0, 80),
    subtext: String(lobby?.subtext || "").trim().slice(0, 200),
    promo_text: String(lobby?.promo_text || "").trim().slice(0, 120),
    cta_label: String(lobby?.cta_label || "").trim().slice(0, 40),
    cta_url: String(lobby?.cta_url || "").trim().slice(0, 300),
    show_menu_items: Boolean(lobby?.show_menu_items),
    menu_items: Array.isArray(lobby?.menu_items)
      ? lobby.menu_items.slice(0, 10).map((item) => ({
          name: String(item?.name || "").trim().slice(0, 60),
          price: String(item?.price || "").trim().slice(0, 20),
          description: String(item?.description || "").trim().slice(0, 100),
        }))
      : [],
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
  };

  await Promise.all([
    db.doc(`stores/${storeId}/meta/info`).set({ lobby_content: sanitized }, { merge: true }),
    projectionPublicStoreRef(storeId).set({ lobby_content: sanitized }, { merge: true }),
  ]);

  await logAuditAction(storeId, "lobby_content_updated", {});
  return { ok: true };
});

// R-1: Save Queue Snapshot — scheduled function saves queue state every 5 minutes.
// NOTE: Requires Blaze plan for scheduled execution. Use manualSaveQueueSnapshots on Spark.
exports.saveQueueSnapshots = onSchedule({ region: REGION, schedule: "every 5 minutes" }, async () => {
  await runSaveQueueSnapshots();
});

// Core logic extracted so it can be called from both schedule and manual trigger
async function runSaveQueueSnapshots() {
  const storesSnap = await db.collection("stores").where("is_open", "==", true).get();

  const saves = [];
  for (const storeDoc of storesSnap.docs) {
    const entriesSnap = await db.collection(`stores/${storeDoc.id}/entries`).orderBy("queue_index", "asc").limit(100).get();
    if (entriesSnap.empty) continue;

    const snapshot = {
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      entry_count: entriesSnap.size,
      entries: entriesSnap.docs.map((entryDoc) => ({
        id: entryDoc.id,
        queue_index: entryDoc.data().queue_index,
        display_name: entryDoc.data().display_name || "",
        member_count: entryDoc.data().member_count || 1,
        joined_at: entryDoc.data().joined_at || null,
      })),
    };

    saves.push(
      db.collection(`stores/${storeDoc.id}/snapshots`).add(snapshot).then(async () => {
        // Fix: Use timestamp cutoff instead of offset() — offset reads+bills every skipped doc
        const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - 35 * 60 * 1000); // keep ~6 snapshots at 5-min intervals
        const oldSnaps = await db.collection(`stores/${storeDoc.id}/snapshots`)
          .where("created_at", "<", cutoff)
          .get();
        if (!oldSnaps.empty) {
          const deleteBatch = db.batch();
          oldSnaps.docs.forEach((snapDoc) => deleteBatch.delete(snapDoc.ref));
          await deleteBatch.commit();
        }
      }).catch(() => {})
    );
  }

  await Promise.allSettled(saves);
}

// R-1: Rollback Queue Snapshot — restores queue from a saved snapshot.
exports.rollbackQueueSnapshot = onCall({ region: REGION }, async (request) => {
  const { storeId, snapshotId } = request.data || {};
  const role = await getStoreRole(storeId, request.auth);
  requireRole(role, ["owner", "manager"]);

  const snapDoc = await db.doc(`stores/${storeId}/snapshots/${snapshotId}`).get();
  if (!snapDoc.exists) throw new HttpsError("not-found", "Snapshot not found.");

  const snapshotData = snapDoc.data();
  const entries = snapshotData.entries || [];

  // Fix: Pause the queue before clearing to eliminate the race window where
  // customers between clearBatch and restoreBatch would see an empty queue (isServed=true).
  const metaDocRef = db.doc(`stores/${storeId}/meta/info`);
  await metaDocRef.set({ queue_paused: true, paused_reason: "Restoring snapshot..." }, { merge: true });

  try {
    const currentEntries = await db.collection(`stores/${storeId}/entries`).get();
    const clearBatch = db.batch();
    currentEntries.docs.forEach((d) => clearBatch.delete(d.ref));
    await clearBatch.commit();

    if (entries.length > 0) {
      const restoreBatch = db.batch();
      entries.forEach((entry) => {
        restoreBatch.set(db.doc(`stores/${storeId}/entries/${entry.id}`), {
          display_name: entry.display_name || "Restored Customer",
          member_count: entry.member_count || 1,
          queue_index: entry.queue_index,
          joined_at: entry.joined_at || admin.firestore.FieldValue.serverTimestamp(),
          last_active: admin.firestore.Timestamp.now(),
          skips_used: 0,
          fcm_token: null,
          source: "restored",
        });
      });
      await restoreBatch.commit();
    }
  } finally {
    // Always unpause even if restore partially fails
    await metaDocRef.set({ queue_paused: false, paused_reason: "" }, { merge: true });
  }

  const metaUpdate = {
    live_party_count: entries.length,
    live_member_count: entries.reduce((s, e) => s + (e.member_count || 1), 0),
    last_active: admin.firestore.FieldValue.serverTimestamp(),
  };
  await Promise.all([
    metaRef(storeId).set(metaUpdate, { merge: true }),
    storeRef(storeId).set(metaUpdate, { merge: true }),
    projectionPublicStoreRef(storeId).set(projectionBuildPublicStorePayload(storeId, metaUpdate), { merge: true }),
  ]);

  await logAuditAction(storeId, "queue_snapshot_restored", { snapshot_id: snapshotId, entry_count: entries.length });
  return { ok: true, restored: entries.length };
});

// D-2: Refresh Ghost Score — scheduled hourly calculation of each store's accuracy/trust score.
// NOTE: Requires Blaze plan for scheduled execution. Use manualRefreshGhostScore on Spark.
exports.refreshGhostScore = onSchedule({ region: REGION, schedule: "every 60 minutes" }, async () => {
  await runRefreshGhostScore();
});

// Core logic extracted for manual trigger reuse
async function runRefreshGhostScore() {
  // Fix: Only process stores active in last 7 days — prevents unbounded full-collection read
  const activityCutoff = admin.firestore.Timestamp.fromMillis(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const storesSnap = await db.collection("stores").where("last_active", ">=", activityCutoff).get();
  const updates = [];

  for (const storeDoc of storesSnap.docs) {
    const storeId = storeDoc.id;
    const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [servedSnap, recentSnap] = await Promise.all([
      db.collection(`stores/${storeId}/history`).where("history_type", "==", "served").orderBy("completed_at", "desc").limit(50).get(),
      db.collection(`stores/${storeId}/history`).where("completed_at", ">=", cutoff).get(),
    ]);

    if (servedSnap.size < 5) continue;

    const totalRecent = recentSnap.size;
    const noShows = recentSnap.docs.filter((d) => d.data().history_type === "no_show").length;
    const noShowRate = totalRecent > 0 ? noShows / totalRecent : 0;
    const noShowScore = Math.max(0, 100 - noShowRate * 200);

    const times = servedSnap.docs
      .map((d) => d.data().completed_at?.toMillis?.())
      .filter(Boolean)
      .sort((a, b) => a - b);

    let consistencyScore = 70;
    if (times.length >= 3) {
      const intervals = times.slice(1).map((t, i) => t - times[i]);
      const avg = intervals.reduce((s, v) => s + v, 0) / intervals.length;
      const variance = intervals.reduce((s, v) => s + (v - avg) ** 2, 0) / intervals.length;
      const stdDevMins = Math.sqrt(variance) / 60000;
      consistencyScore = Math.max(0, Math.min(100, 100 - stdDevMins * 5));
    }

    const volumeScore = Math.min(100, servedSnap.size * 2);
    const ghostScore = Math.round(noShowScore * 0.4 + consistencyScore * 0.35 + volumeScore * 0.25);

    updates.push(Promise.all([
      storeDoc.ref.set({ ghost_score: ghostScore }, { merge: true }),
      projectionPublicStoreRef(storeId).set({ ghost_score: ghostScore }, { merge: true }),
    ]).catch(() => {}));
  }

  await Promise.allSettled(updates);
}

// ============================================================
// SPARK PLAN MANUAL-TRIGGER SUBSTITUTES
// These onCall functions replicate the scheduled function logic.
// Call them from the admin panel maintenance buttons.
// On Blaze, the scheduled functions above run automatically.
// ============================================================

exports.manualSaveQueueSnapshots = onCall({ region: REGION }, async (request) => {
  const { storeId } = request.data || {};
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Sign in required.");
  const role = await getStoreRole(storeId, request.auth);
  requireRole(role, ["owner"]);
  await runSaveQueueSnapshots();
  return { ok: true };
});

exports.manualRefreshGhostScore = onCall({ region: REGION }, async (request) => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Sign in required.");
  // Only owners can trigger global score refresh — just verify they're authed
  await runRefreshGhostScore();
  return { ok: true };
});

exports.manualCleanupStaleEntries = onCall({ region: REGION }, async (request) => {
  const { storeId } = request.data || {};
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Sign in required.");
  const role = await getStoreRole(storeId, request.auth);
  requireRole(role, ["owner", "manager"]);

  // Re-use the cleanupStaleEntries logic for just this one store
  const STALE_THRESHOLD_MS = 45 * 60 * 1000; // 45 minutes
  const staleTime = admin.firestore.Timestamp.fromMillis(Date.now() - STALE_THRESHOLD_MS);
  const entriesSnap = await db.collection(`stores/${storeId}/entries`).where("last_active", "<", staleTime).get();

  if (entriesSnap.empty) return { ok: true, cleaned: 0 };

  const batch = db.batch();
  const historyBatch = db.batch();
  entriesSnap.docs.forEach((entryDoc) => {
    batch.delete(entryDoc.ref);
    const histRef = db.collection(`stores/${storeId}/history`).doc();
    historyBatch.set(histRef, {
      ...entryDoc.data(),
      history_type: "stale",
      completed_at: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  await batch.commit();
  await historyBatch.commit();

  const cleaned = entriesSnap.size;
  await logAuditAction(storeId, "stale_entries_cleaned", { cleaned_count: cleaned });
  return { ok: true, cleaned };
});

exports.manualSyncStoreSchedules = onCall({ region: REGION }, async (request) => {
  const { storeId } = request.data || {};
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Sign in required.");
  const role = await getStoreRole(storeId, request.auth);
  requireRole(role, ["owner"]);

  // Re-evaluate this store's schedule and open/close if needed
  const storeSnap = await db.doc(`stores/${storeId}`).get();
  if (!storeSnap.exists) throw new HttpsError("not-found", "Store not found.");

  const data = storeSnap.data();
  if (!data.schedule_enabled || !data.schedule) return { ok: true, changed: false };

  const tz = data.timezone || DEFAULT_TIMEZONE;
  const nowInTz = new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
  const dayKey = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][nowInTz.getDay()];
  const daySchedule = data.schedule[dayKey];

  if (!daySchedule?.enabled) {
    if (data.is_open) {
      await Promise.all([
        storeSnap.ref.set({ is_open: false }, { merge: true }),
        metaRef(storeId).set({ is_open: false }, { merge: true }),
      ]);
      await logAuditAction(storeId, "auto_closed_schedule", { day: dayKey });
      return { ok: true, changed: true, action: "closed" };
    }
    return { ok: true, changed: false };
  }

  const [openH, openM] = daySchedule.open.split(":").map(Number);
  const [closeH, closeM] = daySchedule.close.split(":").map(Number);
  const nowMins = nowInTz.getHours() * 60 + nowInTz.getMinutes();
  const openMins = openH * 60 + openM;
  const closeMins = closeH * 60 + closeM;
  const shouldBeOpen = nowMins >= openMins && nowMins < closeMins;

  if (shouldBeOpen !== data.is_open) {
    await Promise.all([
      storeSnap.ref.set({ is_open: shouldBeOpen }, { merge: true }),
      metaRef(storeId).set({ is_open: shouldBeOpen }, { merge: true }),
    ]);
    const action = shouldBeOpen ? "auto_opened_schedule" : "auto_closed_schedule";
    await logAuditAction(storeId, action, { day: dayKey });
    return { ok: true, changed: true, action: shouldBeOpen ? "opened" : "closed" };
  }

  return { ok: true, changed: false };
});
