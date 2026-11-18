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

function pollStats(): void {
  if (!document.querySelector('dl[data-stats]') && !document.documentElement.dataset.live) return;
  const tick = async () => {
    if (document.hidden) return;
    try {
      const r = await fetch('/api/stats', { cache: 'no-store' });
      if (r.ok) renderStats(await r.json());
    } catch { /* offline: keep the last values */ }
  };
  setInterval(tick, 20_000);
  document.addEventListener('visibilitychange', tick);
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
    if (document.documentElement.dataset.v !== '3d' && !document.cookie.includes(`${NO3D_COOKIE}=`)) probe3d();
  });
}
