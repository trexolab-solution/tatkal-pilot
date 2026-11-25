import { initPassengerTip, passengerCount } from '@/utils/passengerTip';
import { timerChip } from '@/utils/timer';
import {
  autoName,
  BERTHS,
  CLASSES,
  defaultTiming,
  displayName,
  emptyBooking,
  getStore,
  getTiming,
  heavyTiming,
  MAX_PASSENGERS,
  newId,
  problemsFor,
  saveStore,
  saveTiming,
  TIMING_LIMITS,
  watchStore,
  type Gender,
  type PassengerEntry,
  type SavedBooking,
  type Store,
  type Timing,
  type Tri,
} from '@/utils/storage';
import { attachCombobox } from '@/utils/combobox';
import { ensureDailySync, stationStatus, syncStations } from '@/utils/catalog';
import {
  clearLookupCache,
  getRailKey,
  getStation,
  getTrain,
  LookupError,
  searchStations,
  searchTrains,
  setRailKey,
  cacheStats,
  usageSummary,
  type Station,
  type TrainHit,
} from '@/utils/lookup';
import { openingLabel, openingState, tatkalOpening } from '@/utils/tatkal';
import { applyBadge, availableUpdate, currentVersion, ensureUpdateCheck, lastChecked } from '@/utils/update';
import { initHelp, type HelpKey } from '@/utils/help';
import { ICONS } from '@/utils/ui';

type Field = HTMLInputElement | HTMLSelectElement;
interface Rule {
  el: Field;
  check: () => string; // '' means valid
}

const $ = <T extends HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)!;
const $$ = <T extends HTMLElement>(sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll<T>(sel));
const input = (id: string) => $<HTMLInputElement>(`#${id}`);
const select = (id: string) => $<HTMLSelectElement>(`#${id}`);

/* ---------- floating toasts ---------- */

type Kind = 'success' | 'error' | 'info';
function toast(message: string, kind: Kind = 'success', opts: { ms?: number; action?: { label: string; run: () => void } } = {}) {
  const box = $('#toasts');
  while (box.children.length >= 3) box.firstElementChild?.remove();
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.innerHTML = `${ICONS[kind]}<span class="msg"></span>`; // security-ok: ICONS is a constant map, the message goes in via textContent
  el.querySelector('.msg')!.textContent = message;
  if (opts.action) {
    const a = document.createElement('button');
    a.type = 'button';
    a.className = 'link act';
    a.textContent = opts.action.label;
    a.addEventListener('click', () => {
      el.remove();
      opts.action!.run();
    });
    el.appendChild(a);
  }
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'x';
  x.setAttribute('aria-label', 'Dismiss');
  x.textContent = '×';
  el.appendChild(x);
  box.appendChild(el);
  const dismiss = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 170);
  };
  x.addEventListener('click', dismiss);
  setTimeout(dismiss, opts.ms ?? (kind === 'error' ? 6000 : 3500));
}

/* ---------- constants ---------- */

const AC_CLASS_SET = new Set(['1A', '2A', '3A', '3E', 'CC', 'EC']);
const CLASS_LABELS: Record<string, string> = {
  '1A': '1A – First AC',
  '2A': '2A – AC 2 Tier',
  '3A': '3A – AC 3 Tier',
  '3E': '3E – AC 3 Economy',
  SL: 'SL – Sleeper',
  CC: 'CC – AC Chair Car',
  EC: 'EC – Exec. Chair Car',
  '2S': '2S – Second Sitting',
};
// Tatkal opens at different times: 10:00 for AC classes, 11:00 for the rest.
for (const [label, ac] of [['AC classes · Tatkal opens 10:00', true], ['Non-AC classes · Tatkal opens 11:00', false]] as const) {
  const group = document.createElement('optgroup');
  group.label = label;
  CLASSES.filter((c) => AC_CLASS_SET.has(c) === ac).forEach((c) => group.appendChild(new Option(CLASS_LABELS[c] ?? c, c)));
  select('cls').appendChild(group);
}

/* ---------- validation plumbing ---------- */

let touched = new WeakSet<Element>();
const rowRules = new WeakMap<HTMLElement, Rule[]>();
let staticRules: Rule[] = [];

const allRules = (): Rule[] => [...staticRules, ...$$('.pax').flatMap((row) => rowRules.get(row) ?? [])];

function paint(el: Field, message: string) {
  const err = el.closest('.field')?.querySelector<HTMLElement>('.err');
  if (err) err.textContent = message;
  el.setAttribute('aria-invalid', message ? 'true' : 'false');
}

/** Run one rule. Errors only show once the field was touched (or `force`). */
function run(rule: Rule, force = false): string {
  const message = rule.check();
  if (force) touched.add(rule.el);
  paint(rule.el, touched.has(rule.el) ? message : '');
  return message;
}

function clearErrors() {
  touched = new WeakSet<Element>();
  allRules().forEach((r) => paint(r.el, ''));
  $('#paxErr').textContent = '';
}

/* ---------- date / Tatkal helpers ---------- */

const pad = (n: number) => String(n).padStart(2, '0');
const parseIso = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
};
const tomorrow = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(0, 0, 0, 0);
  return d;
};

const currentOpening = () => tatkalOpening(input('date').value, select('cls').value);

/** True once the user typed their own "search at" time (so we stop overwriting it). */
let customStart = false;

const pad2 = (n: number) => String(n).padStart(2, '0');
const isoDate = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

function updateOpeningHint() {
  const info = currentOpening();
  const on = input('autoStart').checked;
  const startAt = input('startAt');
  if (!on) startAt.value = '';
  else if (info && !customStart) startAt.value = info.time;
  $('#startAtWrap').hidden = !(on && customStart);
  $('#editStart').hidden = !(on && !customStart && !!info);
  const opens = info ? openingLabel(info).replace(' · ', ' at ') : '';
  $('#startNote').textContent = !on
    ? 'Off: the search starts as soon as you press Start.'
    : !info
      ? 'Choose the journey date to set the time.'
      : customStart
        ? `Searches at ${startAt.value || '…'}. Tatkal opens ${opens}.`
        : `Tatkal opens ${opens}. AC classes open at 10:00 and Sleeper and other classes at 11:00, so the search runs at ${info.time}.`;
  // Highlight the quick-date chip that matches the chosen date.
  $$('.quick-btn').forEach((btn) => {
    const d = new Date();
    d.setDate(d.getDate() + Number(btn.dataset.days));
    btn.setAttribute('aria-pressed', String(input('date').value === isoDate(d)));
  });
}

