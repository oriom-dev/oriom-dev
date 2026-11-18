import { test } from 'node:test';
import assert from 'node:assert/strict';
import coap from 'coap';
import { App } from '../src/server/app.ts';
import { Counter } from '../src/server/counter.ts';
import { coapServer } from '../src/server/coap.ts';

const app = new App(new Counter(), () => ({ at: '2026-01-01T00:00:00Z', views: 1 }));

function get(port: number, pathname: string, accept?: string): Promise<{ code: string; cf: unknown; body: string }> {
  return new Promise((resolve, reject) => {
    const req = coap.request({ hostname: '::1', port, pathname, method: 'GET' });
    if (accept) req.setOption('Accept', accept);
    req.on('response', (res: any) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ code: res.code, cf: res.headers['Content-Format'], body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('CoAP serves markdown, discovery, stats and block-wise transfer', async () => {
  const srv = coapServer(app, () => '{"views":1}');
  await new Promise<void>((r) => srv.listen(0, () => r()));
  const port = (srv as any)._sock.address().port;
  try {
    const idx = await get(port, '/');
    assert.equal(idx.code, '2.05');
    assert.match(idx.body, /^# oriom/);
    assert.ok(Buffer.byteLength(idx.body) > 1024, 'needs Block2'); // larger than one block
    assert.equal(idx.body, String(app.respond({ path: '/index.md', protocol: 'http' }).body));
    assert.match((await get(port, '/.well-known/core')).body, /<\/works\/mosimo>;ct=0/);
    assert.equal((await get(port, '/api/stats')).body, '{"views":1}');
    assert.equal((await get(port, '/missing')).code, '4.04');
    assert.equal((await get(port, '/', 'application/json')).code, '4.06');
  } finally {
    await new Promise((r) => srv.close(r));
  }
});
