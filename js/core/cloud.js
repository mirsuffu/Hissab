// Firebase layer: Google sign-in, public profile + unique ID, user search, 1:1 chat, attachments, and the data-sync adapter.
// Needs js/firebase-config.js to be filled in. Data model and the security rules it relies on: docs/CHAT_SPEC.md.
import { firebaseConfig } from '../firebase-config.js';
import { logger } from './log.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
const PROFILE_KEY = 'hisaab.cloud_profile';
let cachedProfile = null;
try { cachedProfile = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'); } catch {}

let F = null, auth, db, me = null, profile = cachedProfile, booting = null;
const subs = new Set();
const emit = () => subs.forEach(f => f());

export const configured = () => !!firebaseConfig;
export const onChange = f => (subs.add(f), () => subs.delete(f));
export const refresh = emit;
export const state = () => ({ configured: configured(), ready: !!F, user: me, profile });

export const MAX_DOC_SIZE = 100 * 1024; // 100 KB max for inline text/data docs

// Resolves after the first auth state is known (signed in or not).
export function init() {
  if (!configured()) return Promise.resolve();
  return (booting ??= (async () => {
    const [A, Au, Fs] = await Promise.all(['app', 'auth', 'firestore'].map(m => import(`${SDK}/firebase-${m}.js`)));
    const app = A.initializeApp(firebaseConfig);
    auth = Au.getAuth(app);
    try {
      if (Au.setPersistence && Au.indexedDBLocalPersistence) {
        await Au.setPersistence(auth, Au.indexedDBLocalPersistence);
      }
    } catch {}
    db = Fs.initializeFirestore(app, { localCache: Fs.persistentLocalCache({ tabManager: Fs.persistentMultipleTabManager() }) });
    F = { A, Au, Fs };
    await new Promise(res => {
      let first = true;
      Au.onAuthStateChanged(auth, async u => {
        me = u;
        if (u) {
          const fresh = await loadProfile(u.uid).catch(() => null);
          if (fresh) {
            profile = fresh;
            try { localStorage.setItem(PROFILE_KEY, JSON.stringify(fresh)); } catch {}
          } else {
            profile = cachedProfile?.uid === u.uid ? cachedProfile : null;
          }
        } else {
          profile = null;
          try { localStorage.removeItem(PROFILE_KEY); } catch {}
        }
        first ? ((first = false), res()) : emit();
      });
    });
    logger.info('Cloud connected', { signedIn: !!me });
  })());
}

const need = () => { if (!F) throw new Error('Cloud is not ready'); if (!me) throw new Error('Sign in first'); };
async function loadProfile(uid) { const s = await F.Fs.getDoc(F.Fs.doc(db, 'users', uid)); return s.exists() ? s.data() : null; }
export async function getUser(uid) { need(); return loadProfile(uid); }

export async function signIn() { await init(); await F.Au.signInWithPopup(auth, new F.Au.GoogleAuthProvider()); }
export async function signOut() {
  try { localStorage.removeItem(PROFILE_KEY); } catch {}
  profile = null;
  await F.Au.signOut(auth);
  emit();
}

// ---- profile & unique ID -----------------------------------------------------------------
const HANDLE = /^[a-z0-9._]{3,20}$/;
export async function claimHandle(raw, name) {
  need();
  const h = raw.trim().toLowerCase().replace(/^@/, ''), nm = name.trim();
  if (!HANDLE.test(h)) throw new Error('ID must be 3–20 characters: letters, numbers, dot, underscore');
  if (!nm) throw new Error('Enter a display name');
  const { doc, runTransaction } = F.Fs, user = { uid: me.uid, handle: h, name: nm, nameLower: nm.toLowerCase(), discoverable: true, createdAt: Date.now() };
  await runTransaction(db, async tx => {
    if ((await tx.get(doc(db, 'handles', h))).exists()) throw new Error('That ID is already taken');
    tx.set(doc(db, 'handles', h), { uid: me.uid });
    tx.set(doc(db, 'users', me.uid), user);
    tx.set(doc(db, 'directory', me.uid), { uid: me.uid, handle: h, name: nm, nameLower: user.nameLower });
  });
  profile = user; emit(); logger.info('Chat ID claimed', { handle: h });
}
export async function updateProfile({ name, discoverable }) {
  need(); const { doc, updateDoc, setDoc, deleteDoc } = F.Fs, nm = (name ?? profile.name).trim(), disc = discoverable ?? profile.discoverable;
  await updateDoc(doc(db, 'users', me.uid), { name: nm, nameLower: nm.toLowerCase(), discoverable: disc });
  if (disc) await setDoc(doc(db, 'directory', me.uid), { uid: me.uid, handle: profile.handle, name: nm, nameLower: nm.toLowerCase() });
  else await deleteDoc(doc(db, 'directory', me.uid));
  profile = { ...profile, name: nm, nameLower: nm.toLowerCase(), discoverable: disc }; emit();
}

// ---- search: exact ID, or name prefix (only people who chose to be discoverable) ----------------
export async function search(text) {
  need(); const { doc, getDoc, collection, query, where, limit, getDocs } = F.Fs;
  const s = text.trim().toLowerCase().replace(/^@/, ''); if (!s) return [];
  const found = new Map();
  if (HANDLE.test(s)) { const h = await getDoc(doc(db, 'handles', s)); if (h.exists()) { const u = await loadProfile(h.data().uid); if (u) found.set(u.uid, u); } }
  const snap = await getDocs(query(collection(db, 'directory'), where('nameLower', '>=', s), where('nameLower', '<=', s + '\uf8ff'), limit(10)));
  snap.docs.forEach(d => found.set(d.id, d.data()));
  found.delete(me.uid);
  return [...found.values()];
}

// ---- chat ---------------------------------------------------------------------------------
export const chatId = (a, b) => [a, b].sort().join('_');
export function watchChats(cb) {
  need(); const { collection, query, where, onSnapshot } = F.Fs;
  return onSnapshot(query(collection(db, 'chats'), where('members', 'array-contains', me.uid)),
    s => cb(s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => b.updatedAt - a.updatedAt)), e => logger.warn('Chat list listener', { error: String(e) }));
}
export function watchChat(id, cb) { need(); return F.Fs.onSnapshot(F.Fs.doc(db, 'chats', id), s => cb(s.exists() ? { id, ...s.data() } : null), () => cb(null)); }
export function watchMessages(id, cb) {
  need(); const { collection, query, orderBy, limit, onSnapshot } = F.Fs;
  return onSnapshot(query(collection(db, 'chats', id, 'messages'), orderBy('ts', 'desc'), limit(100)), s => cb(s.docs.map(d => ({ id: d.id, ...d.data() })).reverse()), () => cb([]));
}