/* ---------- passengers ---------- */

let uid = 0;
const options = (values: string[], selected: string) =>
  values.map((v) => `<option${v === selected ? ' selected' : ''}>${v}</option>`).join('');

/** Static "(?)" button markup. Only fixed keys and labels go in, never user data. */
const helpBtn = (key: HelpKey, name: string) =>
  `<button type="button" class="help-btn" data-help="${key}" aria-label="Help: ${name}" aria-expanded="false">?</button>`;

function fieldHtml(id: string, label: string, control: string, extra = '', cls = '', help = '', trail = '') {
  return `<div class="field ${cls}">
    <div class="lbl"><label for="${id}">${label}</label>${help}${trail}</div>${control}
    <p class="err" id="${id}-err" role="alert"></p>${extra}
  </div>`;
}

function passengerRow(p: PassengerEntry): HTMLElement {
  const n = ++uid;
  const isNewPax = p.kind === 'new';
  const li = document.createElement('li');
  li.className = 'pax';
  li.innerHTML = /* security-ok: only counters and fixed option lists are interpolated; stored values are set via .value */ `
    <div class="pax-bar">
      <span class="pax-num"><span class="sr-only">Passenger </span><span class="pax-n"></span></span>
      <div class="pax-src">
        <div class="seg" role="radiogroup" aria-label="Passenger source">
          <label><input type="radio" name="kind-${n}" value="master"${isNewPax ? '' : ' checked'} /><span>Master list</span></label>
          <label><input type="radio" name="kind-${n}" value="new"${isNewPax ? ' checked' : ''} /><span>New passenger</span></label>
        </div>
        ${helpBtn('paxSource', 'Passenger source')}
      </div>
      <div class="field pax-master">
        <label class="sr-only" for="q-${n}">Passenger name (full or partial)</label>
        <div class="with-help">
          <input id="q-${n}" data-k="query" autocomplete="off" placeholder="Name, full or partial (for example Pintu)" aria-describedby="q-${n}-err" />
          ${helpBtn('paxQuery', 'Passenger name')}
        </div>
        <p class="err" id="q-${n}-err" role="alert"></p>
      </div>
      <button type="button" class="icon-btn danger remove" aria-label="Remove passenger" title="Remove passenger">
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.5h11M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M6.8 7v3.8M9.2 7v3.8" /></svg>
      </button>
    </div>
    <div class="pax-new grid">
      ${fieldHtml(`name-${n}`, 'Full name', `<input id="name-${n}" data-k="name" maxlength="16" autocomplete="off" aria-describedby="name-${n}-err" />`, '', 'span-6', helpBtn('paxName', 'Full name'), '<span class="count"></span>')}
      ${fieldHtml(`age-${n}`, 'Age', `<input id="age-${n}" data-k="age" inputmode="numeric" maxlength="3" autocomplete="off" aria-describedby="age-${n}-err" />`, '', 'span-2', helpBtn('paxAge', 'Age'))}
      ${fieldHtml(`gender-${n}`, 'Gender', `<select id="gender-${n}" data-k="gender">${options(['Male', 'Female', 'Transgender'], isNewPax ? p.gender : 'Male')}</select>`, '', 'span-2', helpBtn('paxGender', 'Gender'))}
      ${fieldHtml(`country-${n}`, 'Country', `<input id="country-${n}" data-k="country" autocomplete="off" aria-describedby="country-${n}-err" />`, '', 'span-2', helpBtn('paxCountry', 'Country'))}
      ${fieldHtml(`berth-${n}`, 'Berth preference', `<select id="berth-${n}" data-k="berth">${options(BERTHS, isNewPax ? p.berth : 'No Preference')}</select>`, '', 'span-6', helpBtn('paxBerth', 'Berth preference'))}
    </div>`;

  const f = <T extends Field>(k: string) => $<T>(`[data-k=${k}]`, li);
  const kind = () => (li.querySelector<HTMLInputElement>(`input[name="kind-${n}"]:checked`)?.value ?? 'master') as 'master' | 'new';

  if (p.kind === 'master') f('query').value = p.query;
  if (p.kind === 'new') {
    f('name').value = p.name;
    f('age').value = p.age;
    f('country').value = p.country;
  } else {
    f('country').value = 'India';
  }

  const count = $('.count', li);
  const syncCount = () => (count.textContent = `${f('name').value.length}/16`);
  const syncKind = () => {
    const isNewNow = kind() === 'new';
    $('.pax-master', li).hidden = isNewNow;
    $('.pax-new', li).hidden = !isNewNow;
  };

  // Master queries and new names must not repeat across rows.
  const sameAsOther = (value: string, key: 'query' | 'name') =>
    $$('.pax').some((row) => {
      if (row === li) return false;
      const k = row.querySelector<HTMLInputElement>('input[name^="kind-"]:checked')?.value;
      if ((key === 'query') !== (k === 'master')) return false;
      return row.querySelector<HTMLInputElement>(`[data-k=${key}]`)?.value.trim().toLowerCase() === value.trim().toLowerCase();
    });

  rowRules.set(li, [
    {
      el: f('query'),
      check: () => {
        if (kind() !== 'master') return '';
        const v = f('query').value.trim();
        if (v.length < 2) return 'Enter at least 2 letters of the name.';
        return sameAsOther(v, 'query') ? 'This passenger is added twice.' : '';
      },
    },
    {
      el: f('name'),
      check: () => {
        if (kind() !== 'new') return '';
        const v = f('name').value.trim();
        if (!v) return 'Enter the name.';
        if (v.length > 16) return 'IRCTC allows at most 16 characters.';
        if (!/^[A-Za-z][A-Za-z .]*$/.test(v)) return 'Use letters, spaces and dots only.';
        return sameAsOther(v, 'name') ? 'This passenger is added twice.' : '';
      },
    },
    {
      el: f('age'),
      check: () => {
        if (kind() !== 'new') return '';
        const v = f('age').value.trim();
        return /^\d{1,3}$/.test(v) && Number(v) >= 1 && Number(v) <= 125 ? '' : 'Age must be between 1 and 125.';
      },
    },
    { el: f('country'), check: () => (kind() === 'new' && !f('country').value.trim() ? 'Enter the country.' : '') },
  ]);

  f('age').addEventListener('input', () => (f('age').value = f('age').value.replace(/\D/g, '')));
  f('name').addEventListener('input', syncCount);
  li.querySelectorAll(`input[name="kind-${n}"]`).forEach((r) =>
    r.addEventListener('change', () => {
      syncKind();
      allRules().forEach((rule) => run(rule));
    }),
  );
  $('.remove', li).addEventListener('click', () => {
    li.remove();
    refreshPassengers();
    markDirty();
  });
  syncCount();
  syncKind();
  return li;
}

