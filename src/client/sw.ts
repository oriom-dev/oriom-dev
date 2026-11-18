/// <reference lib="webworker" />
// Offline: the service worker keeps the site bundle (templates + pages) and composes
// pages with the same code as the server, so even offline every visit is a random
// design in a random hue, and every page is still one complete document.
import { randomHue } from '../shared/color.ts';
import { composeHtml, composeMd, pageData } from '../shared/compose.ts';
import { resolve } from '../shared/routes.ts';
import type { SiteBundle, Stats } from '../shared/types.ts';
import { pickVariant } from '../shared/variant.ts';

declare const self: ServiceWorkerGlobalScope;
const CACHE = 'oriom';
const BUNDLE = '/offline.json';
const STATIC = ['/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png'];
const TIMEOUT = 3000;

let site: SiteBundle | null = null;
let stats: Stats | undefined;

async function refreshBundle(): Promise<void> {
  const r = await fetch(BUNDLE, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`bundle HTTP ${r.status}`);
  const c = await caches.open(CACHE);
  await c.put(BUNDLE, r.clone());
  site = await r.json();
  stats = site!.stats;
}

async function bundle(): Promise<SiteBundle | null> {
  if (site) return site;
  const r = await (await caches.open(CACHE)).match(BUNDLE);
  if (r) { site = await r.json(); stats = stats ?? site!.stats; }
  return site;
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    await refreshBundle();
    await (await caches.open(CACHE)).addAll(STATIC).catch(() => {});
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

const withTimeout = (p: Promise<Response>) =>
  Promise.race([p, new Promise<Response>((_, rej) => setTimeout(() => rej(new Error('timeout')), TIMEOUT))]);

async function can3d(): Promise<boolean> {
  try { if (await (navigator as any).gpu?.requestAdapter()) return true; } catch { /* no WebGPU */ }
  try { return !!new OffscreenCanvas(1, 1).getContext('webgl2'); } catch { return false; }
}

async function offline(url: URL): Promise<Response> {
  const s = await bundle();
  if (!s) return new Response('オフラインです。', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  const r = resolve(url.pathname);
  const path = r.kind === 'redirect' ? r.location : r.path;
  const md = r.kind === 'page' && r.md;
  const page = s.pages[path] ?? s.pages['/']!;
  const status = s.pages[path] ? 200 : 404;
  if (md) return new Response(composeMd(page, stats), { status, headers: { 'content-type': 'text/markdown; charset=utf-8' } });
  const variant = pickVariant(await can3d(), url.searchParams.get('v'));
  return new Response(composeHtml(s, page, variant, randomHue(), stats), { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname === '/sw.js' || url.pathname === BUNDLE) return;

  if (url.pathname === '/api/stats') {
    e.respondWith(fetch(req).then(async (r) => {
      if (r.ok) stats = await r.clone().json();
      return r;
    }).catch(() => new Response(JSON.stringify(stats ?? null), { headers: { 'content-type': 'application/json' } })));
    return;
  }
  if (STATIC.includes(url.pathname)) {
    e.respondWith(caches.match(req).then((hit) => hit ?? fetch(req)));
    return;
  }
  if (url.pathname === '/_/page') {
    e.respondWith(withTimeout(fetch(req)).catch(async () => {
      const s = await bundle();
      const r = resolve(url.searchParams.get('p') ?? '/');
      const p = s?.pages[r.kind === 'redirect' ? r.location : r.path];
      if (!s || !p) return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify(pageData(p, stats)), { headers: { 'content-type': 'application/json' } });
    }));
    return;
  }
  const isPage = req.mode === 'navigate' || url.pathname.endsWith('.md') || (req.headers.get('accept') ?? '').includes('text/html');
  if (!isPage) return;
  e.respondWith((async () => {
    try {
      const r = await withTimeout(fetch(req));
      // A new deploy: fetch the new bundle in the background.
      const v = r.headers.get('x-site-version');
      if (v && v !== (await bundle())?.version) e.waitUntil(refreshBundle().catch(() => {}));
      return r;
    } catch {
      return offline(url);
    }
  })());
});
