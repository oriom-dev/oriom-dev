// Builds dist/site.json (templates + pages) plus the service worker and manifest.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { VARIANTS, type Post, type SiteBundle } from '../shared/types.ts';
import { oklchToLinearSrgb } from '../shared/color.ts';
import { mdPath } from '../shared/routes.ts';
import { artAttr } from '../shared/art.ts';
import { ROOT, loadBadges, loadPosts, loadWorks } from './content.ts';
import { strokeIcon } from './png.ts';
import { ORIGIN, PUBLICATION_URI } from './render.ts';
import { bundleJs } from './templates.ts';
import { buildPages } from './pages.ts';
import { template } from './templates.ts';

export function buildSite(extraPosts: Post[] = []): SiteBundle {
  const works = loadWorks();
  const posts = [...loadPosts(), ...extraPosts].sort((a, b) => b.date.localeCompare(a.date));
  const pages = buildPages(works, posts);

  const templates = Object.fromEntries(VARIANTS.map((v) => [v, template(v)])) as SiteBundle['templates'];
  const scriptHashes = Object.fromEntries(VARIANTS.map((v) => [v, inlineScriptHashes(templates[v])])) as SiteBundle['scriptHashes'];
  const version = createHash('sha256').update(JSON.stringify({ templates, pages })).digest('hex').slice(0, 12);
  const badges = loadBadges().map((b) => ({
    kind: 'badge' as const, path: b.share, title: b.name, date: b.issuedOn.slice(0, 10), summary: b.issuer.name, ...(b.art ? { art: artAttr(b.art) } : {}),
  }));
  return { version, builtAt: new Date().toISOString(), templates, scriptHashes, pages, badges };
}

/** CSP hashes of executable inline scripts (JSON data blocks are not executed). */
function inlineScriptHashes(html: string): string[] {
  return [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .filter(([, attrs = '']) => !/type="application\/json"/.test(attrs))
    .map(([, , body]) => `'sha256-${createHash('sha256').update(body!).digest('base64')}'`);
}

const ICON_HUE = 290;
const srgb = (l: number, c: number) =>
  oklchToLinearSrgb(l, c, ICON_HUE).map((v) => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)));
const hex = (rgb: number[]) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** Everything besides the bundle: service worker, manifest, icons, crawler files. */
function writeExtras(out: string, site: SiteBundle): void {
  writeFileSync(path.join(out, 'sw.js'), bundleJs(path.join(ROOT, 'src/client/sw.ts')));
  const bg = srgb(0.19, 0.03), fg = srgb(0.74, 0.12);
  // the 1D favicon's arch, kept inside the maskable safe zone
  const arch: [number, number][] = [];
  for (let t = 0; t <= 1.0001; t += 1 / 64) {
    const u = 1 - t;
    const x = u ** 3 * 4 + 3 * u * u * t * 10 + 3 * u * t * t * 22 + t ** 3 * 28;
    const y = u ** 3 * 24 + 3 * u * u * t * 4 + 3 * u * t * t * 4 + t ** 3 * 24;
    arch.push([0.2 + (x / 32) * 0.6, 0.22 + (y / 32) * 0.6]);
  }
  for (const n of [192, 512]) writeFileSync(path.join(out, `icon-${n}.png`), strokeIcon(n, arch, 0.06, fg, bg));
  writeFileSync(path.join(out, 'icon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="${hex(bg)}"/><path d="M10.4 26.2C11.6 22.4 14 10.2 16 10.2S20.4 22.4 21.6 26.2" fill="none" stroke="${hex(fg)}" stroke-width="2" stroke-linecap="round"/></svg>`);
  writeFileSync(path.join(out, 'manifest.webmanifest'), JSON.stringify({
    name: 'oriom.dev', short_name: 'oriom', lang: 'ja', start_url: '/', scope: '/', id: '/',
    display: 'standalone', background_color: hex(bg), theme_color: hex(bg),
    description: '1 次元・2 次元・3 次元のどれかで現れるポートフォリオ。オフラインでも読めます。',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
    ],
  }));
  const paths = Object.keys(site.pages);
  writeFileSync(path.join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((p) => `<url><loc>${ORIGIN}${p === '/' ? '' : p}</loc></url>`).join('')}</urlset>\n`);
  writeFileSync(path.join(out, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`);
  writeFileSync(path.join(out, 'llms.txt'), `# oriom.dev\n\n> oriom のポートフォリオ。どのページも末尾に .md を付けると Markdown で読めます。\n\n${paths.map((p) => `- [${site.pages[p]!.title}](${ORIGIN}${mdPath(p)})`).join('\n')}\n`);
  if (PUBLICATION_URI) writeFileSync(path.join(out, 'site.standard.publication'), PUBLICATION_URI);
}

if (import.meta.main) {
  const site = buildSite();
  const out = path.join(ROOT, 'dist');
  mkdirSync(out, { recursive: true });
  const json = JSON.stringify(site);
  writeFileSync(path.join(out, 'site.json'), json);
  writeExtras(out, site);
  const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
  console.log(`site ${site.version}: ${Object.keys(site.pages).length} pages, bundle ${kb(json.length)} (${kb(gzipSync(json).length)} gz)`);
  for (const v of VARIANTS) console.log(`  template ${v}: ${kb(Buffer.byteLength(site.templates[v]))}`);
}
