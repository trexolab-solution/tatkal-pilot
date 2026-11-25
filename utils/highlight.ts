/**
 * Highlight of the chosen class card and its BOOK button on the IRCTC train list.
 *
 * These are IRCTC's own elements, so the style has to live in the page itself (the extension's panel and
 * toasts are in a shadow root and cannot reach them). Everything is scoped to the `tp-` classes below and
 * removed again when the run stops.
 *
 *  - tp-target   the class card: a steady brand-blue ring with a soft glow that breathes slowly
 *  - tp-booking  the BOOK button: a pulse that says "this is the one being pressed / press this"
 *
 * With reduced motion the ring stays and the animation is switched off.
 */
const STYLE_ID = 'tatkal-pilot-highlight';
const BLUE = '13 82 196'; // rgb of #0d52c4, the IRCTC primary blue the extension already uses

const CSS = `
.tp-target {
  outline: 2px solid rgb(${BLUE});
  outline-offset: 2px;
  box-shadow: 0 0 0 5px rgb(${BLUE} / .12), 0 6px 18px rgb(${BLUE} / .14);
  animation: tp-glow 2.6s ease-in-out infinite;
}
.tp-booking {
  animation: tp-pulse 1.5s ease-out infinite;
}
@keyframes tp-glow {
  0%, 100% { box-shadow: 0 0 0 4px rgb(${BLUE} / .10), 0 6px 18px rgb(${BLUE} / .12); }
  50% { box-shadow: 0 0 0 7px rgb(${BLUE} / .18), 0 10px 26px rgb(${BLUE} / .20); }
}
@keyframes tp-pulse {
  0% { box-shadow: 0 0 0 0 rgb(${BLUE} / .55); }
  70% { box-shadow: 0 0 0 10px rgb(${BLUE} / 0); }
  100% { box-shadow: 0 0 0 0 rgb(${BLUE} / 0); }
}
@media (prefers-reduced-motion: reduce) {
  .tp-target, .tp-booking { animation: none; }
  .tp-target { box-shadow: 0 0 0 5px rgb(${BLUE} / .16); }
}
`;

function ensureCss() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  (document.head ?? document.documentElement).appendChild(s);
}

/** Ring the chosen class card, and pulse its BOOK button once it exists. Safe to call again and again. */
export function highlightClass(card: HTMLElement) {
  ensureCss();
  card.classList.add('tp-target');
  card.querySelector<HTMLElement>('.btn-book')?.classList.add('tp-booking');
}

/** Take the highlight off everything (run stopped, finished or failed). */
export function clearHighlight() {
  document.querySelectorAll('.tp-target, .tp-booking').forEach((el) => el.classList.remove('tp-target', 'tp-booking'));
}
