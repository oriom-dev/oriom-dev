// Markdown -> pages. No esbuild here: the server imports this at run time.
import type { Comments, PageOut, Post, Work } from '../shared/types.ts';
import { artAttr } from '../shared/art.ts';
import { AUTHOR, loadBadges, loadPages } from './content.ts';
import { badgeMarkdown, expand, mdToHtml, page, postMarkdown, workMarkdown } from './render.ts';

/** Pages only (no esbuild): the server calls this again when followed sites post. */
export function buildPages(works: Work[], posts: Post[], comments: Comments = {}): Record<string, PageOut> {
  const ctx = { works, posts, badges: loadBadges() };
  const pages: Record<string, PageOut> = {};
  const add = (p: PageOut) => {
    if (pages[p.path]) throw new Error(`duplicate page ${p.path}`);
    pages[p.path] = p;
  };

  for (const d of loadPages()) {
    const p = d.name === 'index' ? '/' : `/${d.name}`;
    const meta = { path: p, title: String(d.meta.title), description: String(d.meta.description ?? '') };
    const pg = page(meta, expand(d.body, ctx, 'md'), expand(d.body, ctx, 'html'));
    if (p === '/') pg.intro = mdToHtml(expand(d.body.replace(/^\{\{(works|posts|badges)\}\}$/gm, ''), ctx, 'html'));
    add(pg);
  }
  for (const w of works) {
    add(page({ path: `/works/${w.slug}`, title: w.title, description: w.summary }, workMarkdown(w, 'md'), workMarkdown(w, 'html'),
      { kind: 'work', path: `/works/${w.slug}`, title: w.title, date: w.date, summary: w.summary, tags: w.tech, ...(w.art ? { art: artAttr(w.art) } : {}), ...(w.stat ? { stat: w.stat } : {}) }));
  }
  for (const p of posts) {
    add(page({ path: p.path, title: p.title, description: p.description, type: 'article', atUri: p.atUri, published: p.date }, postMarkdown(p, 'md', comments[p.path]), postMarkdown(p, 'html', comments[p.path]),
      { kind: 'post', path: p.path, title: p.title, date: p.date, summary: p.description, ...(p.author.did !== AUTHOR.did ? { by: p.author.name } : {}) }));
  }
  for (const b of ctx.badges) {
    const path = `/badges/${b.slug}`;
    add(page({ path, title: b.name, description: `${b.issuer.name}・${b.issuedOn.slice(0, 10)}` }, badgeMarkdown(b, 'md'), badgeMarkdown(b, 'html'),
      { kind: 'badge', path, title: b.name, date: b.issuedOn.slice(0, 10), summary: b.issuer.name, ...(b.art ? { art: artAttr(b.art) } : {}) }));
  }
  return pages;
}