function refreshPassengers() {
  const rows = $$('.pax');
  rows.forEach((row, i) => {
    $('.pax-n', row).textContent = String(i + 1);
    const rm = $('.remove', row);
    rm.setAttribute('aria-label', `Remove passenger ${i + 1}`);
    rm.title = `Remove passenger ${i + 1}`;
  });
  $('#paxEmpty').hidden = rows.length > 0;
  $('#paxMeta').textContent = `${rows.length} of ${MAX_PASSENGERS}`;
  const add = $<HTMLButtonElement>('#add');
  add.disabled = rows.length >= MAX_PASSENGERS;
  add.title = add.disabled ? `Tatkal allows at most ${MAX_PASSENGERS} passengers per ticket` : '';
  if (rows.length > 0) $('#paxErr').textContent = '';
}

/* ---------- static field rules ---------- */

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/;
const CODE = /^[A-Z]{2,5}$/;
const stationCode = (id: 'from' | 'to') => input(id).value.trim().toUpperCase();

staticRules = [
  { el: input('trainNo'), check: () => (/^\d{5}$/.test(input('trainNo').value.trim()) ? '' : 'Pick a train from the list, or type its 5-digit number.') },
  { el: select('cls'), check: () => (select('cls').value ? '' : 'Choose a class.') },
  { el: input('from'), check: () => (CODE.test(stationCode('from')) ? '' : 'Pick a station from the list, or type its code (for example NDLS).') },
  {
    el: input('to'),
    check: () => {
      const to = stationCode('to');
      if (!CODE.test(to)) return 'Pick a station from the list, or type its code (for example CNB).';
      return to === stationCode('from') ? 'From and To must be different.' : '';
    },
  },
  {
    el: input('date'),
    check: () => {
      const d = parseIso(input('date').value);
      if (!d) return 'Choose the journey date.';
      // Tatkal opens the day before the journey, so today's date can still be booked if seats remain.
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      return d < startOfToday ? 'The journey date cannot be in the past.' : '';
    },
  },
  {
    el: input('startAt'),
    check: () => {
      const v = input('startAt').value.trim();
      return !v || /^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(v) ? '' : 'Use HH:MM:SS, for example 10:00:00.';
    },
  },
  {
    el: input('mobile'),
    check: () => {
      const v = input('mobile').value;
      return !v || /^[6-9]\d{9}$/.test(v) ? '' : 'Enter a valid 10-digit number starting with 6, 7, 8 or 9.';
    },
  },
  {
    el: input('coach'),
    check: () => {
      const v = input('coach').value;
      return !v || /^[A-Z0-9]{1,4}$/.test(v) ? '' : 'Use letters and digits only, for example B2.';
    },
  },
  {
    el: input('gst'),
    check: () => {
      const v = input('gst').value;
      return !v || GSTIN.test(v) ? '' : 'Enter a valid 15-character GSTIN.';
    },
  },
];

/* ---------- form <-> booking ---------- */

