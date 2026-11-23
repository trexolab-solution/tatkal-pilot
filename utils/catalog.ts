/**
 * Station catalog: everything is searched locally, so typing in the booking form never calls an API.
 *
 *  - Seed: ~9,000 stations shipped with the extension (Datameet, CC0). Works offline from day one.
 *  - Sync: the full list is refreshed from the India API (free, no key, Wikipedia data, CC BY-SA 4.0)
 *    at most once a day (first time the extension is opened that day), or on demand from Settings.
 *    The API will not list "everything" (it needs a name, state or zone), so the list is read zone by zone,
 *    100 stations per request, one request at a time with a pause between them, honouring Retry-After.
 *    If the first page shows the same dataset version as last time, the rest is skipped, so a normal day
 *    costs two requests. Stations the API has no zone for stay covered by the built-in list.
 *  - A failed sync never loses data: the previous list stays, and a failed day is not retried for hours.
 */

export interface StationRec {
  code: string;
  name: string;
  state: string;
}

type Row = [string, string, string]; // code, name, state

interface Stored {
  rows: Row[];
  version: string;
  updatedAt: number; // when the list last changed
  checkedAt: number; // when we last confirmed it is current
  attemptAt: number; // last sync attempt (success or failure)
  lastError: string;
}

const store = storage.defineItem<Stored | null>('local:stationCatalog', { fallback: null });

const API = 'https://api.dharun.dev/v1/stations';
const PAGE = 100;
const PAGE_GAP_MS = 350; // ~170 requests a minute, far below the documented limit
const RETRY_AFTER_FAILURE_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "ANAND VIHAR TRM" -> "Anand Vihar Trm". Names that already have lower-case letters are left alone. */
const nice = (s: string) =>
  s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s(/-])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase()) : s;

/* ---------- in-memory index (seed + synced) ---------- */

let list: StationRec[] | null = null;
let byCode: Map<string, StationRec> | null = null;
let seed: Row[] | null = null;
let watching = false;

async function loadSeed(): Promise<Row[]> {
  if (seed) return seed;
  try {
    const res = await fetch(browser.runtime.getURL('/data/stations.json' as never));
    seed = (await res.json()) as Row[];
  } catch {
    seed = [];
  }
  return seed;
}

async function build() {
  const map = new Map<string, StationRec>();
  for (const [code, name, state] of await loadSeed()) map.set(code, { code, name: nice(name), state });
  const synced = await store.getValue();
  // The synced (newer) list wins for every code it knows; the seed fills the gaps.
  for (const [code, name, state] of synced?.rows ?? []) {
    const old = map.get(code);
    map.set(code, { code, name: nice(name), state: state || old?.state || '' });
  }
  byCode = map;
  list = [...map.values()];
}

async function ready() {
  if (!list) await build();
  if (!watching) {
    watching = true;
    store.watch(() => {
      list = null; // rebuilt on next use (e.g. after a sync in another tab)
    });
  }
}

/* ---------- search ---------- */

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Ranked local search by code or name. Never touches the network. */
export async function searchStationsLocal(query: string, limit = 8): Promise<StationRec[]> {
  const q = norm(query);
  if (q.length < 2) return [];
  await ready();
  const scored: { s: StationRec; score: number }[] = [];
  for (const s of list!) {
    const code = s.code.toLowerCase();
    const name = s.name.toLowerCase();
    let score = -1;
    if (code === q) score = 0;
    else if (name === q) score = 1;
    else if (name.startsWith(q)) score = 2;
    else if (code.startsWith(q)) score = 3;
    else if (name.split(/[\s(/-]+/).some((w) => w.startsWith(q))) score = 4;
    else if (name.includes(q)) score = 5;
    if (score >= 0) scored.push({ s, score });
  }
  scored.sort((a, b) => a.score - b.score || a.s.name.length - b.s.name.length || a.s.name.localeCompare(b.s.name));
  return scored.slice(0, limit).map((x) => x.s);
}

export async function getStationLocal(code: string): Promise<StationRec | null> {
  await ready();
  return byCode!.get(code.trim().toUpperCase()) ?? null;
}

/* ---------- sync ---------- */

export type SyncResult =
  | { status: 'updated'; count: number }
  | { status: 'unchanged'; count: number }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string };

