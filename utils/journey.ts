import { $, $$, click, norm, setInputValue, sleep, waitFor, waitUntil } from './dom';
import { status } from './toast';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export interface JourneyInput {
  from: string;
  to: string;
  date: string; // YYYY-MM-DD
  quota: string;
}

const options = () => $$('[role="listbox"] [role="option"]');

async function pickStation(fieldSelector: string, code: string) {
  const field = await waitFor(() => $(fieldSelector), `station field ${fieldSelector}`);
  click(field);
  const input = await waitFor(() => $<HTMLInputElement>('input.station-search-input'), 'station search input');
  input.focus();
  setInputValue(input, code);
  const opt = await waitFor(
    () => options().find((o) => norm(o.querySelector('.option-code')?.textContent) === norm(code)),
    `station suggestion ${code}`,
  );
  click(opt);
  await sleep(150);
}

async function pickDropdown(ariaLabel: string, text: string) {
  const field = await waitFor(() => $(`[aria-label="${ariaLabel}"]`), `${ariaLabel} field`);
  if (norm(field.querySelector('.select-placeholder')?.textContent) === norm(text)) return;
  click(field);
  const opt = await waitFor(
    () => options().find((o) => norm(o.querySelector('.option-name')?.textContent ?? o.textContent) === norm(text)),
    `${ariaLabel} option ${text}`,
  );
  click(opt);
  await sleep(150);
}

async function pickDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) throw new Error(`Invalid date: ${iso}`);
  click(await waitFor(() => $('#home-travel-date'), 'date field'));
  await waitFor(() => $('.ui-datepicker-calendar'), 'calendar');

  for (let i = 0; i < 24; i++) {
    const month = $('.ui-datepicker-month')?.textContent?.trim();
    const year = Number($('.ui-datepicker-year')?.textContent?.trim());
    const cur = year * 12 + MONTHS.indexOf(month ?? '');
    const want = y * 12 + (m - 1);
    if (cur === want) break;
    const btn = $(cur < want ? '.ui-datepicker-next' : '.ui-datepicker-prev');
    if (!btn) throw new Error('Calendar navigation not available');
    click(btn);
    await sleep(120);
  }

  // Enabled days are <a>, disabled days are <span>.
  const day = $$('.ui-datepicker-calendar td a.ui-state-default').find((a) => a.textContent?.trim() === String(d));
  if (!day) throw new Error(`Date ${iso} is not bookable (disabled in calendar)`);
  click(day);
  await sleep(150);
}

/**
 * Fill From / To / Date / Quota on the home page and press "Search Trains".
 * If `searchAt` (epoch ms) is given, everything is filled first and the search
 * button is pressed exactly at that time.
 */
export async function fillJourney(j: JourneyInput, opts: { searchAt?: number; cancelled?: () => boolean } = {}): Promise<boolean> {
  // The home-page tour overlay blocks the form; make sure it is gone first.
  if ($('.home-tour-layer')) {
    $('button.home-tour-skip')?.click();
    await waitFor(() => !$('.home-tour-layer'), 'home tour to close', 4000);
  }
  await pickStation('#home-from-station', j.from);
  await pickStation('#home-to-station', j.to);
  await pickDate(j.date);
  await pickDropdown('Quota', j.quota);

  const btn = await waitFor(() => $<HTMLButtonElement>('button.search-btn'), 'Search Trains button');
  if (opts.searchAt && opts.searchAt > Date.now()) {
    const begin = Date.now();
    const at = new Date(opts.searchAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
    const left = (s: number) => {
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    };
    const span = Math.max(1, opts.searchAt - begin);
    const reached = await waitUntil(opts.searchAt, (s) => status(`Search at ${at}`, { value: left(s), progress: (Date.now() - begin) / span }), opts.cancelled);
    status(null);
    if (!reached) return false; // stopped while waiting
  }
  click(btn);
  return true;
}
