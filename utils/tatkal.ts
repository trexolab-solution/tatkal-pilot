/** Tatkal opens one day before the journey: AC classes at 10:00, non-AC at 11:00 (local time). */
export const AC_CLASSES = new Set(['1A', '2A', '3A', '3E', 'CC', 'EC']);

export interface Opening {
  at: Date;
  time: string; // HH:MM:SS
  ac: boolean;
}

export function tatkalOpening(date: string, cls: string): Opening | null {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return null;
  const ac = AC_CLASSES.has(cls);
  return { at: new Date(y, m - 1, d - 1, ac ? 10 : 11, 0, 0), time: ac ? '10:00:00' : '11:00:00', ac };
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

/** "Sun, 22 Nov · 11:00" */
export function openingLabel(o: Opening): string {
  const day = o.at.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  return `${day} · ${o.time.slice(0, 5)}`;
}

export interface OpeningState {
  kind: 'upcoming' | 'open' | 'passed';
  label: string; // when it opens
  text: string; // relative state
}

export function openingState(date: string, cls: string, now = Date.now()): OpeningState | null {
  const o = tatkalOpening(date, cls);
  if (!o) return null;
  // The journey day itself still counts as open until midnight (o.at is the day before the journey).
  const journey = new Date(o.at.getFullYear(), o.at.getMonth(), o.at.getDate() + 2).getTime();
  const label = openingLabel(o);
  if (now < o.at.getTime()) return { kind: 'upcoming', label, text: `Opens in ${formatDuration(o.at.getTime() - now)}` };
  if (now < journey) return { kind: 'open', label, text: 'Open now' };
  return { kind: 'passed', label, text: 'Journey date passed' };
}
