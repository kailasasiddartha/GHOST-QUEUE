/* global importScripts, firebase */
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyAPjUYMZjtvPQgPuc1AlQ9tOQ7NNHcbbpw",
  authDomain: "ghost-queue-4ddef.firebaseapp.com",
  projectId: "ghost-queue-4ddef",
  storageBucket: "ghost-queue-4ddef.firebasestorage.app",
  messagingSenderId: "394215346541",
  appId: "1:394215346541:web:37467130d03b8ed1338a64",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || "Ghost Queue";
  const options = {
    body: payload.notification?.body || "Queue update available.",
    icon: "/favicon.svg",
    data: payload.data || {},
  };

  self.registration.showNotification(title, options);
});
