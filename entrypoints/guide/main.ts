// The guide is static HTML. This file only shows the version and marks the current section in the contents list.
const version = document.getElementById('version');
if (version) version.textContent = browser.runtime.getManifest().version;

const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('.toc a[href^="#"]'));
const byId = new Map(links.map((a) => [a.hash.slice(1), a]));
const sections = Array.from(byId.keys())
  .map((id) => document.getElementById(id))
  .filter((el): el is HTMLElement => !!el);

function mark(id: string) {
  for (const [key, a] of byId) {
    if (key === id) a.setAttribute('aria-current', 'true');
    else a.removeAttribute('aria-current');
  }
  // On a phone the contents list scrolls sideways: keep the current link in view (sideways only).
  const a = byId.get(id);
  const list = a?.closest('ol');
  if (a && list && list.scrollWidth > list.clientWidth) {
    list.scrollLeft = a.offsetLeft - list.clientWidth / 2 + a.offsetWidth / 2;
  }
}

if ('IntersectionObserver' in window && sections.length) {
  const visible = new Set<string>();
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) visible.add(e.target.id);
        else visible.delete(e.target.id);
      }
      const first = sections.find((s) => visible.has(s.id));
      if (first) mark(first.id);
    },
    { rootMargin: '-120px 0px -55% 0px' },
  );
  sections.forEach((s) => io.observe(s));
}

// Keep the highlight right after a click on a link (also with the keyboard).
links.forEach((a) => a.addEventListener('click', () => mark(a.hash.slice(1))));
