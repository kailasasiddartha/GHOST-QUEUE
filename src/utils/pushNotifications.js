import { getToken, onMessage } from "firebase/messaging";
import { getFirebaseMessaging } from "../firebase";
import { updateFcmToken } from "./firestore";

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY || "";

export async function registerPushNotifications(storeId, userId) {
  if (!storeId || !userId || !VAPID_KEY) {
    return { enabled: false, reason: "missing-vapid-key" };
  }

  if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) {
    return { enabled: false, reason: "unsupported" };
  }

  const messaging = await getFirebaseMessaging();
  if (!messaging) {
    return { enabled: false, reason: "unsupported" };
  }

  const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
  const permission = await window.Notification.requestPermission();
  if (permission !== "granted") {
    return { enabled: false, reason: permission };
  }

  const token = await getToken(messaging, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration: registration,
  });

  if (!token) {
    return { enabled: false, reason: "token-unavailable" };
  }

  await updateFcmToken(storeId, userId, token);
  return { enabled: true, token };
}

export async function subscribeForegroundMessages(onNotification) {
  const messaging = await getFirebaseMessaging();
  if (!messaging) {
    return () => {};
  }

  return onMessage(messaging, (payload) => {
    onNotification?.(payload);
  });
}
