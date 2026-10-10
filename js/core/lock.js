// App lock (PIN). Honest scope: stops casual access to an open/unattended device; data in the browser DB is not encrypted by it.
const K = 'hisaab.lock';
const enc = new TextEncoder();
const b64 = b => btoa(String.fromCharCode(...new Uint8Array(b)));
const get = () => JSON.parse(localStorage.getItem(K) || 'null');
async function hash(pin, salt) {
  const m = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: Uint8Array.from(atob(salt), c => c.charCodeAt(0)), iterations: 200000, hash: 'SHA-256' }, m, 256));
}
export const hasPin = () => !!get();
export const minutes = () => get()?.minutes ?? 1;
export async function setPin(pin, mins = 1) {
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  localStorage.setItem(K, JSON.stringify({ salt, hash: await hash(pin, salt), minutes: mins }));
}
export const setMinutes = m => { const g = get(); if (g) localStorage.setItem(K, JSON.stringify({ ...g, minutes: m })); };
export const clearPin = () => localStorage.removeItem(K);
export async function verify(pin) { const g = get(); return !!g && (await hash(pin, g.salt)) === g.hash; }

let hiddenAt = 0, fails = 0, until = 0;
export function lockNow() {
  if (!hasPin() || document.getElementById('lock')) return;
  const el = document.createElement('div'); el.id = 'lock';
  el.innerHTML = `<form class="card glass form" style="width:min(320px,86vw);text-align:center"><h2>Enter PIN</h2>
    <input class="pin" type="password" inputmode="numeric" autocomplete="off" maxlength="8" aria-label="PIN" autofocus><p class="muted" id="lockmsg" role="alert"></p><button class="btn primary">Unlock</button></form>`;
  document.body.append(el);
  const input = el.querySelector('input'), msg = el.querySelector('#lockmsg');
  el.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    if (Date.now() < until) { msg.textContent = `Too many tries. Wait ${Math.ceil((until - Date.now()) / 1000)}s.`; return; }
    if (await verify(input.value)) { fails = 0; el.remove(); return; }
    input.value = ''; fails++; msg.textContent = 'Wrong PIN';
    if (fails >= 5) { until = Date.now() + 30000; fails = 0; msg.textContent = 'Too many tries. Wait 30s.'; }
  };
  input.focus();
}
export function initLock() {
  lockNow();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (hasPin() && Date.now() - hiddenAt > minutes() * 60000) lockNow();
  });
}
