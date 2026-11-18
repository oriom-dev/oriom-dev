import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import tls from 'node:tls';
import { App } from '../src/server/app.ts';
import { Counter } from '../src/server/counter.ts';
import { gemtext } from '../src/server/gemtext.ts';
import { geminiServer, handle as gemini } from '../src/server/gemini.ts';
import { handle as gopher } from '../src/server/gopher.ts';

const app = new App(new Counter(), () => ({ at: '2026-01-01T00:00:00Z', views: 7 }));

test('Markdown becomes gemtext with link lines', () => {
  const g = gemtext('# T\n\nSee [the works](/works) and [x](https://x.example).\n\n- a [b](/blog/b)\n- c\n\n| k | v |\n|---|---|\n| 1 | 2 |\n\n[only](/index.md)\n');
  assert.match(g, /^# T\n/);
  assert.match(g, /^See the works and x\.\n=> \/works the works\n=> https:\/\/x\.example x$/m);
  assert.match(g, /^\* a b\n\* c\n=> \/blog\/b b$/m);
  assert.match(g, /```\nk \| v\n1 \| 2\n```/);
  assert.match(g, /^=> \/ only$/m);
});

test('Gemini responses', () => {
  assert.match(gemini(app, 'gemini://oriom.dev/'), /^20 text\/gemini; charset=utf-8; lang=ja\r\n# oriom/);
  assert.match(gemini(app, 'gemini://oriom.dev/works/mosimo'), /^20 .*\r\n# Mosimo Protocol/);
  assert.equal(gemini(app, 'gemini://oriom.dev/works/'), '31 /works\r\n');
  assert.match(gemini(app, 'gemini://oriom.dev/nope'), /^51 /);
  assert.match(gemini(app, 'https://oriom.dev/'), /^53 /);
  assert.match(gemini(app, 'not a url'), /^59 /);
});

test('Gopher menus and text', () => {
  const root = gopher(app, '', 'oriom.dev', 70);
  assert.match(root, /^ioriom\.dev\t\terror\.host\t1\r\n/);
  assert.match(root, /\r\n1実績\t\/works\toriom\.dev\t70\r\n/);
  assert.ok(root.endsWith('\r\n.\r\n'));
  assert.match(gopher(app, '/works', 'oriom.dev', 70), /\r\n0Mosimo Protocol\t\/works\/mosimo\toriom\.dev\t70\r\n/);
  const doc = gopher(app, '/works/mosimo', 'oriom.dev', 70);
  assert.match(doc, /^# Mosimo Protocol\r\n/);
  assert.ok(doc.endsWith('\r\n.\r\n'));
  assert.match(gopher(app, '/index', 'oriom.dev', 70), /^# oriom/);
  assert.match(gopher(app, '/nope', 'oriom.dev', 70), /^3/);
});

test('Gemini over TLS', async () => {
  const dir = new URL('./fixtures/', import.meta.url);
  const srv = geminiServer(app, { cert: readFileSync(new URL('gemini-test-cert.pem', dir)), key: readFileSync(new URL('gemini-test-key.pem', dir)) });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const { port } = srv.address() as { port: number };
  const body = await new Promise<string>((resolve, reject) => {
    const s = tls.connect({ host: '127.0.0.1', port, rejectUnauthorized: false }, () => s.write('gemini://localhost/stats\r\n'));
    let d = '';
    s.on('data', (c) => (d += c)).on('end', () => resolve(d)).on('error', reject);
  });
  srv.close();
  assert.match(body, /^20 text\/gemini.*\r\n# クラスタ/);
});
