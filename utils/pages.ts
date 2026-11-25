/**
 * Open one of the extension's own pages (Options, How to guide) without piling up tabs: if it is already
 * open anywhere, bring that tab (and its window) to the front, otherwise open a new tab.
 *
 * `hash` (like "#new", "#edit=<id>", "#settings") is applied to the tab that is reused too, so the
 * Options page switches to what was asked for. Runs in the background, which outlives the popup.
 *
 * Finding the open tab needs no extra permission: runtime.getContexts lists the extension's own pages.
 * tabs.query is the fallback for older Chrome. If neither finds it, we simply open a new tab.
 */
export type ExtPage = '/options.html' | '/guide.html';

interface Found {
  tabId: number;
  windowId?: number;
}

async function findOpenTab(base: string): Promise<Found | null> {
  try {
    const contexts = await browser.runtime.getContexts({ contextTypes: ['TAB'] });
    const hit = contexts.find((c) => c.documentUrl?.startsWith(base) && c.tabId >= 0);
    if (hit) return { tabId: hit.tabId, windowId: hit.windowId };
  } catch {
    /* getContexts is not available: try the next way */
  }
  try {
    const [tab] = await browser.tabs.query({ url: `${base}*` });
    if (tab?.id !== undefined) return { tabId: tab.id, windowId: tab.windowId };
  } catch {
    /* could not look: report not found */
  }
  return null;
}

export async function openExtPage(path: ExtPage, hash = ''): Promise<void> {
  const base = browser.runtime.getURL(path);
  const open = await findOpenTab(base);
  if (open) {
    try {
      // Changing only the #fragment does not reload the page; the page listens for it.
      await browser.tabs.update(open.tabId, hash ? { active: true, url: base + hash } : { active: true });
      if (open.windowId !== undefined) await browser.windows.update(open.windowId, { focused: true });
      return;
    } catch {
      /* the tab was closed meanwhile: open a fresh one below */
    }
  }
  await browser.tabs.create({ url: base + hash });
}
