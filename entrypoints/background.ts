import { ensureDailySync } from '@/utils/catalog';
import { openExtPage } from '@/utils/pages';
import { applyBadge, ensureUpdateCheck } from '@/utils/update';

export default defineBackground(() => {
  // The popup and the page panel ask here to open Options or the guide. If that page is already open,
  // its tab is focused instead of opening another one.
  browser.runtime.onMessage.addListener((msg: { type?: string; hash?: string }) => {
    if (msg?.type === 'open-options') void openExtPage('/options.html', typeof msg.hash === 'string' ? msg.hash : '');
    else if (msg?.type === 'open-guide') void openExtPage('/guide.html');
  });

  // Keep the station list fresh: once a day, as soon as the browser starts (or the extension is installed).
  const sync = () => void ensureDailySync().catch(() => undefined);
  browser.runtime.onStartup.addListener(sync);
  browser.runtime.onInstalled.addListener(sync);

  // Not on the Web Store, so look for a newer GitHub release once a day and badge the icon if there is one.
  const checkUpdate = () => void ensureUpdateCheck().then(applyBadge, () => undefined);
  browser.runtime.onStartup.addListener(checkUpdate);
  browser.runtime.onInstalled.addListener(checkUpdate);
  void applyBadge(); // the service worker can restart; keep the badge in step with what we know
});
