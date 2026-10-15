// App Lock Suite: PIN (variable length) + Gesture Pattern + Alphanumeric Password
// Biometric Bridge (WebAuthn Platform Authenticator) + Master Passphrase Recovery
import { playTick, triggerHaptic } from './sound.js';
import { isBiometricEnabled, authenticateBiometric } from './biometric.js';
import { toast } from '../ui.js';

const K = 'hisaab.lock';
const enc = new TextEncoder();
const b64 = b => btoa(String.fromCharCode(...new Uint8Array(b)));
const get = () => JSON.parse(localStorage.getItem(K) || 'null');

async function hash(secret, salt) {
  const m = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: Uint8Array.from(atob(salt), c => c.charCodeAt(0)), iterations: 200000, hash: 'SHA-256' }, m, 256));
}

export const hasPin = () => !!get();
export const hasLock = () => !!get();
export const lockType = () => get()?.type || 'pin';
export const minutes = () => get()?.minutes ?? 1;

export async function setLock(type = 'pin', secret = '', mins = 1, recoveryPhrase = '') {
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const hashedSecret = await hash(secret, salt);
  let recoveryHash = null;
  if (recoveryPhrase) {
    recoveryHash = await hash(recoveryPhrase.toLowerCase().trim(), salt);
  }
  localStorage.setItem(K, JSON.stringify({
    type,
    pinLength: type === 'pin' ? secret.length : 4,
    salt,
    hash: hashedSecret,
    recoveryHash,
    minutes: mins
  }));
}

export async function setPin(pin, mins = 1, recoveryPhrase = '') {
  return setLock('pin', pin, mins, recoveryPhrase);
}

export const setMinutes = m => {
  const g = get();
  if (g) localStorage.setItem(K, JSON.stringify({ ...g, minutes: m }));
};

export const clearPin = () => localStorage.removeItem(K);

export async function verify(secret) {
  const g = get();
  return !!g && (await hash(secret, g.salt)) === g.hash;
}

export async function verifyRecovery(phrase) {
  const g = get();
  if (!g) return false;
  if (g.recoveryHash) {
    return (await hash(phrase.toLowerCase().trim(), g.salt)) === g.recoveryHash;
  }
  return false;
}

const FAIL_KEY = 'hisaab.lock_fails';
const UNTIL_KEY = 'hisaab.lock_until';

export const getLockFails = () => parseInt(localStorage.getItem(FAIL_KEY) || '0', 10);
export const setLockFails = v => {
  if (v <= 0) localStorage.removeItem(FAIL_KEY);
  else localStorage.setItem(FAIL_KEY, String(v));
};
export const getLockUntil = () => parseInt(localStorage.getItem(UNTIL_KEY) || '0', 10);
export const setLockUntil = v => {
  if (v <= 0) localStorage.removeItem(UNTIL_KEY);
  else localStorage.setItem(UNTIL_KEY, String(v));
};

// Standard collinear bridge map for 3x3 pattern grid (dots 0 to 8)
// 0 1 2
// 3 4 5
// 6 7 8
export const PATTERN_BRIDGES = {
  '0-2': 1, '2-0': 1,
  '3-5': 4, '5-3': 4,
  '6-8': 7, '8-6': 7,
  '0-6': 3, '6-0': 3,
  '1-7': 4, '7-1': 4,
  '2-8': 5, '8-2': 5,
  '0-8': 4, '8-0': 4,
  '2-6': 4, '6-2': 4
};

export function resolvePatternBridges(seq, nextDot) {
  if (seq.includes(nextDot)) return null;
  const additions = [];
  if (seq.length > 0) {
    const last = seq[seq.length - 1];
    const bridge = PATTERN_BRIDGES[`${last}-${nextDot}`];
    if (bridge !== undefined && !seq.includes(bridge)) {
      additions.push(bridge);
    }
  }
  additions.push(nextDot);
  return additions;
}

