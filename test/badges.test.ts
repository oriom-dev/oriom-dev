import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBadges, loadWorks } from '../src/build/content.ts';
import { buildPages } from '../src/build/pages.ts';

test('badges are a section of the top page and open their own page first', () => {
  const [b] = loadBadges();
  assert.ok(b, 'content/badges has data');
  const top = buildPages(loadWorks(), [])['/']!;
  assert.match(top.body, /<section id="badges"><h2>バッジ<\/h2><ul class="badges">/);
  assert.ok(top.body.includes(`href="/badges/${b!.slug}"`), 'the list links to the detail page, not straight to the issuer');
  const detail = buildPages(loadWorks(), [])[`/badges/${b!.slug}`]!;
  assert.ok(detail.body.includes(`href="${b!.share}" target="_blank" rel="noopener"`), 'the issuer opens in a new tab');
  assert.doesNotMatch(top.body, /<form|sha256\$/);
  assert.match(top.md, /^## バッジ$/m);
});
