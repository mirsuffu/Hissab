// Firebase web app config for Hisaab
// Protected by Firebase Auth + Firestore/Storage security rules.
const host = typeof window !== 'undefined' ? window.location.hostname : '';
const authDomain = (host && (host.endsWith('.web.app') || host.endsWith('.firebaseapp.com')))
  ? host
  : "hisaab-suf-01-fceb1.firebaseapp.com";

export const firebaseConfig = {
  apiKey: "AIzaSyAd-HD92kC_xlyuBcuSq-smDIaur3PiDsg",
  authDomain,
  projectId: "hisaab-suf-01-fceb1",
  storageBucket: "hisaab-suf-01-fceb1.firebasestorage.app",
  messagingSenderId: "995022796051",
  appId: "1:995022796051:web:da065a515bcdf9ff4e96e6"
};
