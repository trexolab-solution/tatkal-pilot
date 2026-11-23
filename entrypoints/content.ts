import { timerChip } from '@/utils/timer';
import { fillPassengersPage, routeStage, startRun, stop, watchRoutes } from '@/utils/run';
import { startHarvest } from '@/utils/harvest';
import { currentPage, loginState, openLogin, type SiteStatus } from '@/utils/site';
import { openingState } from '@/utils/tatkal';
import {
  displayName,
  getProfile,
  getRun,
  getStore,
  saveStore,
  shortDate,
  watchRun,
  watchStore,
  type RunState,
  type Stage,
  type Store,
} from '@/utils/storage';
import { toast } from '@/utils/toast';
import { startTourDismisser } from '@/utils/tour';
import { ACCENT, ACCENT_HOVER, BRAND, ORANGE, addStyles, uiLayer } from '@/utils/ui';
import type { ContentScriptContext } from 'wxt/utils/content-script-context';

interface UiState {
  collapsed: boolean;
  // Distance of the panel's bottom-right corner from the window's right/bottom edge, set only after
  // the user drags it. Absent = the default corner. Anchoring the corner means opening or closing the
  // panel never makes it jump.
  right?: number;
  bottom?: number;
}
const uiItem = storage.defineItem<UiState>('local:ui', { fallback: { collapsed: false } });

const PANEL_CSS = `
.panel { position: fixed; right: 16px; bottom: 16px; z-index: 2147483646; width: 288px; background: #fff; border: 1px solid #d3dcee; border-radius: 14px; box-shadow: 0 10px 30px rgb(7 21 65 / .22); overflow: hidden; font-family: 'Open Sans', system-ui, sans-serif; }
.panel.collapsed { width: auto; border-radius: 999px; }
.bar { display: flex; align-items: center; background: ${BRAND}; }
.head, .gear { cursor: pointer; }
.grip { flex: none; width: 30px; height: 36px; margin-left: 6px; display: grid; place-items: center; border: 0; border-radius: 8px; background: none; color: rgb(255 255 255 / .85); cursor: grab; touch-action: none; user-select: none; }
.grip:hover { background: rgb(255 255 255 / .16); color: #fff; }
.grip:focus-visible { outline-offset: -3px; }
.panel.dragging { box-shadow: 0 16px 40px rgb(7 21 65 / .32); }
.panel.dragging .grip { cursor: grabbing; background: rgb(255 255 255 / .2); }
.notice { display: flex; gap: 10px; padding: 12px; border-radius: 10px; background: #fff4dc; color: #5c3b00; }
.notice svg { flex: none; margin-top: 1px; }
.notice strong { display: block; font-weight: 700; color: #3d2700; }
.notice p { margin: 2px 0 0; font-size: 12.5px; line-height: 1.45; }
.btn.signin { width: 100%; color: ${ACCENT}; border-color: ${ACCENT}; }
.btn.signin:hover:not(:disabled) { background: #e8f0fd; }
.head { flex: 1; display: flex; align-items: center; gap: 7px; min-width: 0; padding: 12px 8px 12px 4px; white-space: nowrap; border: 0; background: none; color: #fff; font-weight: 700; text-align: left; }
.head:focus-visible, .gear:focus-visible { outline-offset: -3px; }
.panel.collapsed .head { padding: 10px 16px 10px 2px; }
.dot { width: 9px; height: 9px; border-radius: 50%; background: #b8c9e6; flex: none; }
.dot.run { background: #ff9a3d; }
.dot.done { background: #6fe0a3; }
.chev { margin-left: auto; width: 14px; height: 14px; color: rgb(255 255 255 / .85); }
.panel.collapsed .chev, .panel.collapsed .gear { display: none; }
.gear { flex: none; width: 34px; height: 34px; margin-right: 6px; display: grid; place-items: center; border: 0; border-radius: 8px; background: none; color: rgb(255 255 255 / .9); }
.gear:hover { background: rgb(255 255 255 / .16); color: #fff; }
.login { flex: none; padding: 2px 8px; border-radius: 999px; font-size: 10.5px; font-weight: 600; background: rgb(7 21 65 / .3); color: #fff; }
.login.in { background: #e6f4ec; color: #145c33; }
.login.out { background: #fdecea; color: #8a1c15; }
.body { padding: 0 14px 14px; display: grid; gap: 12px; padding-top: 12px; }
.panel.collapsed .body { display: none; }
select { width: 100%; height: 34px; padding: 0 8px; border: 1px solid #cfd3d9; border-radius: 8px; background: #fff; color: #071541; font: inherit; font-weight: 600; }
.sum { font-weight: 600; color: #071541; }
.sub { color: #4a5a7d; font-size: 12px; margin-top: 2px; }
.sub .up { color: ${ORANGE}; font-weight: 600; }
.sub .open { color: #1b7a43; font-weight: 600; }
.steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
.steps li { font-size: 11px; color: #7b828d; text-align: center; }
.steps li::before { content: ''; display: block; height: 4px; margin-bottom: 5px; border-radius: 4px; background: #e3e6ea; }
.steps li.done::before { background: ${ACCENT}; opacity: .4; }
.steps li.now { color: #071541; font-weight: 600; }
.steps li.now::before { background: ${ACCENT}; }
.state { margin: 0; font-size: 12.5px; color: #3a414c; }
.state.warn { color: #8a1c15; font-weight: 600; }
.row { display: flex; gap: 8px; }
.btn { height: 38px; padding: 0 16px; border-radius: 999px; border: 1px solid #c9d3e8; background: #fff; color: #071541; font-weight: 600; }
.btn:hover:not(:disabled) { background: #eef3fc; }
.btn:disabled { opacity: .5; cursor: not-allowed; }
.btn.primary { flex: 1; background: ${ACCENT}; border-color: ${ACCENT}; color: #fff; }
.btn.primary:hover:not(:disabled) { background: ${ACCENT_HOVER}; }
.btn.fill { width: 100%; }
.empty { margin: 0; color: #4a5a7d; }
[hidden] { display: none !important; }
`;

