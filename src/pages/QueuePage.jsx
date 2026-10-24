import React, { useEffect, useRef, useState } from "react";
import { signInAnonymously } from "firebase/auth";
import { auth } from "../firebase";
import QRCode from "qrcode";
import JoinQueueForm from "../components/JoinQueueForm";
import ToastStack from "../components/ToastStack";
import ConfirmDialog from "../components/ConfirmDialog";
import { joinQueue, leaveQueue, smartSkip } from "../utils/firestore";
import { useQueue } from "../hooks/useQueue";
import { useToast } from "../hooks/useToast";
import { clearActiveQueueTicket, saveActiveQueueTicket } from "../utils/queueTicket";
import { SUPPORTED_LOCALES, useLocale } from "../utils/i18n";
import { getEffectiveStoreStatus, getStoreTheme } from "../utils/storeStatus";
import { registerPushNotifications, subscribeForegroundMessages } from "../utils/pushNotifications";
import { isFavoriteStore, saveRecentStore, toggleFavoriteStore } from "../utils/storePreferences";
import { playCallChime } from "../utils/soundEffects";

function LanguagePicker({ locale, onChange, label }) {
  return (
    <select
      value={locale}
      onChange={(event) => onChange(event.target.value)}
      aria-label={label}
      className="bg-surface-container-high text-[11px] uppercase tracking-wider text-on-surface-variant rounded-full border border-white/10 px-3 py-2 outline-none"
    >
      {SUPPORTED_LOCALES.map((item) => (
        <option key={item} value={item}>
          {item.toUpperCase()}
        </option>
      ))}
    </select>
  );
}

