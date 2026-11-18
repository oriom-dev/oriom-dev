// The 512KB Club rule and the one-request rule, checked for every page and variant.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSite } from '../src/build/main.ts';
import { composeHtml, composeMd } from '../src/shared/compose.ts';
import { VARIANTS, type Stats } from '../src/shared/types.ts';

const LIMIT = 512 * 1000; // 512 KB, decimal, uncompressed: the strictest reading

// Large but realistic stats so the slots are measured filled, not empty.
const stats: Stats = {
  at: new Date().toISOString(), views: 1234567,
  tompedia: { total: 99999 }, mosimo: { posts: 99999, authors: 999 },
  cluster: { nodes: ['kagoya-vps', 'home-desktop'].map((name) => ({
    name, cpus: 16, load: [9.99, 9.99, 9.99], cpu: 99.9, memory: { used: 1e10, total: 3e10 }, rx: 1e6, tx: 1e6, uptime: 1e7,
    containers: Array.from({ length: 40 }, (_, i) => ({ name: `container-name-${i}`, cpu: 1.234, memory: 123456789 })),
    history: { cpu: Array(360).fill(99.99), mem: Array(360).fill(99.99) },
  })) },
};

const site = buildSite();

// Anything the browser would fetch on its own while rendering.
const AUTO_FETCH = [
  /<(?:img|script|iframe|video|audio|source|embed|input)\b[^>]*\ssrcset?=["']?(?!data:)/i,
  /<link\b(?=[^>]*\brel=["']?(?:stylesheet|icon|preload|modulepreload|manifest|apple-touch-icon|prefetch)\b)(?![^>]*\bhref=["']?data:)[^>]*>/i,
  /<object\b[^>]*\sdata=["']?(?!data:)/i,
  /<video\b[^>]*\sposter=/i,
];

for (const [path, page] of Object.entries(site.pages)) {
  test(`${path}: every variant is one request and under 512 KB`, () => {
    for (const v of VARIANTS) {
      const html = composeHtml(site, page, v, 359, stats);
      const size = Buffer.byteLength(html);
      assert.ok(size <= LIMIT, `${v} is ${size} bytes`);
      for (const re of AUTO_FETCH) assert.doesNotMatch(html, re, `${v} would make a second request`);
      // CSS only (scripts may well say "toDataURL("): <style> blocks and style attributes
      const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>|\sstyle="([^"]*)"/g)].map((m) => m[1] ?? m[2]).join('\n');
      assert.doesNotMatch(css, /url\(\s*["']?(?!data:|#)|@import\b/i, `${v} CSS would make a second request`);
      assert.doesNotMatch(html, /<!--@|__HUE__/, `${v} has an unfilled slot`);
    }
    const md = composeMd(page, stats);
    assert.ok(Buffer.byteLength(md) <= LIMIT);
    assert.doesNotMatch(md, /<!--@|\{\{/);
  });
}

test('a post with the maximum number of comments still fits', async () => {
  const { buildPages } = await import('../src/build/pages.ts');
  const { loadPosts, loadWorks } = await import('../src/build/content.ts');
  const posts = loadPosts().map((p) => ({ ...p, bsky: { uri: 'at://did:plc:x/app.bsky.feed.post/y', cid: 'c' } }));
  const long = 'あ'.repeat(300); // Bluesky posts are at most 300 graphemes
  const c = (i: number) => ({ uri: `at://x/${i}`, url: 'https://bsky.app/profile/x/post/y', author: { did: 'did:plc:x', handle: 'someone.example.com', name: 'な'.repeat(64) }, at: '2026-11-18', text: [{ t: long }], likes: 0, replies: [] });
  const comments = Object.fromEntries(posts.map((p) => [p.path, { url: 'https://bsky.app/profile/x/post/y', count: 999, comments: Array.from({ length: 150 }, (_, i) => c(i)) }]));
  const pages = buildPages(loadWorks(), posts, comments);
  for (const p of posts) for (const v of VARIANTS) {
    const size = Buffer.byteLength(composeHtml(site, pages[p.path]!, v, 1, stats));
    assert.ok(size <= LIMIT, `${p.path} ${v}: ${size}`);
  }
});
