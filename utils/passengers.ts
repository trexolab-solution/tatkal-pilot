import { choose } from './chooser';
import { $, $$, click, isVisible, norm, setInputValue, sleep, waitFor } from './dom';
import type { NewPassenger } from './storage';

/** Names already added to the passenger list, e.g. "1. Asha Verma" -> "ASHA VERMA". */
function listedNames(): string[] {
  return $$('app-passenger-list .passenger-name').map((e) => norm(e.textContent).replace(/^\d+\.\s*/, ''));
}

/**
 * Indexes of `names` that match `query`. An exact (case/space-insensitive) match wins;
 * otherwise every word of the query must appear in the name.
 */
export function matchNames(query: string, names: string[]): number[] {
  const q = norm(query);
  if (!q) return [];
  const all = names.map(norm);
  const exact = all.flatMap((n, i) => (n === q ? [i] : []));
  if (exact.length === 1) return exact;
  const words = q.split(' ');
  return all.flatMap((n, i) => (words.every((w) => n.includes(w)) ? [i] : []));
}

/** Tick the given people in the "Existing Passenger" modal. Returns problems to show the user. */
export async function addMasterPassengers(queries: string[]): Promise<string[]> {
  const problems: string[] = [];
  if (!queries.length) return problems;

  click(await waitFor(() => $('button.btn-existing'), 'Existing Passenger button'));
  await waitFor(() => $$('.ep-modal-panel .ep-passenger-row').length > 0, 'master passenger list', 20000);
  await sleep(200);

  const rows = $$('.ep-modal-panel .ep-passenger-row');
  const names = rows.map((r) => r.querySelector('.ep-passenger-name')?.textContent?.trim() ?? '');
  const already = listedNames();
  const chosen = new Set<number>();

  for (const q of queries) {
    const idxs = matchNames(q, names);
    if (idxs.length === 0) {
      problems.push(`No passenger matching "${q}" in your IRCTC master list`);
      continue;
    }
    let pick = idxs[0] ?? 0;
    if (idxs.length > 1) {
      const c = await choose(`Which passenger is "${q}"?`, 'Several saved passengers match. Pick one.', idxs.map((i) => names[i] ?? ''));
      if (c === null) {
        problems.push(`Skipped "${q}"`);
        continue;
      }
      pick = idxs[c] ?? pick;
    }
    if (already.includes(norm(names[pick]))) continue; // already in the list
    chosen.add(pick);
  }

  for (const i of chosen) {
    const cb = rows[i]?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (cb && !cb.checked) click(cb);
  }
  const btn = chosen.size
    ? $('.ep-modal-panel .ep-add-btn')
    : $$('.ep-modal-panel button').find((b) => /cancel/i.test(b.textContent ?? ''));
  if (btn) click(btn);
  await waitFor(() => !$('.ep-modal-panel'), 'existing-passenger modal to close');
  await sleep(200);
  return problems;
}

const dialog = () => $('.add-passenger-dialog');

/** Pick `text` in the n-th PrimeNG dropdown of the Add Passenger modal. */
async function pickPrime(index: number, text: string) {
  const host = $$('p-dropdown', dialog() ?? document)[index];
  if (!host) throw new Error(`Dropdown #${index} not found in Add Passenger`);
  click(host.querySelector('.ui-dropdown') ?? host);
  const items = () =>
    $$('.ui-dropdown-panel [role="option"], .ui-dropdown-panel li.ui-dropdown-item').filter(isVisible);
  await waitFor(() => items().length > 0, 'dropdown options');
  const opt = items().find((o) => norm(o.textContent) === norm(text));
  if (!opt) {
    throw new Error(`Option "${text}" not found. Available: ${items().map((o) => o.textContent?.trim()).join(', ')}`);
  }
  click(opt);
  await sleep(150);
}

export async function addNewPassenger(p: NewPassenger): Promise<void> {
  click(await waitFor(() => $('button.btn-new-passenger'), 'New Passenger button'));
  const name = await waitFor(() => $<HTMLInputElement>('#bdo-passengerName'), 'Add Passenger modal');
  name.focus();
  setInputValue(name, p.name.slice(0, 16));
  name.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  const age = await waitFor(() => $<HTMLInputElement>('#bdo-passengerAge'), 'age field');
  setInputValue(age, p.age);
  await pickPrime(0, p.gender);
  if (p.country && norm(p.country) !== 'INDIA') await pickPrime(1, p.country);
  if (p.berth && norm(p.berth) !== 'NO PREFERENCE') await pickPrime(2, p.berth);

  click(await waitFor(() => $('.add-passenger-dialog .ap-add-btn'), 'Add button'));
  await waitFor(() => !isVisible($('.add-passenger-dialog')), `the Add Passenger modal to close (check the fields for "${p.name}")`);
  await sleep(200);
}
