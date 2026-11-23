/** Accessible autocomplete for a text input: debounced, cancels stale searches, keyboard friendly. */

export interface ComboOption<T> {
  label: string; // main text
  detail?: string; // right-aligned, e.g. a code
  sub?: string; // muted second line
  data: T;
}

export interface ComboOptions<T> {
  input: HTMLInputElement;
  minChars: number;
  delay: number;
  search: (query: string) => Promise<ComboOption<T>[]>;
  onPick: (option: ComboOption<T>) => void;
  /** Message to show instead of searching (e.g. "add an API key"). Return '' to search. */
  disabledMessage?: () => string;
  emptyText?: string;
}

let seq = 0;

export function attachCombobox<T>(o: ComboOptions<T>) {
  const { input } = o;
  const id = `combo-${++seq}`;

  const wrap = document.createElement('div');
  wrap.className = 'combo';
  input.parentNode!.insertBefore(wrap, input);
  wrap.appendChild(input);
  const list = document.createElement('ul');
  list.className = 'combo-list';
  list.id = id;
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  wrap.appendChild(list);

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', id);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let token = 0;
  let items: ComboOption<T>[] = [];
  let active = -1;

  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };
  const open = () => {
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };

  const message = (text: string, kind: 'info' | 'error' = 'info') => {
    items = [];
    active = -1;
    list.replaceChildren();
    const li = document.createElement('li');
    li.className = `combo-msg ${kind}`;
    li.setAttribute('role', 'presentation');
    li.textContent = text;
    list.appendChild(li);
    open();
  };

  const setActive = (i: number) => {
    const opts = Array.from(list.querySelectorAll<HTMLElement>('[role=option]'));
    opts.forEach((el, n) => el.setAttribute('aria-selected', String(n === i)));
    active = i;
    const el = opts[i];
    if (el) {
      input.setAttribute('aria-activedescendant', el.id);
      el.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  };

  const pick = (i: number) => {
    const opt = items[i];
    if (!opt) return;
    close();
    o.onPick(opt);
  };

  const render = (results: ComboOption<T>[]) => {
    items = results;
    list.replaceChildren();
    if (!results.length) return message(o.emptyText ?? 'No matches');
    results.forEach((r, i) => {
      const li = document.createElement('li');
      li.id = `${id}-${i}`;
      li.className = 'combo-opt';
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      const top = document.createElement('div');
      top.className = 'combo-top';
      const name = document.createElement('span');
      name.className = 'combo-name';
      name.textContent = r.label;
      top.appendChild(name);
      if (r.detail) {
        const d = document.createElement('span');
        d.className = 'combo-detail';
        d.textContent = r.detail;
        top.appendChild(d);
      }
      li.appendChild(top);
      if (r.sub) {
        const s = document.createElement('div');
        s.className = 'combo-sub';
        s.textContent = r.sub;
        li.appendChild(s);
      }
      li.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus in the input
      li.addEventListener('click', () => pick(i));
      list.appendChild(li);
    });
    open();
    setActive(0);
  };

  const run = async (query: string) => {
    const mine = ++token;
    list.setAttribute('aria-busy', 'true');
    try {
      const results = await o.search(query);
      if (mine !== token) return; // a newer search replaced this one
      render(results);
    } catch (e) {
      if (mine !== token) return;
      message(e instanceof Error ? e.message : 'Lookup failed.', 'error');
    } finally {
      if (mine === token) list.removeAttribute('aria-busy');
    }
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    token++; // cancel anything in flight
    const q = input.value.trim();
    if (q.length < o.minChars) return close();
    const blocked = o.disabledMessage?.() ?? '';
    if (blocked) return message(blocked);
    message('Searching…');
    timer = setTimeout(() => void run(q), o.delay);
  });

  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (items.length) setActive((active + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length) setActive((active - 1 + items.length) % items.length);
    } else if (e.key === 'Enter' && active >= 0 && items.length) {
      e.preventDefault();
      pick(active);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });

  input.addEventListener('blur', () => {
    clearTimeout(timer);
    token++;
    setTimeout(close, 120);
  });

  return { close };
}