const radio = (name: string, value: string) => {
  const r = document.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`);
  if (r) r.checked = true;
};
const radioValue = (name: string) => document.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value ?? '';

function renderForm(sb: SavedBooking) {
  const b = sb.booking;
  input('name').value = sb.name;
  input('trainNo').value = b.trainNo;
  select('cls').value = b.cls;
  input('from').value = b.from;
  input('to').value = b.to;
  input('date').value = b.date;
  input('startAt').value = b.startAt;
  input('autoStart').checked = !!b.startAt;
  customStart = !!b.startAt && b.startAt !== tatkalOpening(b.date, b.cls)?.time;
  const o = sb.options;
  input('mobile').value = o.mobile;
  radio('payment', o.payment);
  input('confirmBerthSw').checked = o.confirmBerth === 'tick';
  input('autoUpgradeSw').checked = o.autoUpgrade === 'tick';
  input('coach').value = o.coach;
  input('gst').value = o.gst;
  input('autoCalc').checked = o.autoCalc;
  input('autoBook').checked = o.autoBook;
  $<HTMLDetailsElement>('#moreOpts').open = !!(o.mobile || o.coach || o.gst);
  const list = $('#passengers');
  list.innerHTML = ''; // security-ok: clears the list, no content is inserted
  sb.passengers.forEach((x) => list.appendChild(passengerRow(x)));
  refreshPassengers();
  updateOpeningHint();
  syncConfirmNote();
  clearErrors();
  resetLookupInfo();
}

function collect(): SavedBooking {
  const passengers: PassengerEntry[] = $$('.pax').map((row) => {
    const v = (k: string) => $<Field>(`[data-k=${k}]`, row).value.trim();
    const kind = row.querySelector<HTMLInputElement>('input[name^="kind-"]:checked')?.value;
    if (kind === 'new') {
      return { kind: 'new', name: v('name'), age: v('age'), gender: v('gender') as Gender, country: v('country') || 'India', berth: v('berth') };
    }
    return { kind: 'master', query: v('query') };
  });
  return {
    id: currentId,
    name: input('name').value.trim(),
    updatedAt: Date.now(),
    booking: {
      trainNo: input('trainNo').value.trim(),
      cls: select('cls').value,
      from: stationCode('from'),
      to: stationCode('to'),
      date: input('date').value,
      startAt: input('autoStart').checked ? input('startAt').value.trim() : '',
    },
    passengers,
    options: {
      mobile: input('mobile').value.trim(),
      payment: (radioValue('payment') || 'UPI') as SavedBooking['options']['payment'],
      confirmBerth: (input('confirmBerthSw').checked ? 'tick' : 'leave') as Tri,
      autoUpgrade: (input('autoUpgradeSw').checked ? 'tick' : 'leave') as Tri,
      coach: input('coach').value.trim(),
      gst: input('gst').value.trim(),
      autoCalc: input('autoCalc').checked,
      autoBook: input('autoBook').checked,
    },
  };
}

/* ---------- state ---------- */

let store: Store = { bookings: [], activeId: '' };
let currentId = '';
let isNew = false;
let dirty = false;
let view: 'list' | 'edit' | 'settings' = 'list';
let pendingAction: (() => void) | null = null;
let armedId = ''; // table row whose delete is armed (needs a second click)
let armTimer: ReturnType<typeof setTimeout> | undefined;
let delTimer: ReturnType<typeof setTimeout> | undefined;

const savedCurrent = () => store.bookings.find((b) => b.id === currentId);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const shortDate = (iso: string) => {
  const d = parseIso(iso);
  return d ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—';
};

function showView(v: 'list' | 'edit' | 'settings') {
  view = v;
  $('#listView').hidden = v !== 'list';
  $('#form').hidden = v !== 'edit';
  $('#settingsView').hidden = v !== 'settings';
  $('#tabBookings').setAttribute('aria-current', v === 'settings' ? 'false' : 'page');
  $('#tabSettings').setAttribute('aria-current', v === 'settings' ? 'page' : 'false');
  document.title = v === 'list' ? 'TatkalPilot – Bookings' : v === 'settings' ? 'TatkalPilot – Settings' : 'TatkalPilot – Edit booking';
  window.scrollTo(0, 0);
}

/* ---------- bookings table ---------- */

function cell(cls: string, ...kids: (Node | string)[]) {
  const td = document.createElement('td');
  if (cls) td.className = cls;
  td.append(...kids);
  return td;
}
const line = (cls: string, text: string) => {
  const d = document.createElement('div');
  d.className = cls;
  d.textContent = text;
  return d;
};

const ICON_PATHS: Record<'edit' | 'copy' | 'trash', string> = {
  edit: '<path d="M10.5 2.5l3 3-8 8h-3v-3l8-8z" />',
  copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.6" /><path d="M10.5 3.2A1.7 1.7 0 0 0 8.8 1.5H3.7A1.7 1.7 0 0 0 2 3.2v5.1A1.7 1.7 0 0 0 3.7 10" />',
  trash: '<path d="M2.5 4.5h11M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M6.8 7v3.8M9.2 7v3.8" />',
};

/** Icon-only button. The tooltip and screen-reader name come from `label`. */
function iconButton(kind: 'edit' | 'copy' | 'trash', label: string, onClick: () => void) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'icon-btn';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[kind]}</svg>`; // security-ok: ICON_PATHS is a constant map
  b.addEventListener('click', onClick);
  return b;
}

function renderList() {
  const ul = $('#cards');
  ul.replaceChildren();
  const has = store.bookings.length > 0;
  $('#emptyList').hidden = has;
  $('#count').textContent = has ? plural(store.bookings.length, 'booking') : '';

  const now = Date.now();
  for (const b of store.bookings) {
    const named = b.name.trim();
    const route = b.booking.from && b.booking.to ? `${b.booking.from} → ${b.booking.to}` : '';
    const title = named || route || 'Untitled booking';
    const lead = [
      b.booking.trainNo ? `${b.booking.trainNo} · ${b.booking.cls}` : '',
      named ? route : '',
      b.booking.date ? shortDate(b.booking.date) : '',
    ]
      .filter(Boolean)
      .join(' · ');
    const metaEl = line('card-meta', lead ? `${lead} · ` : '');
    metaEl.append(passengerCount(b.passengers)); // hover the count to see who the passengers are
    const missing = problemsFor(b);
    const open = openingState(b.booking.date, b.booking.cls, now);

    const li = document.createElement('li');
    li.className = `card${b.id === flashId ? ' flash' : ''}`;
    li.dataset.id = b.id;

    const main = document.createElement('div');
    main.className = 'card-main';
    main.append(line('card-title', title), metaEl);
    const chip = timerChip(b.booking.startAt);
    if (chip) {
      chip.style.marginTop = '4px';
      main.append(chip);
    }
    if (missing.length) main.append(line('card-warn', `Incomplete: ${missing.join(', ')}`));

    const pill = document.createElement('span');
    if (open) {
      pill.className = `pill ${open.kind}`;
      pill.textContent = open.kind === 'open' ? 'Tatkal open' : open.text;
      pill.title = `Tatkal ${open.label}`;
    }

    const edit = iconButton('edit', `Edit "${title}"`, () => openBooking(b.id));
    const dup = iconButton('copy', `Duplicate "${title}"`, () => void duplicate(b.id));
    const armed = armedId === b.id;
    const del = iconButton('trash', armed ? `Confirm delete "${title}"` : `Delete "${title}"`, () => {
      if (!armed) {
        armedId = b.id;
        clearTimeout(armTimer);
        armTimer = setTimeout(() => {
          armedId = '';
          renderList();
        }, 4000);
        renderList();
        return;
      }
      armedId = '';
      void removeBooking(b.id);
    });
    del.classList.add('danger');
    if (armed) {
      del.classList.add('armed');
      del.append(' Confirm');
    }
    const actions = document.createElement('div');
    actions.className = 'card-actions';
    actions.append(edit, dup, del);

    li.append(main, pill, actions);
    ul.appendChild(li);
  }
}

/* ---------- editor header / state ---------- */

