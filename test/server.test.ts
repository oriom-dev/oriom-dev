import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { App, prefersMarkdown } from '../src/server/app.ts';
import { Counter } from '../src/server/counter.ts';
import { http09Server, parseProxy } from '../src/server/http09.ts';

const app = new App(new Counter(), () => ({ at: '2026-01-01T00:00:00Z', views: 42 }));
const chrome = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36';

test('markdown negotiation', () => {
  assert.equal(prefersMarkdown('text/markdown'), true);
  assert.equal(prefersMarkdown('text/html,application/xhtml+xml,*/*;q=0.8'), false);
  assert.equal(prefersMarkdown('*/*'), false);
  assert.equal(prefersMarkdown('text/markdown, text/html;q=0.9'), true);
  assert.equal(prefersMarkdown(undefined), false);
});

test('pages, markdown, redirects and 404', () => {
  const html = app.respond({ path: '/', protocol: 'http', userAgent: chrome });
  assert.equal(html.status, 200);
  assert.match(String(html.body), /^<!doctype html>/);
  assert.match(html.headers['content-security-policy']!, /script-src 'sha256-/);
  const md = app.respond({ path: '/index.md', protocol: 'http' });
  assert.match(md.headers['content-type']!, /text\/markdown/);
  assert.match(String(md.body), /^# oriom\.dev/);
  assert.equal(app.respond({ path: '/works/?a=1', protocol: 'http' }).headers.location, '/works?a=1');
  assert.equal(app.respond({ path: '/nope', protocol: 'http' }).status, 404);
  assert.equal(app.respond({ path: '/?v=2d', protocol: 'http', userAgent: chrome }).variant, '2d');
  for (let i = 0; i < 50; i++) assert.notEqual(app.respond({ path: '/', protocol: 'http', userAgent: 'curl/8' }).variant, '3d');
});

test('PROXY protocol v1 and v2 headers are stripped', () => {
  assert.deepEqual(parseProxy(Buffer.from('PROXY TCP4 203.0.113.9 10.0.0.1 5555 80\r\nGET /\r\n')),
    { client: '203.0.113.9', rest: Buffer.from('GET /\r\n') });
  const v2 = Buffer.concat([
    Buffer.from([0x0d, 0x0a, 0x0d, 0x0a, 0x00, 0x0d, 0x0a, 0x51, 0x55, 0x49, 0x54, 0x0a, 0x21, 0x11, 0x00, 0x0c]),
    Buffer.from([198, 51, 100, 7, 10, 0, 0, 1, 0x15, 0xb3, 0, 80]), Buffer.from('GET /\n'),
  ]);
  assert.deepEqual(parseProxy(v2), { client: '198.51.100.7', rest: Buffer.from('GET /\n') });
  assert.equal(parseProxy(Buffer.from('PROXY TCP4 1.2')), null);
});

test('HTTP/0.9 returns the bare body and closes', async () => {
  const srv = http09Server(app).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const { port } = srv.address() as net.AddressInfo;
  const get = (line: string) => new Promise<string>((resolve) => {
    const s = net.connect(port, '127.0.0.1', () => s.write(line));
    const chunks: Buffer[] = [];
    s.on('data', (c) => chunks.push(c)).on('close', () => resolve(Buffer.concat(chunks).toString()));
  });
  try {
    assert.match(await get('GET /stats.md\r\n'), /^# クラスタ/);
    assert.match(await get('GET /\n'), /^<!doctype html>/);
    assert.match(await get('GET /works/mosimo/\r\n'), /^<!doctype html>/); // redirect is followed: 0.9 has no status
    assert.equal(await get('POST / HTTP/1.1\r\n'), '');
  } finally {
    srv.close();
  }
});

test('paths that scanners send never throw', async () => {
  const { handle: gemini } = await import('../src/server/gemini.ts');
  const { handle: gopher } = await import('../src/server/gopher.ts');
  for (const path of ['//%2e%2e%2f%2eenv', '//', '///etc/passwd', '/%', '/%E0%A4%A', '//[::1', '/..%2f..%2fetc']) {
    const r = app.respond({ path, protocol: 'http' });
    assert.ok([200, 301, 400, 404].includes(r.status), `${path}: ${r.status}`);
    assert.doesNotThrow(() => gopher(app, path, 'oriom.dev', 70), path);
  }
  assert.equal(app.respond({ path: '//index.md', protocol: 'http' }).status, 200); // "//" is a path, not a host
  assert.match(gemini(app, 'gemini://oriom.dev/%E0%A4%A'), /^59 /);
});
