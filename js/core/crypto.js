// Passphrase-encrypted backups: PBKDF2-SHA256 (310k iterations) -> AES-256-GCM. Nothing leaves the device.
const ITER = 310000, enc = new TextEncoder();
const b64 = buf => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function key(pass, salt, iter) {
  const m = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, m, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export const isEncrypted = text => { try { return JSON.parse(text).hisaab === 'enc'; } catch { return false; } };
export async function encrypt(text, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(pass, salt, ITER), enc.encode(text));
  return JSON.stringify({ hisaab: 'enc', v: 1, kdf: 'PBKDF2-SHA256', iter: ITER, salt: b64(salt), iv: b64(iv), data: b64(ct) });
}
export async function decrypt(json, pass) {
  const o = JSON.parse(json);
  try { return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv) }, await key(pass, unb64(o.salt), o.iter), unb64(o.data))); }
  catch { throw new Error('Wrong passphrase or damaged file'); }
}
