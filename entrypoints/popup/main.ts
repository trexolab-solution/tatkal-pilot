import { timerChip } from '@/utils/timer';
import { getProfile, getStore, problemsFor, shortDate, type SavedBooking, type Store } from '@/utils/storage';
import type { SiteStatus } from '@/utils/site';
import { ensureDailySync } from '@/utils/catalog';
import { applyBadge, availableUpdate, ensureUpdateCheck } from '@/utils/update';
import { openingState } from '@/utils/tatkal';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

type Tone = 'ok' | 'warn' | 'wait';
const ICON: Record<Tone, string> = {
  ok: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5.2 8.3l2 2 3.6-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  warn: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 2.2l6.2 11H1.8L8 2.2z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6.6v3M8 11.6v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  wait: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2.5 2.5"/></svg>',
};

let store: Store = { bookings: [], activeId: '' };

interface Ctx {
  kind: 'ready' | 'no-script' | 'other-tab' | 'closed';
  tabId?: number;
  status?: SiteStatus;
}

async function getCtx(): Promise<Ctx> {
  const [active] = await browser.tabs.query({ active: true, currentWindow: true });
  if (active?.id && active.url?.startsWith('https://www.irctc.co.in/')) {
    try {
      const status = (await browser.tabs.sendMessage(active.id, { type: 'status' })) as SiteStatus | undefined;
      if (status) return { kind: 'ready', tabId: active.id, status };
    } catch {
      /* content script not loaded yet */
    }
    return { kind: 'no-script', tabId: active.id };
  }
  const tabs = await browser.tabs.query({ url: 'https://www.irctc.co.in/*' });
  const other = tabs[0];
  return other?.id ? { kind: 'other-tab', tabId: other.id } : { kind: 'closed' };
}

/** The single status line under the list. */
function showSite(tone: Tone, text: string, linkLabel?: string, onLink?: () => void) {
  const el = $('site');
  el.className = `site ${tone}`;
  el.innerHTML = ICON[tone]; // security-ok: ICON is a constant map of static SVG, the text goes in via textContent
  const span = document.createElement('span');
  span.textContent = text;
  el.appendChild(span);
  if (linkLabel && onLink) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'inline';
    b.textContent = linkLabel;
    b.addEventListener('click', onLink);
    el.appendChild(b);
  }
}

const openOptions = (hash = '') => {
  void browser.tabs.create({ url: browser.runtime.getURL('/options.html') + hash });
  window.close();
};

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

function bookingItem(b: SavedBooking): HTMLLIElement {
  const named = b.name.trim();
  const route = b.booking.from && b.booking.to ? `${b.booking.from} → ${b.booking.to}` : '';
  const title = named || route || 'Untitled booking';
  const meta = [
    b.booking.trainNo ? `${b.booking.trainNo} · ${b.booking.cls}` : '',
    named ? route : '',
    b.booking.date ? shortDate(b.booking.date) : '',
    plural(b.passengers.length, 'passenger'),
  ]
    .filter(Boolean)
    .join(' · ');
  const missing = problemsFor(b);
  const open = openingState(b.booking.date, b.booking.cls);

  // A plain, read-only list: choosing the booking to run happens on the IRCTC page or in Manage.
  const li = document.createElement('li');
  li.className = 'bitem';

  // Two rows: [title ........ badge] and [details]
  const body = document.createElement('div');
  body.className = 'b-body';
  const top = document.createElement('div');
  top.className = 'b-top';
  const t = document.createElement('span');
  t.className = 'b-title';
  t.textContent = title;
  t.title = title;
  top.appendChild(t);
  const chip = timerChip(b.booking.startAt);
  if (chip) top.appendChild(chip);

  const badge = document.createElement('span');
  if (missing.length) {
    badge.className = 'pill warn';
    badge.textContent = 'Incomplete';
    badge.title = `Missing: ${missing.join(', ')}`;
    top.appendChild(badge);
  } else if (open) {
    badge.className = `pill ${open.kind}`;
    badge.textContent = open.kind === 'open' ? 'Tatkal open' : open.text;
    top.appendChild(badge);
  }

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'b-edit';
  edit.title = `Edit "${title}"`;
  edit.setAttribute('aria-label', `Edit "${title}"`);
  edit.innerHTML = /* security-ok: a literal SVG string, no variables */
    '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.8 2.7l2.5 2.5-7.6 7.6-3.2.7.7-3.2z"/><path d="M9.4 4.1l2.5 2.5"/></svg>';
  edit.addEventListener('click', () => openOptions(`#edit=${b.id}`));

  const m = document.createElement('div');
  m.className = 'b-meta';
  m.textContent = meta;
  m.title = meta; // full text on hover when it is cut off
  body.append(top, m);
  li.append(body, edit);

  return li;
}

