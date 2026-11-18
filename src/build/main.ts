// Builds dist/site.json (templates + pages) plus the service worker and manifest.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { VARIANTS, type PageOut, type SiteBundle } from '../shared/types.ts';
import { ROOT, loadPages, loadPosts, loadWorks } from './content.ts';
import { expand, page, postMarkdown, workMarkdown } from './render.ts';
import { graphHtml, layout } from './graph.ts';
import { template } from './templates.ts';

export function buildSite(): SiteBundle {
  const works = loadWorks();
  const posts = loadPosts();
  const ctx = { works, posts };
  const pages: Record<string, PageOut> = {};
  const add = (p: PageOut) => {
    if (pages[p.path]) throw new Error(`duplicate page ${p.path}`);
    pages[p.path] = p;
  };

  for (const d of loadPages()) {
    const p = d.name === 'index' ? '/' : `/${d.name}`;
    const meta = { path: p, title: String(d.meta.title), description: String(d.meta.description ?? '') };
    add(page(meta, expand(d.body, ctx, 'md'), expand(d.body, ctx, 'html')));
  }
  for (const w of works) {
    add(page({ path: `/works/${w.slug}`, title: w.title, description: w.summary }, workMarkdown(w, 'md'), workMarkdown(w, 'html')));
  }
  for (const p of posts) {
    add(page({ path: p.path, title: p.title, description: p.description, type: 'article', atUri: p.atUri, published: p.date }, postMarkdown(p)));
  }

  const slots = { map: graphHtml(layout(works)) };
  const templates = Object.fromEntries(VARIANTS.map((v) => [v, template(v, slots)])) as SiteBundle['templates'];
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

if (import.meta.main) {
  const site = buildSite();
  const out = path.join(ROOT, 'dist');
  mkdirSync(out, { recursive: true });
  const json = JSON.stringify(site);
  writeFileSync(path.join(out, 'site.json'), json);
  const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
  console.log(`site ${site.version}: ${Object.keys(site.pages).length} pages, bundle ${kb(json.length)} (${kb(gzipSync(json).length)} gz)`);
  for (const v of VARIANTS) console.log(`  template ${v}: ${kb(Buffer.byteLength(site.templates[v]))}`);
}