const STEPS: Stage[] = ['home', 'list', 'passengers', 'review'];
const STEP_LABEL = ['Search', 'Train', 'Passengers', 'Review'];

const STATE_TEXT: Record<Stage, string> = {
  home: 'Searching trains…',
  list: 'Finding your train…',
  passengers: 'Press BOOK. Passengers fill automatically.',
  review: 'Check the fare, then continue.',
  done: 'Done. Continue from here.',
};

/** "Manage bookings" icon: a bulleted list (a gear/sun-like icon looks like a theme toggle). */
const GEAR =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6.2 4.5h7.3M6.2 8h7.3M6.2 11.5h7.3"/><path d="M2.6 4.5h.01M2.6 8h.01M2.6 11.5h.01" stroke-width="2.2"/></svg>';
const GRIP =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="currentColor"><circle cx="5.5" cy="3.5" r="1.25"/><circle cx="10.5" cy="3.5" r="1.25"/><circle cx="5.5" cy="8" r="1.25"/><circle cx="10.5" cy="8" r="1.25"/><circle cx="5.5" cy="12.5" r="1.25"/><circle cx="10.5" cy="12.5" r="1.25"/></svg>';
const LOCK =
  '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3.2" y="7" width="9.6" height="6.8" rx="1.6"/><path d="M5.4 7V5.2a2.6 2.6 0 0 1 5.2 0V7"/></svg>';
