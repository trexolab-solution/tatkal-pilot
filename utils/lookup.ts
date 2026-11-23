/**
 * Optional lookups that make the Journey form easier to fill correctly.
 *
 *  - Stations: India API (api.dharun.dev). Free, no key.
 *  - Trains:   RailCore (ir.railcore.tech). Free plan = 500/month, 100/day, 10/min, needs the
 *              user's own API key. Both are third-party; IRCTC itself stays the final authority.
 *
 * Everything here is best-effort. If a lookup is unavailable the form simply works manually.
 *
 * Because the free plan is small, almost nothing hits the network twice:
 *  - results are cached on disk (stations 30 days, trains 7 days, "not found" 3 days);
 *  - a longer query is answered from a cached shorter one when that one was complete;
 *  - every station/train ever seen is remembered by code/number, so verifying a saved booking is free;
 *  - identical in-flight requests are shared;
 *  - automatic train calls stop at a daily and monthly budget, after which only the cache is used.
 */

import { getStationLocal, searchStationsLocal, stationStatus } from './catalog';

export interface Station {
  code: string;
  name: string;
  state: string;
}
export interface TrainHit {
  number: string;
  name: string;
  from: string;
  to: string;
  type: string;
  days: string[];
  /** Where we learned it: IRCTC's own train list (from/to = the searched stations) or RailCore (full route). */
  src?: 'irctc' | 'railcore' | 'catalog'; // catalog = built-in older railway list (CC0)
}

export type LookupErrorKind = 'network' | 'limit' | 'auth' | 'nokey' | 'budget' | 'server';
export class LookupError extends Error {
  constructor(
    message: string,
    public kind: LookupErrorKind,
  ) {
    super(message);
  }
}

const STATIONS_URL = 'https://api.dharun.dev/v1/stations';
const TRAINS_URL = 'https://ir.railcore.tech/v1/trains/search';
const LIMIT = 8;

const DAY = 86_400_000;
const TTL = { station: 60 * DAY, train: 90 * DAY, missing: 7 * DAY };
const DAILY_AUTO_BUDGET = 80; // of RailCore's 100/day, keep 20 spare
const MONTHLY_AUTO_BUDGET = 450; // of 500/month

interface Entry<T> {
  v: T;
  t: number; // stored at
  complete?: boolean; // a search whose result list was not cut off by the limit
}
interface Usage {
  day: string;
  rail: number;
  month: string;
  railMonth: number;
  creditsLeft: number | null;
  blockedUntil: number; // epoch ms: RailCore asked us to stop until then (rate limit)
}
interface CacheData {
  stationQ: Record<string, Entry<Station[]>>;
  stationCode: Record<string, Entry<Station | null>>;
  trainQ: Record<string, Entry<TrainHit[]>>;
  train: Record<string, Entry<TrainHit | null>>;
  usage: Usage;
}

const empty = (): CacheData => ({
  stationQ: {},
  stationCode: {},
  trainQ: {},
  train: {},
  usage: { day: '', rail: 0, month: '', railMonth: 0, creditsLeft: null, blockedUntil: 0 },
});

const cacheItem = storage.defineItem<CacheData>('local:lookupCache', { fallback: empty() });
const keyItem = storage.defineItem<{ railcoreKey: string }>('local:lookupSettings', { fallback: { railcoreKey: '' } });

/* ---------- settings ---------- */

export const getRailKey = async () => (await keyItem.getValue()).railcoreKey.trim();
export const setRailKey = (railcoreKey: string) => keyItem.setValue({ railcoreKey: railcoreKey.trim() });

/* ---------- cache plumbing ---------- */

let mem: CacheData | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let watching = false;

/** Union of two caches (the extension's pages and the IRCTC tab each hold their own copy). */
function mergeCaches(a: CacheData, b: CacheData): CacheData {
  const mergeMap = <T>(x: Record<string, Entry<T>>, y: Record<string, Entry<T>>) => {
    const out: Record<string, Entry<T>> = { ...x };
    for (const [k, e] of Object.entries(y)) if (!out[k] || e.t >= out[k]!.t) out[k] = e;
    return out;
  };
  const ua = a.usage;
  const ub = b.usage;
  const usage = ua.day === ub.day && ua.month === ub.month ? (ua.rail >= ub.rail ? ua : ub) : ua.day > ub.day ? ua : ub;
  const blockedUntil = Math.max(ua.blockedUntil ?? 0, ub.blockedUntil ?? 0); // the longest pause wins
  return {
    stationQ: mergeMap(a.stationQ, b.stationQ),
    stationCode: mergeMap(a.stationCode, b.stationCode),
    trainQ: mergeMap(a.trainQ, b.trainQ),
    train: mergeMap(a.train, b.train),
    usage: { ...usage, blockedUntil },
  };
}

