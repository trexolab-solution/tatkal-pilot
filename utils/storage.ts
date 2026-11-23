export const QUOTA = 'TATKAL'; // this extension is for Tatkal only

export type Gender = 'Male' | 'Female' | 'Transgender';
export type Tri = 'tick' | 'untick' | 'leave';

/** Passenger picked from the IRCTC master list by (part of) the name. */
export interface MasterPassenger {
  kind: 'master';
  query: string;
}

/** Passenger entered manually (fields as on the IRCTC "Add Passenger" modal). */
export interface NewPassenger {
  kind: 'new';
  name: string; // IRCTC allows max 16 characters
  age: string;
  gender: Gender;
  country: string;
  berth: string; // "Preferences" dropdown
}

export type PassengerEntry = MasterPassenger | NewPassenger;

export interface Booking {
  trainNo: string;
  from: string; // station code
  to: string; // station code
  date: string; // YYYY-MM-DD
  cls: string; // class code, e.g. 3A
  startAt: string; // optional HH:MM:SS (local time) to press "Search Trains"
}

export interface Options {
  mobile: string; // optional mobile number for ticket details
  payment: 'UPI' | 'CARDS';
  confirmBerth: Tri; // "Book only if confirm berths are allotted"
  autoUpgrade: Tri; // "Consider for Auto Upgradation"
  coach: string;
  gst: string;
  autoCalc: boolean; // also press Calculate Fare + Continue To Payment
}

/** Everything the run needs for one booking. */
export interface Profile {
  booking: Booking;
  passengers: PassengerEntry[];
  options: Options;
}

export interface SavedBooking extends Profile {
  id: string;
  name: string;
  updatedAt: number;
}

export interface Store {
  bookings: SavedBooking[];
  activeId: string; // '' when there are no bookings
}

export const CLASSES = ['1A', '2A', '3A', '3E', 'SL', 'CC', 'EC', '2S'];
export const BERTHS = ['No Preference', 'Lower', 'Middle', 'Upper', 'Side Lower', 'Side Upper'];
export const MAX_PASSENGERS = 4; // Tatkal limit per ticket

export const defaultProfile: Profile = {
  booking: { trainNo: '', from: '', to: '', date: '', cls: '3A', startAt: '' },
  passengers: [],
  options: {
    mobile: '',
    payment: 'UPI',
    confirmBerth: 'tick',
    autoUpgrade: 'leave',
    coach: '',
    gst: '',
    autoCalc: false,
  },
};

/* ---------- bookings store ---------- */

const storeItem = storage.defineItem<Store>('local:store', { fallback: { bookings: [], activeId: '' } });
// Single-booking format used by the first version; migrated once.
const legacyItem = storage.defineItem<Partial<Profile> | null>('local:profile', { fallback: null });

export const newId = () => `b_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const shortDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';
};

/** Default name built from the journey, e.g. "12004 · NDLS → CNB · 25 Nov". */
export function autoName(b: Booking): string {
  const parts = [b.trainNo, b.from && b.to ? `${b.from} → ${b.to}` : '', shortDate(b.date)].filter(Boolean);
  return parts.join(' · ') || 'Untitled booking';
}

export const emptyBooking = (): SavedBooking => ({
  id: newId(),
  name: '',
  updatedAt: Date.now(),
  ...structuredClone(defaultProfile),
});

const complete = (p: Partial<Profile> | undefined): Profile => ({
  booking: { ...defaultProfile.booking, ...p?.booking },
  passengers: Array.isArray(p?.passengers) ? p.passengers : [],
  options: { ...defaultProfile.options, ...p?.options },
});

export async function getStore(): Promise<Store> {
  const s = await storeItem.getValue();
  if (s.bookings.length === 0) {
    const legacy = await legacyItem.getValue();
    if (legacy?.booking?.trainNo || legacy?.passengers?.length) {
      const p = complete(legacy);
      const b: SavedBooking = { id: newId(), name: '', updatedAt: Date.now(), ...p };
      const migrated: Store = { bookings: [b], activeId: b.id };
      await storeItem.setValue(migrated);
      await legacyItem.removeValue();
      return migrated;
    }
  }
  const bookings = s.bookings.map((b) => ({ ...b, ...complete(b) }));
  const activeId = bookings.some((b) => b.id === s.activeId) ? s.activeId : (bookings[0]?.id ?? '');
  return { bookings, activeId };
}

export const saveStore = (s: Store) => storeItem.setValue(s);
export const watchStore = (cb: (s: Store) => void) => storeItem.watch(() => void getStore().then(cb));

/** The booking a run uses: the given id, else the active one, else empty defaults. */
export async function getProfile(id?: string): Promise<Profile> {
  const s = await getStore();
  const b = s.bookings.find((x) => x.id === (id || s.activeId));
  return complete(b);
}

/** Names of required booking fields that are still empty. */
export function problemsFor(p: Profile): string[] {
  const b = p.booking;
  return [
    !/^\d{4,5}$/.test(b.trainNo.trim()) && 'train number',
    !b.from && 'From station',
    !b.to && 'To station',
    !b.date && 'journey date',
    !b.cls && 'class',
    p.passengers.length === 0 && 'at least one passenger',
  ].filter((x): x is string => !!x);
}

export const displayName = (b: SavedBooking) => b.name.trim() || autoName(b.booking);

/* ---------- run state ---------- */

export type Stage = 'home' | 'list' | 'passengers' | 'review' | 'done';
export interface RunState {
  active: boolean;
  stage: Stage;
  at: number;
  bookingId: string;
}

const idle: RunState = { active: false, stage: 'home', at: 0, bookingId: '' };
const runItem = storage.defineItem<RunState>('local:run', { fallback: idle });

const RUN_TTL = 30 * 60 * 1000;

export async function getRun(): Promise<RunState> {
  const r = await runItem.getValue();
  if (!r.active || Date.now() - r.at > RUN_TTL) return idle;
  return r;
}

export const setRun = (r: Partial<RunState>) =>
  getRun().then((cur) => runItem.setValue({ ...cur, ...r, at: Date.now() }));

export const stopRun = () => runItem.setValue(idle);
export const watchRun = (cb: (r: RunState) => void) => runItem.watch(() => void getRun().then(cb));
