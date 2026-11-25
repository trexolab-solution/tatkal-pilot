import { now, syncClock } from './clock';
import { $, $$, click, isVisible, sleep, waitFor } from './dom';
import { fillJourney } from './journey';
import { addMasterPassengers, addNewPassenger } from './passengers';
import { applyOptions } from './prefs';
import {
  defaultTiming,
  getProfile,
  getRun,
  getStore,
  getTiming,
  problemsFor,
  QUOTA,
  setRun,
  stopRun,
  watchRun,
  type Profile,
  type Stage,
  type Timing,
} from './storage';
import { status, toast } from './toast';

const HOME_URL = 'https://www.irctc.co.in/eticket/train-search';

export function routeStage(path = location.pathname): Stage | null {
  if (path.includes('/booking/train-list')) return 'list';
  if (path.includes('/booking/psgninput')) return 'passengers';
  if (path.includes('/booking/reviewBooking')) return 'review';
  if (path.includes('/train-search')) return 'home';
  return null;
}

/** "HH:MM:SS" (local time, today) -> epoch ms, or undefined if empty / invalid / already past. */
function parseStart(t: string): number | undefined {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(t.trim());
  if (!m) return undefined;
  const d = new Date();
  d.setHours(Number(m[1]), Number(m[2]), Number(m[3] ?? 0), 0);
  return d.getTime() > now() ? d.getTime() : undefined;
}

const isLoginButton = (e: Element) => /^login$/i.test(e.textContent?.trim() ?? '');

async function ensureLoggedIn() {
  await waitFor(
    () => $('app-header .nav-link-1') || $$('app-header button, app-header a').some(isLoginButton),
    'the page header',
    8000,
  );
  if ($$('app-header button, app-header a').some(isLoginButton)) {
    throw new Error('You are not logged in. Log in to IRCTC, then press Start.');
  }
}

function fail(e: unknown) {
  void stopRun();
  status(null);
  toast(e instanceof Error ? e.message : String(e), 'error', 9000);
}

/* ---- Retry policy for a slow / failing site (Tatkal traffic) ----
 * Like a person pressing the button again on "High Load": keep retrying until it works, but give up
 * after RETRY_WINDOW. Retries only happen after a step actually failed. */
/** User-adjustable (Settings page); reloaded at the start of every step so a change applies at once. */
let T: Timing = defaultTiming;
const ms = (s: number) => s * 1000;
const retryGap = () => ms(T.gapMin + Math.random() * (T.gapMax - T.gapMin));

/** Text of any visible site toast, to include in failure messages. */
function siteToast(): string {
  const t = $$('p-toast .ui-toast-message, p-toast [role="alert"]').find(isVisible);
  return t?.innerText.replace(/\s+/g, ' ').trim().slice(0, 120) ?? '';
}

/** Set when the run is stopped (from the panel, the popup or another tab), so a timed wait ends at once. */
let runStopped = false;
watchRun((r) => {
  if (!r.active) runStopped = true;
});

async function stageHome(p: Profile) {
  const b = p.booking;
  await ensureLoggedIn();
  await setRun({ stage: 'list' }); // set before the search click navigates away
  runStopped = false;
  if (b.startAt.trim()) await syncClock(); // measure IRCTC's clock so the timed search fires on its second
  const searched = await fillJourney({ from: b.from, to: b.to, date: b.date, quota: QUOTA }, { searchAt: parseStart(b.startAt), cancelled: () => runStopped });
  if (!searched) return;

  // The site can stay on the home page when it is overloaded: press Search again until it moves (bounded by time).
  const deadline = Date.now() + ms(T.searchWindow);
  let searches = 1;
  for (;;) {
    status('Waiting for search results…');
    const moved = await waitFor(() => routeStage() !== 'home', 'search result', ms(T.searchWait)).then(() => true, () => false);
    if (moved) return void status(null);
    if (runStopped) return void status(null);
    const btn = $<HTMLButtonElement>('button.search-btn');
    if (!btn || Date.now() >= deadline) break;
    searches++;
    status(`Searching again (#${searches}, up to ${Math.max(0, Math.ceil((deadline - Date.now()) / 1000))}s left)…`);
    await sleep(retryGap());
    click(btn);
  }
  status(null);
  throw new Error(`The train list did not load after ${searches} searches in ${T.searchWindow}s. ${siteToast()} Press Start to try again.`.trim());
}