let hiddenAt = 0;

export function lockNow() {
  if (!hasLock() || document.getElementById('lock')) return;
  const cfg = get();
  const type = cfg?.type || 'pin';
  const targetLen = cfg?.pinLength || 4;
  const bioActive = isBiometricEnabled();

  const el = document.createElement('div');
  el.id = 'lock';

  let bodyHtml = '';
  if (type === 'pattern') {
    bodyHtml = `
      <div class="lock-header">
        <h2 class="lock-title">Draw Pattern</h2>
        <p class="lock-sub muted">Connect at least 4 dots to unlock</p>
      </div>
      <p class="muted" id="lockmsg" role="alert" style="min-height:18px;font-size:.82rem"></p>
      <div class="pattern-wrap" style="position:relative;width:280px;height:280px;margin:10px auto;touch-action:none">
        <canvas id="pattern-canvas" width="280" height="280" style="display:block;width:280px;height:280px;border-radius:16px"></canvas>
      </div>
    `;
  } else if (type === 'password') {
    bodyHtml = `
      <div class="lock-header">
        <h2 class="lock-title">Enter Password</h2>
        <p class="lock-sub muted">App locked to protect your records</p>
      </div>
      <p class="muted" id="lockmsg" role="alert" style="min-height:18px;font-size:.82rem"></p>
      <form id="pass-form" style="display:grid;gap:14px;margin:10px 0">
        <div style="position:relative;display:flex;align-items:center">
          <input id="pass-input" type="password" autocomplete="off" data-lpignore="true" spellcheck="false"
            placeholder="Enter password" class="dialog-input" style="padding-right:42px" required autofocus>
          <button type="button" id="pass-toggle-btn" class="icon-btn" aria-label="Toggle password visibility"
            style="position:absolute;right:6px;width:32px;height:32px;box-shadow:none;background:transparent">
            <svg viewBox="0 0 24 24" style="width:18px;height:18px"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </button>
        </div>
        <div style="display:flex;gap:10px;justify-content:center">
          <button type="submit" class="btn primary" style="flex:1">Unlock</button>
          <button type="button" class="btn" id="btn-bio" aria-label="Biometric unlock" ${bioActive ? '' : 'style="opacity:0.3"'}>
            <svg viewBox="0 0 24 24" style="width:20px;height:20px"><path d="M12 2a10 10 0 0 0-8 16M20 18a10 10 0 0 0-4-15M12 7a5 5 0 0 0-4 8M16 15a5 5 0 0 0-2-7M12 12v3"/></svg>
          </button>
        </div>
      </form>
    `;
  } else {
    // Default PIN
    bodyHtml = `
      <div class="lock-header">
        <h2 class="lock-title">Enter PIN</h2>
        <p class="lock-sub muted">App locked to protect your records</p>
      </div>

      <div class="pin-dots" id="pin-dots" aria-label="PIN entered">
        ${Array.from({ length: targetLen }, () => '<span class="pin-dot"></span>').join('')}
      </div>

      <p class="muted" id="lockmsg" role="alert" style="min-height:18px;font-size:.82rem"></p>

      <div class="numpad-grid">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button type="button" class="numpad-key" data-digit="${n}">${n}</button>`).join('')}
        <button type="button" class="numpad-key" id="btn-bio" aria-label="Biometric unlock" ${bioActive ? '' : 'style="opacity:0.3"'}>
          <svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 0 0-8 16M20 18a10 10 0 0 0-4-15M12 7a5 5 0 0 0-4 8M16 15a5 5 0 0 0-2-7M12 12v3"/></svg>
        </button>
        <button type="button" class="numpad-key" data-digit="0">0</button>
        <button type="button" class="numpad-key" id="btn-back" aria-label="Backspace">
          <svg viewBox="0 0 24 24"><path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/></svg>
        </button>
      </div>
    `;
  }

  el.innerHTML = `
    <div class="lock-card card glass">
      ${bodyHtml}
      <div class="lock-footer" style="margin-top:8px">
        <button type="button" class="lock-forgot-btn" id="btn-forgot">Forgot Lock?</button>
      </div>
    </div>
  `;

  document.body.append(el);

  const card = el.querySelector('.lock-card');
  const msg = el.querySelector('#lockmsg');
  let countdownTimer = null;
  let activeKeyHandler = null;

  const isLockedOut = () => {
    const until = getLockUntil();
    if (Date.now() < until) {
      const rem = Math.ceil((until - Date.now()) / 1000);
      if (msg) msg.textContent = `Too many tries. Wait ${rem}s.`;
      if (!countdownTimer) {
        countdownTimer = setInterval(() => {
          const curUntil = getLockUntil();
          const left = Math.ceil((curUntil - Date.now()) / 1000);
          if (left <= 0) {
            clearInterval(countdownTimer);
            countdownTimer = null;
            if (msg) msg.textContent = '';
          } else {
            if (msg) msg.textContent = `Too many tries. Wait ${left}s.`;
          }
        }, 1000);
      }
      return true;
    }
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    return false;
  };
  isLockedOut();

  const triggerFail = text => {
    if (isLockedOut()) return;
    let f = getLockFails() + 1;
    setLockFails(f);
    triggerHaptic(30);
    card.classList.add('pin-shake');
    setTimeout(() => card.classList.remove('pin-shake'), 400);
    if (msg) msg.textContent = text || 'Incorrect attempt';
    if (f >= 5) {
      const until = Date.now() + 30000;
      setLockUntil(until);
      setLockFails(0);
      isLockedOut();
    }
  };

  const handleUnlockSuccess = () => {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    if (activeKeyHandler) {
      window.removeEventListener('keydown', activeKeyHandler);
      activeKeyHandler = null;
    }
    setLockFails(0);
    setLockUntil(0);
    triggerHaptic(12);
    el.remove();
  };

  // Biometric button setup
  const tryBio = async () => {
    if (!bioActive) return;
    const ok = await authenticateBiometric('Unlock Hisaab');
    if (ok) {
      handleUnlockSuccess();
      toast('Unlocked with biometrics ✨');
    }
  };

  const bioBtn = el.querySelector('#btn-bio');
  if (bioBtn) bioBtn.onclick = tryBio;
  if (bioActive) setTimeout(tryBio, 300);

  // Specific Type Logic
  if (type === 'pin') {
    let currentPin = '';
    const dots = el.querySelectorAll('.pin-dot');

    const updateDots = () => {
      dots.forEach((d, idx) => {
        if (idx < currentPin.length) d.classList.add('filled');
        else d.classList.remove('filled');
      });
    };

    const addDigit = digit => {
      if (isLockedOut()) {
        triggerFail();
        return;
      }
      if (currentPin.length >= targetLen) return;
      currentPin += digit;
      updateDots();
      playTick();

      if (currentPin.length === targetLen) {
        verify(currentPin).then(ok => {
          if (ok) {
            handleUnlockSuccess();
          } else {
            currentPin = '';
            updateDots();
            triggerFail('Wrong PIN');
          }
        });
      }
    };

    const backspace = () => {
      if (!currentPin.length) return;
      currentPin = currentPin.slice(0, -1);
      updateDots();
      playTick();
    };

    el.querySelectorAll('[data-digit]').forEach(b => {
      b.onclick = () => addDigit(b.dataset.digit);
    });
    el.querySelector('#btn-back').onclick = backspace;

    const keyHandler = e => {
      if (!document.getElementById('lock')) {
        window.removeEventListener('keydown', keyHandler);
        return;
      }
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        addDigit(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        backspace();
      }
    };
    activeKeyHandler = keyHandler;
    window.addEventListener('keydown', keyHandler);
  } else if (type === 'password') {
    const form = el.querySelector('#pass-form');
    const input = el.querySelector('#pass-input');
    const toggle = el.querySelector('#pass-toggle-btn');

    toggle?.addEventListener('click', () => {
      input.type = input.type === 'password' ? 'text' : 'password';
    });

    form.onsubmit = async e => {
      e.preventDefault();
      if (isLockedOut()) {
        triggerFail();
        return;
      }
      const val = input.value;
      if (await verify(val)) {
        handleUnlockSuccess();
      } else {
        input.value = '';
        triggerFail('Incorrect password');
      }
    };
  } else if (type === 'pattern') {
    const canvas = el.querySelector('#pattern-canvas');
    const ctx = canvas.getContext('2d');
    const size = 280;
    const padding = 45;
    const gap = (size - 2 * padding) / 2;

    const dots = [];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        dots.push({
          idx: row * 3 + col,
          x: padding + col * gap,
          y: padding + row * gap
        });
      }
    }

    let activeSeq = [];
    let isDrawing = false;
    let curPointer = null;

    const drawGrid = (flashColor = null) => {
      ctx.clearRect(0, 0, size, size);

      // Connected lines
      if (activeSeq.length > 1) {
        ctx.beginPath();
        const first = dots[activeSeq[0]];
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < activeSeq.length; i++) {
          const pt = dots[activeSeq[i]];
          ctx.lineTo(pt.x, pt.y);
        }
        ctx.strokeStyle = flashColor || 'hsl(var(--accent-h) var(--accent-s) 52%)';
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();
      }

      // Trailing pointer line
      if (isDrawing && curPointer && activeSeq.length > 0) {
        const lastPt = dots[activeSeq[activeSeq.length - 1]];
        ctx.beginPath();
        ctx.moveTo(lastPt.x, lastPt.y);
        ctx.lineTo(curPointer.x, curPointer.y);
        ctx.strokeStyle = 'hsl(var(--accent-h) var(--accent-s) 52% / 0.5)';
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.stroke();
      }

      // Draw dot nodes
      dots.forEach(d => {
        const isSelected = activeSeq.includes(d.idx);
        ctx.beginPath();
        ctx.arc(d.x, d.y, isSelected ? 12 : 8, 0, Math.PI * 2);
        ctx.fillStyle = isSelected
          ? (flashColor || 'hsl(var(--accent-h) var(--accent-s) 52%)')
          : 'rgba(150, 150, 150, 0.4)';
        ctx.fill();

        if (isSelected) {
          ctx.beginPath();
          ctx.arc(d.x, d.y, 20, 0, Math.PI * 2);
          ctx.strokeStyle = flashColor || 'hsl(var(--accent-h) var(--accent-s) 52% / 0.35)';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      });
    };

    drawGrid();

    const getCoord = e => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
    };

    const checkPointHit = pt => {
      for (const d of dots) {
        if (!activeSeq.includes(d.idx)) {
          const dist = Math.hypot(d.x - pt.x, d.y - pt.y);
          if (dist < 26) return d.idx;
        }
      }
      return null;
    };

    const connectDot = dotIdx => {
      const added = resolvePatternBridges(activeSeq, dotIdx);
      if (added && added.length > 0) {
        activeSeq.push(...added);
        triggerHaptic(6);
        playTick();
        drawGrid();
      }
    };

    const startDraw = e => {
      if (isLockedOut()) return;
      isDrawing = true;
      activeSeq = [];
      try { canvas.setPointerCapture(e.pointerId); } catch {}
      const pt = getCoord(e);
      curPointer = pt;
      const hit = checkPointHit(pt);
      if (hit !== null) connectDot(hit);
      drawGrid();
    };

    const moveDraw = e => {
      if (!isDrawing) return;
      const pt = getCoord(e);
      curPointer = pt;
      const hit = checkPointHit(pt);
      if (hit !== null) connectDot(hit);
      drawGrid();
    };

    const endDraw = async e => {
      if (!isDrawing) return;
      isDrawing = false;
      curPointer = null;
      try { if (e?.pointerId) canvas.releasePointerCapture(e.pointerId); } catch {}

      if (activeSeq.length < 4) {
        drawGrid('var(--neg)');
        triggerFail('Pattern needs at least 4 dots');
        setTimeout(() => { activeSeq = []; drawGrid(); }, 500);
        return;
      }

      const patternStr = activeSeq.join('-');
      if (await verify(patternStr)) {
        handleUnlockSuccess();
      } else {
        drawGrid('var(--neg)');
        triggerFail('Wrong Pattern');
        setTimeout(() => { activeSeq = []; drawGrid(); }, 500);
      }
    };

    canvas.addEventListener('pointerdown', startDraw);
    canvas.addEventListener('pointermove', moveDraw);
    canvas.addEventListener('pointerup', endDraw);
    canvas.addEventListener('pointercancel', endDraw);
  }

  // Recovery Master Passphrase handler
  el.querySelector('#btn-forgot').onclick = () => {
    const g = get();
    const origHTML = card.innerHTML;

    if (g?.recoveryHash) {
      card.innerHTML = `
        <div class="lock-header">
          <h2 class="lock-title">Reset Security Lock</h2>
          <p class="lock-sub muted">Enter Master Recovery Passphrase to unlock</p>
        </div>
        <form id="rec-form" class="form" style="display:grid;gap:12px;margin:12px 0">
          <input class="dialog-input" type="password" name="phrase" autocomplete="off" placeholder="Master Recovery Passphrase" autofocus required>
          <p class="muted" id="rec-msg" style="min-height:16px;font-size:.82rem"></p>
          <div class="dialog-actions" style="justify-content:center;gap:8px">
            <button type="button" class="btn" id="btn-cancel-rec">Cancel</button>
            <button type="submit" class="btn primary">Verify & Reset</button>
          </div>
        </form>
      `;

      card.querySelector('#btn-cancel-rec').onclick = () => {
        if (activeKeyHandler) {
          window.removeEventListener('keydown', activeKeyHandler);
          activeKeyHandler = null;
        }
        el.remove();
        lockNow();
      };

      card.querySelector('#rec-form').onsubmit = async evt => {
        evt.preventDefault();
        const p = evt.target.phrase.value;
        const rMsg = card.querySelector('#rec-msg');
        if (await verifyRecovery(p)) {
          clearPin();
          el.remove();
          toast('Security lock reset. Configure a new lock in Settings.');
        } else {
          rMsg.textContent = 'Incorrect recovery passphrase';
          rMsg.style.color = 'var(--neg)';
        }
      };
      return;
    }

    // Offline Reset
    card.innerHTML = `
      <div class="lock-header">
        <h2 class="lock-title">Reset App Lock?</h2>
        <p class="lock-sub muted">This removes the local lock so you can access your records. Data on this device will not be erased.</p>
      </div>
      <div class="dialog-actions" style="justify-content:center;gap:10px;margin-top:16px">
        <button type="button" class="btn" id="btn-cancel-rec">Cancel</button>
        <button type="button" class="btn danger" id="btn-confirm-reset">Reset Lock</button>
      </div>
    `;

    card.querySelector('#btn-cancel-rec').onclick = () => {
      if (activeKeyHandler) {
        window.removeEventListener('keydown', activeKeyHandler);
        activeKeyHandler = null;
      }
      el.remove();
      lockNow();
    };

    card.querySelector('#btn-confirm-reset').onclick = () => {
      clearPin();
      el.remove();
      toast('App Lock removed. You can set a new lock in Settings.');
    };
  };
}

export function initLock() {
  lockNow();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now();
    else if (hasLock() && Date.now() - hiddenAt > minutes() * 60000) lockNow();
  });
}
