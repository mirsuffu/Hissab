const ymd = d => d.toLocaleDateString('en-CA');
// Next occurrence after `date`. Monthly keeps the original day (r.day) and clamps to month length (31st -> 28th/30th).
export function advance(date, r) {
  const [y, m, d] = date.split('-').map(Number);
  if (r.every === 'daily') return ymd(new Date(y, m - 1, d + 1));
  if (r.every === 'weekly') return ymd(new Date(y, m - 1, d + 7));
  const first = new Date(y, m, 1), dim = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return ymd(new Date(first.getFullYear(), first.getMonth(), Math.min(r.day || d, dim)));
}
