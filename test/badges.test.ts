import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBadges, loadPosts, loadWorks } from '../src/build/content.ts';
import { buildPages } from '../src/build/pages.ts';

test('badges are a section of the top page, display only', () => {
  const [b] = loadBadges();
  assert.ok(b, 'content/badges has data');
  const top = buildPages(loadWorks(), loadPosts())['/']!;
  assert.match(top.body, /<section id="badges"><h2>バッジ<\/h2><ul class="badges">/);
  assert.ok(top.body.includes(`href="${b!.share}"`));
  assert.doesNotMatch(top.body, /<form|sha256\$/);
  assert.match(top.md, /^## バッジ$/m);
});
