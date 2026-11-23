import { uiLayer } from './ui';

/** In-page picker. Resolves with the chosen index, or null if skipped. */
export function choose(title: string, hint: string, items: string[]): Promise<number | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const dlg = document.createElement('div');
    dlg.className = 'dialog';
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-label', title);
    const h = document.createElement('h2');
    h.textContent = title;
    const p = document.createElement('p');
    p.textContent = hint;
    dlg.append(h, p);

    const done = (v: number | null) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') done(null);
    };
    document.addEventListener('keydown', onKey, true);

    items.forEach((label, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'opt';
      b.textContent = label;
      b.addEventListener('click', () => done(i));
      dlg.appendChild(b);
    });
    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'skip';
    skip.textContent = 'Skip this passenger';
    skip.addEventListener('click', () => done(null));
    dlg.appendChild(skip);

    overlay.appendChild(dlg);
    uiLayer().appendChild(overlay);
    dlg.querySelector<HTMLElement>('.opt')?.focus();
  });
}