let syncing: Promise<SyncResult> | null = null;

async function getJson(url: string): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    } catch {
      throw new Error('The station service could not be reached.');
    }
    if (res.status === 429 && attempt < 2) {
      const wait = Math.min(20, Number(res.headers.get('Retry-After')) || 5);
      await sleep(wait * 1000);
      continue;
    }
    if (!res.ok) throw new Error(`The station service answered ${res.status}.`);
    return res.json();
  }
}

async function fetchPage(zone: string, offset: number): Promise<{ rows: Row[]; total: number; version: string }> {
  const json = await getJson(`${API}?zone=${encodeURIComponent(zone)}&limit=${PAGE}&offset=${offset}`);
  const rows: Row[] = (json?.data ?? []).map((d: { code: string; name: string; state?: string }) => [String(d.code).toUpperCase(), String(d.name), String(d.state ?? '')]);
  return {
    rows,
    total: Number(json?.meta?.total ?? rows.length),
    version: String(json?.meta?.source?.version ?? json?.meta?.source?.retrieved ?? ''),
  };
}

async function runSync(force: boolean): Promise<SyncResult> {
  const prev = await store.getValue();
  const now = Date.now();
  const base: Stored = prev ?? { rows: [], version: '', updatedAt: 0, checkedAt: 0, attemptAt: 0, lastError: '' };
  try {
    const zoneJson = await getJson(`${API}/zones`);
    const zones: string[] = (zoneJson?.data ?? []).map((z: { code: string }) => String(z.code)).filter(Boolean);
    if (zones.length === 0) throw new Error('The station service returned no zones.');

    const byCode = new Map<string, Row>();
    let version = '';
    for (const [i, zone] of zones.entries()) {
      for (let offset = 0; ; offset += PAGE) {
        if (i > 0 || offset > 0) await sleep(PAGE_GAP_MS);
        const page = await fetchPage(zone, offset);
        for (const r of page.rows) byCode.set(r[0], r);
        if (i === 0 && offset === 0) {
          version = page.version;
          if (!force && prev && prev.rows.length > 0 && version && version === prev.version) {
            await store.setValue({ ...prev, checkedAt: now, attemptAt: now, lastError: '' });
            return { status: 'unchanged', count: prev.rows.length };
          }
        }
        if (offset + PAGE >= page.total || page.rows.length === 0) break;
      }
    }
    const rows = [...byCode.values()];
    if (rows.length < 500) throw new Error('The station list came back incomplete, so it was not saved.');
    await store.setValue({ rows, version, updatedAt: now, checkedAt: now, attemptAt: now, lastError: '' });
    list = null;
    return { status: 'updated', count: rows.length };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await store.setValue({ ...base, attemptAt: now, lastError: error }); // keep the old rows
    return { status: 'failed', error };
  }
}

/** Refresh the station list now (Settings → "Update now"). Concurrent calls share one run. */
export function syncStations(force = true): Promise<SyncResult> {
  syncing ??= runSync(force).finally(() => (syncing = null));
  return syncing;
}

const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

/** Update once per day: the first time the extension is opened that day. Cheap and safe to call often. */
export async function ensureDailySync(): Promise<SyncResult> {
  const s = await store.getValue();
  const now = Date.now();
  if (s && sameDay(s.checkedAt, now)) return { status: 'skipped', reason: 'already checked today' };
  if (s && s.lastError && now - s.attemptAt < RETRY_AFTER_FAILURE_MS) return { status: 'skipped', reason: 'recent failure' };
  if (navigator.onLine === false) return { status: 'skipped', reason: 'offline' };
  return syncStations(false);
}

export interface StationStatus {
  count: number;
  updatedAt: number;
  checkedAt: number;
  lastError: string;
  seedOnly: boolean;
}

export async function stationStatus(): Promise<StationStatus> {
  await ready();
  const s = await store.getValue();
  return { count: list!.length, updatedAt: s?.updatedAt ?? 0, checkedAt: s?.checkedAt ?? 0, lastError: s?.lastError ?? '', seedOnly: !s || s.rows.length === 0 };
}

export const DAY = DAY_MS;
