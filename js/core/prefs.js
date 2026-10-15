// User-customisable look & feel. Persisted locally, applied as CSS variables on <html>.
import { logger } from './log.js';
const KEY = 'hisaab.prefs';
const timers = {};
export const DEFAULTS = { mode: 'minimal', theme: 'auto', hue: 162, radius: 22, blur: 18, depth: 10, density: 1, fontSize: 15, dupWindow: 6, sound: true, soundVolume: 0.7, haptics: true, brsEnabled: true, chillarEnabled: false, chillarPotId: '' };
let P = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
const mq = matchMedia('(prefers-color-scheme: dark)');

export const prefs = () => P;
export function apply() {
  const r = document.documentElement;
  r.dataset.mode = P.mode;
  r.dataset.theme = P.theme === 'auto' ? (mq.matches ? 'ink' : 'mist') : P.theme;
  r.style.setProperty('--accent-h', P.hue);
  r.style.setProperty('--radius', P.radius + 'px');
  r.style.setProperty('--blur', P.blur + 'px');
  r.style.setProperty('--depth', P.depth + 'px');
  r.style.setProperty('--density', P.density);
  r.style.setProperty('--base-font', (P.fontSize || 15) + 'px');
}
export function setPref(k, v) {
  P[k] = v; localStorage.setItem(KEY, JSON.stringify(P)); apply();
  clearTimeout(timers[k]); timers[k] = setTimeout(() => logger.info('Setting changed', { [k]: v }), 600);
}
export function resetPrefs() { logger.info('Appearance reset'); P = { ...DEFAULTS }; localStorage.setItem(KEY, JSON.stringify(P)); apply(); }
mq.addEventListener('change', apply);
apply();

const AI_CONFIG_KEY = 'hisaab.ai_config';
export function getAiConfig() {
  try {
    const cfg = JSON.parse(localStorage.getItem(AI_CONFIG_KEY) || 'null');
    return {
      enabled: cfg?.enabled ?? true,
      provider: cfg?.provider || 'local',
      apiKey: cfg?.apiKey || '',
      endpoint: cfg?.endpoint || '',
      model: cfg?.model || '',
      systemPrompt: cfg?.systemPrompt || ''
    };
  } catch {
    return { enabled: true, provider: 'local', apiKey: '', endpoint: '', model: '', systemPrompt: '' };
  }
}
export function saveAiConfig(cfg) {
  const cur = getAiConfig();
  localStorage.setItem(AI_CONFIG_KEY, JSON.stringify({ ...cur, ...cfg }));
}

