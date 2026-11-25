/**
 * "1 passenger" that shows who the passengers are when you hover it (or focus it with the keyboard, or
 * tap it on a touch screen). Used in the page panel, the popup and the Bookings list, so a booking can
 * be checked at a glance without opening it.
 *
 * - passengerCount(list) builds the little "N passengers" element. It carries its data in an attribute.
 * - initPassengerTip(host) is called once per page. It listens on `host` for those elements (event
 *   delegation), so it keeps working when a screen redraws its rows every second or so.
 *
 * Texts are only ever inserted with textContent.
 */
import type { PassengerEntry } from './storage';

export interface PaxLine {
  name: string;
  detail: string;
}

/** One line per passenger: the name, and what we know about them. */
export function passengerLines(list: PassengerEntry[]): PaxLine[] {
  return list.map((p) => {
    if (p.kind === 'master') return { name: p.query.trim() || 'Unnamed', detail: 'From your IRCTC saved list' };
    const bits = [
      p.age.trim() ? `${p.age.trim()} yrs` : '',
      p.gender,
      p.berth && p.berth !== 'No Preference' ? `${p.berth} berth` : '',
      p.country && p.country !== 'India' ? p.country : '',
    ].filter(Boolean);
    return { name: p.name.trim() || 'Unnamed', detail: bits.join(' · ') };
  });
}

/** The "N passenger(s)" text. With at least one passenger it also shows the list on hover or focus. */
export function passengerCount(list: PassengerEntry[]): HTMLElement {
  const el = document.createElement('span');
  el.textContent = `${list.length} passenger${list.length === 1 ? '' : 's'}`;
  if (list.length) {
    el.className = 'pax-count';
    el.tabIndex = 0;
    el.dataset.pax = JSON.stringify(passengerLines(list));
  }
  return el;
}

const CSS = `
.pax-count { text-decoration: underline dotted; text-underline-offset: 3px; cursor: help; }
.pax-count:focus-visible { outline: 2px solid #0d52c4; outline-offset: 2px; border-radius: 3px; }
.ptip { position: fixed; left: 0; top: 0; z-index: 2147483647; box-sizing: border-box; width: max-content; max-width: min(280px, calc(100vw - 16px)); padding: 10px 12px 11px; border: 1px solid #c9d3e8; border-radius: 10px; background: #ffffff; color: #071541; font: 500 12.5px/1.4 'Open Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; box-shadow: 0 8px 24px rgb(7 21 65 / .22), 0 1px 3px rgb(7 21 65 / .12); pointer-events: none; animation: ptip-in .12s ease-out; }
.ptip[hidden] { display: none; }
.ptip-h { margin: 0 0 8px; padding: 0 0 7px; border-bottom: 1px solid #e3e9f5; color: #4a5a7d; font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
.ptip ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; counter-reset: p; }
.ptip li { display: grid; grid-template-columns: 20px minmax(0, 1fr); column-gap: 8px; align-items: start; counter-increment: p; }
.ptip li::before { content: counter(p); display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; background: #e8f0fd; color: #0d52c4; font-size: 11px; font-weight: 700; }
.ptip b { display: block; color: #071541; font-weight: 700; overflow-wrap: anywhere; }
.ptip small { display: block; margin-top: 1px; color: #4a5a7d; font-size: 11.5px; font-weight: 500; }
@keyframes ptip-in { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .ptip { animation: none; } }
`;

/**
 * Turn on the hover list for every `.pax-count` inside `host`. Call once per page: with document.body, or with
 * the shadow-root wrapper of the page panel (the tooltip and its style are added next to it, so IRCTC's CSS
 * cannot touch them and the panel's overflow cannot clip them).
 */
export function initPassengerTip(host: HTMLElement): void {
  if (host.dataset.paxTip) return;
  host.dataset.paxTip = '1';

  const root = host.getRootNode();
  const style = document.createElement('style');
  style.textContent = CSS;
  (root instanceof ShadowRoot ? root : document.head).appendChild(style);

  const tip = document.createElement('div');
  tip.className = 'ptip';
  tip.id = 'tp-pax-tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  host.appendChild(tip);

  let current: HTMLElement | null = null;

  const hide = () => {
    tip.hidden = true;
    current?.removeAttribute('aria-describedby');
    current = null;
  };

  const place = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let top = r.top - h - 8; // above the text, or below it when there is no room
    if (top < 4) top = r.bottom + 8;
    top = Math.max(4, Math.min(top, vh - h - 4));
    const left = Math.max(4, Math.min(r.left + r.width / 2 - w / 2, vw - w - 4));
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  };

  const show = (el: HTMLElement) => {
    if (current === el && !tip.hidden) return;
    let lines: PaxLine[] = [];
    try {
      lines = JSON.parse(el.dataset.pax ?? '[]') as PaxLine[];
    } catch {
      /* unreadable data: show nothing */
    }
    if (!lines.length) return hide();
    tip.replaceChildren();
    const head = document.createElement('div');
    head.className = 'ptip-h';
    head.textContent = `Passengers (${lines.length})`;
    const ol = document.createElement('ol');
    for (const l of lines) {
      const li = document.createElement('li');
      const body = document.createElement('div');
      const name = document.createElement('b');
      name.textContent = l.name;
      body.append(name);
      if (l.detail) {
        const small = document.createElement('small');
        small.textContent = l.detail;
        body.append(small);
      }
      li.append(body);
      ol.append(li);
    }
    tip.append(head, ol);
    current?.removeAttribute('aria-describedby');
    current = el;
    el.setAttribute('aria-describedby', tip.id);
    tip.hidden = false;
    place(el);
  };

  const trigger = (e: Event) => ((e.target as Element | null)?.closest?.('.pax-count') ?? null) as HTMLElement | null;

  // A screen may redraw its rows while the pointer rests on one. The new element gets pointerover on the next
  // move, so showing again is harmless, and any pointerover somewhere else hides a tip left behind.
  host.addEventListener('pointerover', (e) => {
    const el = trigger(e);
    if (el) show(el);
    else if (!tip.hidden) hide();
  });
  host.addEventListener('pointerout', (e) => {
    const from = trigger(e);
    if (!from || (e as PointerEvent).pointerType === 'touch') return; // a tap: stays until you tap elsewhere
    const to = ((e as PointerEvent).relatedTarget as Element | null)?.closest?.('.pax-count');
    if (to !== from) hide();
  });
  host.addEventListener('focusin', (e) => {
    const el = trigger(e);
    if (el) show(el);
  });
  host.addEventListener('focusout', (e) => {
    if (trigger(e)) hide();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  });
  window.addEventListener('scroll', hide, true);
}
