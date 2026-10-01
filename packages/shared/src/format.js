/** Indian number formatting helpers for chat copy and UI. */
export function inr(n, { compact = true } = {}) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  if (compact) {
    if (Math.abs(v) >= 1e7) return `₹${trim(v / 1e7)} Cr`;
    if (Math.abs(v) >= 1e5) return `₹${trim(v / 1e5)} L`;
  }
  return '₹' + Math.round(v).toLocaleString('en-IN');
}
const trim = (x) => (Math.round(x * 100) / 100).toString();
export const pct = (n) => (n == null ? '—' : `${n}%`);
