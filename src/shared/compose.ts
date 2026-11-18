// Turns a built page into the bytes that go on the wire. Shared by the server and
// the service worker so both serve identical single-request pages.
import { parseArtAttr, separatePath } from './art.ts';
import { mdPath } from './routes.ts';
import { compactStats, fillStatsHtml, fillStatsMd } from './stats.ts';
import type { Item, PageOut, SiteBundle, Stats, Variant } from './types.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&${({ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' } as const)[c as '&']};`);

function art(attr: string | undefined): string {
  if (!attr) return '';
  const a = parseArtAttr(attr);
  return `<figure class="art"><svg viewBox="0 0 1000 ${Math.round(1000 / a.aspect)}" aria-hidden="true"><path d="${separatePath(a)}"/></svg></figure>`;
}

/** One card: the year is the column it stands in, so it is not repeated here. */
function card(it: Item): string {
  const tags = it.tags?.length ? `<ul class="tags">${it.tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '';
  return `<li class="${it.kind}"><a href="${esc(it.path)}">${art(it.art)}<b>${esc(it.title)}</b>`
    + `${it.summary ? `<span>${esc(it.summary)}</span>` : ''}${it.by ? `<small>${esc(it.by)}</small>` : ''}`
    + `${it.stat ? `<!--@stats:${it.stat}-->` : ''}${tags}</a></li>`;
}

/** The 2D view: a column per year, newest first; works, posts and badges in each. */
export function years(site: SiteBundle): string {
  const all = [...items(site), ...(site.badges ?? [])];
  const by = new Map<string, Item[]>();
  for (const it of all) {
    const y = (it.date ?? '').slice(0, 4) || '—';
    by.set(y, [...(by.get(y) ?? []), it]);
  }
  const cols = [...by.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  return `<div class="years">${cols.map(([y, its]) => {
    its.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
    return `<section class="year" id="y${y}" aria-label="${y} 年"><h2>${y}</h2><ul>${its.map(card).join('')}</ul></section>`;
  }).join('')}</div>`;
}

/** The sections of the top page that exist, and the cluster. */
function nav(site: SiteBundle): string {
  const has = (k: Item['kind']) => Object.values(site.pages).some((p) => p.item?.kind === k);
  const links: [string, string][] = [['/#works', '実績']];
  if (has('post')) links.push(['/#posts', '記事']);
  if (site.pages['/']?.body.includes('id="badges"')) links.push(['/#badges', 'バッジ']);
  if (site.pages['/stats']) links.push(['/stats', 'クラスタ']);
  return `<nav aria-label="サイト">${links.map(([h, t]) => `<a href="${h}">${t}</a>`).join('')}</nav>`;
}

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
    .replace('<!--@home-->', () => (variant === '2d' ? (home?.intro ?? '') + years(site) : home?.body ?? ''))
    // in 2D the top page is the card itself: the hidden popup stays empty (no duplicate ids)
    .replace('<!--@body-->', () => (variant === '2d' && page.path === '/' ? '' : page.body))
    .replace('<!--@nav-->', () => nav(site))
    .replace('<!--@popattr-->', page.path === '/' ? 'hidden' : '')
    .replace('__SKIP__', page.path === '/' ? '#home' : '#c')
    .replace('<!--@items-->', () => JSON.stringify(items(site)).replace(/</g, '\\u003c')), s)
    .replace('<!--@stats-->', () => JSON.stringify(compactStats(s) ?? null).replace(/</g, '\\u003c'))
    .replaceAll('__HUE__', String(hue))
    .replaceAll('__MD__', mdPath(page.path))
    .replaceAll('__PATH__', page.path);
}

/** The popup's content: title and body with the live numbers filled in. */
export const pageData = (page: PageOut, stats?: Stats) => ({ path: page.path, title: page.title, body: fillStatsHtml(page.body, stats) });

export const composeMd = (page: PageOut, stats?: Stats) => fillStatsMd(page.md, stats);