const findCard = (no: string) =>
  $$('app-train-avl-enq').find((c) => c.querySelector('.train-number')?.textContent?.trim() === no);
const findTarget = (card: HTMLElement, cls: string) =>
  $$('.class-card', card).find((c) => (c.querySelector('.class-code')?.textContent ?? '').includes(`(${cls})`));

/** Press Check Availability until the class cards show up (bounded retries). */
async function openAvailability(card: HTMLElement): Promise<HTMLElement[]> {
  const deadline = Date.now() + ms(T.availWindow);
  for (let attempt = 1; !card.querySelector('.class-card'); attempt++) {
    if (runStopped) break;
    const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    status(`Check Availability: attempt ${attempt} (retrying up to ${left}s)…`);
    const btn = card.querySelector<HTMLElement>('button.btn-availability');
    if (btn) click(btn);
    const ok = await waitFor(() => card.querySelector('.class-card'), 'class availability', ms(T.attemptWait)).then(() => true, () => false);
    if (ok) break;
    if (Date.now() >= deadline) {
      status(null);
      throw new Error(`Availability did not load after ${attempt} attempts in ${T.availWindow}s. ${siteToast()} Press Start to try again.`.trim());
    }
    await sleep(retryGap());
  }
  status(null);
  return $$('.class-card', card);
}

function mark(target: HTMLElement, scroll: boolean) {
  target.style.outline = '3px solid #b34700';
  if (scroll) target.scrollIntoView({ block: 'center' });
}

/**
 * Presses BOOK for the user when "Click BOOK for me" is on. Like a person, it presses again if the
 * page is still the train list after one press (site overloaded), but only inside the retry window.
 * Returns true when it pressed. Pay & Book is never touched.
 */
function autoBooker(enabled: boolean) {
  let first = 0;
  let last = 0;
  return (target: HTMLElement): boolean => {
    if (!enabled || runStopped) return false;
    const btn = target.querySelector<HTMLButtonElement>('.btn-book');
    if (!btn || btn.disabled) return false;
    const t = Date.now();
    if (first && (t - first > ms(T.availWindow) || t - last < ms(T.attemptWait))) return false;
    first ||= t;
    last = t;
    click(btn);
    return true;
  };
}

/**
 * After the class is highlighted, BOOK is pressed (by us, or by the user when auto-book is off). If the
 * site resets the list on an error (cards vanish), open availability again and re-highlight.
 */
