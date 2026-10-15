import { APP } from '../config.js';

export const uid = () => crypto.randomUUID();
export const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, local
export const toMinor = v => Math.round((parseFloat(String(v).replace(/,/g, '')) || 0) * 100); // paise
export const fromMinor = m => String(m / 100);
const nf = new Intl.NumberFormat(APP.locale, { style: 'currency', currency: APP.currency, minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const fmt = m => nf.format(m / 100);
export const dateTs = d => new Date(d + 'T00:00:00').getTime();

// All money is stored as integer minor units (paise) to avoid float drift.
export const newFund = o => ({
  id: uid(), profileId: o.profileId, name: o.name, type: o.type || 'own', holder: o.holder || '',
  opening: o.opening || 0, budget: o.budget || 0,
  hue: o.hue ?? Math.floor(Math.random() * 360), deleted: false, createdAt: Date.now(),
});

export const newPot = o => ({
  id: uid(), profileId: o.profileId, name: o.name,
  targetAmount: o.targetAmount || 0, // paise
  targetDate: o.targetDate || '',     // YYYY-MM-DD
  custody: o.custody || 'wallet',     // 'wallet' | 'box' | 'bank' | 'custom'
  custodyName: o.custodyName || '',   // e.g. PhonePe, Safe Box, Fixed Deposit
  opening: o.opening || 0,
  locked: !!o.locked,                 // Discipline lock
  broken: false,                      // Fully liquidated/broken flag
  autoSweep: o.autoSweep || null,     // { enabled, amount, sourceFundId, day }
  hue: o.hue ?? 160,
  deleted: false, createdAt: Date.now(),
});

export const newTxn = o => ({
  id: uid(), fundId: o.fundId, type: o.type || 'out', amount: o.amount || 0,
  categoryId: o.categoryId || 'cat-general', partyId: o.partyId || '', note: o.note || '', date: o.date || today(),
  deleted: false, createdAt: Date.now(),
  ...(o.potId ? { potId: o.potId } : {}),
  ...(o.isSuspense ? { isSuspense: true } : {}),
  ...(o.isChillar ? { isChillar: true } : {}),
  ...(o.transferId ? { transferId: o.transferId } : {}),
  ...(o.recurringId ? { recurringId: o.recurringId } : {}),
  ...(o.receiptId ? { receiptId: o.receiptId } : (o.receipt ? { receipt: o.receipt } : {})),
});

export function compressImage(file, maxDim = 800, quality = 0.65) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const render = (dim, q) => {
          let w = img.width, h = img.height;
          if (w > dim || h > dim) {
            if (w > h) { h = Math.round((h * dim) / w); w = dim; }
            else { w = Math.round((w * dim) / h); h = dim; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          try {
            const webp = canvas.toDataURL('image/webp', q);
            if (webp.startsWith('data:image/webp')) return webp;
          } catch {}
          return canvas.toDataURL('image/jpeg', q);
        };
        let res = render(maxDim, quality);
        // Ensure image fits comfortably within 200 KB binary (approx 270k base64 characters)
        if (res.length > 270000) res = render(600, 0.5);
        if (res.length > 270000) res = render(480, 0.4);
        resolve(res);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

