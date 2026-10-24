import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import {
  initializeFirestore,
  memoryLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
import { getMessaging, isSupported } from "firebase/messaging";

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyAPjUYMZjtvPQgPuc1AlQ9tOQ7NNHcbbpw",
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "ghost-queue-4ddef.firebaseapp.com",
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID || "ghost-queue-4ddef",
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "ghost-queue-4ddef.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "394215346541",
  appId:             import.meta.env.VITE_FIREBASE_APP_ID || "1:394215346541:web:37467130d03b8ed1338a64",
};

const app = initializeApp(firebaseConfig);

// Try to use persistent multi-tab IndexedDB storage.
// Falls back to in-memory cache if:
//   - Running in a private/incognito window (IndexedDB blocked)
//   - Another tab already has the lock on the IndexedDB persistence
//   - The browser doesn't support IndexedDB
let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentMultipleTabManager(),
  });
} catch {
  console.warn("[firebase] Falling back to in-memory Firestore cache.");
  db = initializeFirestore(app, {
    localCache: memoryLocalCache(),
  });
}

export { db };
export const auth            = getAuth(app);
export const googleProvider  = new GoogleAuthProvider();
export const messagingSupport = isSupported();

export async function getFirebaseMessaging() {
  const supported = await messagingSupport;
  if (!supported) return null;
  return getMessaging(app);
}

export default app;
