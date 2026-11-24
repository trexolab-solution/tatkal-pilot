import { ensureDailySync } from '@/utils/catalog';
import { applyBadge, ensureUpdateCheck } from '@/utils/update';

export default defineBackground(() => {
  // Content scripts cannot open the options page themselves.
  browser.runtime.onMessage.addListener((msg: { type?: string; hash?: string }) => {
    if (msg?.type !== 'open-options') return;
    if (msg.hash) void browser.tabs.create({ url: browser.runtime.getURL('/options.html') + msg.hash });
    else void browser.runtime.openOptionsPage();
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
