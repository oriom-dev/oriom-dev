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
  tompedia: { total: 99999, byYear: [] }, mosimo: { posts: 99999, authors: 999 },
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
  /url\(\s*["']?(?!data:|#)/i,
  /@import\b/i,
  /<video\b[^>]*\sposter=/i,
];

for (const [path, page] of Object.entries(site.pages)) {
  test(`${path}: every variant is one request and under 512 KB`, () => {
    for (const v of VARIANTS) {
      const html = composeHtml(site, page, v, 359, stats);
      const size = Buffer.byteLength(html);
      assert.ok(size <= LIMIT, `${v} is ${size} bytes`);
      for (const re of AUTO_FETCH) assert.doesNotMatch(html, re, `${v} would make a second request`);
      assert.doesNotMatch(html, /<!--@|__HUE__/, `${v} has an unfilled slot`);
    }
    const md = composeMd(page, stats);
    assert.ok(Buffer.byteLength(md) <= LIMIT);
    assert.doesNotMatch(md, /<!--@|\{\{/);
  });
}
