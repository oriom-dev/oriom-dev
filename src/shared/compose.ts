// Turns a built page into the bytes that go on the wire. Shared by the server and
// the service worker so both serve identical single-request pages.
import { mdPath } from './routes.ts';
import { fillStatsHtml, fillStatsMd } from './stats.ts';
import type { Item, PageOut, SiteBundle, Stats, Variant } from './types.ts';

/** Works (newest first), then posts (newest first): the signs of the 3D world. */
export function items(site: SiteBundle): Item[] {
  const all = Object.values(site.pages).flatMap((p) => (p.item ? [p.item] : []));
  const by = (k: Item['kind']) => all.filter((i) => i.kind === k).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  return [...by('work'), ...by('post')];
}

export function composeHtml(site: SiteBundle, page: PageOut, variant: Variant, hue: number, stats?: Stats): string {
  const s = stats ?? site.stats;
  // Function replacers: page content may contain `$&` and friends.
  const home = site.pages['/'];
  return fillStatsHtml(site.templates[variant]
    .replace('<!--@head-->', () => page.head)
    .replace('<!--@home-->', () => home?.body ?? '')
    .replace('<!--@body-->', () => page.body)
    .replace('<!--@popattr-->', page.path === '/' ? 'hidden' : '')
    .replace('__SKIP__', page.path === '/' ? '#home' : '#c')
    .replace('<!--@items-->', () => JSON.stringify(items(site)).replace(/</g, '\\u003c')), s)
    .replace('<!--@stats-->', () => JSON.stringify(s ?? null).replace(/</g, '\\u003c'))
    .replaceAll('__HUE__', String(hue))
    .replaceAll('__MD__', mdPath(page.path))
    .replaceAll('__PATH__', page.path);
}

/** The popup's content: title and body with the live numbers filled in. */
export const pageData = (page: PageOut, stats?: Stats) => ({ path: page.path, title: page.title, body: fillStatsHtml(page.body, stats) });

export const composeMd = (page: PageOut, stats?: Stats) => fillStatsMd(page.md, stats);