const CHEVRON =
  '<svg class="chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6.5l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function mountPanel(ctx: ContentScriptContext) {
  const layer = uiLayer();
  if (layer.querySelector('.panel')) return;
  addStyles('panel', PANEL_CSS);

  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.setAttribute('aria-label', 'IRCTC Autofill');
  panel.innerHTML = `
    <div class="bar">
      <button type="button" class="grip" aria-label="Move panel" title="Drag to move (or use the arrow keys)">${GRIP}</button>
      <button type="button" class="head" aria-expanded="true">
        <span class="dot" aria-hidden="true"></span>
        <span>IRCTC Autofill</span>
        <span class="login" hidden></span>
        ${CHEVRON}
      </button>
      <button type="button" class="gear manage" title="Manage bookings" aria-label="Manage bookings">${GEAR}</button>
    </div>
    <div class="body">
      <div class="has-bookings">
        <select id="pick" aria-label="Booking"></select>
        <div class="sum" style="margin-top:10px"></div>
        <div class="sub"></div>
      </div>
      <p class="empty" hidden>No booking saved yet.</p>
      <ol class="steps" aria-label="Progress">${STEP_LABEL.map((l, i) => `<li data-step="${STEPS[i]}">${l}</li>`).join('')}</ol>
      <div class="notice" role="status" hidden>
        ${LOCK}
        <div>
          <strong>Login required</strong>
          <p>Log in to IRCTC to start.</p>
        </div>
      </div>
      <button type="button" class="btn signin" hidden>Open login</button>
      <p class="state" role="status"></p>
      <div class="row">
        <button type="button" class="btn primary start">Start</button>
        <button type="button" class="btn stop" hidden>Stop</button>
      </div>
      <button type="button" class="btn fill" hidden>Fill passengers on this page</button>
    </div>`;
  layer.appendChild(panel);

  const q = <T extends HTMLElement>(s: string) => panel.querySelector<T>(s)!;
  const head = q<HTMLButtonElement>('.head');
  const pick = q<HTMLSelectElement>('#pick');
  const start = q<HTMLButtonElement>('.start');
  const stopBtn = q<HTMLButtonElement>('.stop');
  const fill = q<HTMLButtonElement>('.fill');
  let store: Store = { bookings: [], activeId: '' };
  let run: RunState = { active: false, stage: 'home', at: 0, bookingId: '' };

  const setCollapsed = (c: boolean) => {
    panel.classList.toggle('collapsed', c);
    head.setAttribute('aria-expanded', String(!c));
  };
  const saveUi = async (patch: Partial<UiState>) => {
    await uiItem.setValue({ ...(await uiItem.getValue()), ...patch });
  };

  const DEFAULT_GAP = 16;
  const SNAP = 40; // dropped this close to the default corner = back to the default placement

  /** Anchor the panel's bottom-right corner `right`/`bottom` px from the window edges (kept inside). */
  const place = (right: number, bottom: number) => {
    const m = 8;
    const r = Math.min(Math.max(m, right), Math.max(m, innerWidth - panel.offsetWidth - m));
    const b = Math.min(Math.max(m, bottom), Math.max(m, innerHeight - panel.offsetHeight - m));
    panel.style.right = `${r}px`;
    panel.style.bottom = `${b}px`;
  };
  const resetPlacement = () => {
    panel.style.right = '';
    panel.style.bottom = '';
  };
  const corner = () => {
    const r = panel.getBoundingClientRect();
    return { right: innerWidth - r.right, bottom: innerHeight - r.bottom };
  };
  const keepInView = () => {
    if (!panel.style.right) return; // still in the default corner
    const c = corner();
    place(c.right, c.bottom);
  };

  void uiItem.getValue().then((u) => {
    setCollapsed(u.collapsed);
    if (u.right != null && u.bottom != null) place(u.right, u.bottom);
  });
  ctx.addEventListener(window, 'resize', keepInView);
  const sizeWatch = new ResizeObserver(keepInView); // expanding / collapsing changes the size
  sizeWatch.observe(panel);
  ctx.onInvalidated(() => sizeWatch.disconnect());

  // Drag by the header (open or collapsed). A press that barely moves is still a click.
  const grip = q<HTMLElement>('.grip');
  let drag: { sx: number; sy: number; right: number; bottom: number; active: boolean } | null = null;
  let justDragged = false;
  const onMove = (e: PointerEvent) => {
    if (!drag) return;
    const dx = e.clientX - drag.sx;
    const dy = e.clientY - drag.sy;
    if (!drag.active && Math.hypot(dx, dy) < 8) return;
    drag.active = true;
    panel.classList.add('dragging');
    place(drag.right - dx, drag.bottom - dy);
  };
  const onUp = () => {
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onUp, true);
    if (drag?.active) {
      justDragged = true;
      setTimeout(() => (justDragged = false), 0); // swallow the click that ends a drag
      const c = corner();
      if (c.right <= DEFAULT_GAP + SNAP && c.bottom <= DEFAULT_GAP + SNAP) {
        resetPlacement(); // dropped back near the corner: use the original placement
        void saveUi({ right: undefined, bottom: undefined });
      } else {
        void saveUi({ right: Math.round(c.right), bottom: Math.round(c.bottom) });
      }
    }
    drag = null;
    panel.classList.remove('dragging');
  };
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); // no text selection while dragging
    const c = corner();
    drag = { sx: e.clientX, sy: e.clientY, right: c.right, bottom: c.bottom, active: false };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
  });

  // Keyboard: arrow keys move the panel (Shift = bigger steps), so moving never needs a mouse.
  grip.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 40 : 10;
    const move: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const d = move[e.key];
    if (!d) return;
    e.preventDefault();
    const c = corner();
    place(c.right + d[0], c.bottom + d[1]);
    const n = corner();
    void saveUi({ right: Math.round(n.right), bottom: Math.round(n.bottom) });
  });

  head.title = 'Click to open or close';
  head.addEventListener('click', () => {
    if (justDragged) return;
    const c = !panel.classList.contains('collapsed');
    setCollapsed(c);
    void saveUi({ collapsed: c });
  });

  // A run must not carry on after the user logs out: stop it once the site has shown "logged out" for a few seconds in a row
  // (a short blip while the header loads does not count).
  let outTicks = 0;
  const render = () => {
    const active = store.bookings.find((b) => b.id === store.activeId);
    const has = store.bookings.length > 0;
    const login = loginState();
    outTicks = run.active && login === 'out' ? outTicks + 1 : 0;
    if (outTicks === 4) {
      void stop().then(() => toast('You logged out of IRCTC, so the booking was stopped.', 'info', 7000));
    }
    q('.has-bookings').hidden = !has;
    q('.empty').hidden = has;

    // Booking picker: a dropdown only when there is something to choose.
    const ids = store.bookings.map((b) => b.id).join();
    const names = store.bookings.map(displayName).join('|');
    if (pick.dataset.ids !== ids || pick.dataset.names !== names) {
      pick.replaceChildren(...store.bookings.map((b) => new Option(displayName(b), b.id)));
      pick.dataset.ids = ids;
      pick.dataset.names = names;
    }
    pick.value = store.activeId;
    pick.disabled = run.active;
    pick.hidden = store.bookings.length < 2;

    if (active) {
      const b = active.booking;
      const route = b.from && b.to ? `${b.from} → ${b.to}` : '';
      q('.sum').textContent = [b.trainNo, b.cls, route].filter(Boolean).join(' · ') || displayName(active);
      const sub = q('.sub');
      sub.replaceChildren();
      const n = active.passengers.length;
      sub.append(`${shortDate(b.date) || 'No date'} · ${n} passenger${n === 1 ? '' : 's'}`);
      const chip = timerChip(active.booking.startAt);
      if (chip) sub.append(' · ', chip);
      const t = openingState(b.date, b.cls);
      if (t && t.kind !== 'passed') {
        const span = document.createElement('span');
        span.className = t.kind === 'open' ? 'open' : 'up';
        span.textContent = t.kind === 'open' ? 'Tatkal open' : t.text;
        sub.append(' · ', span);
      }
    }

    // Login badge + progress
    const badge = q('.login');
    badge.hidden = login === 'unknown';
    badge.className = `login ${login === 'in' ? 'in' : 'out'}`;
    badge.textContent = login === 'in' ? 'Logged in' : 'Logged out';

    const done = run.active && run.stage === 'done';
    const idx = run.active ? (run.stage === 'done' ? STEPS.length : STEPS.indexOf(run.stage)) : -1;
    panel.querySelectorAll<HTMLElement>('.steps li').forEach((li, i) => {
      li.className = i < idx ? 'done' : i === idx ? 'now' : '';
    });

    const loggedOut = !run.active && has && login === 'out';
    // Logged out: no Start button, just a clear message and a shortcut to the site's login.
    q('.notice').hidden = !loggedOut;
    q('.signin').hidden = !loggedOut;
    q('.steps').hidden = loggedOut;
    q('.state').hidden = loggedOut;
    q('.row').hidden = loggedOut;
    const state = q('.state');
    state.className = `state${loggedOut ? ' warn' : ''}`;
    const waitingFor = run.active && run.stage === 'home' && active ? active.booking.startAt.trim() : '';
    const waitMs = waitingFor
      ? (() => {
          const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(waitingFor);
          if (!m) return 0;
          const d = new Date();
          d.setHours(Number(m[1]), Number(m[2]), Number(m[3] ?? 0), 0);
          return d.getTime() - Date.now();
        })()
      : 0;
    state.textContent = run.active
      ? waitMs > 0
        ? `Filled. Searches automatically at ${waitingFor.slice(0, 5)}.`
        : STATE_TEXT[run.stage]
      : !has
        ? 'Create a booking to get started.'
        : loggedOut
          ? 'Log in to IRCTC to start.'
          : 'Ready when you are.';
    q('.dot').className = `dot${run.active ? (done ? ' done' : ' run') : ''}`;

    start.textContent = has ? (run.active ? 'Restart' : 'Start') : 'Create booking';
    start.disabled = has && !run.active && login === 'out';
    start.title = start.disabled ? 'Log in to IRCTC first' : '';
    stopBtn.hidden = !run.active;
    fill.hidden = routeStage() !== 'passengers' || !has || loggedOut;
  };

  void Promise.all([getStore(), getRun()]).then(([s, r]) => {
    store = s;
    run = r;
    render();
  });
  ctx.onInvalidated(
    watchStore((s) => {
      store = s;
      render();
    }),
  );
  ctx.onInvalidated(
    watchRun((r) => {
      run = r;
      render();
    }),
  );
  ctx.setInterval(render, 800); // route changes (SPA) toggle the "fill passengers" button

  pick.addEventListener('change', async () => {
    const next = { ...store, activeId: pick.value };
    await saveStore(next);
    const b = next.bookings.find((x) => x.id === next.activeId);
    if (b) toast(`Active booking: ${displayName(b)}`, 'info', 2500);
  });
  start.addEventListener('click', () => {
    if (store.bookings.length === 0) void browser.runtime.sendMessage({ type: 'open-options' });
    else void startRun();
  });
  stopBtn.addEventListener('click', async () => {
    await stop();
    toast('Stopped', 'info', 2000);
  });
  q('.signin').addEventListener('click', () => {
    if (!openLogin()) toast('Use the Login button at the top of the IRCTC page.', 'info');
  });
  q('.manage').addEventListener('click', () => void browser.runtime.sendMessage({ type: 'open-options' }));
  fill.addEventListener('click', async () => {
    fill.disabled = true;
    try {
      await fillPassengersPage(await getProfile(run.bookingId || undefined));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error', 8000);
    } finally {
      fill.disabled = false;
    }
  });
}

