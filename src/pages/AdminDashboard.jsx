import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { signOut } from "firebase/auth";
import { auth, db } from "../firebase";
import { useQueue } from "../hooks/useQueue";
import { useToast } from "../hooks/useToast";
import {
  addWalkInCustomer,
  callNext,
  clearQueueWithHistory,
  markNoShow,
  removeStoreStaffMember,
  saveStoreOperationalState,
  saveStoreSettings,
  saveStoreStaffMember,
  skipEntryForward,
  toggleStoreOpen,
  updateQueueEntry,
  addEmergencyEntry,
  markVIPEntry,
  reServeQueueEntry,
  sendBroadcast,
  clearStoreBroadcast,
} from "../utils/firestore";
import { collection, collectionGroup, getDocs, getDoc, doc, limit, onSnapshot, orderBy, query, startAfter, where } from "firebase/firestore";
import QRCode from "qrcode";

import AdminLogin from "./AdminLogin";
import ToastStack from "../components/ToastStack";
import ConfirmDialog from "../components/ConfirmDialog";
import { createDefaultSchedule, getEffectiveStoreStatus, normalizeSchedule } from "../utils/storeStatus";
import { computeQueueHealthScore, getHealthIcon, getHealthColor, getHealthBgColor } from "../utils/queueIntelligence";
import { playCallChime } from "../utils/soundEffects";

