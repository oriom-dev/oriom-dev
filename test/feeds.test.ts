import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postMarkdown, mdToHtml } from '../src/build/render.ts';
import { wellKnownUrl } from '../src/server/feeds.ts';

test('well-known URL for root and sub-path publications', () => {
  assert.equal(wellKnownUrl('https://oriom.dev'), 'https://oriom.dev/.well-known/site.standard.publication');
  assert.equal(wellKnownUrl('https://mochott.site/jisaku.dev/'), 'https://mochott.site/.well-known/site.standard.publication/jisaku.dev');
});

test('text from other sites cannot inject markup', () => {
  const html = mdToHtml(postMarkdown({
    slug: 'x/y', path: '/blog/x/y', title: '<img src=x onerror=alert(1)>', date: '2026-01-01', description: '',
    tags: ['<b>'], body: '<script>alert(1)</script>\n\n[link](javascript:alert(1)) **bold**',
    author: { name: 'Team', did: 'did:plc:other' }, external: 'https://example.com/y',
  }, 'html'));
  assert.doesNotMatch(html, /<script|<img|<b>|href="javascript/);
  assert.match(html, /&lt;script&gt;/);
});
