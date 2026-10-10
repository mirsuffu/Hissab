// Firebase layer: Google sign-in, public profile + unique ID, user search, 1:1 chat, attachments, and the data-sync adapter.
// Needs js/firebase-config.js to be filled in. Data model and the security rules it relies on: docs/CHAT_SPEC.md.
import { firebaseConfig } from '../firebase-config.js';
import { logger } from './log.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
let F = null, auth, db, storage, me = null, profile = null, booting = null;
const subs = new Set();
const emit = () => subs.forEach(f => f());

export const configured = () => !!firebaseConfig;
export const onChange = f => (subs.add(f), () => subs.delete(f));
export const refresh = emit;
export const state = () => ({ configured: configured(), ready: !!F, user: me, profile });

export const LIMITS = {
  image: 5 * 1024 * 1024, file: 10 * 1024 * 1024, imageEdge: 1600,
  types: { 'image/jpeg': 1, 'image/png': 1, 'image/webp': 1, 'application/pdf': 1, 'text/plain': 1, 'text/csv': 1,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 1, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 1 },
};

// Resolves after the first auth state is known (signed in or not).
export function init() {
  if (!configured()) return Promise.resolve();
  return (booting ??= (async () => {
    const [A, Au, Fs, St] = await Promise.all(['app', 'auth', 'firestore', 'storage'].map(m => import(`${SDK}/firebase-${m}.js`)));
    const app = A.initializeApp(firebaseConfig);
    auth = Au.getAuth(app);
    db = Fs.initializeFirestore(app, { localCache: Fs.persistentLocalCache({ tabManager: Fs.persistentMultipleTabManager() }) });
    storage = St.getStorage(app);
    F = { A, Au, Fs, St };
    await new Promise(res => { let first = true; Au.onAuthStateChanged(auth, async u => { me = u; profile = u ? await loadProfile(u.uid).catch(() => null) : null; first ? ((first = false), res()) : emit(); }); });
    logger.info('Cloud connected', { signedIn: !!me });
  })());
}

const need = () => { if (!F) throw new Error('Cloud is not ready'); if (!me) throw new Error('Sign in first'); };
async function loadProfile(uid) { const s = await F.Fs.getDoc(F.Fs.doc(db, 'users', uid)); return s.exists() ? s.data() : null; }
export async function getUser(uid) { need(); return loadProfile(uid); }

export async function signIn() { await init(); await F.Au.signInWithPopup(auth, new F.Au.GoogleAuthProvider()); }
export async function signOut() { await F.Au.signOut(auth); }

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

export function validateFile(file) {
  if (!LIMITS.types[file.type]) return 'That file type isn’t allowed. Use images, PDF, TXT, CSV, DOCX or XLSX.';
  if (!file.type.startsWith('image/') && file.size > LIMITS.file) return 'Files can be up to 10 MB.';
  if (file.type.startsWith('image/') && file.size > 40 * 1024 * 1024) return 'That image is too large.';
  return '';
}
async function shrink(file) {
  if (!file.type.startsWith('image/')) return file;
  const bmp = await createImageBitmap(file), k = Math.min(1, LIMITS.imageEdge / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', .82));
  if (blob.size > LIMITS.image) throw new Error('Image is still over 5 MB after compression.');
  return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
}
async function upload(id, msgId, file) {
  const f = await shrink(file), { ref, uploadBytes, getDownloadURL } = F.St, path = `chat-files/${id}/${msgId}/${f.name.replace(/[^\w.-]+/g, '_')}`;
  await uploadBytes(ref(storage, path), f, { contentType: f.type });
  return { name: f.name, type: f.type, size: f.size, path, url: await getDownloadURL(ref(storage, path)) };
}

export async function send(other, text, file) {
  need(); const { doc, collection, getDoc, setDoc, writeBatch, increment } = F.Fs, id = chatId(me.uid, other.uid), ref = doc(db, 'chats', id);
  let snap = await getDoc(ref), chat = snap.exists() ? snap.data() : null, t = (text || '').trim();
  if (!t && !file) throw new Error('Type a message or attach a file');
  if (chat?.status === 'blocked') throw new Error('This chat is blocked');
  if (chat?.status === 'pending') throw new Error(chat.requester === me.uid ? 'Waiting for them to accept your request' : 'Accept the request to reply');
  const now = Date.now();
  if (!chat) {
    await setDoc(ref, {
      members: [me.uid, other.uid].sort(), status: 'pending', requester: me.uid, createdAt: now, updatedAt: now,
      lastMessage: { text: t || (file ? `📎 ${file.name}`.slice(0, 80) : ''), ts: now, from: me.uid },
      unread: { [me.uid]: 0, [other.uid]: 1 },
      names: { [me.uid]: profile.name, [other.uid]: other.name },
      handles: { [me.uid]: profile.handle, [other.uid]: other.handle }
    });
    chat = { status: 'pending', requester: me.uid };
  }
  const msgRef = doc(collection(db, 'chats', id, 'messages')), attachment = file ? await upload(id, msgRef.id, file) : null;
  const last = { text: t || `📎 ${attachment.name}`.slice(0, 80), ts: now, from: me.uid }, batch = writeBatch(db);
  batch.update(ref, { updatedAt: now, lastMessage: last, [`unread.${other.uid}`]: increment(1) });
  batch.set(msgRef, { from: me.uid, text: t, ts: now, ...(attachment && { attachment }) });
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