const HISTORY_WINDOWS = [1, 3, 7, 30];
const HISTORY_TYPES = ["all", "served", "left", "no_show", "closed", "stale"];
const DAYS = [["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"], ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"]];
const NOTE_TEMPLATES = ["wheelchair", "senior citizen", "takeaway", "table for 4", "call on arrival"];

function draftFromEntry(entry) {
  return {
    name: entry?.display_name || "",
    phone: entry?.phone_number || "",
    members: Number(entry?.member_count ?? 1),
    party_note: entry?.party_note || "",
    staff_note: entry?.staff_note || "",
    priority_level: Number(entry?.priority_level ?? 0),
    service_counter: entry?.service_counter || "",
    emergency_priority: false,
  };
}

function formatTime(timestamp) {
  return timestamp?.toDate ? timestamp.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--:--";
}

function formatDateLabel(timestamp) {
  const date = timestamp?.toDate ? timestamp.toDate() : new Date();
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (dayStart.getTime() === today.getTime()) return "Today";
  if (dayStart.getTime() === yesterday.getTime()) return "Yesterday";
  return date.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}

// FIX C6: Escape user-supplied strings before inserting into raw HTML to prevent XSS.
function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function downloadCsv(rows, storeId) {
  const csv = [
    ["Date", "Time", "Status", "Name", "Phone", "Members", "Counter", "Party Note", "Staff Note"],
    ...rows.map((row) => [
      row.completed_at?.toDate ? row.completed_at.toDate().toLocaleDateString() : "",
      formatTime(row.completed_at),
      row.history_type || "served",
      row.display_name || "",
      row.phone_number || "",
      row.member_count || "",
      row.service_counter || "",
      row.party_note || "",
      row.staff_note || "",
    ]),
  ]
    .map((line) => line.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ghost-queue-history-${storeId}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

async function downloadExcel(rows, storeId) {
  const data = rows.map((row) => ({
    Date: row.completed_at?.toDate ? row.completed_at.toDate().toLocaleDateString() : "",
    Time: formatTime(row.completed_at),
    Status: row.history_type || "served",
    Name: row.display_name || "",
    Phone: row.phone_number || "",
    Members: row.member_count || "",
    Counter: row.service_counter || "",
    "Party Note": row.party_note || "",
    "Staff Note": row.staff_note || "",
  }));
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(workbook, worksheet, "History");
  XLSX.writeFile(workbook, `ghost-queue-history-${storeId}.xlsx`);
}

async function findAccessibleStore(user) {
  if (!user?.uid) return { storeId: null, role: null };

  // Cache per-session to avoid repeated collectionGroup queries
  const cacheKey = `gq_store_access_${user.uid}`;
  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      // Validate the cached store still exists
      const snap = await getDoc(doc(db, "stores", parsed.storeId));
      if (snap.exists()) return parsed;
      sessionStorage.removeItem(cacheKey);
    }
  } catch {
    // sessionStorage unavailable or stale — fall through to live query
  }

  const ownedSnap = await getDocs(query(collection(db, "stores"), where("ownerId", "==", user.uid), limit(1)));
  if (!ownedSnap.empty) {
    const result = { storeId: ownedSnap.docs[0].id, role: "owner" };
    try { sessionStorage.setItem(cacheKey, JSON.stringify(result)); } catch { /* ignore */ }
    return result;
  }
  const email = String(user.email || "").toLowerCase();
  if (!email) return { storeId: null, role: null };
  const staffSnap = await getDocs(query(collectionGroup(db, "staffByEmail"), where("email", "==", email), limit(1)));
  if (staffSnap.empty) return { storeId: null, role: null };
  const staffDoc = staffSnap.docs[0];
  const result = { storeId: staffDoc.ref.parent.parent?.id || null, role: staffDoc.data().role || "staff" };
  try { sessionStorage.setItem(cacheKey, JSON.stringify(result)); } catch { /* ignore */ }
  return result;
}

export default function AdminDashboard({ adminUser }) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fetchingStore, setFetchingStore] = useState(true);
  const [storeId, setStoreId] = useState(null);
  const [accessRole, setAccessRole] = useState("owner");
  const [activeTab, setActiveTab] = useState("dashboard");
  const [historyData, setHistoryData] = useState([]);
  const [historyLastDoc, setHistoryLastDoc] = useState(null);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const HISTORY_PAGE_SIZE = 75;
  const [auditData, setAuditData] = useState([]);
  const [staffMembers, setStaffMembers] = useState([]);
  const [staffDraft, setStaffDraft] = useState({ email: "", role: "staff" });
  const [historyWindow, setHistoryWindow] = useState(3);
  const [historyType, setHistoryType] = useState("all");
  const [historySearch, setHistorySearch] = useState("");
  const [queueSearch, setQueueSearch] = useState("");
  const [customStart, setCustomStart] = useState(new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10));
  const [customEnd, setCustomEnd] = useState(new Date().toISOString().slice(0, 10));
  const [modalState, setModalState] = useState(null);
  const [confirmState, setConfirmState] = useState(null);
  const [draft, setDraft] = useState(draftFromEntry());
  const [draftBusy, setDraftBusy] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const { toasts, pushToast, dismissToast } = useToast(3400);
  const [settings, setSettings] = useState({
    fast_pass_price: 0,
    announcement: "",
    closed_reason: "",
    holiday_mode: false,
    holiday_reason: "",
    queue_paused: false,
    paused_reason: "",
    join_disabled: false,
    join_disabled_reason: "",
    max_queue_size: 0,
    store_logo: "storefront",
    cover_image_url: "",
    brand_primary: "#7C3AED",
    brand_secondary: "#22D3EE",
    timezone: "Asia/Kolkata",
    schedule_enabled: false,
    schedule: createDefaultSchedule(),
  });
  const canvasRef = useRef(null);

  const { entries, totalInQueue, storeMeta, avgServiceMins } = useQueue(storeId, null, true);
  const queueEntries = useMemo(() => [...entries].sort((a, b) => Number(a.queue_index ?? 0) - Number(b.queue_index ?? 0)), [entries]);
  const filteredQueueEntries = useMemo(() => {
    const search = queueSearch.trim().toLowerCase();
    if (!search) {
      return queueEntries;
    }

    return queueEntries.filter((entry) =>
      [entry.display_name, entry.phone_number, entry.party_note, entry.staff_note, entry.service_counter]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(search)
    );
  }, [queueEntries, queueSearch]);
  const storeStatus = getEffectiveStoreStatus(storeMeta);
  const storeName = storeMeta?.store_name ?? "Loading...";
  const ownerView = accessRole === "owner";
  const canManageStore = ownerView || accessRole === "manager";

  // Replace the local pushToast boilerplate — now handled by the shared useToast hook above.

  // FIX H1: adminUser is already resolved by App.jsx and passed as a prop.
  // The duplicate onAuthStateChanged here creates an unnecessary second Firebase listener.
  // We derive isAdmin directly from the prop instead.
  useEffect(() => {
    setIsAdmin(!!adminUser);
    setLoading(false);
  }, [adminUser]);

  useEffect(() => {
    const fetchStore = async () => {
      if (!adminUser) {
        setFetchingStore(false);
        return;
      }

      try {
        const result = await findAccessibleStore(adminUser);
        setStoreId(result.storeId);
        setAccessRole(result.role || "owner");
        setActiveTab((current) => (result.role && result.role !== "owner" && current === "settings" ? "dashboard" : current));
      } finally {
        setFetchingStore(false);
      }
    };

    fetchStore();
  }, [adminUser]);

  useEffect(() => {
    if (!storeMeta) return;
    setSettings({
      fast_pass_price: storeMeta.fast_pass_price ?? 0,
      announcement: storeMeta.announcement ?? "",
      closed_reason: storeMeta.closed_reason ?? "",
      holiday_mode: storeMeta.holiday_mode ?? false,
      holiday_reason: storeMeta.holiday_reason ?? "",
      queue_paused: storeMeta.queue_paused ?? false,
      paused_reason: storeMeta.paused_reason ?? "",
      join_disabled: storeMeta.join_disabled ?? false,
      join_disabled_reason: storeMeta.join_disabled_reason ?? "",
      max_queue_size: Number(storeMeta.max_queue_size ?? 0),
      store_logo: storeMeta.store_logo ?? "storefront",
      cover_image_url: storeMeta.cover_image_url ?? "",
      brand_primary: storeMeta.brand_primary ?? "#7C3AED",
      brand_secondary: storeMeta.brand_secondary ?? "#22D3EE",
      timezone: storeMeta.timezone ?? "Asia/Kolkata",
      schedule_enabled: storeMeta.schedule_enabled ?? false,
      schedule: normalizeSchedule(storeMeta.schedule),
    });
  }, [storeMeta]);

  // Item 9: History uses getDocs pagination instead of real-time onSnapshot (600 docs).
  // getDocs is correct here — history doesn't need millisecond freshness.
  const fetchHistory = useCallback(async (afterDoc = null) => {
    if (!storeId) return;
    if (afterDoc) setHistoryLoadingMore(true);
    try {
      const baseQuery = query(
        collection(db, "stores", storeId, "history"),
        orderBy("completed_at", "desc"),
        limit(HISTORY_PAGE_SIZE)
      );
      const snap = await getDocs(afterDoc ? query(baseQuery, startAfter(afterDoc)) : baseQuery);
      const newDocs = snap.docs.map((item) => ({ id: item.id, ...item.data() }));
      setHistoryData((prev) => afterDoc ? [...prev, ...newDocs] : newDocs);
      setHistoryLastDoc(snap.docs[snap.docs.length - 1] || null);
      setHistoryHasMore(snap.docs.length === HISTORY_PAGE_SIZE);
    } catch {
      // Silently ignore — history is non-critical
    } finally {
      setHistoryLoadingMore(false);
    }
  }, [storeId]);

  useEffect(() => {
    if (!storeId) return;

    const unsubAudit = onSnapshot(
      query(collection(db, "stores", storeId, "audit"), orderBy("created_at", "desc"), limit(60)),
      (snap) => setAuditData(snap.docs.map((item) => ({ id: item.id, ...item.data() }))
      ));

    let unsubStaff = () => {};
    if (ownerView) {
      unsubStaff = onSnapshot(collection(db, "stores", storeId, "staffByEmail"), (snap) => {
        const members = snap.docs
          .map((item) => ({ id: item.id, ...item.data() }))
          .sort((a, b) => String(a.email).localeCompare(String(b.email)));
        setStaffMembers(members);
      });
    } else {
      setStaffMembers([]);
    }

    // Initial history fetch
    fetchHistory();

    return () => {
      unsubAudit();
      unsubStaff();
    };
  }, [fetchHistory, ownerView, storeId]);

  useEffect(() => {
    if (activeTab === "dashboard" && canvasRef.current && storeId) {
      QRCode.toCanvas(canvasRef.current, `${window.location.origin}/q/${storeId}`, { width: 180, margin: 1 });
    }
  }, [activeTab, storeId]);

  const filteredHistory = useMemo(() => {
    const search = historySearch.trim().toLowerCase();
    return historyData.filter((item) => {
      const completed = item.completed_at?.toDate ? item.completed_at.toDate() : null;
      if (!completed) return false;

      if (historyWindow === "custom") {
        const start = new Date(`${customStart}T00:00:00`);
        const end = new Date(`${customEnd}T23:59:59`);
        if (completed < start || completed > end) return false;
      } else {
        const cutoff = new Date();
        cutoff.setHours(0, 0, 0, 0);
        cutoff.setDate(cutoff.getDate() - (Number(historyWindow) - 1));
        if (completed < cutoff) return false;
      }

      if (historyType !== "all" && item.history_type !== historyType) return false;
      if (!search) return true;
      return [item.display_name, item.phone_number, item.party_note, item.staff_note, item.history_type, item.service_counter].join(" ").toLowerCase().includes(search);
    });
  }, [customEnd, customStart, historyData, historySearch, historyType, historyWindow]);

  const stats = useMemo(() => {
    const served = filteredHistory.filter((item) => item.history_type === "served").length;
    const left = filteredHistory.filter((item) => item.history_type === "left").length;
    const noShow = filteredHistory.filter((item) => item.history_type === "no_show").length;
    const stale = filteredHistory.filter((item) => item.history_type === "stale").length;
    // Only count entries with both timestamps to avoid skewing the avg with no-shows/stale
    const timedItems = filteredHistory.filter((item) => item.joined_at?.toDate && item.completed_at?.toDate);
    const avgWait = timedItems.length
      ? Math.round(
          timedItems.reduce((sum, item) =>
            sum + Math.max(0, (item.completed_at.toDate() - item.joined_at.toDate()) / 60000), 0
          ) / timedItems.length
        )
      : 0;
    return { served, left, noShow, stale, avgWait };
  }, [filteredHistory]);

  const peakHours = useMemo(() => {
    // Cover 8am–10pm (15 hours) to capture evening peaks for restaurants & clinics
    const buckets = Array.from({ length: 15 }, (_, index) => ({ label: `${index + 8}:00`, count: 0 }));
    filteredHistory.forEach((item) => {
      const hour = item.completed_at?.toDate ? item.completed_at.toDate().getHours() : -1;
      if (hour >= 8 && hour <= 22) buckets[hour - 8].count += 1;
    });
    const max = Math.max(...buckets.map((bucket) => bucket.count), 1);
    return buckets.map((bucket) => ({ ...bucket, height: `${Math.max(12, Math.round((bucket.count / max) * 100))}%` }));
  }, [filteredHistory]);

  const busiestDays = useMemo(() => {
    const grouped = filteredHistory.reduce((acc, item) => {
      const key = item.completed_at?.toDate ? item.completed_at.toDate().toLocaleDateString() : "Unknown";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(grouped).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 4);
  }, [filteredHistory]);

  const historyGroups = useMemo(() => {
    const groups = [];
    filteredHistory.forEach((entry) => {
      const label = formatDateLabel(entry.completed_at);
      const existingGroup = groups.find((group) => group.label === label);
      if (existingGroup) {
        existingGroup.entries.push(entry);
      } else {
        groups.push({ label, entries: [entry] });
      }
    });

    return groups.map((group) => ({
      ...group,
      totals: {
        served: group.entries.filter((entry) => entry.history_type === "served").length,
        left: group.entries.filter((entry) => entry.history_type === "left").length,
        noShow: group.entries.filter((entry) => entry.history_type === "no_show").length,
      },
    }));
  }, [filteredHistory]);

  const topPartyNote = useMemo(() => {
    const counts = filteredHistory.reduce((acc, item) => {
      const note = String(item.party_note || "").trim().toLowerCase();
      if (!note) return acc;
      acc[note] = (acc[note] || 0) + 1;
      return acc;
    }, {});
    const [label, count] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || [];
    return label ? { label, count } : null;
  }, [filteredHistory]);

  const handleToggle = async () => {
    if (!storeId) return;
    if (storeStatus.isOpen && queueEntries.length > 0) {
      setConfirmState({
        title: "Close store?",
        message: `There are still ${queueEntries.length} active parties. You can clear them into history before closing, or close without clearing.`,
        confirmLabel: "Clear and close",
        cancelLabel: "Close only",
        tone: "danger",
        onConfirm: async () => {
          await clearQueueWithHistory(storeId, "Store closed by admin");
          await toggleStoreOpen(storeId, false);
          pushToast("Store closed and live queue moved to history.", "success");
          setConfirmState(null);
        },
        onCancel: async () => {
          await toggleStoreOpen(storeId, false);
          pushToast("Store closed.", "success");
          setConfirmState(null);
        },
      });
      return;
    }

    await toggleStoreOpen(storeId, !storeStatus.isOpen);
    pushToast(storeStatus.isOpen ? "Store closed." : "Store opened.", "success");
  };

  const handleDraftSubmit = async () => {
    if (!storeId || !modalState) return;
    setDraftBusy(true);
    try {
      const duplicate = queueEntries.find((entry) =>
        entry.phone_number === draft.phone && (!modalState.entry || entry.id !== modalState.entry.id)
      );

      if (duplicate) {
        throw new Error(`Phone number already exists in queue for ${duplicate.display_name || "another customer"}.`);
      }

      if (modalState.type === "create") {
         if (draft.emergency_priority) {
            await addEmergencyEntry(storeId, draft);
         } else {
            await addWalkInCustomer(storeId, draft, adminUser?.uid || "admin");
         }
      }
      if (modalState.type === "edit") await updateQueueEntry(storeId, modalState.entry.id, draft);
      setModalState(null);
      pushToast(modalState.type === "create" ? "Walk-in added." : "Entry updated.", "success");
    } catch (err) {
      pushToast(err.message || "Could not save this entry.", "error");
    } finally {
      setDraftBusy(false);
    }
  };

  const handleMarkVIP = async (entryId) => {
    if (!storeId) return;
    try {
      await markVIPEntry(storeId, entryId);
      pushToast("Entry marked as VIP. They will be served up next.", "success");
    } catch (error) {
      pushToast(error.message || "Could not mark entry as VIP.", "error");
    }
  };

  const handleReServeEntry = async (entryId) => {
    if (!storeId) return;
    try {
      await reServeQueueEntry(storeId, entryId);
      pushToast("Customer recalled for re-service.", "success");
    } catch (error) {
      pushToast(error.message || "Could not re-serve customer.", "error");
    }
  };

  const handleSendBroadcast = async (message) => {
    if (!storeId) return;
    try {
      await sendBroadcast(storeId, message);
      pushToast("Broadcast message sent.", "success");
    } catch (error) {
       pushToast(error.message || "Failed to send broadcast.", "error");
    }
  };

  const handleClearBroadcast = async () => {
    if (!storeId) return;
    try {
      await clearStoreBroadcast(storeId);
      pushToast("Broadcast cleared.", "success");
    } catch (error) {
       pushToast(error.message || "Failed to clear broadcast.", "error");
    }
  };

  const handleSaveSettings = async () => {
    if (!storeId) return;
    setSavingSettings(true);
    try {
      await saveStoreSettings(storeId, {
        fast_pass_price: Number(settings.fast_pass_price) || 0,
        announcement: settings.announcement,
        closed_reason: settings.closed_reason,
        holiday_mode: settings.holiday_mode,
        holiday_reason: settings.holiday_reason,
        queue_paused: settings.queue_paused,
        paused_reason: settings.paused_reason,
        join_disabled: settings.join_disabled,
        join_disabled_reason: settings.join_disabled_reason,
        max_queue_size: Math.max(0, Number(settings.max_queue_size) || 0),
        store_logo: settings.store_logo,
        cover_image_url: settings.cover_image_url,
        brand_primary: settings.brand_primary,
        brand_secondary: settings.brand_secondary,
        timezone: settings.timezone,
        schedule_enabled: settings.schedule_enabled,
        schedule: normalizeSchedule(settings.schedule),
      });
      pushToast("Settings saved.", "success");
    } catch (err) {
      pushToast(err.message || "Could not save settings.", "error");
    } finally {
      setSavingSettings(false);
    }
  };

  const handleAddStaffMember = async () => {
    if (!storeId || !staffDraft.email) return;
    try {
      await saveStoreStaffMember(storeId, staffDraft.email, staffDraft.role);
      setStaffDraft({ email: "", role: "staff" });
      pushToast("Team member added.", "success");
    } catch (err) {
      pushToast(err.message || "Could not add team member.", "error");
    }
  };

  const handleRestoreHistoryEntry = async (entry) => {
    if (!storeId) return;
    try {
      await addWalkInCustomer(storeId, {
        name: entry.display_name || "Guest",
        phone: entry.phone_number || "",
        members: entry.member_count || 1,
        party_note: entry.party_note || "",
        staff_note: entry.staff_note || "",
        priority_level: entry.priority_level || 0,
        service_counter: entry.service_counter || "",
      }, adminUser?.uid || "admin");
      pushToast(`${entry.display_name || "Guest"} was restored to the live queue.`, "success");
    } catch (error) {
      pushToast(error.message || "Could not restore this history entry.", "error");
    }
  };

  const handleQuickSetting = async (updates, successMessage) => {
    if (!storeId) return;
    try {
      await saveStoreOperationalState(storeId, updates);
      pushToast(successMessage, "success");
    } catch (error) {
      pushToast(error.message || "Could not update queue controls.", "error");
    }
  };

  const handleDownloadPoster = async () => {
    const url = `${window.location.origin}/q/${storeId}`;
    try {
      const qrDataUrl = await QRCode.toDataURL(url, { margin: 2, scale: 10 });
      const popup = window.open("", "_blank", "width=960,height=1200");
      if (!popup) {
        pushToast("Allow popups to print poster.", "error");
        return;
      }

      popup.document.write(`
        <html>
          <head>
            <title>${htmlEscape(storeName)} - Queue Poster</title>
            <style>
              @page { size: A4; margin: 0; }
              body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: white; color: black; text-align: center; margin: 0; padding: 40px; }
              .container { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; max-height: 1100px; border: 12px solid #7C3AED; border-radius: 40px; padding: 60px; box-sizing: border-box; }
              h1 { font-size: 80px; margin: 0 0 20px; color: #111; letter-spacing: -2px; }
              p.subtitle { font-size: 32px; color: #666; margin: 0 0 60px; font-weight: 500; }
              .qr-box { padding: 40px; background: white; border-radius: 24px; box-shadow: 0 20px 40px rgba(0,0,0,0.1); margin-bottom: 40px; }
              img { display: block; margin: 0 auto; width: 400px; height: 400px; }
              p.link { font-size: 24px; color: #7C3AED; font-family: monospace; font-weight: bold; background: #f3e8ff; padding: 12px 24px; border-radius: 12px; }
              p.footer { position: absolute; bottom: 60px; font-size: 16px; color: #999; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>${htmlEscape(storeName)}</h1>
              <p class="subtitle">Scan to join the live queue</p>
              <div class="qr-box">
                <img src="${qrDataUrl}" alt="QR Code" />
              </div>
              <p class="link">${url}</p>
              <p class="footer">Powered by Ghost Queue</p>
            </div>
          </body>
        </html>
      `);
      popup.document.close();
      
      // Wait for image to load before printing
      setTimeout(() => {
        popup.focus();
        popup.print();
      }, 500);

    } catch {
      pushToast("Could not generate poster.", "error");
    }
  };

  const handlePrintQueue = () => {
    const popup = window.open("", "_blank", "width=960,height=720");
    if (!popup) {
      pushToast("Allow popups to print queue sheets.", "error");
      return;
    }

    // FIX C6: All user-supplied values are HTML-escaped before interpolation.
    const rows = queueEntries.map((entry, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${htmlEscape(entry.display_name || "Guest")}</td>
        <td>${htmlEscape(entry.phone_number || "-")}</td>
        <td>${htmlEscape(entry.member_count || 1)}</td>
        <td>${htmlEscape(entry.service_counter || "-")}</td>
        <td>${htmlEscape(entry.party_note || "-")}</td>
      </tr>
    `).join("");

    popup.document.write(`
      <html>
        <head>
          <title>${htmlEscape(storeName)} Queue Sheet</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
            table { width: 100%; border-collapse: collapse; margin-top: 16px; }
            th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
            h1, p { margin: 0; }
            p { margin-top: 8px; color: #555; }
          </style>
        </head>
        <body>
          <h1>${htmlEscape(storeName)}</h1>
          <p>Live queue sheet • ${new Date().toLocaleString()}</p>
          <table>
            <thead>
              <tr><th>#</th><th>Name</th><th>Phone</th><th>Members</th><th>Counter</th><th>Note</th></tr>
            </thead>
            <tbody>${rows || '<tr><td colspan="6">Queue is empty.</td></tr>'}</tbody>
          </table>
        </body>
      </html>
    `);
    popup.document.close();
    popup.focus();
    popup.print();
  };

  const handlePrintSummary = () => {
    const popup = window.open("", "_blank", "width=960,height=720");
    if (!popup) {
      pushToast("Allow popups to print summary sheets.", "error");
      return;
    }

    // FIX C6: HTML-escape store name and user-generated group labels.
    const groupsMarkup = historyGroups.map((group) => `
      <section style="margin-top:24px">
        <h2>${htmlEscape(group.label)}</h2>
        <p>Served: ${group.totals.served} &bull; Left: ${group.totals.left} &bull; No-show: ${group.totals.noShow}</p>
      </section>
    `).join("");

    popup.document.write(`
      <html>
        <head>
          <title>${htmlEscape(storeName)} Daily Summary</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
            h1, h2, p { margin: 0; }
            h2 { margin-top: 18px; }
            p { margin-top: 8px; color: #555; }
          </style>
        </head>
        <body>
          <h1>${htmlEscape(storeName)}</h1>
          <p>Summary window &bull; ${historyWindow === "custom" ? `${htmlEscape(customStart)} to ${htmlEscape(customEnd)}` : `Last ${historyWindow} day(s)`}</p>
          <p>Served ${stats.served} &bull; Left ${stats.left} &bull; No-show ${stats.noShow} &bull; Avg wait ${stats.avgWait} min</p>
          ${groupsMarkup || "<p>No history in this range.</p>"}
        </body>
      </html>
    `);
    popup.document.close();
    popup.focus();
    popup.print();
  };

  const [soundEnabled, setSoundEnabled] = useState(() => {
    try {
      return localStorage.getItem("gq_sound_enabled") !== "false";
    } catch {
      return true;
    }
  });

  const toggleSound = () => {
    setSoundEnabled((prev) => {
      const next = !prev;
      try { localStorage.setItem("gq_sound_enabled", String(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const handleCallNext = useCallback(async () => {
    if (!storeId || queueEntries.length === 0) return;
    try {
      if (soundEnabled) playCallChime();
      await callNext(storeId);
      pushToast("Called next party in queue.", "success");
    } catch (err) {
      pushToast(err.message || "Could not call next customer.", "error");
    }
  }, [storeId, queueEntries.length, soundEnabled, pushToast]);

  const handleCallSpecific = (entry) => {
    if (soundEnabled) playCallChime();
    pushToast(`Alerted ${entry.display_name || "Guest"} for counter entry.`, "info");
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (
        e.code === "Space" &&
        e.target.tagName !== "INPUT" &&
        e.target.tagName !== "TEXTAREA" &&
        !modalState &&
        activeTab === "dashboard"
      ) {
        e.preventDefault();
        handleCallNext();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTab, modalState, handleCallNext]);

  if (loading || fetchingStore) {
    return (
      <div className="min-h-screen bg-[#07070a] text-white flex flex-col items-center justify-center p-6 font-body">
        <div className="relative mb-6">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-violet-600 to-cyan-500 p-0.5 animate-pulse">
            <div className="w-full h-full bg-[#0e0e14] rounded-[14px] flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-violet-400">admin_panel_settings</span>
            </div>
          </div>
        </div>
        <p className="text-sm font-semibold text-white tracking-wide">Syncing Store Cloud State...</p>
        <p className="text-xs text-white/40 mt-1 font-mono uppercase tracking-widest">Ghost Queue 2.0</p>
      </div>
    );
  }

  if (!isAdmin) return <AdminLogin />;

  if (!storeId) {
    return (
      <div className="min-h-screen bg-[#07070a] text-white flex items-center justify-center p-6 font-body">
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#0e0e14]/90 backdrop-blur-2xl p-8 text-center shadow-2xl relative">
          <div className="w-14 h-14 rounded-2xl bg-violet-500/10 border border-violet-500/20 mx-auto flex items-center justify-center mb-4">
            <span className="material-symbols-outlined text-2xl text-violet-400">store</span>
          </div>
          <h2 className="text-2xl font-headline font-bold text-white mb-2">No Store Assigned</h2>
          <p className="text-xs text-white/60 mb-6 leading-relaxed">
            {adminUser?.email
              ? `Account (${adminUser.email}) does not own or staff an active store queue yet.`
              : "No venue is currently associated with this login."}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={() => { window.location.href = "/register"; }}
              className="px-5 py-3 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-semibold text-xs uppercase tracking-wider shadow-lg shadow-violet-600/30 transition-all cursor-pointer"
            >
              Provision Store
            </button>
            <button
              onClick={() => signOut(auth)}
              className="px-5 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  const tabs = ownerView
    ? [
        { id: "dashboard", label: "Live Radar", icon: "radar" },
        { id: "history", label: "Queue History", icon: "history" },
        { id: "settings", label: "Settings", icon: "settings" },
        { id: "audit", label: "Audit Trail", icon: "security" },
      ]
    : [
        { id: "dashboard", label: "Live Radar", icon: "radar" },
        { id: "history", label: "Queue History", icon: "history" },
        { id: "audit", label: "Audit Trail", icon: "security" },
      ];

  const healthScore = computeQueueHealthScore({
    meta: storeMeta,
    entries: queueEntries,
    recentHistory: filteredHistory,
    targetMaxWaitMins: 20,
  });

  return (
    <div className="min-h-screen bg-[#07070a] text-white font-body selection:bg-violet-500/30 relative">
      {/* Background ambient lighting */}
      <div className="pointer-events-none fixed -top-40 left-1/4 w-[600px] h-[350px] bg-violet-600/10 blur-[140px] rounded-full" />
      <div className="pointer-events-none fixed bottom-10 right-10 w-[500px] h-[400px] bg-cyan-500/10 blur-[150px] rounded-full" />
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(#ffffff08_1px,transparent_1px)] [background-size:24px_24px] opacity-30" />

      {/* Top Floating Glass Header */}
      <header className="sticky top-0 z-40 bg-[#07070a]/85 backdrop-blur-xl border-b border-white/10 px-4 sm:px-6 py-3.5">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-4">
          
          {/* Store Brand & Role */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-violet-600 to-indigo-600 p-0.5 shadow-md flex items-center justify-center shrink-0">
              <div className="w-full h-full bg-[#0e0e14] rounded-[10px] flex items-center justify-center">
                <span className="material-symbols-outlined text-lg text-violet-400">
                  {storeMeta?.store_logo || "storefront"}
                </span>
              </div>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold font-headline text-white truncate">{storeName}</h1>
                <span className="px-2 py-0.5 rounded-full bg-violet-500/15 border border-violet-500/30 text-violet-300 text-[10px] font-mono uppercase tracking-wider">
                  {accessRole}
                </span>
              </div>
              <p className="text-[11px] text-white/50 truncate flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${storeStatus.isOpen ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
                <span>{storeStatus.label}</span>
                <span className="text-white/30">•</span>
                <span className="text-white/40">{storeMeta?.category || "Service Queue"}</span>
              </p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.04] border border-white/10 overflow-x-auto">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                    isActive
                      ? "bg-violet-600 text-white shadow-md shadow-violet-600/30"
                      : "text-white/60 hover:text-white hover:bg-white/5"
                  }`}
                >
                  <span className="material-symbols-outlined text-sm">{tab.icon}</span>
                  <span>{tab.label}</span>
                  {tab.id === "dashboard" && totalInQueue > 0 && (
                    <span className="px-1.5 py-0.2 rounded-full bg-white/20 text-white text-[10px] font-mono">
                      {totalInQueue}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Controls: Sound, Status Switch, TV Signage, Logout */}
          <div className="flex items-center gap-2 shrink-0">
            {/* Sound toggle */}
            <button
              onClick={toggleSound}
              className={`p-2 rounded-xl border text-xs transition-all flex items-center justify-center cursor-pointer ${
                soundEnabled
                  ? "bg-violet-500/15 border-violet-500/30 text-violet-300 hover:bg-violet-500/25"
                  : "bg-white/5 border-white/10 text-white/40 hover:text-white/70"
              }`}
              title={soundEnabled ? "Sound Chimes Active (Click to mute)" : "Chimes Muted (Click to enable)"}
            >
              <span className="material-symbols-outlined text-base">
                {soundEnabled ? "volume_up" : "volume_off"}
              </span>
            </button>

            {/* TV Signage Link */}
            <a
              href={`/signage/${storeId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white text-xs font-semibold transition-all"
              title="Open full-screen TV display for waiting room"
            >
              <span className="material-symbols-outlined text-sm">tv</span>
              <span className="hidden sm:inline">Signage</span>
            </a>

            {/* Open / Close store toggle */}
            <button
              onClick={handleToggle}
              disabled={!canManageStore}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl border text-xs font-semibold uppercase tracking-wider transition-all disabled:opacity-50 cursor-pointer ${
                storeStatus.isOpen
                  ? "bg-red-500/15 border-red-500/30 text-red-300 hover:bg-red-500/25"
                  : "bg-emerald-500/15 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25"
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${storeStatus.isOpen ? "bg-red-400" : "bg-emerald-400 animate-pulse"}`} />
              <span>{storeStatus.isOpen ? "Close Store" : "Open Store"}</span>
            </button>

            {/* Sign Out */}
            <button
              onClick={() => signOut(auth)}
              className="p-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/50 hover:text-white text-xs transition-all cursor-pointer"
              title="Sign Out"
            >
              <span className="material-symbols-outlined text-base">logout</span>
            </button>
          </div>

        </div>
      </header>

      {/* Main Content Area */}
      <main className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 relative z-10">
        
        {/* DASHBOARD TAB */}
        {activeTab === "dashboard" && (
          <div className="space-y-6">
            
            {/* Quick Action Top Bar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-4 rounded-2xl bg-[#0e0e14]/90 border border-white/10 shadow-lg">
              <div className="flex items-center gap-3">
                <button
                  onClick={handleCallNext}
                  disabled={queueEntries.length === 0}
                  className="flex-1 sm:flex-initial inline-flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-500 hover:opacity-95 text-white font-headline font-bold text-sm tracking-wide shadow-lg shadow-violet-600/30 transition-all active:scale-[0.98] disabled:opacity-40 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-lg">campaign</span>
                  <span>CALL NEXT CUSTOMER</span>
                  <span className="hidden md:inline-block px-1.5 py-0.5 rounded bg-black/30 text-[10px] font-mono text-white/80">
                    Space
                  </span>
                </button>

                {queueEntries.length > 0 && (
                  <div className="hidden lg:block text-xs text-white/60">
                    <span>Up next: </span>
                    <strong className="text-white font-semibold">{queueEntries[0]?.display_name || "Guest"}</strong>
                    <span className="text-white/40"> ({queueEntries[0]?.member_count || 1} pax)</span>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => { setDraft(draftFromEntry()); setModalState({ type: "create" }); }}
                  className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-semibold tracking-wide transition-all cursor-pointer"
                >
                  <span className="material-symbols-outlined text-sm text-cyan-400">person_add</span>
                  <span>Add Walk-In</span>
                </button>

                <button
                  onClick={handleDownloadPoster}
                  className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-semibold tracking-wide transition-all cursor-pointer"
                >
                  <span className="material-symbols-outlined text-sm text-violet-400">print</span>
                  <span>QR Poster</span>
                </button>

                <button
                  onClick={handlePrintQueue}
                  className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-semibold tracking-wide transition-all cursor-pointer"
                >
                  <span className="material-symbols-outlined text-sm text-emerald-400">description</span>
                  <span>Queue Sheet</span>
                </button>
              </div>
            </div>

            {/* 4 KPI Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-5 rounded-2xl bg-[#0e0e14]/90 border border-white/10 relative overflow-hidden group hover:border-violet-500/30 transition-colors">
                <div className="flex items-center justify-between text-xs text-white/50 uppercase tracking-wider font-mono">
                  <span>In Queue</span>
                  <span className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
                </div>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="text-3xl sm:text-4xl font-headline font-bold text-white">{totalInQueue}</span>
                  <span className="text-xs text-white/40 font-mono">
                    {Number(storeMeta?.max_queue_size ?? 0) > 0 ? `/ ${storeMeta.max_queue_size} cap` : "parties"}
                  </span>
                </div>
                <p className="text-[11px] text-white/40 mt-1">Real-time waiting parties</p>
              </div>

              <div className="p-5 rounded-2xl bg-[#0e0e14]/90 border border-white/10 relative overflow-hidden group hover:border-cyan-500/30 transition-colors">
                <div className="flex items-center justify-between text-xs text-white/50 uppercase tracking-wider font-mono">
                  <span>Live Pace</span>
                  <span className="material-symbols-outlined text-cyan-400 text-sm">speed</span>
                </div>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="text-3xl sm:text-4xl font-headline font-bold text-cyan-300">{avgServiceMins}m</span>
                  <span className="text-xs text-white/40 font-mono">/ party</span>
                </div>
                <p className="text-[11px] text-white/40 mt-1">Rolling service speed</p>
              </div>

              <div className="p-5 rounded-2xl bg-[#0e0e14]/90 border border-white/10 relative overflow-hidden group hover:border-emerald-500/30 transition-colors">
                <div className="flex items-center justify-between text-xs text-white/50 uppercase tracking-wider font-mono">
                  <span>Served Today</span>
                  <span className="material-symbols-outlined text-emerald-400 text-sm">check_circle</span>
                </div>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="text-3xl sm:text-4xl font-headline font-bold text-white">{stats.served}</span>
                  <span className="text-xs text-emerald-400 font-mono">completed</span>
                </div>
                <p className="text-[11px] text-white/40 mt-1">Customer turns serviced</p>
              </div>

              <div className="p-5 rounded-2xl bg-[#0e0e14]/90 border border-white/10 relative overflow-hidden group hover:border-amber-500/30 transition-colors">
                <div className="flex items-center justify-between text-xs text-white/50 uppercase tracking-wider font-mono">
                  <span>Health Score</span>
                  <span className={`material-symbols-outlined text-sm ${getHealthColor(healthScore.level)}`}>
                    {getHealthIcon(healthScore.level)}
                  </span>
                </div>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="text-3xl sm:text-4xl font-headline font-bold text-white">{healthScore.score}</span>
                  <span className="text-xs text-white/40 font-mono">/ 100</span>
                </div>
                <p className="text-[11px] text-white/40 mt-1">
                  {filteredHistory.length ? Math.round(((stats.left + stats.noShow + stats.stale) / filteredHistory.length) * 100) : 0}% dropout rate
                </p>
              </div>
            </div>

            {/* Operational Warning & Controls Banner */}
            {(storeMeta?.queue_paused || storeMeta?.join_disabled || Number(storeMeta?.max_queue_size ?? 0) > 0) && (
              <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/25 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-amber-400 text-xl">info</span>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      {storeMeta?.queue_paused && (
                        <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-bold uppercase tracking-wider">
                          Queue Paused
                        </span>
                      )}
                      {storeMeta?.join_disabled && (
                        <span className="px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 text-[10px] font-bold uppercase tracking-wider">
                          Joins Blocked
                        </span>
                      )}
                      {Number(storeMeta?.max_queue_size ?? 0) > 0 && (
                        <span className="px-2 py-0.5 rounded-full bg-white/10 text-white/80 text-[10px] font-bold uppercase tracking-wider">
                          Cap {totalInQueue}/{storeMeta.max_queue_size}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-amber-200/80 mt-1">
                      {storeMeta?.paused_reason || storeMeta?.join_disabled_reason || "Queue constraints active."}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => handleQuickSetting({ queue_paused: !storeMeta?.queue_paused }, storeMeta?.queue_paused ? "Queue resumed." : "Queue paused.")}
                    disabled={!canManageStore}
                    className="px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 text-xs font-semibold uppercase tracking-wider transition-all disabled:opacity-50 cursor-pointer"
                  >
                    {storeMeta?.queue_paused ? "Resume Queue" : "Pause Queue"}
                  </button>
                  <button
                    onClick={() => handleQuickSetting({ join_disabled: !storeMeta?.join_disabled }, storeMeta?.join_disabled ? "New joins enabled." : "New joins disabled.")}
                    disabled={!canManageStore}
                    className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold uppercase tracking-wider transition-all disabled:opacity-50 cursor-pointer"
                  >
                    {storeMeta?.join_disabled ? "Enable Joins" : "Disable Joins"}
                  </button>
                  <button
                    onClick={() => handleQuickSetting({ max_queue_size: totalInQueue + 5 }, `Capacity expanded to ${totalInQueue + 5}.`)}
                    disabled={!canManageStore}
                    className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold uppercase tracking-wider transition-all disabled:opacity-50 cursor-pointer"
                  >
                    Cap +5
                  </button>
                </div>
              </div>
            )}

            {/* Main 2-Column Section */}
            <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6 items-start">
              
              {/* Left Column: Live Queue List */}
              <div className="space-y-4">
                
                {/* Search & Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-headline font-bold text-white">Live Customer Queue</h2>
                    <span className="px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 text-xs font-mono font-bold">
                      {filteredQueueEntries.length} Active
                    </span>
                  </div>

                  <div className="relative w-full sm:w-72">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-white/40 text-sm">search</span>
                    <input
                      type="text"
                      value={queueSearch}
                      onChange={(e) => setQueueSearch(e.target.value)}
                      placeholder="Search name, phone, note, counter..."
                      className="w-full bg-[#12121c] border border-white/10 rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder:text-white/40 focus:border-violet-500 focus:outline-none transition-colors"
                    />
                    {queueSearch && (
                      <button
                        onClick={() => setQueueSearch("")}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white text-xs"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                {/* Queue Entry Cards */}
                {filteredQueueEntries.length === 0 ? (
                  <div className="p-12 rounded-3xl border border-dashed border-white/10 bg-[#0e0e14]/50 text-center">
                    <span className="material-symbols-outlined text-4xl text-white/20 mb-2">task_alt</span>
                    <h3 className="text-sm font-semibold text-white/80">Queue is Clear</h3>
                    <p className="text-xs text-white/40 mt-1 max-w-sm mx-auto">
                      {queueEntries.length === 0
                        ? "No parties currently waiting. Customers can scan the QR code to join or staff can log walk-ins."
                        : "No entries match your search query."}
                    </p>
                    {queueEntries.length === 0 && (
                      <button
                        onClick={() => { setDraft(draftFromEntry()); setModalState({ type: "create" }); }}
                        className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600/30 hover:bg-violet-600/50 border border-violet-500/30 text-violet-200 text-xs font-semibold transition-all cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-sm">person_add</span>
                        <span>Log First Walk-In</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredQueueEntries.map((entry, index) => {
                      const isNext = index === 0;
                      return (
                        <div
                          key={entry.id}
                          className={`p-4 rounded-2xl border transition-all ${
                            isNext
                              ? "bg-[#141422] border-violet-500/40 shadow-[0_0_30px_rgba(124,58,237,0.15)]"
                              : "bg-[#0e0e14]/90 border-white/10 hover:border-white/20"
                          }`}
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            
                            {/* Left details */}
                            <div className="flex items-start gap-3.5">
                              {/* Position badge */}
                              <div
                                className={`w-11 h-11 rounded-xl flex items-center justify-center font-headline font-bold text-sm shrink-0 ${
                                  isNext
                                    ? "bg-gradient-to-tr from-violet-600 to-cyan-500 text-white shadow-md shadow-violet-600/30"
                                    : "bg-white/5 border border-white/10 text-white/70"
                                }`}
                              >
                                #{String(index + 1).padStart(2, "0")}
                              </div>

                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <h4 className="font-bold text-sm text-white truncate">
                                    {entry.display_name || "Guest Customer"}
                                  </h4>

                                  {isNext && (
                                    <span className="px-2 py-0.5 rounded-full bg-violet-500/20 border border-violet-500/40 text-violet-300 text-[10px] font-bold uppercase tracking-wider">
                                      Next Up
                                    </span>
                                  )}

                                  {Number(entry.priority_level ?? 0) > 0 && (
                                    <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-bold uppercase tracking-wider">
                                      Priority
                                    </span>
                                  )}

                                  {entry.source === "walk_in" && (
                                    <span className="px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 text-[10px] font-bold uppercase tracking-wider">
                                      Walk-In
                                    </span>
                                  )}

                                  {entry.running_late && (
                                    <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                                      <span className="material-symbols-outlined text-xs">timer</span>
                                      Running Late
                                    </span>
                                  )}

                                  {entry.service_counter && (
                                    <span className="px-2 py-0.5 rounded-full bg-white/10 text-white/80 text-[10px] font-mono">
                                      Counter: {entry.service_counter}
                                    </span>
                                  )}
                                </div>

                                <div className="flex flex-wrap items-center gap-2 text-xs text-white/50 mt-1">
                                  <span>{entry.phone_number || "No phone"}</span>
                                  <span>•</span>
                                  <span>{entry.member_count || 1} guest{(entry.member_count || 1) > 1 ? "s" : ""}</span>
                                  <span>•</span>
                                  <span>Joined {formatTime(entry.joined_at)}</span>
                                </div>

                                {entry.party_note && (
                                  <p className="text-xs text-white/70 bg-white/[0.03] border border-white/5 rounded-lg px-2.5 py-1 mt-2">
                                    <span className="text-violet-400 font-semibold">Note: </span>
                                    {entry.party_note}
                                  </p>
                                )}

                                {entry.staff_note && (
                                  <p className="text-xs text-cyan-300 bg-cyan-500/10 border border-cyan-500/20 rounded-lg px-2.5 py-1 mt-1">
                                    <span className="font-semibold">Staff note: </span>
                                    {entry.staff_note}
                                  </p>
                                )}
                              </div>
                            </div>

                            {/* Right Action Buttons */}
                            <div className="flex flex-wrap items-center gap-1.5 sm:self-center shrink-0">
                              <button
                                onClick={() => handleCallSpecific(entry)}
                                className="px-3 py-1.5 rounded-lg bg-violet-600/20 hover:bg-violet-600/40 border border-violet-500/30 text-violet-300 text-[11px] font-semibold uppercase tracking-wider transition-all flex items-center gap-1 cursor-pointer"
                                title="Play call chime"
                              >
                                <span className="material-symbols-outlined text-sm">volume_up</span>
                                <span>Call</span>
                              </button>

                              <button
                                onClick={() => handleMarkVIP(entry.id)}
                                className="px-2.5 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/25 border border-amber-500/20 text-amber-300 text-[11px] font-semibold uppercase tracking-wider transition-all cursor-pointer"
                                title="Promote to front VIP"
                              >
                                VIP
                              </button>

                              <button
                                onClick={() => handleReServeEntry(entry.id)}
                                className="px-2.5 py-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/25 border border-cyan-500/20 text-cyan-300 text-[11px] font-semibold uppercase tracking-wider transition-all cursor-pointer"
                                title="Recall customer for re-service"
                              >
                                Recall
                              </button>

                              <button
                                onClick={() => { setDraft(draftFromEntry(entry)); setModalState({ type: "edit", entry }); }}
                                className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white text-[11px] font-semibold uppercase tracking-wider transition-all cursor-pointer"
                                title="Edit party details"
                              >
                                Edit
                              </button>

                              <button
                                onClick={() => skipEntryForward(storeId, entry.id).then(() => pushToast("Moved back 1 spot.", "success")).catch((err) => pushToast(err.message, "error"))}
                                className="px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 hover:text-white text-[11px] font-semibold uppercase tracking-wider transition-all cursor-pointer"
                                title="Skip 1 position back"
                              >
                                Skip
                              </button>

                              <button
                                onClick={() => markNoShow(storeId, entry.id).then(() => pushToast("Marked as no-show.", "success")).catch((err) => pushToast(err.message, "error"))}
                                className="px-2.5 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-[11px] font-semibold uppercase tracking-wider transition-all cursor-pointer"
                                title="Mark as absent / no-show"
                              >
                                No-Show
                              </button>
                            </div>

                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Right Column: Operator Widgets */}
              <div className="space-y-6">
                
                {/* Queue Health Card */}
                <div className={`p-5 rounded-2xl border ${getHealthBgColor(healthScore.level)}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className={`material-symbols-outlined text-xl ${getHealthColor(healthScore.level)}`}>
                        {getHealthIcon(healthScore.level)}
                      </span>
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-white">Queue Health</h3>
                    </div>
                    <span className="text-lg font-headline font-bold text-white">{healthScore.score}/100</span>
                  </div>

                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {healthScore.factors.map((f, i) => (
                      <span
                        key={i}
                        className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                          f.severity === "critical"
                            ? "bg-red-500/10 border-red-500/30 text-red-300"
                            : f.severity === "warning"
                            ? "bg-amber-500/10 border-amber-500/30 text-amber-300"
                            : "bg-white/5 border-white/10 text-white/60"
                        }`}
                      >
                        {f.label}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Live Broadcast Card */}
                <div className="p-5 rounded-2xl bg-[#0e0e14]/90 border border-white/10 shadow-lg">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-amber-400 text-lg">campaign</span>
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-white">Broadcast Message</h3>
                    </div>
                    {storeMeta?.current_broadcast?.message && (
                      <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                    )}
                  </div>

                  {storeMeta?.current_broadcast?.message ? (
                    <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
                      <p className="text-xs text-amber-200 leading-relaxed">{storeMeta.current_broadcast.message}</p>
                      <button
                        onClick={handleClearBroadcast}
                        className="mt-3 w-full py-2 rounded-lg bg-white/5 hover:bg-white/10 text-red-400 text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer"
                      >
                        End Broadcast
                      </button>
                    </div>
                  ) : (
                    <div>
                      <textarea
                        id="broadcast-input"
                        rows={2}
                        placeholder="Message displayed to all waiting customers..."
                        className="w-full resize-none bg-[#12121c] border border-white/10 rounded-xl p-3 text-xs text-white placeholder:text-white/40 focus:border-violet-500 focus:outline-none transition-colors mb-2"
                      />
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {["5m sanitation break", "Calling counter 1 & 2", "Kitchen in rush hour"].map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => {
                              const el = document.getElementById("broadcast-input");
                              if (el) el.value = preset;
                            }}
                            className="px-2 py-0.5 rounded-md bg-white/5 hover:bg-white/10 text-[10px] text-white/50 hover:text-white transition-colors cursor-pointer"
                          >
                            + {preset}
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() => {
                          const el = document.getElementById("broadcast-input");
                          if (el?.value?.trim()) {
                            handleSendBroadcast(el.value.trim());
                            el.value = "";
                          }
                        }}
                        className="w-full py-2.5 rounded-xl bg-violet-600/20 hover:bg-violet-600/30 border border-violet-500/30 text-violet-300 text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer"
                      >
                        Send Broadcast Alert
                      </button>
                    </div>
                  )}
                </div>

                {/* QR Code & Poster Card */}
                <div className="p-5 rounded-2xl bg-[#0e0e14]/90 border border-white/10 text-center shadow-lg">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-white/60 mb-3">Store QR & Link</h3>
                  <div className="inline-block p-2 rounded-xl bg-white shadow-md">
                    <canvas ref={canvasRef} />
                  </div>
                  <p className="mt-3 text-[11px] font-mono text-white/40 break-all bg-white/[0.02] p-2 rounded-lg border border-white/5">
                    {window.location.host}/q/{storeId}
                  </p>
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    <button
                      type="button"
                      onClick={() => {
                        const url = `${window.location.origin}/q/${storeId}`;
                        if (navigator.clipboard?.writeText) {
                          navigator.clipboard.writeText(url).then(() => pushToast("Store URL copied!", "success"));
                        } else {
                          window.prompt("Store URL:", url);
                        }
                      }}
                      className="py-2 px-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-white/80 hover:text-white transition-all cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <span className="material-symbols-outlined text-sm">content_copy</span>
                      <span>Copy</span>
                    </button>
                    <button
                      onClick={handleDownloadPoster}
                      className="py-2 px-3 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:opacity-95 text-xs font-semibold text-white transition-all cursor-pointer flex items-center justify-center gap-1.5"
                    >
                      <span className="material-symbols-outlined text-sm">print</span>
                      <span>Print</span>
                    </button>
                  </div>
                </div>

                {/* Peak Hours Histogram */}
                <div className="p-5 rounded-2xl bg-[#0e0e14]/90 border border-white/10 shadow-lg">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-white">Peak Hours Radar</h3>
                    <span className="text-[10px] text-cyan-400 font-mono">Recent data</span>
                  </div>
                  <div className="flex items-end h-28 gap-1 border-b border-white/10 pb-2">
                    {peakHours.map((bucket) => (
                      <div key={bucket.label} className="flex-1 flex flex-col items-center gap-1.5">
                        <div
                          className={`w-full rounded-t-sm transition-all ${
                            bucket.count > 0 ? "bg-gradient-to-t from-violet-600 to-cyan-400" : "bg-white/5"
                          }`}
                          style={{ height: bucket.height }}
                          title={`${bucket.label}: ${bucket.count} visitors`}
                        />
                        <span className="text-[8px] font-mono text-white/30 truncate">{bucket.label.slice(0, 2)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Busiest Days */}
                <div className="p-5 rounded-2xl bg-[#0e0e14]/90 border border-white/10 shadow-lg">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-white mb-3">Busiest Days</h3>
                  <div className="space-y-2">
                    {busiestDays.length === 0 ? (
                      <p className="text-xs text-white/40">Gathering historical sessions...</p>
                    ) : (
                      busiestDays.map((item) => (
                        <div
                          key={item.label}
                          className="flex items-center justify-between p-2.5 rounded-xl bg-white/[0.03] border border-white/5 text-xs"
                        >
                          <span className="text-white/70">{item.label}</span>
                          <span className="font-bold text-white font-mono">{item.count} parties</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Common Party Note */}
                {topPartyNote && (
                  <div className="p-5 rounded-2xl bg-[#0e0e14]/90 border border-white/10 shadow-lg">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-white mb-2">Frequent Special Request</h3>
                    <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5">
                      <p className="text-xs font-bold text-violet-300 capitalize">{topPartyNote.label}</p>
                      <p className="text-[11px] text-white/40 mt-0.5">{topPartyNote.count} recent guest requests</p>
                    </div>
                  </div>
                )}

              </div>
            </div>

          </div>
        )}

        {/* HISTORY TAB */}
        {activeTab === "history" && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-headline font-bold text-white">Queue Historical Archives</h2>
                <p className="text-xs text-white/50 mt-1">Review past customer turnouts, dropout reasons, and export logs.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => downloadCsv(filteredHistory, storeId)}
                  className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-semibold tracking-wider uppercase transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-sm">download</span>
                  <span>Export CSV</span>
                </button>
                <button
                  onClick={() => downloadExcel(filteredHistory, storeId)}
                  className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-semibold tracking-wider uppercase transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-sm">table_view</span>
                  <span>Export Excel</span>
                </button>
                <button
                  onClick={handlePrintSummary}
                  className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white text-xs font-semibold tracking-wider uppercase transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-sm">print</span>
                  <span>Print Summary</span>
                </button>
              </div>
            </div>

            {/* Filter controls */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                placeholder="Search past guest, phone, note, counter..."
                className="bg-[#12121c] border border-white/10 rounded-xl px-4 py-3 text-xs text-white placeholder:text-white/40 focus:border-violet-500 focus:outline-none"
              />
              <select
                value={historyType}
                onChange={(e) => setHistoryType(e.target.value)}
                className="bg-[#12121c] border border-white/10 rounded-xl px-4 py-3 text-xs text-white focus:border-violet-500 focus:outline-none cursor-pointer"
              >
                {HISTORY_TYPES.map((t) => (
                  <option key={t} value={t} className="bg-[#12121c] text-white">
                    {t === "all" ? "All History Types" : t.replace("_", " ").toUpperCase()}
                  </option>
                ))}
              </select>
              <select
                value={historyWindow}
                onChange={(e) => setHistoryWindow(e.target.value === "custom" ? "custom" : Number(e.target.value))}
                className="bg-[#12121c] border border-white/10 rounded-xl px-4 py-3 text-xs text-white focus:border-violet-500 focus:outline-none cursor-pointer"
              >
                {HISTORY_WINDOWS.map((d) => (
                  <option key={d} value={d} className="bg-[#12121c] text-white">
                    Last {d} day{d > 1 ? "s" : ""}
                  </option>
                ))}
                <option value="custom" className="bg-[#12121c] text-white">Custom Date Range</option>
              </select>
            </div>

            {historyWindow === "custom" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 rounded-xl bg-white/[0.02] border border-white/10">
                <div>
                  <label className="text-[10px] text-white/50 uppercase font-mono mb-1 block">Start Date</label>
                  <input
                    type="date"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                    className="w-full bg-[#12121c] border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-white/50 uppercase font-mono mb-1 block">End Date</label>
                  <input
                    type="date"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    className="w-full bg-[#12121c] border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white"
                  />
                </div>
              </div>
            )}

            {/* History Results */}
            <div className="space-y-4">
              {historyGroups.length === 0 ? (
                <div className="p-12 rounded-3xl border border-dashed border-white/10 bg-[#0e0e14]/50 text-center">
                  <span className="material-symbols-outlined text-4xl text-white/20 mb-2">folder_open</span>
                  <p className="text-xs text-white/50">No history entries found matching this date range or filter.</p>
                </div>
              ) : (
                historyGroups.map((group) => (
                  <div key={group.label} className="space-y-3">
                    <div className="flex items-center justify-between px-4 py-2 rounded-xl bg-white/[0.03] border border-white/5">
                      <span className="text-xs font-mono font-bold uppercase tracking-wider text-violet-400">
                        {group.label}
                      </span>
                      <span className="text-[11px] text-white/40 font-mono">
                        Served {group.totals.served} • Left {group.totals.left} • No-show {group.totals.noShow}
                      </span>
                    </div>

                    <div className="space-y-2">
                      {group.entries.map((entry) => (
                        <div
                          key={entry.id}
                          className="p-3.5 rounded-xl bg-[#0e0e14]/80 border border-white/5 flex items-center justify-between gap-4"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-xs text-white">{entry.display_name || "Guest"}</span>
                              <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase ${
                                entry.history_type === "served"
                                  ? "bg-emerald-500/15 text-emerald-300"
                                  : entry.history_type === "no_show"
                                  ? "bg-red-500/15 text-red-300"
                                  : "bg-white/10 text-white/60"
                              }`}>
                                {(entry.history_type || "served").replace("_", " ")}
                              </span>
                              {entry.service_counter && (
                                <span className="text-[10px] text-white/40 font-mono">Counter: {entry.service_counter}</span>
                              )}
                            </div>
                            <p className="text-[11px] text-white/40 mt-0.5">
                              {entry.phone_number || "-"} • {entry.member_count || 1} pax • Completed {formatTime(entry.completed_at)}
                            </p>
                          </div>

                          <button
                            onClick={() => handleRestoreHistoryEntry(entry)}
                            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] text-white/70 hover:text-white transition-all cursor-pointer shrink-0"
                          >
                            Restore
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>

            {historyHasMore && (
              <div className="pt-4 text-center">
                <button
                  type="button"
                  onClick={() => fetchHistory(historyLastDoc)}
                  disabled={historyLoadingMore}
                  className="px-6 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold uppercase tracking-wider text-white transition-all disabled:opacity-50 cursor-pointer"
                >
                  {historyLoadingMore ? "Loading..." : "Load Older Archives"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* SETTINGS TAB */}
        {activeTab === "settings" && ownerView && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-headline font-bold text-white">Store Configuration & Rules</h2>
              <p className="text-xs text-white/50 mt-1">Branding, queue constraints, business schedules, and team delegation.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Branding & Visuals */}
              <div className="p-6 rounded-2xl bg-[#0e0e14]/90 border border-white/10 space-y-4">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-white">Branding & Identity</h3>
                
                <div>
                  <label className="text-[10px] text-white/50 uppercase font-mono block mb-1">Material Icon Name</label>
                  <input
                    value={settings.store_logo}
                    onChange={(e) => setSettings((prev) => ({ ...prev, store_logo: e.target.value }))}
                    placeholder="e.g. storefront, local_cafe, local_hospital"
                    className="w-full bg-[#12121c] border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:border-violet-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-[10px] text-white/50 uppercase font-mono block mb-1">Cover Image URL</label>
                  <input
                    value={settings.cover_image_url}
                    onChange={(e) => setSettings((prev) => ({ ...prev, cover_image_url: e.target.value }))}
                    placeholder="https://..."
                    className="w-full bg-[#12121c] border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:border-violet-500 focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] text-white/50 uppercase font-mono block mb-1">Primary Brand Color</label>
                    <input
                      type="color"
                      value={settings.brand_primary}
                      onChange={(e) => setSettings((prev) => ({ ...prev, brand_primary: e.target.value }))}
                      className="w-full h-10 rounded-xl bg-[#12121c] border border-white/10 p-1 cursor-pointer"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-white/50 uppercase font-mono block mb-1">Secondary Color</label>
                    <input
                      type="color"
                      value={settings.brand_secondary}
                      onChange={(e) => setSettings((prev) => ({ ...prev, brand_secondary: e.target.value }))}
                      className="w-full h-10 rounded-xl bg-[#12121c] border border-white/10 p-1 cursor-pointer"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] text-white/50 uppercase font-mono block mb-1">Customer Announcement Banner</label>
                  <textarea
                    rows={2}
                    value={settings.announcement}
                    onChange={(e) => setSettings((prev) => ({ ...prev, announcement: e.target.value }))}
                    placeholder="Message shown at top of customer pass..."
                    className="w-full resize-none bg-[#12121c] border border-white/10 rounded-xl p-3 text-xs text-white focus:border-violet-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Operational Rules */}
              <div className="p-6 rounded-2xl bg-[#0e0e14]/90 border border-white/10 space-y-4">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-white">Queue Operational Constraints</h3>

                <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5">
                  <div>
                    <span className="text-xs font-semibold text-white block">Holiday Mode</span>
                    <span className="text-[10px] text-white/40">Displays venue as temporarily closed</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.holiday_mode}
                    onChange={(e) => setSettings((prev) => ({ ...prev, holiday_mode: e.target.checked }))}
                    className="w-5 h-5 rounded accent-violet-600 cursor-pointer"
                  />
                </div>

                {settings.holiday_mode && (
                  <input
                    value={settings.holiday_reason}
                    onChange={(e) => setSettings((prev) => ({ ...prev, holiday_reason: e.target.value }))}
                    placeholder="Holiday reason (e.g. Renovation, National Holiday)"
                    className="w-full bg-[#12121c] border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:border-violet-500 focus:outline-none"
                  />
                )}

                <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5">
                  <div>
                    <span className="text-xs font-semibold text-white block">Pause Queue</span>
                    <span className="text-[10px] text-white/40">Prevents counter calling without clearing</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.queue_paused}
                    onChange={(e) => setSettings((prev) => ({ ...prev, queue_paused: e.target.checked }))}
                    className="w-5 h-5 rounded accent-violet-600 cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5">
                  <div>
                    <span className="text-xs font-semibold text-white block">Disable New Joins</span>
                    <span className="text-[10px] text-white/40">Stops QR scans from adding new tickets</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.join_disabled}
                    onChange={(e) => setSettings((prev) => ({ ...prev, join_disabled: e.target.checked }))}
                    className="w-5 h-5 rounded accent-violet-600 cursor-pointer"
                  />
                </div>

                <div>
                  <label className="text-[10px] text-white/50 uppercase font-mono block mb-1">Max Queue Size (0 = unlimited)</label>
                  <input
                    type="number"
                    min="0"
                    value={settings.max_queue_size}
                    onChange={(e) => setSettings((prev) => ({ ...prev, max_queue_size: e.target.value }))}
                    className="w-full bg-[#12121c] border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:border-violet-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-[10px] text-white/50 uppercase font-mono block mb-1">Operating Timezone</label>
                  <input
                    value={settings.timezone}
                    onChange={(e) => setSettings((prev) => ({ ...prev, timezone: e.target.value }))}
                    placeholder="Asia/Kolkata"
                    className="w-full bg-[#12121c] border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:border-violet-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Weekly Operating Schedule */}
            <div className="p-6 rounded-2xl bg-[#0e0e14]/90 border border-white/10 space-y-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-white">Weekly Operating Schedule</h3>
                <label className="flex items-center gap-2 text-xs text-white/60 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.schedule_enabled}
                    onChange={(e) => setSettings((prev) => ({ ...prev, schedule_enabled: e.target.checked }))}
                    className="rounded accent-violet-600"
                  />
                  <span>Enforce schedule auto open/close</span>
                </label>
              </div>

              <div className="grid grid-cols-1 gap-2">
                {DAYS.map(([key, label]) => (
                  <div
                    key={key}
                    className="p-3 rounded-xl bg-white/[0.02] border border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    <span className="w-28 font-medium text-white">{label}</span>
                    <label className="flex items-center gap-2 text-white/70">
                      <input
                        type="checkbox"
                        checked={settings.schedule[key]?.enabled}
                        onChange={(e) =>
                          setSettings((prev) => ({
                            ...prev,
                            schedule: {
                              ...prev.schedule,
                              [key]: { ...prev.schedule[key], enabled: e.target.checked },
                            },
                          }))
                        }
                        className="rounded accent-violet-600"
                      />
                      <span>Open</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="time"
                        value={settings.schedule[key]?.open || "09:00"}
                        onChange={(e) =>
                          setSettings((prev) => ({
                            ...prev,
                            schedule: {
                              ...prev.schedule,
                              [key]: { ...prev.schedule[key], open: e.target.value },
                            },
                          }))
                        }
                        className="bg-[#12121c] border border-white/10 rounded-lg px-2.5 py-1 text-xs text-white"
                      />
                      <span className="text-white/40">to</span>
                      <input
                        type="time"
                        value={settings.schedule[key]?.close || "22:00"}
                        onChange={(e) =>
                          setSettings((prev) => ({
                            ...prev,
                            schedule: {
                              ...prev.schedule,
                              [key]: { ...prev.schedule[key], close: e.target.value },
                            },
                          }))
                        }
                        className="bg-[#12121c] border border-white/10 rounded-lg px-2.5 py-1 text-xs text-white"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Team Access */}
            <div className="p-6 rounded-2xl bg-[#0e0e14]/90 border border-white/10 space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-white">Team Staff Access</h3>
              
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_150px_130px] gap-2">
                <input
                  type="email"
                  value={staffDraft.email}
                  onChange={(e) => setStaffDraft((prev) => ({ ...prev, email: e.target.value }))}
                  placeholder="colleague@store.com"
                  className="bg-[#12121c] border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white focus:border-violet-500 focus:outline-none"
                />
                <select
                  value={staffDraft.role}
                  onChange={(e) => setStaffDraft((prev) => ({ ...prev, role: e.target.value }))}
                  className="bg-[#12121c] border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white focus:border-violet-500 focus:outline-none cursor-pointer"
                >
                  <option value="manager">Manager</option>
                  <option value="staff">Staff Operator</option>
                </select>
                <button
                  type="button"
                  onClick={handleAddStaffMember}
                  className="px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-xs transition-all cursor-pointer"
                >
                  Add Member
                </button>
              </div>

              <div className="space-y-2 mt-3">
                {staffMembers.length === 0 ? (
                  <p className="text-xs text-white/40">No staff accounts invited yet.</p>
                ) : (
                  staffMembers.map((member) => (
                    <div
                      key={member.id}
                      className="p-3 rounded-xl bg-white/[0.03] border border-white/5 flex items-center justify-between text-xs"
                    >
                      <div>
                        <span className="font-semibold text-white block">{member.email}</span>
                        <span className="text-[10px] text-violet-400 font-mono uppercase">{member.role}</span>
                      </div>
                      <button
                        onClick={() => removeStoreStaffMember(storeId, member.email)}
                        className="px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs transition-colors cursor-pointer"
                      >
                        Revoke
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <button
              onClick={handleSaveSettings}
              disabled={savingSettings}
              className="w-full py-4 rounded-xl bg-gradient-to-r from-violet-600 via-indigo-600 to-cyan-500 hover:opacity-95 text-white font-headline font-bold text-sm tracking-wide shadow-lg shadow-violet-600/30 transition-all cursor-pointer disabled:opacity-50"
            >
              {savingSettings ? "Saving Changes..." : "Save Store Settings"}
            </button>
          </div>
        )}

        {/* AUDIT TAB */}
        {activeTab === "audit" && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-headline font-bold text-white">Immutable Security Audit Trail</h2>
              <p className="text-xs text-white/50 mt-1">Every queue action, status toggle, and settings update is cryptographically logged.</p>
            </div>

            {auditData.length === 0 ? (
              <div className="p-12 rounded-3xl border border-dashed border-white/10 bg-[#0e0e14]/50 text-center">
                <span className="material-symbols-outlined text-4xl text-white/20 mb-2">shield</span>
                <p className="text-xs text-white/50">No security events logged in this session.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {auditData.map((item) => (
                  <div
                    key={item.id}
                    className="p-3.5 rounded-xl bg-[#0e0e14]/80 border border-white/5 flex items-center justify-between gap-4 text-xs"
                  >
                    <div className="flex items-center gap-3">
                      <span className="w-2 h-2 rounded-full bg-cyan-400" />
                      <div>
                        <span className="font-semibold text-white capitalize">{item.action?.replace(/_/g, " ")}</span>
                        <p className="text-[11px] text-white/40 mt-0.5">
                          {item.display_name || item.target_entry_id || item.reason || "System operational event"}
                        </p>
                      </div>
                    </div>
                    <span className="text-[11px] font-mono text-white/40 shrink-0">
                      {formatTime(item.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </main>

      {/* Global Toast Stack */}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      {/* Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(confirmState)}
        title={confirmState?.title}
        message={confirmState?.message}
        confirmLabel={confirmState?.confirmLabel}
        cancelLabel={confirmState?.cancelLabel}
        tone={confirmState?.tone}
        onConfirm={confirmState?.onConfirm}
        onCancel={confirmState?.onCancel}
      />

      {/* Walk-In / Edit Entry Modal */}
      {modalState && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-3xl border border-white/15 bg-[#0e0e14] p-6 sm:p-7 shadow-2xl relative">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-headline font-bold text-white">
                {modalState.type === "create" ? "Add Walk-In Guest" : "Edit Queue Entry"}
              </h3>
              <button
                onClick={() => setModalState(null)}
                className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-white/60 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="text-[10px] text-white/50 uppercase font-mono block mb-1">Customer / Party Name</label>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g. Rahul Sharma"
                  className="w-full bg-[#14141e] border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder:text-white/30 focus:border-violet-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-white/50 uppercase font-mono block mb-1">Phone Number (10 digits)</label>
                  <input
                    value={draft.phone}
                    onChange={(e) => setDraft((prev) => ({ ...prev, phone: e.target.value.replace(/[^0-9]/g, "").slice(0, 10) }))}
                    placeholder="9876543210"
                    className="w-full bg-[#14141e] border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder:text-white/30 focus:border-violet-500 focus:outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-white/50 uppercase font-mono block mb-1">Party Size (Members)</label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={draft.members}
                    onChange={(e) => setDraft((prev) => ({ ...prev, members: Number(e.target.value) || 1 }))}
                    className="w-full bg-[#14141e] border border-white/10 rounded-xl px-4 py-2.5 text-white focus:border-violet-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-white/50 uppercase font-mono block mb-1">Staff Internal Note</label>
                  <input
                    value={draft.staff_note}
                    onChange={(e) => setDraft((prev) => ({ ...prev, staff_note: e.target.value }))}
                    placeholder="e.g. VIP guest, urgent"
                    className="w-full bg-[#14141e] border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder:text-white/30 focus:border-violet-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-white/50 uppercase font-mono block mb-1">Target Counter</label>
                  <input
                    value={draft.service_counter}
                    onChange={(e) => setDraft((prev) => ({ ...prev, service_counter: e.target.value.slice(0, 40) }))}
                    placeholder="Counter 1"
                    className="w-full bg-[#14141e] border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder:text-white/30 focus:border-violet-500 focus:outline-none"
                  />
                </div>
              </div>

              {modalState.type === "create" && (
                <label className="flex items-center gap-2.5 p-3 rounded-xl bg-red-500/10 border border-red-500/20 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.emergency_priority}
                    onChange={(e) => setDraft((prev) => ({ ...prev, emergency_priority: e.target.checked }))}
                    className="w-4 h-4 rounded accent-red-500 cursor-pointer"
                  />
                  <div>
                    <span className="font-semibold text-red-400 block">Emergency Front Insertion</span>
                    <span className="text-[10px] text-red-300/60">Inserts immediately at position #1 ahead of current queue</span>
                  </div>
                </label>
              )}

              <div>
                <label className="text-[10px] text-white/50 uppercase font-mono block mb-1">Customer Request / Party Note</label>
                <textarea
                  rows={2}
                  value={draft.party_note}
                  onChange={(e) => setDraft((prev) => ({ ...prev, party_note: e.target.value }))}
                  placeholder="e.g. Wheelchair access, corner booth..."
                  className="w-full resize-none bg-[#14141e] border border-white/10 rounded-xl p-3 text-white placeholder:text-white/30 focus:border-violet-500 focus:outline-none"
                />
              </div>

              {/* Note presets */}
              <div className="flex flex-wrap gap-1.5">
                {NOTE_TEMPLATES.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        party_note: prev.party_note ? `${prev.party_note}, ${n}`.slice(0, 120) : n,
                      }))
                    }
                    className="px-2 py-0.5 rounded-md bg-white/5 hover:bg-white/10 text-[10px] text-white/50 hover:text-white transition-colors cursor-pointer"
                  >
                    + {n}
                  </button>
                ))}
              </div>

              <button
                onClick={handleDraftSubmit}
                disabled={draftBusy}
                className="w-full mt-2 py-3.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-semibold text-xs uppercase tracking-wider shadow-lg shadow-violet-600/30 transition-all cursor-pointer disabled:opacity-50"
              >
                {draftBusy ? "Saving..." : modalState.type === "create" ? "Add to Queue" : "Update Entry"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