async function load(): Promise<CacheData> {
  if (!mem) {
    const stored = await cacheItem.getValue();
    mem = { ...empty(), ...stored, usage: { ...empty().usage, ...stored?.usage } };
  }
  if (!watching) {
    watching = true;
    // Pick up trains learned in another context (e.g. while browsing IRCTC).
    cacheItem.watch((v) => {
      if (mem && v) mem = mergeCaches({ ...empty(), ...v }, mem);
    });
  }
  return mem;
}

const MAX = { stationQ: 200, stationCode: 1500, trainQ: 150, train: 600 };
function prune<T>(map: Record<string, Entry<T>>, max: number) {
  const keys = Object.keys(map);
  if (keys.length <= max) return;
  keys.sort((a, b) => map[a]!.t - map[b]!.t).slice(0, keys.length - max).forEach((k) => delete map[k]);
}

async function flush() {
  if (!mem) return;
  const stored = await cacheItem.getValue();
  mem = mergeCaches({ ...empty(), ...stored }, mem);
  prune(mem.stationQ, MAX.stationQ);
  prune(mem.stationCode, MAX.stationCode);
  prune(mem.trainQ, MAX.trainQ);
  prune(mem.train, MAX.train);
  await cacheItem.setValue(mem);
}

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flush(), 600);
}

function fresh<T>(e: Entry<T> | undefined, ttl: number): Entry<T> | undefined {
  return e && Date.now() - e.t < ttl ? e : undefined;
}

const inflight = new Map<string, Promise<unknown>>();
function shared<T>(key: string, run: () => Promise<T>): Promise<T> {
  const cur = inflight.get(key) as Promise<T> | undefined;
  if (cur) return cur;
  const p = run().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export async function clearLookupCache() {
  mem = empty();
  await cacheItem.setValue(mem);
}

/* ---------- usage / budget ---------- */

const todayKey = () => new Date().toISOString().slice(0, 10);

function rollUsage(c: CacheData) {
  const day = todayKey();
  const month = day.slice(0, 7);
  if (c.usage.day !== day) {
    c.usage.day = day;
    c.usage.rail = 0;
  }
  if (c.usage.month !== month) {
    c.usage.month = month;
    c.usage.railMonth = 0;
  }
}

export interface UsageSummary {
  today: number;
  month: number;
  creditsLeft: number | null;
  blockedUntil: number;
}
export async function usageSummary(): Promise<UsageSummary> {
  const c = await load();
  rollUsage(c);
  return { today: c.usage.rail, month: c.usage.railMonth, creditsLeft: c.usage.creditsLeft, blockedUntil: c.usage.blockedUntil };
}

/* ---------- network ---------- */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Every RailCore request goes through this gate: one at a time, at least RAIL_MIN_GAP_MS apart. The free plan
 * allows 10 requests a minute, so even a burst of typing can never exceed it.
 */
const RAIL_MIN_GAP_MS = 1500;
let railChain: Promise<unknown> = Promise.resolve();
let lastRailCall = 0;
function railGate<T>(run: () => Promise<T>): Promise<T> {
  const next = railChain.then(async () => {
    const wait = lastRailCall + RAIL_MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRailCall = Date.now();
    return run();
  });
  railChain = next.catch(() => undefined);
  return next;
}

const formatWait = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return s < 90 ? `${s} s` : s < 5400 ? `${Math.ceil(s / 60)} min` : `${Math.ceil(s / 3600)} h`;
};

async function getJson(url: string, headers: Record<string, string> = {}): Promise<{ status: number; json: any; res: Response }> {
  let res: Response;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  } catch {
    throw new LookupError('Lookup is unavailable right now.', 'network');
  }
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON error page */
  }
  return { status: res.status, json, res };
}

/* ---------- stations ---------- */

const toStation = (d: any): Station => ({ code: String(d.code), name: String(d.name), state: String(d.state ?? '') });

/**
 * Suggestions come from the local station catalog (see catalog.ts). That is a search over data already on
 * this computer, so typing never calls an API and there is no rate limit to hit.
 */
export async function searchStations(q: string): Promise<Station[]> {
  return searchStationsLocal(q);
}

