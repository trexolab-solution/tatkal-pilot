import { ensureDailySync } from '@/utils/catalog';

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
});
