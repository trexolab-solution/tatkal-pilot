/**
 * All on-page UI (floating panel, toasts, status bar, passenger chooser) lives in one
 * shadow root, so the IRCTC site's CSS cannot restyle it and ours cannot leak into the site.
 */
const HOST_ID = 'tatkal-pilot-host';

export const ACCENT = '#0d52c4'; // IRCTC beta primary blue
export const ACCENT_HOVER = '#0a42a0';
export const ORANGE = '#b34700'; // text-safe IRCTC orange
export const BRAND = '#0b71ba'; // IRCTC header blue

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.ui { font: 13px/1.45 'Open Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #071541; }
button { font: inherit; cursor: pointer; }
:focus-visible { outline: 2px solid #0d52c4; outline-offset: 2px; }

/* toasts: 16px from every screen edge, same sizes and motion as the options page */
.toasts { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 2147483647; display: flex; flex-direction: column; align-items: stretch; gap: 10px; width: min(calc(100vw - 32px), 440px); pointer-events: none; }
.toast { pointer-events: auto; align-self: center; display: flex; align-items: center; gap: 12px; width: fit-content; min-width: min(280px, 100%); max-width: 100%; padding: 12px 12px 12px 16px; border-radius: 12px; background: #0c1c4f; color: #ffffff; font-size: 13.5px; line-height: 1.45; font-weight: 500; box-shadow: 0 12px 32px rgb(0 0 0 / .35), 0 0 0 1px rgb(255 255 255 / .06); animation: in .2s cubic-bezier(.2, .8, .2, 1); transition: opacity .16s ease, transform .16s ease; }
.toast.out { opacity: 0; transform: translateY(6px); }
.toast svg { flex: none; }
.toast .msg { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.toast .x { flex: none; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 6px; background: none; color: #aab0bb; font-size: 16px; line-height: 1; }
.toast .x:hover { background: rgb(255 255 255 / .12); color: #fff; }
@keyframes in { from { opacity: 0; transform: translateY(10px) scale(.98); } to { opacity: 1; transform: none; } }

/* status bar */
.status { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 2147483647; width: max-content; min-width: 260px; max-width: calc(100vw - 32px); padding: 10px 16px 12px; border-radius: 12px; background: #071541; color: #fff; font-size: 14px; box-shadow: 0 6px 20px rgb(0 0 0 / .28); }
.status .s-tag { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; color: #aebbe0; font-size: 11px; font-weight: 600; letter-spacing: .02em; }
.status .s-dot { width: 6px; height: 6px; border-radius: 50%; background: #f26a05; }
.status .s-line { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; font-weight: 600; }
.status .s-val { font-variant-numeric: tabular-nums; }
.status .s-bar { height: 3px; margin-top: 8px; border-radius: 2px; background: #2c3a6b; overflow: hidden; }
.status .s-bar i { display: block; height: 100%; background: #f26a05; border-radius: 2px; }

/* chooser */
.overlay { position: fixed; inset: 0; z-index: 2147483647; background: rgb(0 0 0 / .45); display: flex; align-items: center; justify-content: center; }
.dialog { width: min(92vw, 360px); background: #fff; border-radius: 12px; padding: 16px; box-shadow: 0 10px 30px rgb(0 0 0 / .35); }
.dialog h2 { margin: 0 0 4px; font-size: 15px; }
.dialog p { margin: 0 0 12px; color: #4a5a7d; }
.dialog .opt { display: block; width: 100%; text-align: left; margin: 0 0 6px; padding: 9px 12px; border: 1px solid #cfd3d9; border-radius: 8px; background: #fff; color: #071541; }
.dialog .opt:hover { border-color: ${ACCENT}; background: #e8f0fd; }
.dialog .skip { margin-top: 4px; padding: 6px 4px; border: 0; background: none; color: #4a5a7d; text-decoration: underline; }

@media (prefers-reduced-motion: reduce) { .toast { animation: none; transition: none; } }
`;

export function uiRoot(): ShadowRoot {
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = HOST_ID;
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    const wrap = document.createElement('div');
    wrap.className = 'ui';
    wrap.id = 'ui';
    root.append(style, wrap);
    document.documentElement.appendChild(host);
  }
  return host.shadowRoot!;
}

/** The container all UI pieces are appended to. */
export const uiLayer = (): HTMLElement => uiRoot().getElementById('ui')!;

/** Extra CSS for a component (added once). */
export function addStyles(id: string, css: string) {
  const root = uiRoot();
  if (root.getElementById(id)) return;
  const s = document.createElement('style');
  s.id = id;
  s.textContent = css;
  root.appendChild(s);
}

export const ICONS = {
  success: '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><circle cx="10" cy="10" r="10" fill="#1b7a43"/><path d="M5.8 10.4l2.8 2.8 5.6-6" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  error: '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><circle cx="10" cy="10" r="10" fill="#c62828"/><path d="M10 5.6v5.2M10 13.7v.1" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>',
  info: '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><circle cx="10" cy="10" r="10" fill="#0d52c4"/><path d="M10 9v4.6M10 6.3v.1" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>',
};
