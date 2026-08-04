import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js';
import { getDatabase } from 'https://www.gstatic.com/firebasejs/9.22.1/firebase-database.js';
import { APP_CONFIG } from '../config.js';

const app = getApps()[0] ?? initializeApp(APP_CONFIG.firebase);

export const auth = getAuth(app);
export const firestore = getFirestore(app);
export const realtime = getDatabase(app);

export function observeAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function loginWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return signInWithPopup(auth, provider);
}

export function logout() {
  return signOut(auth);
}