export default defineContentScript({
  matches: ['https://www.irctc.co.in/*'],
  runAt: 'document_idle',
  main(ctx) {
    // After the extension is reloaded, an already-open IRCTC tab keeps a dead copy of this script.
    // Its storage calls reject with "Extension context invalidated"; that is expected, so stay quiet.
    window.addEventListener('unhandledrejection', (e) => {
      if (/Extension context invalidated/i.test(String((e.reason as Error)?.message ?? e.reason))) e.preventDefault();
    });

    ctx.onInvalidated(startTourDismisser());
    const mount = () => mountPanel(ctx);
    mount();
    // The site is an SPA: make sure our host stays attached.
    const observer = new MutationObserver(mount);
    observer.observe(document.documentElement, { childList: true });
    ctx.onInvalidated(() => observer.disconnect());

    browser.runtime.onMessage.addListener((msg: { type?: string }) => {
      if (msg?.type === 'start') {
        void startRun();
        return;
      }
      if (msg?.type === 'stop') {
        void stop();
        return;
      }
      if (msg?.type === 'status') {
        return getRun().then((run): SiteStatus => ({ page: currentPage(), login: loginState(), run }));
      }
    });

    ctx.onInvalidated(watchRoutes());
    startHarvest((fn, ms) => ctx.setInterval(fn, ms)); // learn trains from IRCTC's own train list
  },
});