async function render() {
  const ctx = await getCtx();
  const has = store.bookings.length > 0;
  $('none').hidden = has;
  $('main').hidden = !has;
  if (!has) return;

  const list = $('blist');
  const scroll = list.scrollTop;
  list.replaceChildren(...store.bookings.map(bookingItem));
  list.scrollTop = scroll;
  $('count').textContent = plural(store.bookings.length, 'booking');

  const action = $<HTMLButtonElement>('action');
  const stop = $<HTMLButtonElement>('stop');
  const link = $('openIrctc');
  const running = ctx.status?.run.active ?? false;
  action.hidden = true;
  stop.hidden = !running;
  // The website link is only useful when IRCTC is not open in any tab.
  link.hidden = ctx.kind !== 'closed';
  stop.onclick = async () => {
    if (ctx.tabId) await browser.tabs.sendMessage(ctx.tabId, { type: 'stop' });
    void render();
  };

  // Not on the IRCTC page: this extension only works there.
  if (ctx.kind !== 'ready' || !ctx.status) {
    if (ctx.kind === 'no-script') {
      showSite('warn', 'The IRCTC tab needs a reload.');
      action.hidden = false;
      action.textContent = 'Reload IRCTC tab';
      action.onclick = async () => {
        await browser.tabs.reload(ctx.tabId!);
        window.close();
      };
    } else if (ctx.kind === 'other-tab') {
      showSite('warn', 'Works only on the IRCTC tab.');
      action.hidden = false;
      action.textContent = 'Go to IRCTC tab';
      action.onclick = async () => {
        const tab = await browser.tabs.update(ctx.tabId!, { active: true });
        if (tab?.windowId) await browser.windows.update(tab.windowId, { focused: true });
        window.close();
      };
    } else {
      showSite('warn', 'Works only on irctc.co.in.');
    }
    return;
  }

  // On IRCTC: show login state. Starting is done from the panel on the page itself.
  const active = store.bookings.find((b) => b.id === store.activeId);
  const missing = active ? problemsFor(await getProfile(active.id)) : [];
  const login = ctx.status.login;
  if (running) showSite('ok', 'Run in progress on the IRCTC page.');
  else if (login === 'out') showSite('warn', 'Logged out. Log in to IRCTC first.');
  else if (login === 'unknown') showSite('wait', 'Checking login…');
  else if (missing.length) showSite('warn', `Logged in. Booking incomplete (${missing.join(', ')}).`, 'Edit', () => openOptions());
  else showSite('ok', 'Logged in. Press Start on the IRCTC page.');
}

$('manage').addEventListener('click', () => {
  void browser.runtime.openOptionsPage();
  window.close();
});
$('settings').addEventListener('click', () => openOptions('#settings'));
$('guide').addEventListener('click', () => {
  void browser.tabs.create({ url: browser.runtime.getURL('/guide.html') });
  window.close();
});
$('new').addEventListener('click', () => openOptions('#new'));
$('createFirst').addEventListener('click', () => openOptions('#new'));

document.getElementById('version')!.textContent = browser.runtime.getManifest().version;
void ensureDailySync().catch(() => undefined); // first open of the day refreshes the station list

// Not on the Web Store: tell the user when a newer GitHub release exists (link only, nothing is installed).
async function showUpdate() {
  const u = await availableUpdate();
  const a = $<HTMLAnchorElement>('update');
  a.hidden = !u;
  if (!u) return;
  a.href = u.url;
  a.textContent = `Update available: ${u.latest} · Download`;
}
void showUpdate();
void ensureUpdateCheck().then(() => Promise.all([showUpdate(), applyBadge()])).catch(() => undefined);
void getStore().then((s) => {
  store = s;
  void render();
  setInterval(() => void getStore().then((x) => ((store = x), render())), 1500); // keeps login state fresh
});