async function keepHighlighted(no: string, cls: string, book: (target: HTMLElement) => boolean) {
  let reopens = 0;
  while (routeStage() === 'list') {
    await sleep(1500);
    if (routeStage() !== 'list' || !(await getRun()).active) return;
    const card = findCard(no);
    const target = card && findTarget(card, cls);
    if (target) {
      if (!target.style.outline) mark(target, false);
      book(target);
      continue;
    }
    if (!card) continue; // list is re-rendering
    if (reopens >= T.reopenLimit) {
      toast('Availability keeps resetting. Please check it manually.', 'error');
      return;
    }
    reopens++;
    try {
      await openAvailability(card);
      const again = findTarget(card, cls);
      if (again) {
        mark(again, true);
        if (!book(again)) toast('Availability reopened. Press BOOK.', 'info');
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
      return;
    }
  }
}

async function stageList(p: Profile) {
  const no = p.booking.trainNo.trim().padStart(5, '0');
  status('Loading the train list…');
  const card = await waitFor(
    () => findCard(no),
    `train ${no} in the list (does it run on this date and route?)`,
    ms(T.pageWait),
  ).finally(() => status(null));
  card.scrollIntoView({ block: 'center' });

  const classes = await openAvailability(card);
  const target = findTarget(card, p.booking.cls);
  if (!target) {
    const have = classes.map((c) => c.querySelector('.class-code')?.textContent?.trim()).join(', ');
    throw new Error(`Class ${p.booking.cls} not found on train ${no}. Available: ${have}`);
  }
  await setRun({ stage: 'passengers' });
  mark(target, true);
  const book = autoBooker(p.options.autoBook);
  if (target.querySelector('.btn-book')) {
    if (book(target)) toast(`Train ${no} · ${p.booking.cls}: clicking BOOK…`, 'info', 4000);
    else toast(`Train ${no} · ${p.booking.cls}: press BOOK now`, 'info', 8000);
  } else {
    toast(`Train ${no} · ${p.booking.cls}: BOOK is not available yet (Tatkal not open?)`, 'error');
  }
  void keepHighlighted(no, p.booking.cls, book);
}

export async function fillPassengersPage(p: Profile): Promise<void> {
  T = await getTiming();
  status('Loading the passenger page…');
  await waitFor(() => isVisible($('button.btn-existing')), 'the passenger page', ms(T.pageWait)).finally(() => status(null));
  const problems: string[] = [];
  const masters = p.passengers.flatMap((x) => (x.kind === 'master' ? [x.query] : []));
  problems.push(...(await addMasterPassengers(masters)));
  for (const x of p.passengers) {
    if (x.kind === 'new') await addNewPassenger(x);
  }
  problems.push(...(await applyOptions(p.options)));

  if (problems.length) toast(problems.join(' · '), 'error', 10000);
  else toast('Passenger details filled. Press Calculate Fare.', 'success', 6000);
}

async function stagePassengers(p: Profile) {
  await fillPassengersPage(p);
  if (p.options.autoCalc) {
    await setRun({ stage: 'review' });
    click(await waitFor(() => $<HTMLButtonElement>('button.btn-calc-fare:not([disabled])'), 'the Calculate Fare button'));
  } else {
    await setRun({ stage: 'done' });
  }
}

async function stageReview(p: Profile) {
  if (!p.options.autoCalc) return;
  await sleep(600);
  const btn = await waitFor(() => $<HTMLButtonElement>('button.btn-payment:not([disabled])'), 'the Continue To Payment button', ms(T.paymentWait));
  await setRun({ stage: 'done' });
  click(btn); // stops on the Payment page; Pay & Book stays manual
}

const handlers: Record<Exclude<Stage, 'done'>, (p: Profile) => Promise<void>> = {
  home: stageHome,
  list: stageList,
  passengers: stagePassengers,
  review: stageReview,
};

let busy = false;
let pending = false;

/** Run the handler for the current page if a run is active and this page is its turn. */
export async function advance(): Promise<void> {
  if (busy) {
    pending = true; // a route change arrived while a handler was still running
    return;
  }
  const run = await getRun();
  const here = routeStage();
  if (!run.active || run.stage === 'done' || !here || here !== run.stage) return;
  busy = true;
  try {
    const profile = await getProfile(run.bookingId);
    T = await getTiming();
    validate(profile);
    await handlers[here](profile);
  } catch (e) {
    fail(e);
  } finally {
    busy = false;
    if (pending) {
      pending = false;
      void advance();
    }
  }
}

function validate(p: Profile) {
  const missing = problemsFor(p);
  if (missing.length) throw new Error(`Complete the booking first. Missing: ${missing.join(', ')}.`);
}

export async function startRun(): Promise<void> {
  const store = await getStore();
  if (!store.activeId) return fail(new Error('No booking saved yet. Create one in the extension first.'));
  try {
    validate(await getProfile(store.activeId));
  } catch (e) {
    return fail(e);
  }
  const here = routeStage();
  await setRun({ active: true, stage: here ?? 'home', bookingId: store.activeId });
  if (!here) {
    location.href = HOME_URL; // page reloads; the new page continues the run
    return;
  }
  await advance();
}

export async function stop() {
  runStopped = true;
  await stopRun();
  status(null);
}

/** Re-run `advance` whenever the SPA route changes (and once on load). */
export function watchRoutes(): () => void {
  let last = '';
  const tick = () => {
    if (location.pathname !== last) {
      last = location.pathname;
      void advance();
    }
  };
  tick();
  const id = setInterval(tick, 400);
  return () => clearInterval(id);
}
