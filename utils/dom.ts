import { now } from './clock';

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll until `fn` returns a truthy value, or throw after `timeout` ms. */
export async function waitFor<T>(
  fn: () => T | null | undefined | false,
  what: string,
  timeout = 5000,
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const v = fn();
    if (v) return v;
    await sleep(60);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/** Wait until `target` (epoch ms), calling `onTick` with seconds left about once a second. */
export async function waitUntil(target: number, onTick?: (secondsLeft: number) => void, cancelled?: () => boolean): Promise<boolean> {
  let lastShown = -1;
  for (;;) {
    if (cancelled?.()) return false;
    const left = target - now(); // server-synced clock, see clock.ts
    if (left <= 0) return true;
    const secs = Math.ceil(left / 1000);
    if (secs !== lastShown) {
      lastShown = secs;
      onTick?.(secs);
    }
    await sleep(left > 300 ? 100 : 5);
  }
}

/** Set a value on an input the way Angular forms expect (native setter + events). */
export function setInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

export function click(el: Element) {
  (el as HTMLElement).click();
}

export const isVisible = (el: Element | null | undefined): el is HTMLElement =>
  !!el && (el as HTMLElement).getBoundingClientRect().height > 0;

export const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) =>
  root.querySelector<T>(sel);

export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) =>
  Array.from(root.querySelectorAll<T>(sel));
