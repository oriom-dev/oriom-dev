// Markdown -> pages. No esbuild here: the server imports this at run time.
import type { BadgeStatus, Comments, PageOut, Post, Work } from '../shared/types.ts';
import { artAttr } from '../shared/art.ts';
import { AUTHOR, loadBadges, loadPages } from './content.ts';
import { expand, page, postMarkdown, workMarkdown } from './render.ts';

/** Pages only (no esbuild): the server calls this again when followed sites post. */
export function buildPages(works: Work[], posts: Post[], comments: Comments = {}, badgeStatus: Record<string, BadgeStatus> = {}): Record<string, PageOut> {
  const ctx = { works, posts, badges: loadBadges(), badgeStatus };
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
    add(page({ path: `/works/${w.slug}`, title: w.title, description: w.summary }, workMarkdown(w, 'md'), workMarkdown(w, 'html'),
      { kind: 'work', path: `/works/${w.slug}`, title: w.title, date: w.date, summary: w.summary, ...(w.art ? { art: artAttr(w.art) } : {}) }));
  }
  for (const p of posts) {
    add(page({ path: p.path, title: p.title, description: p.description, type: 'article', atUri: p.atUri, published: p.date }, postMarkdown(p, 'md', comments[p.path]), postMarkdown(p, 'html', comments[p.path]),
      { kind: 'post', path: p.path, title: p.title, date: p.date, summary: p.description, ...(p.author.did !== AUTHOR.did ? { by: p.author.name } : {}) }));
  }
  return pages;
}
