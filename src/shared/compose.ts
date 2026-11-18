// Turns a built page into the bytes that go on the wire. Shared by the server and
// the service worker so both serve identical single-request pages.
import { fillStatsHtml, fillStatsMd } from './stats.ts';
import type { PageOut, SiteBundle, Stats, Variant } from './types.ts';

export function composeHtml(site: SiteBundle, page: PageOut, variant: Variant, hue: number, stats?: Stats): string {
  const s = stats ?? site.stats;
  // Function replacers: page content may contain `$&` and friends.
  return site.templates[variant]
    .replace('<!--@head-->', () => page.head)
    .replace('<!--@body-->', () => fillStatsHtml(page.body, s))
    .replace('<!--@stats-->', () => JSON.stringify(s ?? null).replace(/</g, '\\u003c'))
    .replaceAll('__HUE__', String(hue));
}

export const composeMd = (page: PageOut, stats?: Stats) => fillStatsMd(page.md, stats);