export function validateDoc(file) {
  if (file.size > MAX_DOC_SIZE) return 'Document must be under 100 KB.';
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const allowed = ['csv', 'tsv', 'txt', 'md', 'json', 'doc', 'xls', 'html'];
  if (!allowed.includes(ext) && !file.type.startsWith('text/')) {
    return 'Please attach a text-based document (CSV, TXT, Markdown, JSON).';
  }
  return '';
}

export async function send(other, text, docPayload = null) {
  need(); const { doc, collection, getDoc, writeBatch, increment } = F.Fs, id = chatId(me.uid, other.uid), ref = doc(db, 'chats', id);
  const snap = await getDoc(ref), chat = snap.exists() ? snap.data() : null, t = (text || '').trim();
  if (!t && !docPayload) throw new Error('Type a message or attach a document');
  if (chat?.status === 'blocked') throw new Error('This chat is blocked');
  if (chat?.status === 'pending') throw new Error(chat.requester === me.uid ? 'Waiting for them to accept your request' : 'Accept the request to reply');
  const now = Date.now();
  const lastText = t || (docPayload ? `📄 ${docPayload.name}` : '');
  const last = { text: lastText.slice(0, 80), ts: now, from: me.uid }, batch = writeBatch(db);
  if (!chat) {
    batch.set(ref, {
      members: [me.uid, other.uid].sort(), status: 'pending', requester: me.uid, createdAt: now, updatedAt: now,
      lastMessage: last, unread: { [me.uid]: 0, [other.uid]: 1 },
      names: { [me.uid]: profile.name, [other.uid]: other.name },
      handles: { [me.uid]: profile.handle, [other.uid]: other.handle }
    });
  } else {
    batch.update(ref, { updatedAt: now, lastMessage: last, [`unread.${other.uid}`]: increment(1) });
  }
  const msgRef = doc(collection(db, 'chats', id, 'messages'));
  batch.set(msgRef, { from: me.uid, text: t, ts: now, ...(docPayload && { doc: docPayload }) });
  await batch.commit();
}
export const respond = (id, accept) => (need(), F.Fs.updateDoc(F.Fs.doc(db, 'chats', id), accept ? { status: 'accepted' } : { status: 'blocked', blockedBy: me.uid }));
export const block = id => (need(), F.Fs.updateDoc(F.Fs.doc(db, 'chats', id), { status: 'blocked', blockedBy: me.uid }));
export const unblock = id => (need(), F.Fs.updateDoc(F.Fs.doc(db, 'chats', id), { status: 'accepted', blockedBy: F.Fs.deleteField() }));
export const markRead = id => (need(), F.Fs.updateDoc(F.Fs.doc(db, 'chats', id), { [`unread.${me.uid}`]: 0 }).catch(() => {}));

// ---- data sync adapter (used by core/sync.js) ----------------------------------------------
// Your own data lives under users/{uid}/{kind}/{id}; only you can read it (see rules in the spec).
export function syncAdapter() {
  need(); const { collection, doc, setDoc, query, where, getDocs } = F.Fs, col = k => collection(db, 'users', me.uid, k);
  return {
    push: (kind, d) => setDoc(doc(col(kind), d.id), d),
    pullSince: async (kind, since) => (await getDocs(query(col(kind), where('updatedAt', '>', since)))).docs.map(d => d.data()),
  };
}

export async function wipeCloudData() {
  need();
  const { collection, getDocs, writeBatch } = F.Fs;
  for (const kind of ['profiles', 'funds', 'pots', 'categories', 'parties', 'transactions', 'recurring', 'audit']) {
    const snap = await getDocs(collection(db, 'users', me.uid, kind));
    if (!snap.empty) {
      const CHUNK = 450;
      for (let i = 0; i < snap.docs.length; i += CHUNK) {
        const batch = writeBatch(db);
        const slice = snap.docs.slice(i, i + CHUNK);
        slice.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
    }
  }
  logger.info('Cloud data wiped for user', { uid: me.uid });
}