function renderHeader() {
  const saved = savedCurrent();
  const typedName = input('name').value.trim();
  $('#edTitle').textContent = typedName || (isNew ? 'New booking' : saved ? displayName(saved) : 'Booking');

  const open = openingState(input('date').value, select('cls').value);
  $('#edSub').textContent = open ? `Tatkal ${open.label} · ${open.text}` : 'Set the journey date to see when Tatkal opens.';

  $<HTMLButtonElement>('#dup').disabled = isNew || !saved;
  $<HTMLButtonElement>('#del').disabled = isNew || !saved;
  resetDelete();

  const saveBtn = $<HTMLButtonElement>('#save');
  saveBtn.textContent = isNew ? 'Create booking' : 'Save changes';
  saveBtn.disabled = !isNew && !dirty;
  $('#discard').hidden = !dirty;
  const st = $('#status');
  st.textContent = dirty ? 'Unsaved changes' : isNew ? 'New booking, not saved yet' : 'All changes saved';
  st.className = `status${dirty ? ' dirty' : ''}`;
}

function resetDelete() {
  clearTimeout(delTimer);
  const del = $<HTMLButtonElement>('#del');
  del.textContent = 'Delete';
  del.classList.remove('confirm');
}

function markDirty() {
  dirty = true;
  renderHeader();
}

function loadForm(sb: SavedBooking, asNew: boolean) {
  currentId = sb.id;
  isNew = asNew;
  renderForm(sb);
  dirty = false;
  $('#switchBanner').hidden = true;
  pendingAction = null;
  showView('edit');
  renderHeader();
}

const startNew = () => {
  loadForm(emptyBooking(), true);
  // Tatkal is the point of this extension: start with "search at opening time" on, following the class.
  input('autoStart').checked = true;
  customStart = false;
  updateOpeningHint();
};

function openBooking(id: string) {
  const b = store.bookings.find((x) => x.id === id);
  if (b) loadForm(b, false);
  else showView('list');
}

/** Run `action`, but first ask what to do with unsaved changes. */
function guarded(action: () => void) {
  if (view !== 'edit' || !dirty) return action();
  pendingAction = action;
  $('#switchBanner').hidden = false;
  $<HTMLButtonElement>('#swSave').focus();
}

async function commit(next: Store) {
  store = next;
  await saveStore(next);
  renderList();
  if (view === 'edit') renderHeader();
}

/* ---------- actions ---------- */

async function duplicate(id: string) {
  const src = store.bookings.find((x) => x.id === id);
  if (!src) return;
  const copy: SavedBooking = { ...structuredClone(src), id: newId(), name: `${src.name.trim() || (src.booking.from && src.booking.to ? `${src.booking.from} → ${src.booking.to}` : 'Untitled booking')} (copy)`.slice(0, 60), updatedAt: Date.now() };
  const at = store.bookings.findIndex((b) => b.id === id) + 1;
  await commit({ ...store, bookings: [...store.bookings.slice(0, at), copy, ...store.bookings.slice(at)] });
  if (view === 'edit') openBooking(copy.id);
  toast('Booking duplicated');
}

async function removeBooking(id: string) {
  const idx = store.bookings.findIndex((b) => b.id === id);
  const removed = store.bookings[idx];
  if (!removed) return;
  const wasActive = store.activeId === id;
  const bookings = store.bookings.filter((b) => b.id !== id);
  await commit({ bookings, activeId: wasActive ? (bookings[0]?.id ?? '') : store.activeId });
  if (view === 'edit' && currentId === id) showView('list');
  toast(`Deleted "${displayName(removed)}"`, 'info', {
    ms: 7000,
    action: {
      label: 'Undo',
      run: async () => {
        const restored = [...store.bookings];
        restored.splice(Math.min(idx, restored.length), 0, removed);
        await commit({ bookings: restored, activeId: wasActive ? removed.id : store.activeId });
        toast('Booking restored');
      },
    },
  });
}

/** Validate and save the form. Returns true when saved. */
async function save(toList = true): Promise<boolean> {
  const failing = allRules().filter((rule) => run(rule, true));
  const rows = $$('.pax').length;
  $('#paxErr').textContent = rows === 0 ? 'Add at least one passenger.' : '';
  const problems = failing.length + (rows === 0 ? 1 : 0);
  if (problems) {
    toast(`Fix ${plural(problems, 'field')} before saving`, 'error');
    const first = failing.map((r) => r.el).find((el) => el.offsetParent !== null);
    (first ?? $<HTMLElement>('#add')).focus();
    return false;
  }
  const sb = collect();
  if (isNew) {
    await commit({ bookings: [...store.bookings, sb], activeId: store.activeId || sb.id });
    isNew = false;
    toast(`Booking created: ${displayName(sb)}`);
  } else {
    await commit({ ...store, bookings: store.bookings.map((b) => (b.id === sb.id ? sb : b)) });
    toast(`Booking updated: ${displayName(sb)}`);
  }
  dirty = false;
  if (toList) {
    showView('list');
    flashCard(sb.id);
  } else renderHeader();
  return true;
}

/** Briefly highlight a card after saving so the user sees where the booking went. */
let flashId = '';
function flashCard(id: string) {
  flashId = id;
  renderList();
  document.querySelector(`.card[data-id="${id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  setTimeout(() => {
    flashId = '';
    document.querySelector('.card.flash')?.classList.remove('flash');
  }, 2200);
}

/* ---------- lookups: suggestions + confirmation (all optional) ---------- */

let railKeySet = false;

function setInfo(id: string, kind: '' | 'ok' | 'warn', text: string, action?: { label: string; run: () => void }) {
  const box = $(`#${id}-info`);
  box.className = `info ${kind}`.trim();
  box.replaceChildren();
  if (!text) return;
  if (kind) box.insertAdjacentHTML('beforeend', kind === 'ok' ? ICONS.success : ICONS.error);
  const span = document.createElement('span');
  span.textContent = text;
  box.appendChild(span);
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'link';
    b.textContent = action.label;
    b.addEventListener('click', action.run);
    box.appendChild(b);
  }
}

const stationText = (s: Station) => (s.state ? `${s.name}, ${s.state}` : s.name);

