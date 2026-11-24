/**
 * Update notice for installs that do not come from the Chrome Web Store.
 *
 * Once a day we read the public "latest release" of the GitHub repo and compare its tag with the
 * installed version. We never download or install anything: if a newer release exists we only show
 * a link to its page. The request carries no user data (GitHub just sees an ordinary IP address).
 */

const REPO = 'trexolab-solution/tatkal-pilot';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const PAGE_PREFIX = `https://github.com/${REPO}/`; // only links under our own repo are ever shown
const TIMEOUT_MS = 10_000;
const RETRY_AFTER_FAILURE_MS = 60 * 60 * 1000;

interface Saved {
  checkedAt: number; // last successful check
  attemptAt: number; // last attempt, success or not
  latest: string; // latest release tag, e.g. "v1.0.2"
  url: string; // release page
  lastError: string;
}

const item = storage.defineItem<Saved>('local:update', {
  fallback: { checkedAt: 0, attemptAt: 0, latest: '', url: '', lastError: '' },
});

export interface UpdateInfo {
  latest: string;
  url: string;
}

export type CheckResult = { status: 'checked' } | { status: 'skipped'; reason: string } | { status: 'failed'; error: string };

const parse = (v: string): [number, number, number] | null => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};

/** True when version `a` is strictly newer than `b` (both MAJOR.MINOR.PATCH, optional leading "v"). */
export function isNewer(a: string, b: string): boolean {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) {
    const p = x[i] ?? 0;
    const q = y[i] ?? 0;
    if (p !== q) return p > q;
  }
  return false;
}

export const currentVersion = () => browser.runtime.getManifest().version;

/** The newer release we know about, or null when the install is up to date (or we have not checked yet). */
export async function availableUpdate(): Promise<UpdateInfo | null> {
  const s = await item.getValue();
  return s.latest && s.url && isNewer(s.latest, currentVersion()) ? { latest: s.latest, url: s.url } : null;
}

export async function lastChecked(): Promise<number> {
  return (await item.getValue()).checkedAt;
}

/** Toolbar badge: "NEW" while an update is waiting. Quietly does nothing where the action API is missing. */
export async function applyBadge(): Promise<void> {
  try {
    const u = await availableUpdate();
    await browser.action.setBadgeText({ text: u ? 'NEW' : '' });
    if (u) await browser.action.setBadgeBackgroundColor({ color: '#b34700' });
  } catch {
    /* no action API in this context */
  }
}

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

let running: Promise<CheckResult> | null = null;

async function run(): Promise<CheckResult> {
  const prev = await item.getValue();
  const now = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API, { headers: { Accept: 'application/vnd.github+json' }, signal: ctl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(res.status === 404 ? 'No release published yet' : `GitHub answered ${res.status}`);
    const body = (await res.json()) as { tag_name?: unknown; html_url?: unknown };
    const tag = typeof body.tag_name === 'string' ? body.tag_name : '';
    const url = typeof body.html_url === 'string' ? body.html_url : '';
    if (!parse(tag)) throw new Error('Unexpected release tag');
    if (!url.startsWith(PAGE_PREFIX)) throw new Error('Unexpected release link');
    await item.setValue({ checkedAt: now, attemptAt: now, latest: tag, url, lastError: '' });
    await applyBadge();
    return { status: 'checked' };
  } catch (e) {
    const error = e instanceof Error && e.name === 'AbortError' ? 'Timed out' : e instanceof Error ? e.message : String(e);
    await item.setValue({ ...prev, attemptAt: now, lastError: error }); // keep what we knew before
    return { status: 'failed', error };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check at most once a day (and not again within an hour after a failure). Cheap and safe to call
 * from the background, the popup and the options page. `force` is for the "Check now" button.
 */
export async function ensureUpdateCheck(force = false): Promise<CheckResult> {
  if (running) return running;
  if (!force) {
    const s = await item.getValue();
    const now = Date.now();
    if (sameDay(s.checkedAt, now)) return { status: 'skipped', reason: 'already checked today' };
    if (s.lastError && now - s.attemptAt < RETRY_AFTER_FAILURE_MS) return { status: 'skipped', reason: 'recent failure' };
  }
  if (navigator.onLine === false) return { status: 'skipped', reason: 'offline' };
  running = run().finally(() => (running = null));
  return running;
}

export const watchUpdate = (cb: () => void) => item.watch(cb);
