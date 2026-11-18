// Builds dist/site.json (templates + pages) plus the service worker and manifest.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { VARIANTS, type Post, type SiteBundle } from '../shared/types.ts';
import { oklchToLinearSrgb } from '../shared/color.ts';
import { mdPath } from '../shared/routes.ts';
import { ROOT, loadWorks } from './content.ts';
import { strokeIcon } from './png.ts';
import { ORIGIN } from './render.ts';
import { bundleJs, M_PATH } from './templates.ts';
import { buildPages } from './pages.ts';
import { writeAdmin } from './admin.ts';
import { template } from './templates.ts';

export function buildSite(extraPosts: Post[] = []): SiteBundle {
  const works = loadWorks();
  const posts = [...extraPosts].sort((a, b) => b.date.localeCompare(a.date));
  const pages = buildPages(works, posts);

  const templates = Object.fromEntries(VARIANTS.map((v) => [v, template(v)])) as SiteBundle['templates'];
  const scriptHashes = Object.fromEntries(VARIANTS.map((v) => [v, inlineScriptHashes(templates[v])])) as SiteBundle['scriptHashes'];
  const version = createHash('sha256').update(JSON.stringify({ templates, pages })).digest('hex').slice(0, 12);
  return { version, builtAt: new Date().toISOString(), templates, scriptHashes, pages };
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
  const bg = srgb(0.27, 0.04), fg = srgb(0.86, 0.12);
  // the favicon's "M", kept inside the maskable safe zone (the middle 60 %)
  const m: [number, number][] = [[9.5, 23], [9.5, 9.5], [16, 17.5], [22.5, 9.5], [22.5, 23]].map(([x, y]) => [0.2 + ((x! - 2) / 28) * 0.6, 0.2 + ((y! - 2) / 28) * 0.6]);
  for (const n of [192, 512]) writeFileSync(path.join(out, `icon-${n}.png`), strokeIcon(n, m, 0.07, fg, bg));
  writeFileSync(path.join(out, 'icon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="${hex(bg)}"/><path d="${M_PATH}" fill="none" stroke="${hex(fg)}" stroke-width="3.4" stroke-linecap="square"/></svg>`);
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
  writeAdmin(out);
  writeFileSync(path.join(out, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${ORIGIN}/sitemap.xml\n`);
  writeFileSync(path.join(out, 'llms.txt'), `# oriom.dev\n\n> oriom のポートフォリオ。どのページも末尾に .md を付けると Markdown で読めます。\n\n${paths.map((p) => `- [${site.pages[p]!.title}](${ORIGIN}${mdPath(p)})`).join('\n')}\n`);
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