/** Look up one station by code. Returns null if the code is not in the list. */
export async function getStation(code: string): Promise<Station | null> {
  const key = code.trim().toUpperCase();
  if (!/^[A-Z]{2,5}$/.test(key)) return null;
  const local = await getStationLocal(key);
  if (local) return local;
  // Not in the catalog (which is refreshed daily): ask the API once and remember the answer.
  const c = await load();
  const hit = c.stationCode[key];
  if (hit && Date.now() - hit.t < (hit.v ? TTL.station : TTL.missing)) return hit.v;

  return shared(`c:${key}`, async () => {
    const { status, json } = await getJson(`${STATIONS_URL}/${key}`);
    if (status === 404) {
      c.stationCode[key] = { v: null, t: Date.now() };
      persist();
      return null;
    }
    if (status !== 200) throw new LookupError('Station lookup is unavailable right now.', status === 429 ? 'limit' : 'server');
    const s = toStation(json.data);
    c.stationCode[key] = { v: s, t: Date.now() };
    persist();
    return s;
  });
}

/* ---------- trains ---------- */

const toTrain = (t: any): TrainHit => ({
  number: String(t.train_number),
  name: String(t.display_name || t.train_name || '')
    .replace(new RegExp(`^${String(t.train_number)}\\s*[-–:]\\s*`), '')
    .trim(),
  from: String(t.source_station_code ?? ''),
  to: String(t.destination_station_code ?? ''),
  type: String(t.train_type ?? ''),
  days: Array.isArray(t.running_days) ? t.running_days.map(String) : [],
  src: 'railcore',
});

const matchesTrain = (t: TrainHit, key: string) =>
  /^\d+$/.test(key) ? t.number.startsWith(key) : t.name.toLowerCase().includes(key);

function canCallRail(c: CacheData): boolean {
  rollUsage(c);
  return c.usage.rail < DAILY_AUTO_BUDGET && c.usage.railMonth < MONTHLY_AUTO_BUDGET;
}

/* ---------- built-in catalog (no network, no key) ---------- */

let catalog: Map<string, TrainHit> | null = null;

/**
 * Older railway list shipped with the extension (about 5,100 trains, CC0, from the Datameet railways data).
 * It is only a last fallback: names can be abbreviated and trains added after 2016 are missing.
 */
async function loadCatalog(): Promise<Map<string, TrainHit>> {
  if (catalog) return catalog;
  const map = new Map<string, TrainHit>();
  try {
    const res = await fetch(browser.runtime.getURL('/data/trains.json' as never));
    const rows = (await res.json()) as [string, string, string, string, string][];
    for (const [number, name, from, to, type] of rows) map.set(number, { number, name, from, to, type, days: [], src: 'catalog' });
  } catch {
    /* no catalog: everything else still works */
  }
  catalog = map;
  return map;
}

async function catalogMatches(key: string): Promise<TrainHit[]> {
  const all = await loadCatalog();
  if (/^\d{5}$/.test(key)) {
    const hit = all.get(key);
    return hit ? [hit] : [];
  }
  const out: TrainHit[] = [];
  for (const t of all.values()) {
    if (matchesTrain(t, key)) out.push(t);
    if (out.length >= LIMIT) break;
  }
  return out;
}