async function confirmStation(id: 'from' | 'to') {
  const el = input(id);
  const code = stationCode(id);
  if (!CODE.test(code)) return setInfo(id, '', '');
  if (el.dataset.verified === code) return;
  setInfo(id, '', 'Checking…');
  try {
    const s = await getStation(code);
    if (stationCode(id) !== code) return; // edited meanwhile
    if (s) {
      el.dataset.verified = code;
      setInfo(id, 'ok', stationText(s));
    } else setInfo(id, 'warn', 'This code is not in the station list. Check it before saving.');
  } catch {
    if (stationCode(id) === code) setInfo(id, '', 'Could not verify the code (lookup unavailable).');
  }
}

function afterPick(el: Field) {
  markDirty();
  updateOpeningHint();
  allRules().forEach((rule) => (rule.el === el ? run(rule, true) : touched.has(rule.el) && run(rule)));
}

const cleanName = (t: TrainHit) => t.name.replace(new RegExp(`^${t.number}\s*[-–:]\s*`), '').trim();
const dayName = (d: string) => d.charAt(0) + d.slice(1).toLowerCase();

function showTrain(t: TrainHit) {
  const days = t.days.length === 7 ? 'Daily' : t.days.map(dayName).join(' ');
  const text = [`${t.number} · ${cleanName(t)}`, t.from && t.to ? `${t.from} → ${t.to}` : '', days, t.src === 'catalog' ? 'older data, IRCTC will confirm' : ''].filter(Boolean).join(' · ');
  const canFill = t.from && t.to && !input('from').value.trim() && !input('to').value.trim();
  setInfo(
    'trainNo',
    'ok',
    text,
    canFill
      ? {
          label: `Use ${t.from} → ${t.to}`,
          run: () => {
            input('from').value = t.from;
            input('to').value = t.to;
            void confirmStation('from');
            void confirmStation('to');
            afterPick(input('from'));
            afterPick(input('to'));
            setInfo('trainNo', 'ok', text);
          },
        }
      : undefined,
  );
}

async function confirmTrain() {
  const n = input('trainNo').value.trim();
  if (!/^\d{5}$/.test(n)) return setInfo('trainNo', '', '');
  setInfo('trainNo', '', 'Checking…');
  try {
    // Cache, remembered trains and the built-in list answer first; the API is only a last resort.
    const t = await getTrain(n);
    if (input('trainNo').value.trim() !== n) return;
    if (t) showTrain(t);
    else setInfo('trainNo', 'warn', 'Train not found in the catalog. Check the number before saving.');
  } catch (e) {
    if (input('trainNo').value.trim() !== n) return;
    if (e instanceof LookupError && e.kind === 'nokey') {
      setInfo('trainNo', '', 'Name not available offline. Open this train once on IRCTC, or', {
        label: 'add a RailCore key',
        run: () =>
          guarded(() => {
            showView('settings');
            void refreshKeyUi();
          }),
      });
    } else setInfo('trainNo', '', e instanceof LookupError ? e.message : 'Could not verify the train.');
  }
}

function resetLookupInfo() {
  (['from', 'to'] as const).forEach((id) => {
    delete input(id).dataset.verified;
    setInfo(id, '', '');
    void confirmStation(id);
  });
  setInfo('trainNo', '', '');
  void confirmTrain();
}

for (const id of ['from', 'to'] as const) {
  attachCombobox<Station>({
    input: input(id),
    minChars: 2,
    delay: 300,
    emptyText: 'No station found. You can still type its code.',
    search: async (q) => (await searchStations(q)).map((s) => ({ label: s.name, detail: s.code, sub: s.state, data: s })),
    onPick: (o) => {
      input(id).value = o.data.code;
      input(id).dataset.verified = o.data.code;
      setInfo(id, 'ok', stationText(o.data));
      afterPick(input(id));
    },
  });
  input(id).addEventListener('blur', () => {
    const v = input(id).value.trim();
    if (/^[A-Za-z]{2,5}$/.test(v)) input(id).value = v.toUpperCase(); // looks like a code
    void confirmStation(id);
  });
}

attachCombobox<TrainHit | null>({
  input: input('trainNo'),
  minChars: 3,
  delay: 450, // trains use a small free quota, so wait until typing pauses
  emptyText: 'No saved train matches yet. Trains you open on IRCTC are remembered, or type the full 5-digit number.',
  search: async (q) => {
    let hits: TrainHit[] = [];
    try {
      hits = await searchTrains(q);
    } catch (e) {
      // No key / budget used up is not a problem for the user: fall back to what we know.
      if (!(e instanceof LookupError && (e.kind === 'nokey' || e.kind === 'budget'))) throw e;
    }
    const options = hits.map((t) => ({
      label: `${t.number} · ${cleanName(t)}`,
      detail: t.from && t.to ? `${t.from} → ${t.to}` : '',
      sub: [t.src === 'catalog' ? 'Older railway data' : t.type, t.days.length === 7 ? 'Daily' : t.days.map(dayName).join(' ')].filter(Boolean).join(' · '),
      data: t as TrainHit | null,
    }));
    // A full number we know nothing about can still be used as typed.
    if (!options.length && /^\d{5}$/.test(q.trim())) {
      options.push({ label: `Use ${q.trim()}`, detail: '', sub: 'Not verified yet. IRCTC will confirm it when you start.', data: null });
    }
    return options;
  },
  onPick: (o) => {
    if (o.data) {
      input('trainNo').value = o.data.number;
      showTrain(o.data);
    } else {
      input('trainNo').value = o.label.replace('Use ', '');
      void confirmTrain();
    }
    afterPick(input('trainNo'));
  },
});
input('trainNo').addEventListener('blur', () => void confirmTrain());

async function refreshKeyUi() {
  const key = await getRailKey();
  railKeySet = !!key;
  input('railKey').value = '';
  $('#removeKey').hidden = !key;
  const [u, stats] = await Promise.all([usageSummary(), cacheStats()]);
  const time = (t: number) => new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const note = u.blockedUntil > Date.now() ? ` · Paused until ${time(u.blockedUntil)}` : u.today >= 80 ? ' · Daily limit reached' : '';
  $('#keyStatus').textContent = key ? `Today ${u.today}/100 · This month ${u.month}/500${note}` : 'No key saved.';
  $('#trainCount').textContent = `${stats.trains.toLocaleString('en-IN')} train${stats.trains === 1 ? '' : 's'} remembered`;
}

