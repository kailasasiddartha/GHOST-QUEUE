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

  const { entries, totalInQueue, storeMeta, avgServiceMins } = useQueue(storeId, null);
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

  if (loading || fetchingStore) return (
    <div className="min-h-screen bg-background text-on-background lg:flex">
      <aside className="w-full border-b border-white/5 bg-surface-container p-4 sm:p-6 lg:fixed lg:inset-y-0 lg:w-64 lg:border-b-0 lg:border-r">
        <div className="mb-8 animate-pulse">
          <div className="h-6 w-32 rounded-lg bg-white/10 mb-3" />
          <div className="h-3 w-24 rounded-lg bg-white/5" />
        </div>
        <div className="space-y-2 animate-pulse">
          {[1,2,3,4].map(i => <div key={i} className="h-12 rounded-xl bg-white/5" />)}
        </div>
      </aside>
      <main className="flex-1 p-4 sm:p-6 lg:ml-64 lg:p-8">
        <div className="mb-8 animate-pulse">
          <div className="h-8 w-40 rounded-lg bg-white/10 mb-2" />
          <div className="h-4 w-56 rounded-lg bg-white/5" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 animate-pulse">
          {[1,2,3,4].map(i => (
            <div key={i} className="rounded-2xl bg-surface-container-low/60 border border-white/5 p-5">
              <div className="h-3 w-16 rounded bg-white/10 mb-4" />
              <div className="h-8 w-12 rounded bg-white/10" />
            </div>
          ))}
        </div>
        <div className="mt-6 space-y-3 animate-pulse">
          {[1,2,3].map(i => (
            <div key={i} className="rounded-2xl border border-white/5 bg-surface-container-low/60 p-5">
              <div className="flex items-center gap-4">
                <div className="h-10 w-10 rounded-full bg-white/10" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-1/3 rounded bg-white/10" />
                  <div className="h-3 w-1/2 rounded bg-white/5" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
  if (!isAdmin) return <AdminLogin />;
  if (!storeId) {
    return (
      <div className="min-h-screen bg-background text-white flex items-center justify-center p-8">
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-surface-container p-8 text-center">
          <h2 className="text-2xl font-headline font-bold mb-3">No Store Access</h2>
          <p className="text-sm text-on-surface-variant mb-6">
            {adminUser?.email ? `No store is assigned to ${adminUser.email}.` : "No store is assigned to this account."}
          </p>
          <div className="flex gap-3 justify-center">
            <button onClick={() => { window.location.href = "/register"; }} className="rounded-xl bg-gradient-to-r from-primary-container to-secondary px-5 py-3 font-headline font-bold text-white">
              Create Store
            </button>
            <button onClick={() => signOut(auth)} className="rounded-xl border border-white/10 px-5 py-3">
              Sign out
            </button>
          </div>
        </div>
      </div>
    );
  }

  const tabs = ownerView ? ["dashboard", "history", "settings", "audit"] : ["dashboard", "history", "audit"];

  return (
    <div className="min-h-screen bg-background text-on-background lg:flex">
      <aside className="w-full border-b border-white/5 bg-surface-container p-4 sm:p-6 lg:fixed lg:inset-y-0 lg:w-64 lg:border-b-0 lg:border-r">
        <div className="mb-8">
          <h1 className="text-xl font-headline font-bold text-primary">Ghost Queue</h1>
          <p className="text-xs uppercase tracking-widest text-on-surface-variant mt-2">{storeName}</p>
          <p className="text-[10px] uppercase tracking-widest text-secondary mt-2">{accessRole}</p>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-2 lg:flex-1 lg:flex-col lg:space-y-2 lg:overflow-visible lg:pb-0">
          {tabs.map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)} className={`whitespace-nowrap rounded-xl px-4 py-3 text-left capitalize lg:w-full ${activeTab === tab ? "bg-surface-container-high text-primary" : "text-on-surface-variant hover:bg-white/5"}`}>{tab}</button>
          ))}
        </div>
        <button onClick={() => signOut(auth)} className="mt-4 w-full rounded-xl border border-white/10 px-4 py-3 text-sm lg:mt-0">Sign out</button>
      </aside>

      <main className="flex-1 p-4 sm:p-6 lg:ml-64 lg:p-8">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-headline font-bold">Admin Panel</h2>
            <p className="text-sm text-on-surface-variant mt-1">{storeStatus.label} · {storeStatus.reason}</p>
          </div>
          <button onClick={handleToggle} disabled={!canManageStore} className="w-full rounded-full border border-white/10 px-5 py-3 text-sm font-bold disabled:opacity-50 sm:w-auto">{storeStatus.isOpen ? "Close Store" : "Open Store"}</button>
        </div>

        {activeTab === "dashboard" && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl bg-surface-container-low/60 border border-white/5 p-5"><p className="text-[10px] uppercase tracking-widest text-on-surface-variant">In queue</p><p className="text-3xl font-headline font-bold mt-2">{totalInQueue}</p></div>
              <div className="rounded-2xl bg-surface-container-low/60 border border-white/5 p-5"><p className="text-[10px] uppercase tracking-widest text-on-surface-variant">Live pace</p><p className="text-3xl font-headline font-bold mt-2">{avgServiceMins}m</p></div>
              <div className="rounded-2xl bg-surface-container-low/60 border border-white/5 p-5"><p className="text-[10px] uppercase tracking-widest text-on-surface-variant">Served</p><p className="text-3xl font-headline font-bold mt-2">{stats.served}</p></div>
              <div className="rounded-2xl bg-surface-container-low/60 border border-white/5 p-5"><p className="text-[10px] uppercase tracking-widest text-on-surface-variant">Dropout</p><p className="text-3xl font-headline font-bold mt-2">{filteredHistory.length ? Math.round(((stats.left + stats.noShow + stats.stale) / filteredHistory.length) * 100) : 0}%</p></div>
            </div>

            {(storeMeta?.queue_paused || storeMeta?.join_disabled || Number(storeMeta?.max_queue_size ?? 0) > 0) && (
              <div className="rounded-2xl border border-white/5 bg-surface-container-low/60 p-5">
                <div className="flex flex-wrap gap-3 text-xs uppercase tracking-[0.16em] text-on-surface-variant">
                  {storeMeta?.queue_paused && <span className="rounded-full bg-secondary/10 px-3 py-2 text-secondary">Queue paused</span>}
                  {storeMeta?.join_disabled && <span className="rounded-full bg-error/10 px-3 py-2 text-error">Joins disabled</span>}
                  {Number(storeMeta?.max_queue_size ?? 0) > 0 && (
                    <span className="rounded-full bg-surface-container-high px-3 py-2">
                      Capacity {totalInQueue}/{Number(storeMeta.max_queue_size)}
                    </span>
                  )}
                </div>
                <p className="mt-3 text-sm text-on-surface-variant">
                  {storeMeta?.paused_reason || storeMeta?.join_disabled_reason || "Customer join state is being controlled from Store Settings."}
                </p>
              </div>
            )}

            <div className="rounded-2xl border border-white/5 bg-surface-container-low/60 p-5">
              <div className="flex flex-wrap gap-3">
                <button onClick={() => handleQuickSetting({ queue_paused: !storeMeta?.queue_paused }, storeMeta?.queue_paused ? "Queue resumed." : "Queue paused.")} disabled={!canManageStore} className="rounded-xl bg-surface-container-high px-4 py-3 text-xs uppercase tracking-widest disabled:opacity-50">
                  {storeMeta?.queue_paused ? "Resume queue" : "Pause queue"}
                </button>
                <button onClick={() => handleQuickSetting({ join_disabled: !storeMeta?.join_disabled }, storeMeta?.join_disabled ? "New joins enabled." : "New joins disabled.")} disabled={!canManageStore} className="rounded-xl bg-surface-container-high px-4 py-3 text-xs uppercase tracking-widest disabled:opacity-50">
                  {storeMeta?.join_disabled ? "Enable joins" : "Disable joins"}
                </button>
                <button onClick={() => handleQuickSetting({ max_queue_size: totalInQueue + 5 }, `Queue capacity set to ${totalInQueue + 5}.`)} disabled={!canManageStore} className="rounded-xl bg-surface-container-high px-4 py-3 text-xs uppercase tracking-widest disabled:opacity-50">
                  Capacity +5
                </button>
                <button onClick={handlePrintQueue} className="rounded-xl bg-surface-container-high px-4 py-3 text-xs uppercase tracking-widest">
                  Print queue
                </button>
                <button onClick={handlePrintSummary} className="rounded-xl bg-surface-container-high px-4 py-3 text-xs uppercase tracking-widest">
                  Print summary
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-8 xl:grid-cols-[1fr_320px]">
              <div className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="text-lg font-headline font-bold">Live Queue</h3>
                  <button onClick={() => { setDraft(draftFromEntry()); setModalState({ type: "create" }); }} className="rounded-xl bg-surface-container-high px-4 py-3 text-xs uppercase tracking-widest">Add Walk-in</button>
                </div>
                <input
                  value={queueSearch}
                  onChange={(event) => setQueueSearch(event.target.value)}
                  placeholder="Search live queue by name, phone, note, counter..."
                  className="w-full rounded-xl border border-white/10 bg-surface-container-high px-4 py-3 outline-none"
                />
                <div className="space-y-3">
                  {filteredQueueEntries.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center text-on-surface-variant">{queueEntries.length === 0 ? "Queue is empty" : "No live entries match this search."}</div>
                  ) : filteredQueueEntries.map((entry, index) => (
                    <div key={entry.id} className="rounded-2xl border border-white/5 bg-surface-container-low/50 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex gap-4">
                          <div className="text-xl font-headline font-bold text-on-surface-variant">{String(index + 1).padStart(2, "0")}</div>
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-bold">{entry.display_name || "Guest"}</p>
                              {Number(entry.priority_level ?? 0) > 0 && <span className="rounded bg-secondary/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-secondary">Priority</span>}
                              {entry.source === "walk_in" && <span className="rounded bg-primary/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-primary">Walk-in</span>}
                              {entry.running_late && <span className="rounded bg-amber-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-amber-500 flex items-center gap-1"><span className="material-symbols-outlined text-[12px]">timer</span>Running Late</span>}
                              {entry.service_counter && <span className="rounded bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wider text-on-surface-variant">{entry.service_counter}</span>}
                            </div>
                            <p className="text-xs text-on-surface-variant mt-1">{entry.phone_number} • {entry.member_count} members • Joined {formatTime(entry.joined_at)}</p>
                            {entry.party_note && <p className="text-xs text-on-surface-variant mt-2">Party note: {entry.party_note}</p>}
                            {entry.staff_note && <p className="text-xs text-secondary mt-1">Staff note: {entry.staff_note}</p>}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2 mt-3 sm:mt-0 justify-end sm:min-w-[220px]">
                          <button aria-label="Edit entry" onClick={() => { setDraft(draftFromEntry(entry)); setModalState({ type: "edit", entry }); }} className="rounded-lg bg-surface-container-high px-3 py-2 text-[10px] uppercase tracking-widest font-bold">Edit</button>
                          <button aria-label="Grant VIP status" onClick={() => handleMarkVIP(entry.id)} className="rounded-lg bg-tertiary/10 text-tertiary px-3 py-2 text-[10px] uppercase tracking-widest font-bold hover:bg-tertiary/20">VIP</button>
                          <button aria-label="Re-serve customer" onClick={() => handleReServeEntry(entry.id)} className="rounded-lg bg-surface-container-high px-3 py-2 text-[10px] uppercase tracking-widest font-bold">Re-serve</button>
                          <button aria-label="Skip entry one position back" onClick={() => skipEntryForward(storeId, entry.id).then(() => pushToast("Entry moved back by one spot.", "success")).catch((err) => pushToast(err.message || "Could not skip entry.", "error"))} className="rounded-lg bg-surface-container-high px-3 py-2 text-[10px] uppercase tracking-widest font-bold">Skip</button>
                          <button aria-label="Mark as no-show" onClick={() => markNoShow(storeId, entry.id).then(() => pushToast("Marked as no-show.", "success")).catch((err) => pushToast(err.message || "Could not mark no-show.", "error"))} className="rounded-lg bg-error/10 px-3 py-2 text-[10px] uppercase tracking-widest font-bold text-error">No-show</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <button onClick={() => callNext(storeId).then(() => pushToast("Next customer called.", "success")).catch((err) => pushToast(err.message || "Could not call next customer.", "error"))} disabled={queueEntries.length === 0} className="w-full rounded-xl bg-gradient-to-r from-primary-container to-secondary py-4 font-headline font-bold text-white disabled:opacity-50">CALL NEXT CUSTOMER</button>
              </div>

              <div className="space-y-6">
                {(function() {
                  const health = computeQueueHealthScore({ meta: storeMeta, entries: queueEntries, recentHistory: filteredHistory, targetMaxWaitMins: 20 });
                  return (
                    <div className={`rounded-2xl border ${getHealthBgColor(health.level)} p-6`}>
                      <div className="flex items-center gap-3 mb-3">
                        <span className={`material-symbols-outlined text-[28px] ${getHealthColor(health.level)}`}>{getHealthIcon(health.level)}</span>
                        <div>
                           <p className="text-[10px] uppercase tracking-widest text-on-surface-variant font-label">Queue Health</p>
                           <h3 className="font-headline font-bold text-2xl">{health.score}/100</h3>
                        </div>
                      </div>
                      <div className="flex gap-2 flex-wrap mt-4">
                        {health.factors.map((f, i) => <span key={i} className={`text-[10px] uppercase tracking-[0.1em] font-bold px-2.5 py-1 rounded border border-white/5 bg-surface-container ${f.severity === "critical" ? "text-red-400" : f.severity === "warning" ? "text-amber-400" : "text-white/60"}`}>{f.label}</span>)}
                      </div>
                    </div>
                  );
                })()}

                <div className="rounded-2xl border border-white/5 bg-surface-container-low/60 p-6">
                  <h3 className="text-[10px] uppercase tracking-widest text-on-surface-variant mb-4">Live Broadcast</h3>
                  {storeMeta?.current_broadcast?.message ? (
                     <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-4">
                       <div className="flex items-center gap-2 mb-2"><span className="material-symbols-outlined text-amber-400 text-sm">campaign</span><p className="text-xs uppercase text-amber-400 tracking-wider font-bold">Broadcasting</p></div>
                       <p className="text-sm text-on-surface mb-4">{storeMeta.current_broadcast.message}</p>
                       <button onClick={handleClearBroadcast} className="w-full rounded-lg bg-surface-container px-4 py-2.5 text-[10px] text-on-surface hover:text-error transition-colors font-bold uppercase tracking-widest">End Broadcast</button>
                     </div>
                  ) : (
                     <div>
                       <textarea id="broadcast-input" rows={2} placeholder="Message all waiting customers..." className="w-full resize-none rounded-xl border border-white/10 bg-surface-container-high px-4 py-3 outline-none text-sm mb-3" />
                       <button onClick={() => {
                          const el = document.getElementById("broadcast-input");
                          if (el?.value) { handleSendBroadcast(el.value); el.value = ""; }
                       }} className="w-full rounded-xl bg-tertiary/10 text-tertiary px-4 py-3 text-xs font-bold uppercase tracking-widest hover:bg-tertiary/20 transition-colors">Send Broadcast</button>
                     </div>
                  )}
                </div>

                <div className="rounded-2xl border border-white/5 bg-surface-container-low/60 p-6 text-center">
                  <h3 className="text-[10px] uppercase tracking-widest text-on-surface-variant mb-4">Store QR</h3>
                  <div className="inline-block rounded-xl bg-white p-2"><canvas ref={canvasRef}></canvas></div>
                  <p className="mt-4 rounded-lg bg-surface-container px-3 py-2 text-[11px] text-on-surface-variant break-all">{window.location.host}/q/{storeId}</p>
                  <button
                    type="button"
                    onClick={() => {
                      const url = `${window.location.origin}/q/${storeId}`;
                      if (navigator.clipboard?.writeText) {
                        navigator.clipboard.writeText(url).then(() => pushToast("Store link copied!", "success"));
                      } else {
                        window.prompt("Copy store link:", url);
                      }
                    }}
                    className="mt-3 w-full rounded-xl bg-surface-container-high px-4 py-2 text-xs uppercase tracking-widest hover:bg-white/10 transition-colors flex items-center justify-center gap-2"
                  >
                    <span className="material-symbols-outlined text-sm">link</span>
                    Copy store link
                  </button>
                  <button onClick={handleDownloadPoster} className="mt-3 w-full rounded-xl bg-gradient-to-r from-primary-container to-secondary px-4 py-2 text-xs uppercase tracking-widest text-white transition-colors flex items-center justify-center gap-2">
                    <span className="material-symbols-outlined text-sm">print</span>
                    Print QR Poster
                  </button>
                </div>
                <div className="rounded-2xl border border-white/5 bg-surface-container-low/60 p-6">
                  <div className="flex items-center justify-between mb-4"><h3 className="text-[10px] uppercase tracking-widest text-on-surface-variant">Peak hours</h3><span className="text-[10px] text-tertiary">History based</span></div>
                  <div className="flex items-end h-32 gap-2 border-b border-white/5 pb-2">
                    {peakHours.map((bucket) => <div key={bucket.label} className="flex-1 flex flex-col items-center gap-2"><div className={`w-full rounded-t-sm ${bucket.count ? "bg-secondary" : "bg-surface-variant/50"}`} style={{ height: bucket.height }}></div><span className="text-[9px] text-on-surface-variant">{bucket.label}</span></div>)}
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-xl bg-surface-container px-3 py-3"><p className="text-[10px] uppercase tracking-widest text-on-surface-variant">Avg wait</p><p className="mt-1 font-bold">{stats.avgWait} min</p></div>
                    <div className="rounded-xl bg-surface-container px-3 py-3"><p className="text-[10px] uppercase tracking-widest text-on-surface-variant">Left / stale</p><p className="mt-1 font-bold">{stats.left + stats.noShow + stats.stale}</p></div>
                  </div>
                </div>
                <div className="rounded-2xl border border-white/5 bg-surface-container-low/60 p-6">
                  <h3 className="text-[10px] uppercase tracking-widest text-on-surface-variant mb-4">Busiest days</h3>
                  <div className="space-y-3">
                    {busiestDays.length === 0 ? <p className="text-sm text-on-surface-variant">Need more history to chart busy days.</p> : busiestDays.map((item) => <div key={item.label} className="flex items-center justify-between rounded-xl bg-surface-container px-3 py-3"><span className="text-sm">{item.label}</span><span className="font-bold">{item.count}</span></div>)}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/5 bg-surface-container-low/60 p-6">
                  <h3 className="text-[10px] uppercase tracking-widest text-on-surface-variant mb-4">Common note</h3>
                  {topPartyNote ? (
                    <div className="rounded-xl bg-surface-container px-4 py-4">
                      <p className="font-semibold capitalize">{topPartyNote.label}</p>
                      <p className="mt-1 text-xs text-on-surface-variant">{topPartyNote.count} recent entries</p>
                    </div>
                  ) : (
                    <p className="text-sm text-on-surface-variant">Need more note data to highlight a trend.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "history" && (
          <div className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-xl font-headline font-bold">History</h3>
                <p className="text-sm text-on-surface-variant mt-1">Filter by name, phone, status, or date range.</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button onClick={() => downloadCsv(filteredHistory, storeId)} className="rounded-xl bg-surface-container-high px-4 py-3 text-xs uppercase tracking-widest">Export CSV</button>
                <button onClick={() => downloadExcel(filteredHistory, storeId)} className="rounded-xl bg-surface-container-high px-4 py-3 text-xs uppercase tracking-widest">Export Excel</button>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              <input value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="Search history..." className="rounded-xl border border-white/10 bg-surface-container-high px-4 py-3 outline-none" />
              <select value={historyType} onChange={(event) => setHistoryType(event.target.value)} className="rounded-xl border border-white/10 bg-surface-container-high px-4 py-3 outline-none">{HISTORY_TYPES.map((item) => <option key={item} value={item}>{item === "all" ? "All statuses" : item.replace("_", " ")}</option>)}</select>
              <select value={historyWindow} onChange={(event) => setHistoryWindow(event.target.value === "custom" ? "custom" : Number(event.target.value))} className="rounded-xl border border-white/10 bg-surface-container-high px-4 py-3 outline-none">{HISTORY_WINDOWS.map((item) => <option key={item} value={item}>Last {item} day{item > 1 ? "s" : ""}</option>)}<option value="custom">Custom range</option></select>
            </div>
            {historyWindow === "custom" && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><input type="date" value={customStart} onChange={(event) => setCustomStart(event.target.value)} className="rounded-xl border border-white/10 bg-surface-container-high px-4 py-3 outline-none" /><input type="date" value={customEnd} onChange={(event) => setCustomEnd(event.target.value)} className="rounded-xl border border-white/10 bg-surface-container-high px-4 py-3 outline-none" /></div>}
            <div className="space-y-4">
              {historyGroups.length === 0 ? <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center text-on-surface-variant">No history found.</div> : historyGroups.map((group) => (
                <div key={group.label} className="space-y-3">
                  <div className="rounded-xl border border-white/5 bg-background/90 px-4 py-3">
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-on-surface-variant">{group.label}</p>
                      <p className="text-[11px] text-on-surface-variant">Served {group.totals.served} • Left {group.totals.left} • No-show {group.totals.noShow}</p>
                    </div>
                  </div>
                  {group.entries.map((entry) => (
                    <div key={entry.id} className="rounded-2xl border border-white/5 bg-surface-container-low/50 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-bold">{entry.display_name || "Guest"}</p>
                            <span className="rounded bg-surface-container-high px-2 py-0.5 text-[10px] uppercase tracking-wider">{(entry.history_type || "served").replace("_", " ")}</span>
                            {entry.service_counter && <span className="rounded bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-wider text-on-surface-variant">{entry.service_counter}</span>}
                          </div>
                          <p className="text-xs text-on-surface-variant mt-1">{entry.phone_number || "-"} • {entry.member_count || 1} members • Joined {formatTime(entry.joined_at)}</p>
                          {entry.party_note && <p className="text-xs text-on-surface-variant mt-2">Party note: {entry.party_note}</p>}
                          {entry.staff_note && <p className="text-xs text-secondary mt-1">Staff note: {entry.staff_note}</p>}
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] uppercase tracking-widest text-on-surface-variant">Completed</p>
                          <p className="mt-1 font-semibold">{formatTime(entry.completed_at)}</p>
                          <button onClick={() => handleRestoreHistoryEntry(entry)} className="mt-3 rounded-lg bg-surface-container-high px-3 py-2 text-xs">Restore</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            {historyHasMore && (
              <div className="pt-4 text-center">
                <button
                  type="button"
                  onClick={() => fetchHistory(historyLastDoc)}
                  disabled={historyLoadingMore}
                  className="rounded-xl bg-surface-container-high px-6 py-2.5 text-xs font-semibold uppercase tracking-widest text-on-surface hover:bg-surface-variant transition-colors disabled:opacity-50"
                >
                  {historyLoadingMore ? "Loading..." : "Load older history"}
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === "settings" && ownerView && (
          <div className="space-y-6">
            <div><h3 className="text-xl font-headline font-bold">Store Settings</h3><p className="text-sm text-on-surface-variant mt-1">Branding, roles, store hours, holidays, and queue settings.</p></div>
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <div className="rounded-2xl border border-white/5 bg-surface-container-low/60 p-6 space-y-4">
                <input value={settings.store_logo} onChange={(event) => setSettings((prev) => ({ ...prev, store_logo: event.target.value }))} placeholder="Material icon name" className="w-full rounded-xl border border-white/10 bg-surface-container-high px-4 py-3 outline-none" />
                <input value={settings.cover_image_url} onChange={(event) => setSettings((prev) => ({ ...prev, cover_image_url: event.target.value }))} placeholder="Cover image URL" className="w-full rounded-xl border border-white/10 bg-surface-container-high px-4 py-3 outline-none" />
                <div className="grid grid-cols-2 gap-3">
                  <input type="color" value={settings.brand_primary} onChange={(event) => setSettings((prev) => ({ ...prev, brand_primary: event.target.value }))} className="h-12 rounded-xl border border-white/10 bg-surface-container-high px-2" />
                  <input type="color" value={settings.brand_secondary} onChange={(event) => setSettings((prev) => ({ ...prev, brand_secondary: event.target.value }))} className="h-12 rounded-xl border border-white/10 bg-surface-container-high px-2" />
                </div>
                <textarea value={settings.announcement} onChange={(event) => setSettings((prev) => ({ ...prev, announcement: event.target.value }))} rows={3} placeholder="Announcement for customers" className="w-full resize-none rounded-xl border border-white/10 bg-surface-container-high px-4 py-3 outline-none" />
                <input type="number" min="0" value={settings.fast_pass_price} onChange={(event) => setSettings((prev) => ({ ...prev, fast_pass_price: event.target.value }))} placeholder="Fast pass price" className="w-full rounded-xl border border-white/10 bg-surface-container-high px-4 py-3 outline-none" />
                <input value={settings.timezone} onChange={(event) => setSettings((prev) => ({ ...prev, timezone: event.target.value }))} placeholder="Timezone (e.g. Asia/Kolkata)" className="w-full rounded-xl border border-white/10 bg-surface-container-high px-4 py-3 outline-none" />
              </div>
              <div className="rounded-2xl border border-white/5 bg-surface-container-low/60 p-6 space-y-4">
                <label className="flex items-center justify-between rounded-xl bg-surface-container-high px-4 py-3"><span>Holiday mode</span><input type="checkbox" checked={settings.holiday_mode} onChange={(event) => setSettings((prev) => ({ ...prev, holiday_mode: event.target.checked }))} /></label>
                <input value={settings.holiday_reason} onChange={(event) => setSettings((prev) => ({ ...prev, holiday_reason: event.target.value }))} placeholder="Holiday reason" className="w-full rounded-xl border border-white/10 bg-surface-container-high px-4 py-3 outline-none" />
                <input value={settings.closed_reason} onChange={(event) => setSettings((prev) => ({ ...prev, closed_reason: event.target.value }))} placeholder="Closed reason" className="w-full rounded-xl border border-white/10 bg-surface-container-high px-4 py-3 outline-none" />
                <label className="flex items-center justify-between rounded-xl bg-surface-container-high px-4 py-3"><span>Pause queue</span><input type="checkbox" checked={settings.queue_paused} onChange={(event) => setSettings((prev) => ({ ...prev, queue_paused: event.target.checked }))} /></label>
                <input value={settings.paused_reason} onChange={(event) => setSettings((prev) => ({ ...prev, paused_reason: event.target.value }))} placeholder="Paused reason" className="w-full rounded-xl border border-white/10 bg-surface-container-high px-4 py-3 outline-none" />
                <label className="flex items-center justify-between rounded-xl bg-surface-container-high px-4 py-3"><span>Disable new joins</span><input type="checkbox" checked={settings.join_disabled} onChange={(event) => setSettings((prev) => ({ ...prev, join_disabled: event.target.checked }))} /></label>
                <input value={settings.join_disabled_reason} onChange={(event) => setSettings((prev) => ({ ...prev, join_disabled_reason: event.target.value }))} placeholder="Join disabled reason" className="w-full rounded-xl border border-white/10 bg-surface-container-high px-4 py-3 outline-none" />
                <input type="number" min="0" value={settings.max_queue_size} onChange={(event) => setSettings((prev) => ({ ...prev, max_queue_size: event.target.value }))} placeholder="Max queue size (0 = unlimited)" className="w-full rounded-xl border border-white/10 bg-surface-container-high px-4 py-3 outline-none" />
                <label className="flex items-center justify-between rounded-xl bg-surface-container-high px-4 py-3"><span>Enable schedule display</span><input type="checkbox" checked={settings.schedule_enabled} onChange={(event) => setSettings((prev) => ({ ...prev, schedule_enabled: event.target.checked }))} /></label>
              </div>
            </div>
            <div className="rounded-2xl border border-white/5 bg-surface-container-low/60 p-6 space-y-3">
              <h4 className="text-sm font-bold">Business schedule</h4>
              {DAYS.map(([key, label]) => <div key={key} className="grid grid-cols-1 gap-3 rounded-xl bg-surface-container px-4 py-4 sm:grid-cols-[120px_90px_1fr_1fr] sm:items-center"><span>{label}</span><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.schedule[key].enabled} onChange={(event) => setSettings((prev) => ({ ...prev, schedule: { ...prev.schedule, [key]: { ...prev.schedule[key], enabled: event.target.checked } } }))} />Open</label><input type="time" value={settings.schedule[key].open} onChange={(event) => setSettings((prev) => ({ ...prev, schedule: { ...prev.schedule, [key]: { ...prev.schedule[key], open: event.target.value } } }))} className="rounded-xl border border-white/10 bg-surface-container-high px-4 py-3 outline-none" /><input type="time" value={settings.schedule[key].close} onChange={(event) => setSettings((prev) => ({ ...prev, schedule: { ...prev.schedule, [key]: { ...prev.schedule[key], close: event.target.value } } }))} className="rounded-xl border border-white/10 bg-surface-container-high px-4 py-3 outline-none" /></div>)}
            </div>
            <div className="rounded-2xl border border-white/5 bg-surface-container-low/60 p-6 space-y-4">
              <h4 className="text-sm font-bold">Team access</h4>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_180px_160px]">
                <input value={staffDraft.email} onChange={(event) => setStaffDraft((prev) => ({ ...prev, email: event.target.value }))} placeholder="staff@example.com" className="rounded-xl border border-white/10 bg-surface-container-high px-4 py-3 outline-none" />
                <select value={staffDraft.role} onChange={(event) => setStaffDraft((prev) => ({ ...prev, role: event.target.value }))} className="rounded-xl border border-white/10 bg-surface-container-high px-4 py-3 outline-none"><option value="manager">Manager</option><option value="staff">Staff</option></select>
                <button onClick={handleAddStaffMember} className="rounded-xl bg-surface-container-high px-4 py-3 text-xs uppercase tracking-widest">Add member</button>
              </div>
              <div className="space-y-3">
                {staffMembers.length === 0 ? <p className="text-sm text-on-surface-variant">No team members added yet.</p> : staffMembers.map((member) => <div key={member.id} className="flex items-center justify-between rounded-xl bg-surface-container px-4 py-3"><div><p className="text-sm font-medium">{member.email}</p><p className="text-[10px] uppercase tracking-widest text-on-surface-variant mt-1">{member.role}</p></div><button onClick={() => removeStoreStaffMember(storeId, member.email)} className="rounded-lg bg-error/10 px-3 py-2 text-xs text-error">Remove</button></div>)}
              </div>
            </div>

            <button onClick={handleSaveSettings} disabled={savingSettings} className="w-full rounded-xl bg-gradient-to-r from-primary-container to-secondary py-4 font-headline font-bold text-white disabled:opacity-50">{savingSettings ? "Saving..." : "Save settings"}</button>
          </div>
        )}

        {activeTab === "audit" && (
          <div className="space-y-3">
            <div><h3 className="text-xl font-headline font-bold">Audit Log</h3><p className="text-sm text-on-surface-variant mt-1">Every queue operation, close/open action, and cleanup event lands here.</p></div>
            {auditData.length === 0 ? <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center text-on-surface-variant">No audit events yet.</div> : auditData.map((item) => <div key={item.id} className="rounded-2xl border border-white/5 bg-surface-container-low/50 p-4"><div className="flex items-center justify-between gap-4"><div><p className="font-bold capitalize">{item.action.replace(/_/g, " ")}</p><p className="text-xs text-on-surface-variant mt-1">{item.display_name || item.target_entry_id || item.reason || "Store event"}</p></div><span className="text-xs text-on-surface-variant">{formatTime(item.created_at)}</span></div></div>)}
          </div>
        )}
      </main>

      <ToastStack
        toasts={toasts}
        onDismiss={dismissToast}
      />
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

      {modalState && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-surface-container p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
            <div className="flex items-center justify-between mb-5"><h3 className="text-lg font-headline font-bold">{modalState.type === "create" ? "Add Walk-in" : "Edit Entry"}</h3><button onClick={() => setModalState(null)} className="rounded-full bg-surface-container-high p-2"><span className="material-symbols-outlined">close</span></button></div>
            <div className="space-y-4">
              <input value={draft.name} onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))} placeholder="Name" className="w-full rounded-xl border border-white/10 bg-surface-container-high px-4 py-3 outline-none" />
              <div className="grid grid-cols-2 gap-4">
                <input value={draft.phone} onChange={(event) => setDraft((prev) => ({ ...prev, phone: event.target.value.replace(/[^0-9]/g, "").slice(0, 10) }))} placeholder="Phone" className="w-full rounded-xl border border-white/10 bg-surface-container-high px-4 py-3 outline-none" />
                <input type="number" min="1" max="20" value={draft.members} onChange={(event) => setDraft((prev) => ({ ...prev, members: Number(event.target.value) || 1 }))} placeholder="Members" className="w-full rounded-xl border border-white/10 bg-surface-container-high px-4 py-3 outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <input value={draft.staff_note} onChange={(event) => setDraft((prev) => ({ ...prev, staff_note: event.target.value }))} placeholder="Staff note" className="w-full rounded-xl border border-white/10 bg-surface-container-high px-4 py-3 outline-none" />
                <input value={draft.service_counter} onChange={(event) => setDraft((prev) => ({ ...prev, service_counter: event.target.value.slice(0, 40) }))} placeholder="Counter label" className="w-full rounded-xl border border-white/10 bg-surface-container-high px-4 py-3 outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <select value={draft.priority_level} onChange={(event) => setDraft((prev) => ({ ...prev, priority_level: Number(event.target.value) }))} className="w-full rounded-xl border border-white/10 bg-surface-container-high px-4 py-3 outline-none"><option value={0}>Normal</option><option value={1}>Priority front</option></select>
                {modalState.type === "create" ? (
                  <label className="flex items-center justify-center gap-2 rounded-xl border border-error/20 bg-error/10 px-4 py-3 text-xs text-error cursor-pointer">
                    <input type="checkbox" checked={draft.emergency_priority} onChange={(event) => setDraft((prev) => ({ ...prev, emergency_priority: event.target.checked }))} className="accent-error w-4 h-4" />
                    <strong>Emergency Override</strong>
                  </label>
                ) : (
                  <div className="rounded-xl border border-white/10 bg-surface-container-high px-4 py-3 text-xs text-on-surface-variant flex items-center justify-center text-center">
                    Phone numbers must be unique.
                  </div>
                )}
              </div>
              <textarea value={draft.party_note} onChange={(event) => setDraft((prev) => ({ ...prev, party_note: event.target.value }))} rows={3} placeholder="Party note" className="w-full resize-none rounded-xl border border-white/10 bg-surface-container-high px-4 py-3 outline-none" />
              <div className="flex flex-wrap gap-2">
                {NOTE_TEMPLATES.map((note) => (
                  <button
                    key={note}
                    type="button"
                    onClick={() => setDraft((prev) => ({ ...prev, party_note: prev.party_note ? `${prev.party_note}, ${note}`.slice(0, 120) : note }))}
                    className="rounded-full bg-surface-container-high px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-on-surface-variant"
                  >
                    {note}
                  </button>
                ))}
              </div>
              <button onClick={handleDraftSubmit} disabled={draftBusy} className="w-full rounded-xl bg-gradient-to-r from-primary-container to-secondary py-4 font-headline font-bold text-white disabled:opacity-50">{draftBusy ? "Saving..." : modalState.type === "create" ? "Add to queue" : "Save changes"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );





}
