// Firebase bootstrapping and re-exports
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  signInAnonymously,
  signInWithCustomToken
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  addDoc,
  onSnapshot,
  deleteDoc,
  updateDoc,
  query,
  where,
  writeBatch,
  Timestamp,
  serverTimestamp,
  setLogLevel,
  runTransaction
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const userFallbackConfig = {
  apiKey: "AIzaSyDeMH7ONn9Lrfuanli4-UEZFBIMGwpqgaU",
  authDomain: "blinq-75546.firebaseapp.com",
  projectId: "blinq-75546",
  storageBucket: "blinq-75546.firebasestorage.app",
  messagingSenderId: "307852677571",
  appId: "1:307852677571:web:659e6003a82ebb14706d76",
  measurementId: "G-6RT2WEDP5G"
};

const firebaseConfig = typeof window !== 'undefined' && typeof window.__firebase_config !== 'undefined'
  ? JSON.parse(window.__firebase_config)
  : userFallbackConfig;

export const appId = typeof window !== 'undefined' && typeof window.__app_id !== 'undefined' ? window.__app_id : 'default-app-id';
export const isEnvironment = typeof window !== 'undefined' && typeof window.__app_id !== 'undefined' && window.__app_id !== 'default-app-id';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
setLogLevel('Debug');

// Re-exports for convenience
export {
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  signInAnonymously,
  signInWithCustomToken,
  doc,
  getDoc,
  setDoc,
  collection,
  addDoc,
  onSnapshot,
  deleteDoc,
  updateDoc,
  query,
  where,
  writeBatch,
  Timestamp,
  serverTimestamp,
  runTransaction
};


