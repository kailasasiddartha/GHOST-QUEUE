import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
} from "firebase/auth";
import { auth, googleProvider } from "./firebase";
export { registerStore } from "./firestore";

export function subscribeToAuthState(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function getResolvedAuthUser() {
  await auth.authStateReady();
  return auth.currentUser;
}

export async function loginAdmin(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export async function loginAdminWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}
