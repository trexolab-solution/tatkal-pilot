/**
 * Help texts for the "(?)" buttons on the options page, and the one shared popover that shows them.
 *
 * Edit the texts here. Keep each to 1-2 short sentences in plain English. The HTML refers to a text
 * with data-help="key" on a <button class="help-btn">. Texts are only ever inserted with textContent.
 */

export const HELP = {
  // ----- Booking editor: journey
  bookingName: 'A name only you see, to tell your bookings apart. If you leave it empty, one is made from the train, route and date.',
  trainNo: 'Type the 5-digit train number, like 12004, or start typing the name and pick it from the list. The train must run on your date and route.',
  from: 'The station you start from. Type its name or code (like NDLS) and pick it from the list.',
  to: 'The station you are going to. Type its name or code (like CNB). It must be different from From.',
  date: 'The day you will travel. Tatkal tickets open one day before this date. The Today, Tomorrow and In 2 days buttons are quick picks.',
  cls: 'The class you want, like 3A (AC 3 Tier) or SL (Sleeper). It also decides when Tatkal opens: 10:00 for AC classes, 11:00 for the rest.',
  autoStart: 'On: the search waits and starts at Tatkal opening time (10:00 for AC, 11:00 for others). Off: it starts as soon as you press Start.',
  startAt: 'The exact time to press Search, as hours:minutes:seconds (24-hour), like 10:00:00. If that time has already passed, searching starts straight away.',

  // ----- Booking editor: passengers
  passengers: 'Add up to 4 people, which is the Tatkal limit for one ticket. Pick each from your saved IRCTC list or type a new person.',
  paxSource: 'Master list means people already saved in your IRCTC account. New passenger means you type their details here.',
  paxQuery: 'Type the saved person’s name, full or part of it, like Pintu. If several saved people match, you choose one on the IRCTC page.',
  paxName: 'Name as on the ID. IRCTC allows at most 16 characters, using letters, spaces and dots only.',
  paxAge: 'Age in years, from 1 to 125.',
  paxGender: 'Choose Male, Female or Transgender, as on the passenger’s ID.',
  paxCountry: 'Leave it as India unless the passenger is a citizen of another country.',
  paxBerth: 'The berth you would like, like Lower. It is only a wish, and IRCTC gives what is free. No Preference is the safe choice.',

  // ----- Booking editor: booking options
  payment: 'How you plan to pay. UPI usually has the lower fee. It is chosen for you, but you always press Pay & Book yourself.',
  autoBook: 'On (default): when your class shows BOOK on the train list, TatkalPilot presses it for you, and again if IRCTC is busy. Off: you press BOOK.',
  confirmBerth: 'On: ticks IRCTC’s box so the ticket is booked only with a confirmed berth, not waitlist or RAC. Off: leaves that box as IRCTC shows it.',
  autoUpgrade: 'On: ticks the IRCTC box that may move you to a higher class for free if seats are left. Off: leaves that box as IRCTC shows it.',
  autoCalc: 'On: also presses Calculate Fare and Continue To Payment for you. Off (default): you press them. Pay & Book is always yours.',
  mobile: 'Optional. A 10-digit number starting with 6, 7, 8 or 9, where ticket details are sent. If empty, IRCTC uses your registered number.',
  coach: 'Optional. A coach you would like a seat in, like B2. It is only a request. Leave it empty if unsure.',
  gst: 'Optional. Your 15-character GST number (the tax ID of a business), only if you want a tax invoice. Leave empty for personal travel.',

  // ----- Settings
  stations: 'The list of stations used in the From and To boxes. It updates by itself once a day. Press Update now to refresh it yourself.',
  trains: 'Train names this extension has learned from IRCTC, plus a built-in list. Clear cache forgets the learned ones; it is safe to do.',
  railKey: 'Optional free key from railcore.tech that lets the extension look up train names. You do not need it to book. Keep it private.',
  timing: 'Controls how often and how long TatkalPilot tries again when IRCTC is slow (the "High Load" message). The defaults are tested, so change them only if needed.',
  timingPreset: 'Normal is the tested default. Heavy load keeps trying longer (90 seconds) on busy days. Custom shows when you change a value yourself.',
  availWindow: 'How long to keep pressing Check Availability until the classes show up. Default 60 seconds. Allowed 10 to 180.',
  attemptWait: 'After each press, how long to wait for the result before pressing again. Default 5 seconds. Allowed 2 to 30.',
  gapMin: 'The shortest pause between two presses. Default 1.5 seconds. It cannot be below 1 second, or IRCTC may slow down your account.',
  gapMax: 'The longest pause between presses. Each pause is random between the minimum and this. Default 2 seconds. Allowed 1 to 15.',
  searchWindow: 'How long to keep pressing Search Trains until the train list loads. Default 60 seconds. Allowed 10 to 180.',
  searchWait: 'After pressing Search, how long to wait for the train list before pressing it again. Default 12 seconds. Allowed 3 to 60.',
  pageWait: 'How long to wait for the train list and the passenger page to load on a slow day. Default 60 seconds. Allowed 10 to 180.',
  paymentWait: 'How long to wait for the Continue To Payment button to become ready. Used only when auto-press is on. Default 15 seconds. Allowed 5 to 60.',
  reopenLimit: 'If IRCTC clears the class list after your class is highlighted, how many times to open it again. Default 8. Allowed 1 to 20.',
  updates: 'Checks GitHub once a day for a newer version. Nothing installs by itself: you download it and replace the old files yourself.',
} as const;

