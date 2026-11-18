// Pages open in a popup over the 2D/3D view. The URL changes (history.pushState) but
// the page does not: once in 2D you stay in 2D until you reload. Content comes from
// /_/page (one small request per page opened, served by the service worker offline).
import { drawThread } from './thread.ts';

export interface PageData { path: string; title: string; body: string }
export interface Popup {
  open(path: string, opts?: { push?: boolean; show?: boolean }): Promise<void>;
  close(): void;
  readonly path: string | null;
}

const pop = () => document.getElementById('pop')!;
const inner = () => pop().querySelector<HTMLElement>('.pop-inner')!;
const SITE_TITLE = 'oriom';

/** Paths that are pages of this site (not files, APIs, Markdown or other origins). */
export function sitePath(a: HTMLAnchorElement): string | null {
  if (a.target && a.target !== '_self') return null;
  if (a.hasAttribute('download')) return null;
  const u = new URL(a.href, location.href);
  if (u.origin !== location.origin) return null;
  if (/\.(md|txt|xml|json|webmanifest|png|svg|js)$/.test(u.pathname) || u.pathname.startsWith('/api/') || u.pathname.startsWith('/_/')) return null;
  return u.pathname.replace(/\/+$/, '') || '/';
}

export function initPopup(hooks: { onOpen?(path: string): void; onClose?(): void } = {}): Popup {
  const cache = new Map<string, PageData>();
  const art = document.getElementById('c')!;
  const initialOpen = !pop().hidden;
  let current: string | null = initialOpen ? location.pathname : null;
  let lastFocus: Element | null = null;
  // the content the server sent with the page
  cache.set(location.pathname, { path: location.pathname, title: document.title, body: art.innerHTML });

  async function load(path: string): Promise<PageData> {
    const hit = cache.get(path);
    if (hit) return hit;
    const r = await fetch(`/_/page?p=${encodeURIComponent(path)}`);
    if (!r.ok && r.status !== 404) throw new Error(`HTTP ${r.status}`);
    const d = (await r.json()) as PageData;
    cache.set(path, d);
    return d;
  }

  const redraw = () => drawThread(inner(), false);
  new ResizeObserver(() => { if (!pop().hidden) redraw(); }).observe(inner());

  function show(d: PageData, animate: boolean): void {
    art.innerHTML = d.body;
    art.querySelector('h1')?.setAttribute('id', 'pop-title');
    pop().querySelector<HTMLAnchorElement>('.pop-md')!.href = d.path === '/' ? '/index.md' : `${d.path}.md`;
    document.title = d.path === '/' ? SITE_TITLE : `${d.title} | ${SITE_TITLE}`;
    pop().hidden = false;
    document.documentElement.classList.add('popped');
    pop().querySelector('.pop-scroll')!.scrollTop = 0;
    requestAnimationFrame(() => drawThread(inner(), animate));
    lastFocus ??= document.activeElement;
    pop().querySelector<HTMLElement>('.pop-close')!.focus({ preventScroll: true });
    document.dispatchEvent(new CustomEvent('stats-dom')); // live numbers in the new content
  }

  const api: Popup = {
    get path() { return current; },
    async open(path, { push = true, show: force = false } = {}) {
      if (path === '/' && !force) return api.close();
      try {
        const d = await load(path);
        if (push && location.pathname !== path) history.pushState({ pop: true }, '', path);
        current = path;
        show(d, true);
        hooks.onOpen?.(path);
      } catch {
        location.href = path; // no network and no service worker: a normal navigation
      }
    },
    close() {
      if (pop().hidden) return;
      pop().hidden = true;
      document.documentElement.classList.remove('popped');
      current = null;
      document.title = SITE_TITLE;
      if (location.pathname !== '/') {
        if (history.state?.pop) history.back();
        else history.pushState({}, '', '/');
      }
      hooks.onClose?.();
      (lastFocus as HTMLElement | null)?.focus?.({ preventScroll: true });
      lastFocus = null;
    },
  };

  // links to pages of this site open in the popup instead of navigating
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element).closest?.('a');
    if (!a) return;
    if (a.classList.contains('pop-close')) { e.preventDefault(); api.close(); return; }
    const path = sitePath(a);
    if (path === null || new URL(a.href).search) return;
    e.preventDefault();
    api.open(path);
  });
  addEventListener('popstate', () => {
    const p = location.pathname;
    if (p === '/') { if (!pop().hidden) { pop().hidden = true; document.documentElement.classList.remove('popped'); current = null; document.title = SITE_TITLE; hooks.onClose?.(); } }
    else api.open(p, { push: false });
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop().hidden) api.close(); });
  pop().addEventListener('click', (e) => { if (e.target === pop() || (e.target as Element).classList.contains('pop-scroll')) api.close(); });

  if (initialOpen) {
    document.documentElement.classList.add('popped');
    requestAnimationFrame(() => drawThread(inner(), true));
  }
  return api;
}

// Open Badges: check a recipient address against the assertion's salted hash, locally.
document.addEventListener('submit', async (e) => {
  const form = (e.target as Element).closest?.('form.badge-check') as HTMLFormElement | null;
  if (!form) return;
  e.preventDefault();
  const out = form.querySelector('output')!;
  const email = (new FormData(form).get('email') as string | null)?.trim() ?? '';
  if (!email) { out.textContent = ''; return; }
  const [alg, want] = (form.dataset.identity ?? '').split('$');
  if (alg !== 'sha256' || !crypto.subtle) { out.textContent = 'このブラウザでは照合できません'; return; }
  const hex = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s + (form.dataset.salt ?? ''))))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  const ok = (await hex(email)) === want || (await hex(email.toLowerCase())) === want;
  out.textContent = ok ? '✓ 一致しました：このアドレスに発行されたバッジです' : '✗ 一致しません';
});
