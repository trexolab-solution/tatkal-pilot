/**
 * Server-synced clock. Tatkal opens at an exact second on IRCTC's clock, and a PC clock can be
 * off by seconds. We measure the offset against the `Date` header of the IRCTC server itself.
 *
 * The header only has 1-second resolution, so each sample gives an interval the true offset must
 * lie in. Samples taken at different sub-second phases are intersected, which narrows the
 * estimate to a few tens of milliseconds.
 */

let offset = 0; // serverTime - localTime, in ms
let accuracy = Infinity; // half-width of the remaining uncertainty, in ms
let synced = false;

/** Current time on the server's clock (epoch ms). Falls back to the local clock until synced. */
export const now = () => Date.now() + offset;

export const clockInfo = () => ({ offset, accuracy, synced });

const SAMPLES = 10;
const GAP_MS = 130; // not a divisor of 1000, so samples land on different sub-second phases
const MAX_RTT = 1500; // ignore samples that were slow, their midpoint is unreliable

async function sample(): Promise<{ lo: number; hi: number } | null> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${location.origin}/?_ts=${t0}`, { method: 'HEAD', cache: 'no-store', credentials: 'omit' });
    const t1 = Date.now();
    const header = res.headers.get('date');
    const server = header ? Date.parse(header) : NaN;
    if (!Number.isFinite(server) || t1 - t0 > MAX_RTT) return null;
    const mid = (t0 + t1) / 2; // assume the server stamped the response halfway through
    const rtt = t1 - t0;
    // server stamp is truncated to the second: real server time is in [server, server + 1000)
    return { lo: server - mid - rtt / 2, hi: server + 1000 - mid + rtt / 2 };
  } catch {
    return null;
  }
}

/** Measure the offset. Safe to call repeatedly; never throws. Resolves with the result. */
export async function syncClock(): Promise<{ offset: number; accuracy: number; synced: boolean }> {
  let lo = -Infinity;
  let hi = Infinity;
  let good = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const s = await sample();
    if (s) {
      const nlo = Math.max(lo, s.lo);
      const nhi = Math.min(hi, s.hi);
      if (nlo <= nhi) {
        lo = nlo;
        hi = nhi;
      } else {
        // inconsistent sample (network jitter): drop it rather than trust it
        continue;
      }
      good++;
    }
    await new Promise((r) => setTimeout(r, GAP_MS));
  }
  if (good >= 3 && Number.isFinite(lo) && Number.isFinite(hi)) {
    offset = Math.round((lo + hi) / 2);
    accuracy = Math.round((hi - lo) / 2);
    synced = true;
  }
  return clockInfo();
}

/** "+1.2s" / "-0.4s" style text for the panel. */
export function formatOffset(ms = offset): string {
  const s = ms / 1000;
  return `${s >= 0 ? '+' : '−'}${Math.abs(s).toFixed(1)}s`;
}
