// Transport-independent request handling: HTTP/1.x–3 (via Caddy), HTTP/0.9 and
// CoAP all ask `respond` for the same representation of a path.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, watch } from 'node:fs';
import path from 'node:path';
import { randomHue } from '../shared/color.ts';
import { composeHtml, composeMd, pageData } from '../shared/compose.ts';
import { compactStats } from '../shared/stats.ts';
import { resolve } from '../shared/routes.ts';
import type { PageOut, SiteBundle, Stats, Variant } from '../shared/types.ts';
import { maybe3d, pickVariant } from '../shared/variant.ts';
import type { Counter } from './counter.ts';

export interface Req {
  path: string; // path + query as sent
  method?: string;
  userAgent?: string | null;
  cookie?: string | null;
  accept?: string | null;
  client?: string; // remote address, only for de-duplicating the counter
  protocol: 'http' | 'http/0.9' | 'coap' | 'gopher' | 'gemini';
}

export interface Reply {
  status: number;
  headers: Record<string, string>;
  body: string | Buffer;
  variant?: Variant;
}

const DIST = path.resolve(import.meta.dirname, '../../dist');

const NOT_FOUND: PageOut = {
  path: '/404',
  title: '見つかりません',
  head: '<title>見つかりません | oriom</title><meta name="robots" content="noindex">',
  body: '<h1>見つかりません</h1><p>このページはありません。<a href="/">トップへ</a></p>',
  md: '# 見つかりません\n\nこのページはありません。[トップへ](/)\n',
};

