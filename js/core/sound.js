// Mechanical keyboard click sound synthesizer using pure Web Audio API.
// Synthesizes a soft, tactile mechanical keycap "tick/thock" on valid interactive clicks.
// Zero audio files, zero network latency (<5ms), 100% offline, resource-safe on ThinkPad T480.
import { prefs } from './prefs.js';

let ctx = null;
let noiseBuffer = null;

function getAudioContext() {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      ctx = new AudioCtx();
    }
  }
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
  return ctx;
}

// Generate a tiny 4ms noise burst for the mechanical tactile switch contact
function getNoiseBuffer(c) {
  if (noiseBuffer) return noiseBuffer;
  const bufferSize = Math.floor(c.sampleRate * 0.004);
  const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.4));
  }
  noiseBuffer = buffer;
  return noiseBuffer;
}

export function triggerHaptic(duration = 10) {
  if (prefs().haptics === false) return;
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(duration);
    }
  } catch {}
}

export function playTick() {
  if (!prefs().sound) return;
  const c = getAudioContext();
  if (!c) return;

  const now = c.currentTime;
  const vol = Math.max(0.05, Math.min(2.0, (Number(prefs().soundVolume ?? 0.7)) * 1.6));

  // 1. High-frequency click transient (tactile leaf switch contact)
  const noise = c.createBufferSource();
  noise.buffer = getNoiseBuffer(c);

  const noiseFilter = c.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.setValueAtTime(2600, now);
  noiseFilter.Q.setValueAtTime(3.0, now);

  const noiseGain = c.createGain();
  noiseGain.gain.setValueAtTime(0.08 * vol, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.006);

  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(c.destination);

  noise.start(now);
  noise.stop(now + 0.007);

  // 2. Low-frequency acoustic cavity resonance (soft bottom-out thock)
  const osc = c.createOscillator();
  const oscGain = c.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(310, now);
  osc.frequency.exponentialRampToValueAtTime(75, now + 0.014);

  oscGain.gain.setValueAtTime(0.14 * vol, now);
  oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.016);

  osc.connect(oscGain);
  oscGain.connect(c.destination);

  osc.start(now);
  osc.stop(now + 0.017);
}

// Global listener attached to real interactive targets only
export function initSoundListener() {
  if (typeof window === 'undefined') return;

  const isValidInteractiveTarget = el => {
    if (!el || el.disabled || el.getAttribute?.('aria-disabled') === 'true') return false;
    return !!el.closest(
      'button, a[href], input[type=checkbox], input[type=radio], select, ' +
      '.tile, .row-item, .seg label, .pill span, .toggle-switch, .numpad-key, ' +
      '[data-del], [data-add], [data-new], [data-edit], [data-key], [data-close], ' +
      '[role="button"], [role="tab"]'
    );
  };

  window.addEventListener('pointerdown', e => {
    // Unlock suspended AudioContext on mobile touch
    getAudioContext();
    if (isValidInteractiveTarget(e.target)) {
      playTick();
      triggerHaptic(8);
    }
  }, { passive: true, capture: true });
}