const stamp = (t: number) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

async function refreshStationUi() {
  const s = await stationStatus();
  $('#stationCount').textContent = `${s.count.toLocaleString('en-IN')} stations`;
  $('#stationStatus').textContent = s.lastError ? 'Update failed. Using the saved list.' : s.seedOnly ? 'Built-in list' : `Updated ${stamp(s.updatedAt)}`;
}

$('#syncStations').addEventListener('click', async () => {
  const btn = $<HTMLButtonElement>('#syncStations');
  btn.disabled = true;
  btn.textContent = 'Updating…';
  const r = await syncStations(false); // checks the dataset version first, so repeated clicks stay cheap
  btn.disabled = false;
  btn.textContent = 'Update now';
  if (r.status === 'updated') toast(`Station list updated: ${r.count.toLocaleString('en-IN')} stations`);
  else if (r.status === 'failed') toast(r.error, 'error');
  else toast('Station list is already up to date', 'info');
  await refreshStationUi();
  await refreshKeyUi();
});

/* ---------- retry & timing (global) ---------- */

const TIMING_KEYS = Object.keys(defaultTiming) as (keyof Timing)[];
const tField = (k: keyof Timing) => input(`t-${k}`);
const sameTiming = (a: Timing, b: Timing) => TIMING_KEYS.every((k) => a[k] === b[k]);

function readTiming(): Partial<Timing> {
  const out: Partial<Timing> = {};
  for (const k of TIMING_KEYS) out[k] = tField(k).value.trim() === '' ? NaN : Number(tField(k).value);
  return out;
}

function showTiming(t: Timing) {
  for (const k of TIMING_KEYS) tField(k).value = String(t[k]);
  syncPreset();
}

/** Highlight the preset the fields currently match, or Custom. */
function syncPreset() {
  const cur = readTiming() as Timing;
  const name = sameTiming(cur, defaultTiming) ? 'normal' : sameTiming(cur, heavyTiming) ? 'heavy' : 'custom';
  radio('tpreset', name);
  $('#presetHelp').textContent =
    name === 'normal' ? 'The tested defaults.' : name === 'heavy' ? 'Same pace as Normal, but keeps trying for 90 seconds.' : 'Your own values.';
}

/** Returns the valid values, or null after marking each bad field. */
function validateTiming(): Timing | null {
  const raw = readTiming();
  let ok = true;
  for (const k of TIMING_KEYS) {
    const el = tField(k);
    const [lo, hi] = TIMING_LIMITS[k];
    const v = raw[k] as number;
    const err = !Number.isFinite(v) ? 'Enter a number.' : v < lo || v > hi ? `Use ${lo} to ${hi}.` : k === 'reopenLimit' && !Number.isInteger(v) ? 'Use a whole number.' : '';
    el.setAttribute('aria-invalid', err ? 'true' : 'false');
    el.closest('.field')!.querySelector('.err')!.textContent = err;
    if (err) ok = false;
  }
  if (ok && (raw.gapMax as number) < (raw.gapMin as number)) {
    ok = false;
    const e = tField('gapMax');
    e.setAttribute('aria-invalid', 'true');
    e.closest('.field')!.querySelector('.err')!.textContent = 'Must be at least the minimum pause.';
  }
  return ok ? (raw as Timing) : null;
}

$$<HTMLInputElement>('input[name="tpreset"]').forEach((r) =>
  r.addEventListener('change', () => {
    if (r.value === 'normal') showTiming(defaultTiming);
    else if (r.value === 'heavy') showTiming(heavyTiming);
    $('#timingStatus').textContent = '';
  }),
);
$$('#timingGrid input').forEach((el) => el.addEventListener('input', () => { syncPreset(); $('#timingStatus').textContent = ''; }));
$('#timingSave').addEventListener('click', async () => {
  const t = validateTiming();
  if (!t) return toast('Fix the highlighted timing values', 'error');
  await saveTiming(t);
  $('#timingStatus').textContent = 'Saved. Applies from the next step of a run.';
  toast('Timing saved');
});
$('#timingReset').addEventListener('click', async () => {
  showTiming(defaultTiming);
  validateTiming();
  await saveTiming(defaultTiming);
  $('#timingStatus').textContent = 'Back to the defaults.';
  toast('Timing reset to defaults', 'info');
});
void getTiming().then(showTiming);

/* ---------- updates (GitHub releases) ---------- */

