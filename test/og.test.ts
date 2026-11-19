import { test } from 'node:test';
import assert from 'node:assert/strict';
import { App } from '../src/server/app.ts';
import { Counter } from '../src/server/counter.ts';
import { ogSvg, wrapEm } from '../src/server/og.ts';

const app = new App(new Counter(), () => ({ at: '2026-01-01T00:00:00Z', views: 0 }));

test('every page names its OGP image, and a card can be drawn for each', () => {
  for (const [path, page] of Object.entries(app.site.pages)) {
    assert.match(page.head, new RegExp(`<meta property="og:image" content="https://oriom.dev/og${path === '/' ? '/index' : path}.png">`));
    assert.match(page.head, /twitter:card" content="summary_large_image"/);
    const svg = ogSvg(page);
    assert.ok(svg.startsWith('<svg') && svg.includes('</svg>'));
    if (path !== '/') assert.ok(svg.includes('oriom.dev'), path);
  }
});

test('titles wrap within the width; Japanese anywhere, words at spaces, "…" when cut', () => {
  assert.deepEqual(wrapEm('東北大学数理・情報', 4, 3), ['東北大学', '数理・情', '報']);
  assert.deepEqual(wrapEm('Kytos Orchestration', 8, 3), ['Kytos', 'Orchestration']);
  const cut = wrapEm('あ'.repeat(20), 5, 2);
  assert.equal(cut.length, 2);
  assert.ok(cut[1]!.endsWith('…'));
});

test('a long badge title gets a smaller size instead of being cut', () => {
  const page = Object.values(app.site.pages).find((p) => p.item?.kind === 'badge' && p.title.length > 30)!;
  const svg = ogSvg(page);
  assert.ok(!svg.includes('…'), page.title);
  assert.match(svg, /font-size="(52|44|36)"/);
});

test('without the fonts there is no image (404), and nothing breaks', () => {
  assert.equal(app.respond({ path: '/og/index.png', protocol: 'http' }).status, 404);
});
