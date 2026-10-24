import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import {
  initializeFirestore,
  memoryLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
import { getMessaging, isSupported } from "firebase/messaging";

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
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
