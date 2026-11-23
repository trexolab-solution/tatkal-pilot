import type { RunState } from './storage';

export type PageName = 'home' | 'list' | 'passengers' | 'review' | 'payment' | 'other';
export type LoginState = 'in' | 'out' | 'unknown';

export const PAGE_LABEL: Record<PageName, string> = {
  home: 'Train search',
  list: 'Train list',
  passengers: 'Passenger details',
  review: 'Booking review',
  payment: 'Payment',
  other: 'Other page',
};

export function currentPage(path = location.pathname): PageName {
  if (path.includes('/booking/train-list')) return 'list';
  if (path.includes('/booking/psgninput')) return 'passengers';
  if (path.includes('/booking/reviewBooking')) return 'review';
  if (path.includes('/payment/')) return 'payment';
  if (path.includes('/train-search')) return 'home';
  return 'other';
}

const isLoginButton = (e: Element) => /^login$/i.test(e.textContent?.trim() ?? '');

export function loginState(): LoginState {
  if (document.querySelector('app-header .nav-link-1')) return 'in';
  const header = document.querySelectorAll('app-header button, app-header a');
  return Array.from(header).some(isLoginButton) ? 'out' : 'unknown';
}

/** Press the site's own LOGIN button (opens its login dialog). Returns false if it is not on the page. */
export function openLogin(): boolean {
  const btn = Array.from(document.querySelectorAll<HTMLElement>('app-header button, app-header a')).find(isLoginButton);
  btn?.click();
  return !!btn;
}

/** What the popup asks the page about. */
export interface SiteStatus {
  page: PageName;
  login: LoginState;
  run: RunState;
}
