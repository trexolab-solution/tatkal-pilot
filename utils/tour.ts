import { toast } from './toast';

/**
 * The new IRCTC site shows popups that block the flow. We handle the ones we know about.
 * Add new entries here as they are discovered.
 *
 *  - Tutorial popovers (fresh browser only), e.g. "Track your train live": click Skip.
 *  - "Please confirm the booking details" (only when the train starts from a different
 *    station than the one searched, e.g. NDLS searched but train runs from ANVT): click
 *    Continue Booking, and show a toast so the change of station is not silent.
 */
interface Handler {
  selector: string;
  /** Return a message to toast after clicking, or nothing. */
  describe?: (btn: HTMLElement) => string | void;
}

const HANDLERS: Handler[] = [
  { selector: 'button.track-train-tutorial-skip' },
  // Home page 6-step tour ("Where are you travelling?"), shown in a fresh browser / after login.
  { selector: 'button.home-tour-skip' },
  {
    selector: 'button.bc-btn-continue',
    describe: (btn) => {
      const card = btn.closest('.bc-card');
      const text = (sel: string) =>
        Array.from(card?.querySelectorAll(sel) ?? [])
          .map((e) => e.textContent?.trim())
          .join(' → ');
      return `Boarding station confirmed: ${text('.bc-station-name--booking')} (you searched ${text('.bc-station-name--search')})`;
    },
  },
];

/**
 * Dialogs that need a human decision. We never click them; we only alert the user.
 *  - "Your preference may not be met ... proceed booking without any preferences?" (Yes / No)
 */
const NOTICES: { match: RegExp; message: string }[] = [
  {
    match: /proceed booking without any preferences/i,
    message: 'IRCTC is asking whether to proceed without preferences. Press Yes or No yourself.',
  },
];

export function startTourDismisser(): () => void {
  const handled = new WeakSet<Element>();
  const noticed = new WeakSet<Element>();
  const sweep = () => {
    for (const dlg of document.querySelectorAll<HTMLElement>('.ui-dialog, [role="dialog"], [role="alertdialog"]')) {
      if (noticed.has(dlg) || dlg.getBoundingClientRect().height === 0) continue;
      const hit = NOTICES.find((n) => n.match.test(dlg.innerText));
      if (hit) {
        noticed.add(dlg);
        toast(hit.message, true, 12000);
      }
    }
    for (const h of HANDLERS) {
      document.querySelectorAll<HTMLElement>(h.selector).forEach((btn) => {
        if (handled.has(btn)) return;
        handled.add(btn);
        const msg = h.describe?.(btn); // read before click: the dialog closes after
        btn.click();
        if (msg) toast(msg, false, 6000);
      });
    }
  };
  sweep();
  const observer = new MutationObserver(sweep);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  return () => observer.disconnect();
}
