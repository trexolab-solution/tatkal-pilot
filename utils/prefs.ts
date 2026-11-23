import { $, click, setInputValue, sleep, waitFor } from './dom';
import type { Options, Tri } from './storage';

/** Choose the payment option. Must happen BEFORE "Calculate Fare" (fare depends on it). */
async function setPayment(kind: Options['payment']) {
  const id = kind === 'UPI' ? 'payment-option-1' : 'payment-option-0';
  const input = await waitFor(() => $<HTMLInputElement>(`#${id}`), `payment option ${id}`);
  if (!input.checked) {
    // PrimeNG radio: the visible box is what handles clicks.
    click(input.closest('p-radiobutton')?.querySelector('.ui-radiobutton-box') ?? input);
    await sleep(150);
    if (!input.checked) click(input);
    await sleep(100);
  }
  if (!input.checked) throw new Error(`Payment option ${kind} could not be selected`);
}

async function setCheckbox(id: string, want: Tri, label: string, problems: string[]) {
  if (want === 'leave') return;
  const cb = $<HTMLInputElement>(`#${id}`);
  if (!cb) return void problems.push(`${label}: checkbox not found`);
  if (cb.disabled) return void problems.push(`${label}: checkbox is disabled`);
  const wanted = want === 'tick';
  if (cb.checked !== wanted) click(cb);
  await sleep(80);
  if (cb.checked !== wanted) problems.push(`${label}: could not be set`);
}

async function openPreferences() {
  const header = await waitFor(() => $('app-booking-preferences .section-header'), 'Other Preferences header');
  if (header.getAttribute('aria-expanded') !== 'true') {
    click(header);
    await waitFor(() => $('#confirmBerth'), 'Other Preferences section');
  }
}

/** Apply mobile, payment option and Other Preferences. Returns problems for the user. */
export async function applyOptions(o: Options): Promise<string[]> {
  const problems: string[] = [];

  if (o.mobile) {
    const m = await waitFor(() => $<HTMLInputElement>('#additionalMobileNumber'), 'mobile number field');
    setInputValue(m, o.mobile);
    m.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  try {
    await setPayment(o.payment);
  } catch (e) {
    problems.push(e instanceof Error ? e.message : String(e));
  }

  const needsPrefs = o.confirmBerth !== 'leave' || o.autoUpgrade !== 'leave' || o.coach || o.gst;
  if (needsPrefs) {
    await openPreferences();
    await setCheckbox('confirmBerth', o.confirmBerth, 'Book only if confirm berths', problems);
    await setCheckbox('autoUpgradationSelected', o.autoUpgrade, 'Auto upgradation', problems);
    if (o.coach) setInputValue(await waitFor(() => $<HTMLInputElement>('#preferred-coach-0'), 'coach field'), o.coach);
    if (o.gst) setInputValue(await waitFor(() => $<HTMLInputElement>('#gstin-number'), 'GST field'), o.gst);
  }
  return problems;
}