export default function QueuePage({ storeIdParam }) {
  const { locale, setLocale, t } = useLocale();
  const params = new URLSearchParams(window.location.search);
  const storeId = storeIdParam || params.get("store") || "CHAI_BABA_01";

  const [userId, setUserId] = useState(null);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("queue");
  const [guestProfile, setGuestProfile] = useState({ name: "", phone: "", members: 1 });
  const { toasts, pushToast, dismissToast } = useToast(3200);
  const [leaving, setLeaving] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState(
    typeof window !== "undefined" && "Notification" in window ? window.Notification.permission : "denied"
  );
  const [turnNotified, setTurnNotified] = useState(false);
  const [favorite, setFavorite] = useState(() => isFavoriteStore(storeId));
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  const [lastNearTurnAlert, setLastNearTurnAlert] = useState(null);
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [installPromptEvent, setInstallPromptEvent] = useState(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [showPassQR, setShowPassQR] = useState(false);
  const [passQrUrl, setPassQrUrl] = useState("");
  const soundEnabledRef = useRef(soundEnabled);

  const { position, waitMins, totalInQueue, storeMeta, isServed, entries, myEntry, inQueue, loading, storeMissing, error: queueError } = useQueue(storeId, userId);

  const totalMembersWaiting = entries.reduce(
    (sum, entry) => sum + Math.max(1, Number(entry.member_count ?? 1)),
    0
  );

  const storeStatus = getEffectiveStoreStatus(storeMeta);
  const storeTheme = getStoreTheme(storeMeta);
  const isOpen = storeStatus.isOpen;
  const canJoin = storeStatus.canJoin !== false;
  const storeName = storeMeta?.store_name ?? storeId;
  const isJoined = inQueue;
  const myIndex = entries.findIndex((entry) => entry.id === userId);
  const queuePath = `/q/${storeId}`;
  const queueLink = typeof window !== "undefined" ? `${window.location.origin}${queuePath}` : queuePath;
  const peopleAhead = myIndex > 0 ? myIndex : 0;
  const membersAhead = myIndex > 0
    ? entries.slice(0, myIndex).reduce((sum, entry) => sum + Math.max(1, Number(entry.member_count ?? 1)), 0)
    : 0;

  // Keep soundEnabledRef in sync so audio effect callbacks don't close over stale state
  useEffect(() => { soundEnabledRef.current = soundEnabled; }, [soundEnabled]);

  useEffect(() => {
    if (isJoined && queueLink) {
      QRCode.toDataURL(queueLink, { margin: 1, width: 220 })
        .then(setPassQrUrl)
        .catch(() => {});
    }
  }, [isJoined, queueLink]);

  useEffect(() => {
    setFavorite(isFavoriteStore(storeId));
  }, [storeId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const handleOnline = () => {
      setIsOnline(true);
      pushToast("You are back online. Live queue updates are active again.", "success", "Connection restored");
    };
    const handleOffline = () => {
      setIsOnline(false);
      pushToast("You are offline. We'll keep showing your last saved ticket until reconnect.", "error", "Offline");
    };
    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPromptEvent(event);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, [pushToast]);

  useEffect(() => {
    if (auth.currentUser) {
      setUserId(auth.currentUser.uid);
      return;
    }

    signInAnonymously(auth)
      .then((cred) => setUserId(cred.user.uid))
      .catch(() => setError("Could not connect. Please refresh."));
  }, []);

  useEffect(() => {
    if (storeMeta) {
      saveRecentStore({ id: storeId, ...storeMeta });
    }
  }, [storeId, storeMeta]);

  useEffect(() => {
    if (myEntry) {
      setGuestProfile({
        name: myEntry.display_name || "",
        phone: myEntry.phone_number || "",
        members: myEntry.member_count || 1,
      });
    }
  }, [myEntry]);

  useEffect(() => {
    if (isJoined && userId) {
      saveActiveQueueTicket({
        storeId,
        storeName,
        storeLogo: storeMeta?.store_logo || "storefront",
        userId,
        savedAt: Date.now(),
      });
    }
  }, [isJoined, isServed, storeId, storeMeta?.store_logo, storeName, userId]);

  useEffect(() => {
    if (isServed) {
      clearActiveQueueTicket();
    }
  }, [isServed]);

  useEffect(() => {
    if (!isJoined || typeof window === "undefined" || !("Notification" in window)) {
      return;
    }

    if (window.Notification.permission === "default") {
      window.Notification.requestPermission().then((permission) => {
        setNotificationPermission(permission);
      });
      return;
    }

    setNotificationPermission(window.Notification.permission);
  }, [isJoined]);

  useEffect(() => {
    if (!isJoined || position > 1) {
      setTurnNotified(false);
    }
  }, [isJoined, position]);

  useEffect(() => {
    if (!isJoined || !position || position > 3 || lastNearTurnAlert === position) {
      return;
    }

    if (soundEnabledRef.current && navigator.vibrate) {
      navigator.vibrate([120, 50, 120]);
    }

    if (soundEnabledRef.current) {
      playCallChime();
    }

    pushToast(
      position === 1
        ? "It's your turn now."
        : `You are getting close. Only ${position - 1} party${position === 2 ? "" : "ies"} ahead.`,
      "success",
      "Queue update"
    );
    setLastNearTurnAlert(position);
  }, [isJoined, lastNearTurnAlert, position, pushToast]);

  useEffect(() => {
    if (!isJoined || position !== 1 || notificationPermission !== "granted" || typeof window === "undefined") {
      return;
    }

    if (turnNotified) {
      return;
    }

    const notification = new window.Notification("It's your turn", {
      body: `${storeName} is ready for ${guestProfile.name || "you"}.`,
      tag: `turn-${storeId}-${userId}`,
    });
    setTurnNotified(true);

    return () => {
      notification.close();
    };
  }, [guestProfile.name, isJoined, notificationPermission, position, storeId, storeName, turnNotified, userId]);

  useEffect(() => {
    if (!isJoined || !userId) {
      return;
    }

    registerPushNotifications(storeId, userId)
      .then((result) => {
        if (result.enabled) {
          setNotificationPermission("granted");
        }
      })
      .catch(() => {
        // keep browser notification fallback silent
      });
  }, [isJoined, storeId, userId]);

  useEffect(() => {
    let unsubscribe = () => {};
    subscribeForegroundMessages((payload) => {
      const title = payload.notification?.title || "Ghost Queue";
      const body = payload.notification?.body || "Queue update available.";
      if (typeof window !== "undefined" && "Notification" in window && window.Notification.permission === "granted") {
        new window.Notification(title, { body });
      }
    }).then((handler) => {
      unsubscribe = typeof handler === "function" ? handler : () => {};
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const joinedAt = myEntry?.joined_at?.toDate
    ? myEntry.joined_at.toDate().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "--:--";

  const handleJoin = async ({ name, phone, members, party_note }) => {
    if (!userId) {
      throw new Error("Connecting to queue. Please try again.");
    }

    setError(null);
    setGuestProfile({ name, phone, members });

    try {
      await joinQueue(storeId, userId, { name, phone, members, party_note });
    } catch (err) {
      if (err.message === "STORE_CLOSED") {
        setError("This store is currently closed. Please come back later.");
        throw new Error("This store is currently closed. Please come back later.");
      }

      if (err.message === "QUEUE_PAUSED") {
        setError("The queue is paused for a short break. Please try again soon.");
        throw new Error("The queue is paused for a short break. Please try again soon.");
      }

      if (err.message === "QUEUE_DISABLED") {
        setError("This store is open, but new joins are temporarily disabled.");
        throw new Error("This store is open, but new joins are temporarily disabled.");
      }

      if (err.message === "QUEUE_FULL") {
        setError("This queue has reached its current capacity. Please try again a little later.");
        throw new Error("This queue has reached its current capacity. Please try again a little later.");
      }

      if (err.message === "ALREADY_IN_QUEUE") {
        return;
      }

      setError(err.message || "Failed to join the queue.");
      pushToast(err.message || "Failed to join the queue.", "error");
      throw new Error(err.message || "Failed to join the queue.");
    }
  };

  const handleSmartSkip = async () => {
    if (!userId) return;

    try {
      await smartSkip(storeId, userId);
      pushToast("We moved your party slightly back in the queue.", "success");
    } catch (err) {
      if (err.message === "MAX_SKIPS_REACHED") {
        pushToast("You have already used your maximum allowed skips.", "error");
      } else if (err.message === "ALREADY_LAST") {
        pushToast("You are already at the end of the line.", "error");
      } else {
        pushToast("Could not delay turn. Please try again.", "error");
      }
    }
  };

  const handleLeaveQueue = async () => {
    if (!userId) return;
    setLeaving(true);
    try {
      await leaveQueue(storeId, userId);
      clearActiveQueueTicket();
      setConfirmLeaveOpen(false);
      pushToast("You left the queue.", "success");
    } catch {
      pushToast("Could not leave the queue. Please try again.", "error");
    } finally {
      setLeaving(false);
    }
  };

  const handleShareTicket = async () => {
    const shareText = `${storeName} queue ticket${position ? ` - position #${position}` : ""}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: `${storeName} Queue`,
          text: shareText,
          url: queueLink,
        });
        return;
      } catch {
        // fall back below
      }
    }

    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(queueLink);
      pushToast(t("copied", "Link copied"), "success");
      return;
    }

    window.prompt(t("copyLink", "Copy link"), queueLink);
  };

  const handleExportTicketImage = async () => {
    if (!isJoined) {
      return;
    }

    try {
      const qrDataUrl = await QRCode.toDataURL(queueLink, { margin: 1, width: 180 });
      const canvas = document.createElement("canvas");
      canvas.width = 720;
      canvas.height = 1080;
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Canvas unavailable");
      }

      const qrImage = new Image();
      await new Promise((resolve, reject) => {
        qrImage.onload = resolve;
        qrImage.onerror = reject;
        qrImage.src = qrDataUrl;
      });

      const gradient = context.createLinearGradient(0, 0, 720, 1080);
      gradient.addColorStop(0, storeTheme.primary);
      gradient.addColorStop(1, storeTheme.secondary);
      context.fillStyle = "#0F1014";
      context.fillRect(0, 0, 720, 1080);
      context.fillStyle = gradient;
      context.globalAlpha = 0.16;
      context.fillRect(40, 40, 640, 260);
      context.globalAlpha = 1;

      context.fillStyle = "#FFFFFF";
      context.font = "700 44px sans-serif";
      context.fillText(storeName, 60, 120);
      context.font = "600 24px sans-serif";
      context.fillStyle = "#C8C5D0";
      context.fillText(`Queue ticket • Position #${position}`, 60, 170);
      context.fillText(`${membersAhead} members ahead • ETA ${waitMins} min`, 60, 210);

      context.fillStyle = "#1D1E24";
      context.fillRect(60, 280, 600, 620);
      context.drawImage(qrImage, 250, 360, 220, 220);
      context.fillStyle = "#FFFFFF";
      context.font = "700 120px sans-serif";
      context.fillText(`#${position}`, 240, 705);
      context.font = "600 30px sans-serif";
      context.fillText(myEntry?.display_name || guestProfile.name || "Guest", 60, 790);
      context.fillStyle = "#C8C5D0";
      context.font = "500 22px sans-serif";
      context.fillText(`Phone: ${myEntry?.phone_number || guestProfile.phone || "-"}`, 60, 835);
      context.fillText(`Party size: ${myEntry?.member_count || guestProfile.members || 1}`, 60, 870);
      context.fillText(queueLink, 60, 930);

      const link = document.createElement("a");
      link.href = canvas.toDataURL("image/png");
      link.download = `${storeId}-ticket.png`;
      link.click();
      pushToast("Ticket image downloaded.", "success");
    } catch {
      pushToast("Could not export ticket image.", "error");
    }
  };

  const statusToneClass = isOpen ? "bg-tertiary text-tertiary" : "bg-error text-error";
  const joinStateMessage = !isOpen
    ? storeStatus.reason || t("queueClosed", "The queue is not active right now. Come back when the store opens.")
    : storeMeta?.queue_paused
      ? storeMeta?.paused_reason || "The team has paused the queue for a short break."
      : storeMeta?.join_disabled
        ? storeMeta?.join_disabled_reason || "This store is serving current guests before taking more joins."
        : Number(storeMeta?.max_queue_size ?? 0) > 0 && totalInQueue >= Number(storeMeta?.max_queue_size)
          ? `This queue is full at ${Number(storeMeta?.max_queue_size)} parties right now.`
          : storeStatus.reason || t("queueLive", "Queue is live right now.");
  const toggleFavorite = () => {
    setFavorite(toggleFavoriteStore({ id: storeId, store_name: storeName, store_logo: storeMeta?.store_logo }).includes(storeId));
  };

  const handleInstallApp = async () => {
    if (!installPromptEvent) {
      pushToast("Install is not available on this device yet.", "default", "Install app");
      return;
    }

    try {
      await installPromptEvent.prompt();
      await installPromptEvent.userChoice;
    } catch {
      // ignore dismissed prompt
    } finally {
      setInstallPromptEvent(null);
    }
  };

  if (loading && !storeMissing) {
    return (
      <div className="min-h-screen bg-background text-white flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-surface-container p-8 text-center">
          <span className="material-symbols-outlined text-5xl text-secondary animate-spin">progress_activity</span>
          <h2 className="mt-4 text-2xl font-headline font-bold">Loading queue</h2>
          <p className="mt-3 text-sm text-on-surface-variant">Checking the latest store status and your live ticket.</p>
        </div>
      </div>
    );
  }

  if (queueError && !storeMeta && !storeMissing) {
    return (
      <div className="min-h-screen bg-background text-white flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-surface-container p-8 text-center">
          <span className="material-symbols-outlined text-5xl text-error">wifi_off</span>
          <h2 className="mt-4 text-2xl font-headline font-bold">Queue unavailable</h2>
          <p className="mt-3 text-sm text-on-surface-variant">{queueError}</p>
          <button
            type="button"
            onClick={() => { window.location.reload(); }}
            className="mt-6 w-full rounded-xl bg-gradient-to-r from-primary-container to-secondary py-3 font-headline font-bold text-white"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
  if (storeMissing) {
    return (
      <div className="min-h-screen bg-background text-white flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-surface-container p-8 text-center">
          <span className="material-symbols-outlined text-5xl text-on-surface-variant">search_off</span>
          <h2 className="mt-4 text-2xl font-headline font-bold">Store not found</h2>
          <p className="mt-3 text-sm text-on-surface-variant">
            This queue link is not active right now, or the store may have been removed.
          </p>
          <button
            type="button"
            onClick={() => { window.location.href = "/"; }}
            className="mt-6 w-full rounded-xl bg-gradient-to-r from-primary-container to-secondary py-3 font-headline font-bold text-white"
          >
            Back to search
          </button>
        </div>
      </div>
    );
  }

  if (isServed) {
    return (
      <div className="flex min-h-[100dvh] flex-col overflow-hidden dark">
        <header className="fixed top-0 w-full z-50 bg-[#131318]/80 backdrop-blur-xl border-b border-white/10 shadow-[0_8px_32px_0_rgba(124,58,237,0.04)]">
          <div className="flex w-full max-w-7xl items-center justify-between px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-4 sm:px-6">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  clearActiveQueueTicket();
                  window.location.href = "/";
                }}
                className="w-10 h-10 rounded-full bg-surface-container-high border border-white/10 flex items-center justify-center text-on-surface-variant hover:text-white hover:bg-white/10 transition-colors"
                aria-label="Back to search"
              >
                <span className="material-symbols-outlined">arrow_back</span>
              </button>
              <span className="material-symbols-outlined text-violet-500">blur_on</span>
              <h1 className="text-xl font-bold bg-gradient-to-r from-[#7C3AED] to-[#22D3EE] bg-clip-text text-transparent font-['Space_Grotesk'] tracking-tight">
                Ghost Queue
              </h1>
            </div>
            <LanguagePicker locale={locale} onChange={setLocale} label={t("language", "Language")} />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto pt-24 pb-12 flex flex-col items-center justify-center text-center relative px-4">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-72 bg-tertiary/10 blur-3xl -z-10 rounded-full"></div>

          <div className="w-20 h-20 rounded-full bg-tertiary/10 flex items-center justify-center border border-tertiary/20 mb-6 relative z-10">
            <span className="material-symbols-outlined text-[40px] text-tertiary">check</span>
          </div>

          <h2 className="text-4xl font-headline font-bold text-on-surface mb-2 relative z-10">
            {guestProfile.name ? `It's your turn, ${guestProfile.name}!` : "It's your turn!"}
          </h2>
          <p className="text-on-surface-variant text-sm max-w-[280px] leading-relaxed mb-6 relative z-10">
            Please head to the counter now. Your order is ready for pickup.
          </p>

          <div
            className="px-4 py-2 rounded-full glass-glow border border-white/10 flex items-center gap-2 relative z-10 mb-8"
            style={{ backgroundImage: storeTheme.mutedGradient }}
          >
            <span className="material-symbols-outlined text-sm text-tertiary">store</span>
            <span className="text-xs font-label uppercase tracking-wider text-on-surface">
              {storeName}
            </span>
          </div>

          <button
            onClick={() => {
              clearActiveQueueTicket();
              window.location.href = "/";
            }}
            className="w-full max-w-[320px] bg-gradient-to-r from-primary-container to-secondary text-white font-headline font-semibold py-3.5 rounded-xl shadow-[0_4px_14px_rgba(124,58,237,0.3)] transition-transform active:scale-95 relative z-10"
          >
            DONE
          </button>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-[100dvh] flex-col overflow-hidden dark">
      <header className="fixed top-0 w-full z-50 bg-[#131318]/80 backdrop-blur-xl border-b border-white/10 shadow-[0_8px_32px_0_rgba(124,58,237,0.04)]">
        <div className="flex w-full max-w-7xl items-center justify-between px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-4 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                window.location.href = "/";
              }}
              className="w-10 h-10 rounded-full bg-surface-container-high border border-white/10 flex items-center justify-center text-on-surface-variant hover:text-white hover:bg-white/10 transition-colors"
              aria-label="Back to search"
            >
              <span className="material-symbols-outlined">arrow_back</span>
            </button>
            <span className="material-symbols-outlined text-violet-500">blur_on</span>
            <h1 className="text-xl font-bold bg-gradient-to-r from-[#7C3AED] to-[#22D3EE] bg-clip-text text-transparent font-['Space_Grotesk'] tracking-tight">
              Ghost Queue
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSoundEnabled((prev) => !prev)}
              className={`w-10 h-10 rounded-full border flex items-center justify-center ${soundEnabled ? "bg-surface-container-high border-white/10 text-on-surface-variant" : "border-error/20 bg-error/10 text-error"}`}
              aria-label={soundEnabled ? "Mute alerts" : "Unmute alerts"}
              title={soundEnabled ? "Mute alerts" : "Unmute alerts"}
            >
              <span className="material-symbols-outlined text-sm">{soundEnabled ? "volume_up" : "volume_off"}</span>
            </button>
            <button
              type="button"
              onClick={toggleFavorite}
              className={`w-10 h-10 rounded-full border flex items-center justify-center ${favorite ? "border-secondary/20 bg-secondary/10 text-secondary" : "bg-surface-container-high border-white/10 text-on-surface-variant"}`}
              aria-label={favorite ? "Remove favorite" : "Add favorite"}
            >
              <span className="material-symbols-outlined" style={favorite ? { fontVariationSettings: "'FILL' 1" } : {}}>
                favorite
              </span>
            </button>
            <LanguagePicker locale={locale} onChange={setLocale} label={t("language", "Language")} />
            <div className="flex items-center gap-2 px-3 py-1 bg-surface-container-high rounded-full border border-white/5">
              <span className={`w-2 h-2 rounded-full animate-pulse ${isOpen ? "bg-tertiary" : "bg-error"}`}></span>
              <span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                {isOpen ? (canJoin ? t("live", "Live") : storeStatus.joinLabel) : storeStatus.label}
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto overscroll-contain pt-24 pb-8 px-6 flex flex-col items-center">
        {activeTab === "queue" && (
          <div className="w-full max-w-[420px] space-y-6 my-auto">
            {!isOnline && (
              <section className="rounded-2xl border border-error/20 bg-error/10 px-4 py-3 text-sm text-on-surface glass-glow">
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined text-error">wifi_off</span>
                  <div>
                    <p className="font-semibold text-on-surface">Offline mode</p>
                    <p className="mt-1 text-on-surface-variant">
                      Your saved ticket stays on this device. Live position updates will resume once your connection returns.
                    </p>
                  </div>
                </div>
              </section>
            )}

            {installPromptEvent && (
              <section className="rounded-2xl border border-secondary/20 bg-secondary/10 px-4 py-3 text-sm text-on-surface glass-glow">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-on-surface">Install Ghost Queue</p>
                    <p className="mt-1 text-on-surface-variant">
                      Add this queue to your home screen for faster access and better ticket recovery.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleInstallApp}
                    className="rounded-full bg-secondary px-4 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-950"
                  >
                    Install
                  </button>
                </div>
              </section>
            )}

            {storeMeta?.cover_image_url && (
              <section
                className="h-40 w-full rounded-3xl border border-white/5 bg-cover bg-center glass-glow"
                style={{ backgroundImage: `linear-gradient(rgba(19,19,24,0.2), rgba(19,19,24,0.75)), url(${storeMeta.cover_image_url})` }}
              ></section>
            )}
            {storeMeta?.announcement && (
              <section
                className="rounded-2xl border border-white/10 px-4 py-3 text-sm text-on-surface glass-glow"
                style={{ backgroundImage: storeTheme.mutedGradient }}
              >
                {storeMeta.announcement}
              </section>
            )}

            <section className="rounded-2xl border border-white/5 bg-surface-container-low/60 backdrop-blur-xl px-4 py-3 flex items-start gap-3 glass-glow">
              <span className={`mt-1 inline-flex h-3 w-3 rounded-full ${statusToneClass.split(" ")[0]}`}></span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-on-surface">{storeName}</p>
                <p className="text-xs text-on-surface-variant mt-1">
                  {joinStateMessage}
                </p>
              </div>
            </section>

            {!isOpen ? (
              <section className="flex flex-col items-center gap-4 text-center px-6 py-10 bg-surface-container-low/60 backdrop-blur-xl rounded-2xl border border-white/5 glass-glow">
                <span className="material-symbols-outlined text-5xl text-on-surface-variant">
                  storefront
                </span>
                <h2 className="text-2xl font-headline font-bold text-on-surface">
                  {storeName} {t("closed", "Closed")}
                </h2>
                <p className="text-on-surface-variant text-sm">
                  {storeStatus.reason || t("queueClosed", "The queue is not active right now. Come back when the store opens.")}
                </p>
              </section>
            ) : !canJoin && !isJoined ? (
              <section className="rounded-2xl border border-white/5 bg-surface-container-low/60 px-6 py-6 text-center glass-glow">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-white/10 bg-surface-container-high">
                  <span className="material-symbols-outlined text-3xl text-on-surface-variant">
                    hourglass_pause
                  </span>
                </div>
                <h2 className="mt-4 text-2xl font-headline font-bold text-on-surface">
                  {storeStatus.joinLabel || "Joins temporarily unavailable"}
                </h2>
                <p className="mt-3 text-sm text-on-surface-variant">
                  {joinStateMessage}
                </p>
                <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => window.location.reload()}
                    className="flex-1 rounded-xl bg-gradient-to-r from-primary-container to-secondary py-3 font-headline font-bold text-white"
                  >
                    Refresh status
                  </button>
                  <button
                    type="button"
                    onClick={() => window.location.href = "/"}
                    className="flex-1 rounded-xl border border-white/10 py-3 font-headline font-bold text-on-surface"
                  >
                    Find another store
                  </button>
                </div>
              </section>
            ) : isJoined ? (
              <>
                {/* 4-Stage Stepper */}
                <section className="grid grid-cols-4 gap-1 text-center py-2.5 px-2 bg-surface-container-low/80 backdrop-blur-md rounded-2xl border border-white/5 shadow-inner">
                  {[
                    { label: "Joined", done: true },
                    { label: "In Line", done: position <= Math.max(2, Math.floor(totalInQueue * 0.75)) },
                    { label: "Almost Up", done: position <= 2 },
                    { label: "Ready!", done: position === 1 },
                  ].map((s, idx) => (
                    <div key={idx} className="flex flex-col items-center">
                      <span
                        className={`w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center mb-1 transition-all ${
                          s.done
                            ? "bg-emerald-400 text-slate-950 shadow-md shadow-emerald-400/30 scale-105"
                            : "bg-white/10 text-on-surface-variant/50"
                        }`}
                      >
                        {s.done ? "✓" : idx + 1}
                      </span>
                      <span
                        className={`text-[9px] font-label uppercase tracking-tight ${
                          s.done ? "text-emerald-400 font-semibold" : "text-on-surface-variant/60"
                        }`}
                      >
                        {s.label}
                      </span>
                    </div>
                  ))}
                </section>

                {/* Holographic Boarding Pass Ticket */}
                <div
                  className={`ticket-notch-container rounded-3xl p-6 glass-panel-elevated border transition-all ${
                    position === 1
                      ? "border-emerald-400/50 neon-border-emerald bg-emerald-950/20"
                      : "border-white/15 neon-border-violet bg-surface-container/70"
                  }`}
                >
                  <div className="ticket-notch-left" />
                  <div className="ticket-notch-right" />

                  {/* Ticket Header */}
                  <div className="flex items-center justify-between pb-4 border-b border-white/10">
                    <div className="flex items-center gap-2.5">
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center border border-white/10"
                        style={{ backgroundImage: storeTheme.mutedGradient }}
                      >
                        <span className="material-symbols-outlined text-primary text-xl">
                          {storeMeta?.store_logo || "storefront"}
                        </span>
                      </div>
                      <div>
                        <p className="font-bold text-sm text-white truncate max-w-[180px]">
                          {storeName}
                        </p>
                        <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-label">
                          Virtual Ticket Pass
                        </p>
                      </div>
                    </div>

                    <span
                      className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        position === 1
                          ? "bg-emerald-400 text-slate-950 animate-pulse font-bold"
                          : myEntry?.fast_pass
                            ? "bg-secondary text-slate-950 font-bold"
                            : "bg-primary/20 text-primary border border-primary/30"
                      }`}
                    >
                      {position === 1
                        ? "⚡ CALLING YOU"
                        : myEntry?.fast_pass
                          ? "⚡ FAST PASS"
                          : "STANDARD PASS"}
                    </span>
                  </div>

                  {/* Main Ticket Center: Queue Position */}
                  <div className="py-6 text-center relative">
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-40 h-40 bg-primary/20 rounded-full blur-3xl pointer-events-none" />

                    <p className="text-[11px] uppercase tracking-[0.2em] text-on-surface-variant font-label mb-1">
                      {t("inQueue", "Queue Position")}
                    </p>

                    <div className="relative inline-block my-2">
                      <h2
                        className={`text-8xl font-headline font-bold tracking-tighter ${
                          position === 1
                            ? "text-emerald-400 drop-shadow-[0_0_25px_rgba(16,185,129,0.5)]"
                            : "text-white drop-shadow-[0_0_25px_rgba(124,58,237,0.4)]"
                        }`}
                      >
                        #{position}
                      </h2>
                    </div>

                    {position === 1 ? (
                      <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-400/20 border border-emerald-400/40 text-emerald-300 font-bold text-xs">
                        <span className="material-symbols-outlined text-sm animate-bounce">door_front</span>
                        Proceed to {myEntry?.service_counter || "the counter"} now!
                      </div>
                    ) : (
                      <p className="text-sm text-on-surface-variant mt-1">
                        Estimated wait: <strong className="text-white">~{waitMins} min</strong> ·{" "}
                        {peopleAhead} {peopleAhead === 1 ? "party" : "parties"} ahead
                      </p>
                    )}
                  </div>

                  {/* Perforation line */}
                  <div className="ticket-perforation my-3 pt-3 flex items-center justify-between text-xs text-on-surface-variant" />

                  {/* Ticket Details Grid */}
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="bg-white/5 rounded-xl p-2.5 border border-white/5">
                      <span className="text-[9px] uppercase tracking-wider text-on-surface-variant/70 font-label block">
                        Guest Name
                      </span>
                      <span className="font-bold text-white truncate block mt-0.5">
                        {myEntry?.display_name || guestProfile.name || "Guest"}
                      </span>
                    </div>

                    <div className="bg-white/5 rounded-xl p-2.5 border border-white/5">
                      <span className="text-[9px] uppercase tracking-wider text-on-surface-variant/70 font-label block">
                        Party Size
                      </span>
                      <span className="font-bold text-white block mt-0.5">
                        {myEntry?.member_count || guestProfile.members || 1} people
                      </span>
                    </div>

                    <div className="bg-white/5 rounded-xl p-2.5 border border-white/5">
                      <span className="text-[9px] uppercase tracking-wider text-on-surface-variant/70 font-label block">
                        Joined At
                      </span>
                      <span className="font-bold text-white block mt-0.5">{joinedAt}</span>
                    </div>

                    <div className="bg-white/5 rounded-xl p-2.5 border border-white/5">
                      <span className="text-[9px] uppercase tracking-wider text-on-surface-variant/70 font-label block">
                        Service Desk
                      </span>
                      <span className="font-bold text-secondary block mt-0.5">
                        {myEntry?.service_counter || "Counter 1"}
                      </span>
                    </div>
                  </div>

                  {/* Show QR Toggle button */}
                  <div className="mt-4 pt-3 border-t border-white/10 text-center">
                    <button
                      type="button"
                      onClick={() => setShowPassQR(!showPassQR)}
                      className="w-full py-2.5 px-4 rounded-xl bg-surface-container-high hover:bg-white/10 border border-white/10 text-xs font-bold text-on-surface transition-all flex items-center justify-center gap-2"
                    >
                      <span className="material-symbols-outlined text-base">qr_code_2</span>
                      {showPassQR ? "Hide QR Code" : "Show Ticket QR Pass"}
                    </button>

                    {showPassQR && passQrUrl && (
                      <div className="mt-3 p-4 bg-white rounded-2xl flex flex-col items-center justify-center animate-[fade-in_0.2s_ease-out]">
                        <img
                          src={passQrUrl}
                          alt="Ticket QR Code"
                          className="w-48 h-48 rounded-lg"
                        />
                        <p className="text-[11px] text-slate-800 font-bold mt-2">
                          Show this code at the counter for instant check-in
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Quick Action Grid */}
                <section className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={handleShareTicket}
                    className="p-3.5 rounded-2xl glass-panel hover:bg-white/10 border border-white/10 text-left transition-all group"
                  >
                    <div className="flex items-center gap-2 text-primary text-xs font-bold mb-1">
                      <span className="material-symbols-outlined text-sm">share</span>
                      Share Ticket
                    </div>
                    <p className="text-[11px] text-on-surface-variant truncate">Send live pass link</p>
                  </button>

                  <button
                    type="button"
                    onClick={handleExportTicketImage}
                    className="p-3.5 rounded-2xl glass-panel hover:bg-white/10 border border-white/10 text-left transition-all group"
                  >
                    <div className="flex items-center gap-2 text-secondary text-xs font-bold mb-1">
                      <span className="material-symbols-outlined text-sm">download</span>
                      Save Pass PNG
                    </div>
                    <p className="text-[11px] text-on-surface-variant truncate">Download offline card</p>
                  </button>
                </section>

                {myEntry?.party_note && (
                  <section className="bg-surface-container-low/60 backdrop-blur-xl p-5 rounded-2xl glass-glow border border-white/5">
                    <span className="text-[10px] text-on-surface-variant font-label uppercase tracking-wider">
                      {t("partyNotes", "Party notes")}
                    </span>
                    <p className="text-sm text-on-surface mt-2">{myEntry.party_note}</p>
                  </section>
                )}

                {myEntry?.service_counter && (
                  <section className="bg-surface-container-low/60 backdrop-blur-xl p-5 rounded-2xl glass-glow border border-white/5">
                    <span className="text-[10px] text-on-surface-variant font-label uppercase tracking-wider">
                      Service counter
                    </span>
                    <p className="text-sm text-on-surface mt-2">{myEntry.service_counter}</p>
                  </section>
                )}

                {error && <p className="text-error text-center text-sm">{error}</p>}
                {notificationPermission === "denied" && (
                  <p className="text-on-surface-variant text-center text-xs">
                    Browser notifications are blocked. Keep this page open to know when it is your turn.
                  </p>
                )}
              </>
            ) : !canJoin ? (
              <section className="flex flex-col items-center gap-4 text-center px-6 py-10 bg-surface-container-low/60 backdrop-blur-xl rounded-2xl border border-white/5 glass-glow">
                <span className="material-symbols-outlined text-5xl text-secondary">
                  pause_circle
                </span>
                <h2 className="text-2xl font-headline font-bold text-on-surface">
                  Queue temporarily unavailable
                </h2>
                <p className="text-on-surface-variant text-sm">
                  {storeStatus.reason || "This store is open, but new joins are paused right now."}
                </p>
                <div className="rounded-full bg-surface-container-high px-4 py-2 text-[11px] uppercase tracking-[0.18em] text-on-surface-variant">
                  {totalInQueue} parties • {totalMembersWaiting} members already waiting
                </div>
              </section>
            ) : (
              <>
                <section className="text-center space-y-2">
                  <p className="text-on-surface-variant font-label tracking-[0.15em] uppercase text-xs">
                    {storeName}
                  </p>
                  <div className="relative inline-block mt-4">
                    <h2 className="text-4xl font-headline font-bold text-on-surface tracking-tighter">
                      {t("joinQueue", "Join Queue")}
                    </h2>
                  </div>
                  <p className="text-on-surface-variant text-sm font-medium">
                    {totalInQueue} {totalInQueue === 1 ? "party" : "parties"} • {totalMembersWaiting} members waiting
                  </p>
                </section>

                {error && <p className="text-error text-center text-sm">{error}</p>}
                <JoinQueueForm onJoin={handleJoin} storeName={storeName} />
              </>
            )}
          </div>
        )}

        {activeTab === "fastpass" && (
          <div className="w-full max-w-[420px] bg-surface-container-low/60 backdrop-blur-xl p-8 rounded-2xl glass-glow border border-white/5 text-center">
            <span className="material-symbols-outlined text-5xl text-secondary mb-4">bolt</span>
            <h2 className="text-2xl font-headline font-bold mb-2">Fast Pass</h2>
            {storeMeta?.fast_pass_price ? (
              <div className="mb-6">
                <p className="text-on-surface-variant text-sm mb-4">
                  Skip the line and jump straight to the front for a premium fee.
                </p>
                <div className="bg-surface-container border border-secondary/20 rounded-xl p-4 inline-block mb-2">
                  <p className="text-xs uppercase tracking-widest text-on-surface-variant font-bold mb-1">
                    Price per pass
                  </p>
                  <p className="text-3xl font-headline font-bold text-secondary">
                    Rs.{Number(storeMeta.fast_pass_price).toLocaleString("en-IN")}
                  </p>
                </div>
                <p className="text-xs text-error mt-2 font-medium">
                  Payment integration coming soon. Pay at counter.
                </p>
              </div>
            ) : (
              <p className="text-on-surface-variant text-sm mb-6">
                Fast Pass is currently disabled for this store.
              </p>
            )}
            <button
              disabled
              className="w-full bg-surface-container-highest text-on-surface-variant font-bold py-3 rounded-xl opacity-50 cursor-not-allowed"
            >
              PURCHASE FAST PASS
            </button>
          </div>
        )}

        {activeTab === "profile" && (
          <div className="w-full max-w-[420px] bg-surface-container-low/60 backdrop-blur-xl p-8 rounded-2xl glass-glow border border-white/5 text-center">
            <div className="w-20 h-20 bg-surface-container rounded-full mx-auto mb-4 flex items-center justify-center border border-white/10">
              <span className="material-symbols-outlined text-3xl text-primary">person</span>
            </div>
            <h2 className="text-xl font-headline font-bold mb-2">
              {guestProfile.name || `${t("guest", "Guest")} User`}
            </h2>
            <p className="text-xs text-on-surface-variant font-mono bg-surface-container px-3 py-1.5 rounded-lg inline-block mb-3">
              ID: {userId}
            </p>
            <p className="text-sm text-on-surface-variant mb-3">
              Party size: {myEntry?.member_count || guestProfile.members || 1}
            </p>
            <p className="text-sm text-on-surface-variant mb-3">
              Phone: {myEntry?.phone_number || guestProfile.phone || "-"}
            </p>
            {myEntry?.party_note && (
              <p className="text-sm text-on-surface-variant mb-8">
                Note: {myEntry.party_note}
              </p>
            )}
            {myEntry?.service_counter && (
              <p className="text-sm text-on-surface-variant mb-4">
                Counter: {myEntry.service_counter}
              </p>
            )}

            <div className="grid grid-cols-2 gap-3 mb-8">
              <a
                href={`https://wa.me/?text=${encodeURIComponent(`${storeName} queue ticket ${queueLink}`)}`}
                target="_blank"
                rel="noreferrer"
                className="bg-surface-container border border-white/10 px-4 py-3 rounded-xl text-xs font-semibold"
              >
                WhatsApp
              </a>
              <a
                href={`sms:?&body=${encodeURIComponent(`${storeName} queue ticket ${queueLink}`)}`}
                className="bg-surface-container border border-white/10 px-4 py-3 rounded-xl text-xs font-semibold"
              >
                SMS
              </a>
            </div>

            {isJoined && (
              <button
                type="button"
                onClick={handleExportTicketImage}
                className="mb-4 w-full rounded-xl bg-surface-container-high px-4 py-3 text-sm font-semibold"
              >
                Download ticket image
              </button>
            )}

            {isJoined && (
              <button
                onClick={() => setConfirmLeaveOpen(true)}
                disabled={leaving}
                className="w-full border border-error/50 text-error hover:bg-error/10 font-bold py-3 rounded-xl transition-colors disabled:opacity-50"
              >
                {leaving ? "LEAVING..." : t("leaveQueue", "Leave Queue")}
              </button>
            )}
          </div>
        )}
      </main>

      {isJoined && position <= 5 && activeTab === "queue" && (
        <div className="fixed bottom-24 right-6 group z-40">
          <div className="absolute right-full mr-3 top-1/2 -translate-y-1/2 bg-surface-container-high text-on-surface text-[10px] px-3 py-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap border border-white/10 font-label uppercase tracking-widest">
            Delay my turn
          </div>
          <button
            onClick={handleSmartSkip}
            className="w-14 h-14 rounded-full shadow-[0_8px_24px_rgba(124,58,237,0.3)] flex items-center justify-center text-white active:scale-90 transition-transform relative"
            style={{ backgroundImage: storeTheme.gradient }}
          >
            <span className="material-symbols-outlined">schedule</span>
            <span className="absolute inset-0 rounded-full animate-ping-slow bg-primary/40 -z-10"></span>
          </button>
        </div>
      )}

      <nav
        className="sticky bottom-0 inset-x-0 z-50 bg-[#131318]/95 backdrop-blur-2xl border-t border-white/5 rounded-t-2xl shadow-[0_-8px_32px_0_rgba(0,0,0,0.5)]"
        style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}
      >
        <div className="flex justify-around items-center pt-3 px-4">
          <button
            onClick={() => setActiveTab("queue")}
            className={`flex flex-col items-center justify-center group w-16 ${activeTab === "queue" ? "text-secondary font-bold" : "text-[#e4e1e9]/40 hover:bg-white/5 rounded-xl py-1 transition-all"}`}
          >
            <span
              className="material-symbols-outlined mb-1 transition-transform group-active:scale-90"
              style={activeTab === "queue" ? { fontVariationSettings: "'FILL' 1" } : {}}
            >
              hourglass_empty
            </span>
            <span className="font-['Inter'] text-[10px] uppercase tracking-[0.05em]">Queue</span>
          </button>
          <button
            onClick={() => setActiveTab("fastpass")}
            className={`flex flex-col items-center justify-center group w-16 ${activeTab === "fastpass" ? "text-secondary font-bold" : "text-[#e4e1e9]/40 hover:bg-white/5 rounded-xl py-1 transition-all"}`}
          >
            <span
              className="material-symbols-outlined mb-1 transition-transform group-active:scale-90"
              style={activeTab === "fastpass" ? { fontVariationSettings: "'FILL' 1" } : {}}
            >
              bolt
            </span>
            <span className="font-['Inter'] text-[10px] uppercase tracking-[0.05em]">Fast Pass</span>
          </button>
          <button
            onClick={() => setActiveTab("profile")}
            className={`flex flex-col items-center justify-center group w-16 ${activeTab === "profile" ? "text-secondary font-bold" : "text-[#e4e1e9]/40 hover:bg-white/5 rounded-xl py-1 transition-all"}`}
          >
            <span
              className="material-symbols-outlined mb-1 transition-transform group-active:scale-90"
              style={activeTab === "profile" ? { fontVariationSettings: "'FILL' 1" } : {}}
            >
              person
            </span>
            <span className="font-['Inter'] text-[10px] uppercase tracking-[0.05em]">{t("profile", "Profile")}</span>
          </button>
        </div>
      </nav>
      <ToastStack
        toasts={toasts}
        onDismiss={dismissToast}
      />
      <ConfirmDialog
        open={confirmLeaveOpen}
        title="Leave queue?"
        message="Your current position will be removed, and your ticket will move into history."
        confirmLabel={leaving ? "Leaving..." : "Leave queue"}
        cancelLabel="Stay in queue"
        tone="danger"
        onCancel={() => !leaving && setConfirmLeaveOpen(false)}
        onConfirm={handleLeaveQueue}
      />
    </div>
  );
}








