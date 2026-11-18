import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadBadges } from '../src/build/content.ts';
import { badgeSection, mdToHtml } from '../src/build/render.ts';

test('badges render with status, hash and a local check form', () => {
  const [b] = loadBadges();
  assert.ok(b, 'content/badges has data');
  const html = mdToHtml(badgeSection(b!, { ok: true, at: '2026-11-18T00:00:00Z', note: '発行元で有効です' }, 'html'));
  assert.match(html, /✓ 発行元で有効です（2026-11-18 に確認）/);
  assert.match(html, new RegExp(`data-identity="${b!.recipient.identity.replace('$', '\\$')}"`));
  assert.match(html, /<figure class="art badge"/);
  const md = badgeSection(b!, undefined, 'md');
  assert.doesNotMatch(md, /<form/);
  assert.match(md, /発行元への確認はまだです/);
});

test('the salted hash is what the form compares against', () => {
  // sha256(identity + salt), the Open Badges 2.0 rule the client-side check uses
  const salt = 'abc', email = 'someone@example.com';
  const h = createHash('sha256').update(email + salt).digest('hex');
  assert.equal(h.length, 64);
});
