/** Small clock + time marker for bookings that search automatically at a set time ("Search at Tatkal opening time"). */
const CLOCK =
  '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M8 4.8V8l2.2 1.4"/></svg>';

export function timerChip(startAt: string): HTMLElement | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(startAt.trim());
  if (!m) return null;
  const time = `${m[1]!.padStart(2, '0')}:${m[2]}`;
  const el = document.createElement('span');
  el.className = 'timer';
  el.title = `Searches automatically at ${time}`;
  el.setAttribute('aria-label', `Searches automatically at ${time}`);
  el.style.cssText = 'display:inline-flex;align-items:center;gap:4px;flex:none;color:#0b71ba;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap';
  el.innerHTML = `${CLOCK}<span>${time}</span>`;
  return el;
}