export type HelpKey = keyof typeof HELP;

/* ---------- the shared popover ---------- */

const POP_ID = 'help-pop';
const GAP = 8; // space between the button and the popover
const EDGE = 8; // minimum space to the viewport edge

/**
 * Wire every `.help-btn[data-help]` on the page (also ones added later) to one shared popover.
 * Role "tooltip" fits: the content is plain text, focus stays on the button, and while the popover is
 * open the button points to it with aria-describedby. Safe to call once.
 */
export function initHelp(): void {
  let pop: HTMLDivElement | null = null;
  let current: HTMLButtonElement | null = null;
  let watcher: MutationObserver | null = null;

  const ensurePop = (): HTMLDivElement => {
    if (pop) return pop;
    pop = document.createElement('div');
    pop.id = POP_ID;
    pop.className = 'help-pop';
    pop.setAttribute('role', 'tooltip');
    pop.hidden = true;
    document.body.appendChild(pop);
    return pop;
  };

  const visible = (btn: HTMLElement) => btn.isConnected && btn.getClientRects().length > 0;

  function place() {
    if (!pop || !current) return;
    if (!visible(current)) return close(false);
    const b = current.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    // The button scrolled out of view: close instead of floating over unrelated content.
    if (b.bottom < 0 || b.top > vh || b.right < 0 || b.left > vw) return close(false);
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const left = Math.max(EDGE, Math.min(b.left + b.width / 2 - w / 2, vw - w - EDGE));
    const below = b.bottom + GAP;
    const above = b.top - GAP - h;
    // Prefer below; flip above only when it does not fit below but does above.
    const top = below + h + EDGE <= vh || above < EDGE ? below : above;
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(Math.max(EDGE, Math.min(top, vh - h - EDGE)))}px`;
  }

  function close(refocus: boolean) {
    const btn = current;
    current = null;
    watcher?.disconnect();
    watcher = null;
    if (pop) pop.hidden = true;
    if (btn) {
      btn.setAttribute('aria-expanded', 'false');
      btn.removeAttribute('aria-describedby');
      if (refocus && btn.isConnected) btn.focus();
    }
  }

  function open(btn: HTMLButtonElement) {
    const key = btn.dataset.help as HelpKey | undefined;
    const text = key && Object.prototype.hasOwnProperty.call(HELP, key) ? HELP[key] : '';
    if (!text) return;
    if (current) close(false);
    const el = ensurePop();
    el.textContent = text;
    el.hidden = false;
    current = btn;
    btn.setAttribute('aria-expanded', 'true');
    btn.setAttribute('aria-describedby', POP_ID);
    place();
    // Switching view / closing a section / removing a row hides or detaches the button: close then.
    watcher = new MutationObserver(() => {
      if (current && !visible(current)) close(false);
    });
    watcher.observe(document.body, { attributes: true, attributeFilter: ['hidden', 'open'], subtree: true, childList: true });
  }

  document.addEventListener('click', (e) => {
    const target = e.target as Element | null;
    const btn = (target?.closest('.help-btn[data-help]') ?? null) as HTMLButtonElement | null;
    if (btn) {
      // Never let the click reach a surrounding label / summary (toggle, radio, details).
      e.preventDefault();
      if (current === btn) close(false);
      else open(btn);
      return;
    }
    if (current && !(pop && target && pop.contains(target))) close(false);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && current) {
      e.preventDefault();
      close(true);
    }
  });

  // Tabbing away from the open help also closes it.
  document.addEventListener('focusin', (e) => {
    const t = e.target as Node | null;
    if (current && t && t !== current && !(pop && pop.contains(t))) close(false);
  });

  window.addEventListener('resize', place);
  // Capture: scrolling any container (not just the page) keeps the popover next to its button.
  window.addEventListener('scroll', place, { capture: true, passive: true });
}