function csp(site: SiteBundle, v: Variant): string {
  return [
    "default-src 'none'",
    `script-src ${site.scriptHashes[v].join(' ')}`,
    "style-src 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

const SECURITY = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
};

export class App {
  site!: SiteBundle;
  private files = new Map<string, { type: string; body: Buffer }>();

  private counter: Counter;
  private stats: () => Stats;
  private distDir: string;

  constructor(counter: Counter, stats: () => Stats, distDir = DIST) {
    this.counter = counter;
    this.stats = stats;
    this.distDir = distDir;
    this.load();
  }

  load(): void {
    this.site = JSON.parse(readFileSync(path.join(this.distDir, 'site.json'), 'utf8'));
    this.base = this.site.pages;
    this.baseVersion = this.site.version;
    if (this.extra && Object.keys(this.extra).length) {
      this.site.pages = { ...this.base, ...this.extra };
      this.site.version = this.versionWith(this.extra);
    }
    this.files.clear();
    const add = (route: string, file: string, type: string) => {
      const f = path.join(this.distDir, file);
      if (existsSync(f)) this.files.set(route, { type, body: readFileSync(f) });
    };
    add('/sw.js', 'sw.js', 'text/javascript; charset=utf-8');
    add('/manifest.webmanifest', 'manifest.webmanifest', 'application/manifest+json');
    add('/icon.svg', 'icon.svg', 'image/svg+xml');
    add('/icon-192.png', 'icon-192.png', 'image/png');
    add('/icon-512.png', 'icon-512.png', 'image/png');
    add('/robots.txt', 'robots.txt', 'text/plain; charset=utf-8');
    add('/sitemap.xml', 'sitemap.xml', 'application/xml');
    add('/llms.txt', 'llms.txt', 'text/plain; charset=utf-8');
    add('/.well-known/site.standard.publication', 'site.standard.publication', 'text/plain; charset=utf-8');
  }

  private extra: Record<string, PageOut> = {};

  /** Pages built at run time (posts from followed sites), merged over the built ones. */
  setPages(pages: Record<string, PageOut>): void {
    this.extra = pages;
    this.site = { ...this.site, pages: { ...this.base, ...pages }, version: this.versionWith(pages) };
  }

  private baseVersion = '';
  /** A new version whenever run-time pages change, so service workers refetch the bundle. */
  private versionWith(pages: Record<string, PageOut>): string {
    if (!Object.keys(pages).length) return this.baseVersion;
    return `${this.baseVersion}-${createHash('sha256').update(JSON.stringify(pages)).digest('hex').slice(0, 8)}`;
  }

  private base: Record<string, PageOut> = {};

  /** Reload dist/ when a new build lands (dev, and atomic deploys). */
  watch(): void {
    let t: NodeJS.Timeout | undefined;
    watch(this.distDir, () => {
      clearTimeout(t);
      t = setTimeout(() => { try { this.load(); console.log(`reloaded ${this.site.version}`); } catch (e) { console.warn(e); } }, 200);
    });
  }

  /** The Markdown of a page, for the text protocols (Gopher, Gemini). Counts the visit. */
  markdown(rawPath: string, client?: string, protocol = 'text'): { status: 200 | 404 } & { body: string } | { status: 301; location: string } {
    const r = resolve(rawPath.replace(/\.gmi$/, '.md'));
    if (r.kind === 'redirect') return { status: 301, location: r.location };
    const page = this.site.pages[r.path];
    if (page) this.counter.hit(r.path, client ?? '', protocol);
    return { status: page ? 200 : 404, body: composeMd(page ?? NOT_FOUND, this.stats()) };
  }

  statsJson = () => JSON.stringify(this.stats());

  /** Page paths and titles under a prefix, newest first as built ("/works", "/blog"). */
  list(prefix: string): { path: string; title: string }[] {
    return Object.values(this.site.pages)
      .filter((p) => p.path.startsWith(`${prefix}/`))
      .map((p) => ({ path: p.path, title: p.title }));
  }

  respond(req: Req): Reply {
    const url = new URL(req.path, 'http://x');
    const file = this.files.get(url.pathname);
    if (file) {
      const cache = url.pathname === '/sw.js' ? 'no-cache' : 'public, max-age=3600';
      return { status: 200, headers: { 'content-type': file.type, 'cache-control': cache, ...SECURITY }, body: file.body };
    }
    if (url.pathname === '/api/stats') {
      // ?full adds per-container data and history: only the cluster popup asks for it
      const s = url.searchParams.has('full') ? this.stats() : compactStats(this.stats());
      return { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...SECURITY }, body: JSON.stringify(s) };
    }
    if (url.pathname === '/_/page') {
      // the popup's content for a page opened in place (title + body)
      const r = resolve(url.searchParams.get('p') ?? '/');
      const path = r.kind === 'redirect' ? r.location : r.path;
      const page = this.site.pages[path];
      if (page) this.counter.hit(path, req.client ?? '', req.userAgent ?? '');
      return {
        status: page ? 200 : 404,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-cache', 'x-site-version': this.site.version, ...SECURITY },
        body: JSON.stringify(pageData(page ?? NOT_FOUND, this.stats())),
      };
    }
    if (url.pathname === '/offline.json') {
      // Everything the service worker needs to compose any page without the network.
      return {
        status: 200,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-cache', etag: `"${this.site.version}"`, ...SECURITY },
        body: JSON.stringify({ ...this.site, stats: this.stats() }),
      };
    }

    const r = resolve(req.path);
    if (r.kind === 'redirect') {
      const location = r.location + url.search;
      return { status: 301, headers: { location, 'content-type': 'text/plain; charset=utf-8', ...SECURITY }, body: `Moved to ${location}\n` };
    }
    const page = this.site.pages[r.path];
    const status = page ? 200 : 404;
    const p = page ?? NOT_FOUND;
    const wantsMd = r.md || req.protocol === 'coap' || prefersMarkdown(req.accept);

    if (page && !wantsMd) this.counter.hit(r.path, req.client ?? '', req.userAgent ?? '');
    if (wantsMd) {
      return {
        status,
        headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'public, max-age=60', vary: 'accept', 'x-site-version': this.site.version, ...SECURITY },
        body: composeMd(p, this.stats()),
      };
    }
    const variant = pickVariant(maybe3d(req.userAgent, req.cookie), url.searchParams.get('v'));
    return {
      status,
      variant,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        // A different design and colour every time, so never reuse a response.
        'cache-control': 'private, no-cache',
        vary: 'accept, cookie, user-agent',
        link: `<${r.path === '/' ? '/index.md' : `${r.path}.md`}>; rel="alternate"; type="text/markdown"`,
        'content-security-policy': csp(this.site, variant),
        'x-site-version': this.site.version,
        ...SECURITY,
      },
      body: composeHtml(this.site, p, variant, randomHue(), this.stats()),
    };
  }
}

/** True when the client ranks text/markdown above text/html (agents, `curl -H accept:text/markdown`). */
export function prefersMarkdown(accept?: string | null): boolean {
  if (!accept) return false;
  const q = (type: string) => {
    let best = -1;
    for (const part of accept.split(',')) {
      const [t, ...params] = part.trim().split(';');
      if (t !== type && !(type.startsWith('text/') && t === 'text/*') && t !== '*/*') continue;
      const qp = params.map((s) => s.trim()).find((s) => s.startsWith('q='));
      const v = qp ? Number(qp.slice(2)) : 1;
      const exact = t === type ? 1 : 0; // an exact match outranks wildcards
      best = Math.max(best, v + exact * 1e-3);
    }
    return best;
  };
  return q('text/markdown') > q('text/html');
}
