import { ICONS, uiLayer } from './ui';

export type ToastKind = 'success' | 'error' | 'info';

/** Floating toast at the bottom of the page. `kind` may also be a boolean (true = error). */
export function toast(message: string, kind: boolean | ToastKind = 'success', ms = 4000) {
  const k: ToastKind = kind === true ? 'error' : kind === false ? 'success' : kind;
  const layer = uiLayer();
  let box = layer.querySelector<HTMLElement>('.toasts');
  if (!box) {
    box = document.createElement('div');
    box.className = 'toasts';
    layer.appendChild(box);
  }
  while (box.children.length >= 4) box.firstElementChild?.remove();

  const el = document.createElement('div');
  el.className = `toast ${k}`;
  el.setAttribute('role', k === 'error' ? 'alert' : 'status');
  el.innerHTML = `${ICONS[k]}<span class="msg"></span><button type="button" class="x" aria-label="Dismiss">×</button>`;
  el.querySelector('.msg')!.textContent = message;
  const dismiss = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 170);
  };
  el.querySelector('.x')!.addEventListener('click', dismiss);
  box.appendChild(el);
  setTimeout(dismiss, k === 'error' ? Math.max(ms, 6000) : ms);
}

export interface StatusOptions {
  /** Right-aligned value, e.g. a countdown. */
  value?: string;
  /** 0..1: shows a thin progress bar. */
  progress?: number;
}

/** A single persistent status card (e.g. a countdown), labelled as coming from the extension. Pass null to remove it. */
export function status(message: string | null, opts: StatusOptions = {}) {
  const layer = uiLayer();
  let el = layer.querySelector<HTMLElement>('.status');
  if (message === null) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('div');
    el.className = 'status';
    el.setAttribute('role', 'status');
    el.innerHTML =
      '<div class="s-tag"><span class="s-dot"></span>IRCTC Autofill</div>' +
      '<div class="s-line"><span class="s-msg"></span><b class="s-val"></b></div>' +
      '<div class="s-bar" hidden><i></i></div>';
    layer.appendChild(el);
  }
  el.querySelector('.s-msg')!.textContent = message;
  const val = el.querySelector<HTMLElement>('.s-val')!;
  val.textContent = opts.value ?? '';
  val.hidden = !opts.value;
  const bar = el.querySelector<HTMLElement>('.s-bar')!;
  bar.hidden = opts.progress === undefined;
  if (opts.progress !== undefined) el.querySelector<HTMLElement>('.s-bar i')!.style.width = `${Math.round(Math.min(1, Math.max(0, opts.progress)) * 100)}%`;
}