export async function searchTrains(q: string): Promise<TrainHit[]> {
  const raw = q.trim();
  const key = raw.toLowerCase();
  if (key.length < 3) return [];
  const railKey = await getRailKey();
  const c = await load();

  // 1. Exact number we already know (or know to be missing): free.
  if (/^\d{5}$/.test(key)) {
    const e = fresh(c.train[key], c.train[key]?.v ? TTL.train : TTL.missing);
    if (e) return e.v ? [e.v] : [];
  }
  // 2. Same query before: free.
  const hit = fresh(c.trainQ[key], TTL.train);
  if (hit) return hit.v;
  // 3. Enough known trains already match: free.
  const known = Object.values(c.train)
    .map((e) => e.v)
    .filter((t): t is TrainHit => !!t && matchesTrain(t, key));
  if (known.length >= 3) return known.slice(0, LIMIT);

  // 4. The built-in catalog is free too: use it before spending an API request.
  const fromCatalog = (await catalogMatches(key)).filter((t) => !known.some((k) => k.number === t.number));
  const local = [...known, ...fromCatalog].slice(0, LIMIT);
  if (/^\d{5}$/.test(key) && local.some((t) => t.number === key)) return local.filter((t) => t.number === key);
  if (local.length >= 3) return local;

  if (!railKey) {
    if (local.length) return local;
    throw new LookupError('No saved train matches. Type the 5-digit number (trains you open on IRCTC are remembered).', 'nokey');
  }
  const paused = c.usage.blockedUntil - Date.now();
  if (paused > 0) {
    if (local.length) return local;
    throw new LookupError(`Train lookups are paused by the rate limit. Try again in ${formatWait(paused)}.`, 'limit');
  }
  if (!canCallRail(c)) {
    if (local.length) return local;
    throw new LookupError('Lookup budget for today is used up. Type the 5-digit number instead.', 'budget');
  }

  return shared(`t:${key}`, async () => {
    const { status, json, res } = await railGate(() => getJson(`${TRAINS_URL}?q=${encodeURIComponent(raw)}&limit=${LIMIT}`, { 'X-RailCore-Key': railKey }));
    if (status === 401 || status === 403) throw new LookupError('RailCore rejected the API key. Check it in settings.', 'auth');
    if (status === 429) {
      // Respect the server: Retry-After if given, else the documented reset time, else one minute.
      const retry = Number(res.headers.get('Retry-After'));
      const reset = Number(res.headers.get('X-RailCore-RateLimit-Reset')) * 1000;
      const until = retry > 0 ? Date.now() + retry * 1000 : reset > Date.now() ? reset : Date.now() + 60_000;
      c.usage.blockedUntil = Math.max(c.usage.blockedUntil, until);
      persist();
      throw new LookupError(`Rate limit reached. Try again in ${formatWait(until - Date.now())}.`, 'limit');
    }
    if (status !== 200 || !json?.success) throw new LookupError('Train lookup is unavailable right now.', 'server');

    rollUsage(c);
    c.usage.rail++;
    c.usage.railMonth++;
    const left = Number(res.headers.get('X-RailCore-Credits-Remaining'));
    if (Number.isFinite(left)) c.usage.creditsLeft = left;

    // Stop *before* the limit is hit: when the server says almost nothing is left, pause until it resets.
    const minLeft = Number(res.headers.get('X-RailCore-RateLimit-Remaining'));
    const dayLeft = Number(res.headers.get('X-RailCore-RateLimit-Day-Remaining'));
    const minReset = Number(res.headers.get('X-RailCore-RateLimit-Reset')) * 1000;
    const dayReset = Number(res.headers.get('X-RailCore-RateLimit-Day-Reset')) * 1000;
    if (Number.isFinite(dayLeft) && dayLeft <= 2 && dayReset > Date.now()) c.usage.blockedUntil = Math.max(c.usage.blockedUntil, dayReset);
    else if (Number.isFinite(minLeft) && minLeft <= 1 && minReset > Date.now()) c.usage.blockedUntil = Math.max(c.usage.blockedUntil, minReset);

    const list: TrainHit[] = (json.data?.results ?? []).map(toTrain);
    const now = Date.now();
    c.trainQ[key] = { v: list, t: now, complete: list.length < LIMIT };
    for (const t of list) c.train[t.number] = { v: t, t: now };
    if (/^\d{5}$/.test(key) && !list.some((t) => t.number === key)) c.train[key] = { v: null, t: now };
    persist();
    return list;
  });
}

/** One train by its number (used to confirm a typed or saved number). Free if already known. */
export async function getTrain(number: string): Promise<TrainHit | null> {
  const key = number.trim();
  if (!/^\d{5}$/.test(key)) return null;
  const list = await searchTrains(key);
  return list.find((t) => t.number === key) ?? null;
}

/** Is there a cached answer for this train number? (lets the UI avoid showing "checking…") */
export async function knownTrain(number: string): Promise<TrainHit | null | undefined> {
  const e = (await load()).train[number];
  return e ? e.v : undefined;
}

/**
 * Remember trains seen on IRCTC's own train list, so they can be suggested later without any API.
 * Never overwrites fuller RailCore data.
 */
export async function learnTrains(hits: TrainHit[]) {
  const c = await load();
  const now = Date.now();
  let changed = false;
  for (const h of hits) {
    if (!/^\d{5}$/.test(h.number)) continue;
    if (c.train[h.number]?.v?.src === 'railcore') continue;
    c.train[h.number] = { v: { ...h, src: 'irctc' }, t: now };
    changed = true;
  }
  if (changed) persist();
}

/** How much is remembered locally (shown in Settings). */
export async function cacheStats(): Promise<{ trains: number; stations: number }> {
  const c = await load();
  return {
    trains: Object.values(c.train).filter((e) => e.v).length,
    stations: (await stationStatus()).count,
  };
}
