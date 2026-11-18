// Runs on every variant after the page is already complete. Everything here is a
// progressive enhancement: PWA install, offline cache, live numbers, 3D capability.
import { statsHtml } from '../shared/stats.ts';
import { NO3D_COOKIE } from '../shared/variant.ts';
import type { Stats } from '../shared/types.ts';

export function readStats(): Stats | null {
  try { return JSON.parse(document.getElementById('stats')?.textContent || 'null'); } catch { return null; }
}

export function renderStats(s: Stats | null): void {
  if (!s) return;
  for (const dl of document.querySelectorAll<HTMLElement>('dl[data-stats]')) {
    const next = document.createRange().createContextualFragment(statsHtml(s, dl.dataset.stats!)).firstElementChild!;
    // Update values in place so screen readers are not handed a new subtree each poll.
    for (const dd of next.querySelectorAll<HTMLElement>('dd[data-k]')) {
      const cur = dl.querySelector<HTMLElement>(`dd[data-k="${CSS.escape(dd.dataset.k!)}"]`);
      if (!cur) { dl.replaceWith(next); break; }
      if (cur.textContent !== dd.textContent) cur.textContent = dd.textContent;
    }
  }
  document.dispatchEvent(new CustomEvent('stats', { detail: s }));
}

/** Once a minute while the tab is visible; the full cluster data only while it is shown. */
function pollStats(): void {
  const tick = async () => {
    if (document.hidden || !document.querySelector('[data-stats]') && document.documentElement.dataset.v !== '3d') return;
    const full = !!document.querySelector('.pop:not([hidden]) dl[data-stats="full"]');
    try {
      const r = await fetch(full ? '/api/stats?full' : '/api/stats', { cache: 'no-store' });
      if (r.ok) renderStats(await r.json());
    } catch { /* offline: keep the last values */ }
  };
  setInterval(tick, 60_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  document.addEventListener('stats-dom', tick);
}

/** Tell the server not to pick the 3D page for this browser if it cannot run it. */
async function probe3d(): Promise<void> {
  let ok = false;
  try { ok = !!(await (navigator as any).gpu?.requestAdapter()); } catch { /* no WebGPU */ }
  if (!ok) { try { ok = !!document.createElement('canvas').getContext('webgl2'); } catch { /* no WebGL 2 */ } }
  document.cookie = `${NO3D_COOKIE}=${ok ? 0 : 1};path=/;max-age=31536000;samesite=lax;secure`;
}

export function boot(): void {
  pollStats();
  addEventListener('load', () => {
    // Added after load so that the first paint needs exactly one request.
    const m = document.createElement('link');
    m.rel = 'manifest';
    m.href = '/manifest.webmanifest';
    document.head.append(m);
    navigator.serviceWorker?.register('/sw.js').catch(() => {});
    if (document.documentElement.dataset.v === '2d' && !document.cookie.includes(`${NO3D_COOKIE}=`)) probe3d();
  });
}