async function refreshUpdateUi(note = '') {
  const u = await availableUpdate();
  const link = $<HTMLAnchorElement>('#updateLink');
  link.hidden = !u;
  if (u) link.href = u.url;
  $('#updateTitle').textContent = u ? `Update available: ${u.latest}` : `You have the latest version (v${currentVersion()})`;
  const at = await lastChecked();
  $('#updateStatus').textContent = note || (at ? `Last checked ${new Date(at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Not checked yet');
}

$('#updateCheck').addEventListener('click', async () => {
  const btn = $<HTMLButtonElement>('#updateCheck');
  btn.disabled = true;
  btn.textContent = 'Checking…';
  const r = await ensureUpdateCheck(true);
  btn.disabled = false;
  btn.textContent = 'Check now';
  await applyBadge();
  await refreshUpdateUi(r.status === 'failed' ? `Could not check: ${r.error}` : '');
});
void ensureUpdateCheck().then(() => Promise.all([refreshUpdateUi(), applyBadge()])).catch(() => undefined);
void refreshUpdateUi();

$('#saveKey').addEventListener('click', async () => {
  const v = input('railKey').value.trim();
  if (!v) return toast('Paste your RailCore API key first', 'error');
  await setRailKey(v);
  await refreshKeyUi();
  toast('RailCore key saved');
  void confirmTrain();
});
$('#removeKey').addEventListener('click', async () => {
  await setRailKey('');
  await refreshKeyUi();
  toast('RailCore key removed', 'info');
});
$('#clearCache').addEventListener('click', async () => {
  await clearLookupCache();
  await refreshKeyUi();
  toast('Lookup cache cleared', 'info');
});
void refreshKeyUi();
document.getElementById('version')!.textContent = 'v' + browser.runtime.getManifest().version;
initPassengerTip(document.body);
void refreshStationUi();
// First time the extension is opened each day: refresh the station list (a single request on a normal day).
void ensureDailySync().then(() => Promise.all([refreshStationUi(), refreshKeyUi()]));

/* ---------- events ---------- */

function syncConfirmNote() {
  $('#confirmNote').classList.toggle('on', input('confirmBerthSw').checked);
}

const form = $<HTMLFormElement>('#form');

form.addEventListener('input', (e) => {
  const t = e.target as Field;
  if (t.id === 'gst' || t.id === 'coach') {
    const cleaned = t.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (cleaned !== t.value) t.value = cleaned;
  }
  if (t.id === 'mobile') t.value = t.value.replace(/\D/g, '');
  if (t.id === 'startAt') {
    t.value = t.value.replace(/[^\d:]/g, '');
    customStart = true;
  }
  markDirty();
  updateOpeningHint();
  syncConfirmNote();
  allRules().forEach((rule) => touched.has(rule.el) && run(rule));
});
form.addEventListener('change', () => {
  markDirty();
  updateOpeningHint();
  syncConfirmNote();
  allRules().forEach((rule) => touched.has(rule.el) && run(rule));
});
form.addEventListener('focusout', (e) => {
  const rule = allRules().find((r) => r.el === e.target);
  if (!rule) return;
  run(rule, true);
  if (rule.el.id === 'from') {
    const to = staticRules.find((r) => r.el.id === 'to');
    if (to && touched.has(to.el)) run(to);
  }
});
form.addEventListener('submit', (e) => {
  e.preventDefault();
  void save();
});

$('#swap').addEventListener('click', () => {
  const from = input('from');
  const to = input('to');
  if (!from.value.trim() && !to.value.trim()) return;
  [from.value, to.value] = [to.value, from.value];
  delete from.dataset.verified;
  delete to.dataset.verified;
  void confirmStation('from');
  void confirmStation('to');
  afterPick(from);
  afterPick(to);
});
$('#autoStart').addEventListener('change', () => {
  customStart = false;
  updateOpeningHint();
});
$('#editStart').addEventListener('click', () => {
  customStart = true;
  updateOpeningHint();
  input('startAt').focus();
});
$$('.quick-btn').forEach((btn) =>
  btn.addEventListener('click', () => {
    const d = new Date();
    d.setDate(d.getDate() + Number(btn.dataset.days));
    input('date').value = isoDate(d);
    input('date').dispatchEvent(new Event('input', { bubbles: true }));
  }),
);

$('#add').addEventListener('click', () => {
  if ($$('.pax').length >= MAX_PASSENGERS) return;
  const row = passengerRow({ kind: 'master', query: '' });
  $('#passengers').appendChild(row);
  refreshPassengers();
  row.querySelector<HTMLInputElement>('[data-k=query]')?.focus();
  markDirty();
});

$('#newBtn').addEventListener('click', startNew);
$('#tabBookings').addEventListener('click', () => guarded(() => showView('list')));
$('#tabSettings').addEventListener('click', () =>
  guarded(() => {
    showView('settings');
    void refreshKeyUi();
  }),
);
$('#emptyNew').addEventListener('click', startNew);
$('#back').addEventListener('click', () => guarded(() => showView('list')));

$('#discard').addEventListener('click', () => {
  const saved = savedCurrent();
  loadForm(saved ?? emptyBooking(), !saved);
  toast('Changes discarded', 'info');
});

$('#dup').addEventListener('click', () => guarded(() => void duplicate(currentId)));
$('#del').addEventListener('click', () => {
  const del = $<HTMLButtonElement>('#del');
  if (!del.classList.contains('confirm')) {
    del.classList.add('confirm');
    del.textContent = 'Click again to confirm';
    delTimer = setTimeout(resetDelete, 4000);
    return;
  }
  resetDelete();
  dirty = false;
  void removeBooking(currentId);
});

$('#swSave').addEventListener('click', async () => {
  if (!(await save(false))) return;
  const go = pendingAction;
  $('#switchBanner').hidden = true;
  pendingAction = null;
  go?.();
});
$('#swDiscard').addEventListener('click', () => {
  const go = pendingAction;
  dirty = false;
  $('#switchBanner').hidden = true;
  pendingAction = null;
  go?.();
});
$('#swStay').addEventListener('click', () => {
  $('#switchBanner').hidden = true;
  pendingAction = null;
});

// Keep toasts exactly 16px above the sticky save bar (0 height when the bar is hidden).
const saveBar = $('.bar');
new ResizeObserver(() => document.documentElement.style.setProperty('--bar-h', `${saveBar.offsetHeight}px`)).observe(saveBar);

window.addEventListener('beforeunload', (e) => {
  if (dirty) e.preventDefault();
});

// Changes made elsewhere (popup / page panel), e.g. switching the active booking.
watchStore((s) => {
  store = s;
  if (view === 'edit' && !isNew && !s.bookings.some((b) => b.id === currentId)) {
    dirty = false;
    showView('list');
  }
  renderList();
  if (view === 'edit') renderHeader();
});

// Keep the "Opens in …" countdowns fresh.
setInterval(() => {
  if (view === 'list') renderList();
  else if (view === 'edit') renderHeader();
}, 30_000);

initHelp();

/** Open what a URL hash asks for (#new, #edit=<id>, #settings). False when it asks for nothing we know. */
function routeHash(h: string): boolean {
  if (h === '#new') startNew();
  else if (h.startsWith('#edit=') && store.bookings.some((b) => b.id === h.slice(6))) openBooking(h.slice(6));
  else if (h === '#settings') showView('settings');
  else return false;
  return true;
}

// The popup and the page panel reuse this tab when it is already open: they only change the hash, so
// switch to what they asked for, but never throw away unsaved changes without asking (guarded).
window.addEventListener('hashchange', () => {
  const h = location.hash;
  if (!h) return;
  history.replaceState(null, '', location.pathname); // so asking for the same thing again fires again
  guarded(() => void routeHash(h));
});

void getStore().then((s) => {
  store = s;
  renderList();
  const h = location.hash;
  if (h) history.replaceState(null, '', location.pathname);
  if (!routeHash(h)) showView('list');
});
