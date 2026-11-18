// CoAP (RFC 7252) over UDP. Pages come back as Markdown (text/plain;charset=utf-8,
// there is no registered CoAP format for text/markdown), long ones via Block2
// (RFC 7959), /api/stats as JSON with Observe (RFC 7641), and resource discovery
// at /.well-known/core (RFC 6690).
import coap from 'coap';
import type { App } from './app.ts';

const TEXT = 'text/plain'; // CoAP Content-Format 0 is defined as UTF-8
const JSON_CF = 'application/json';
const LINK = 'application/link-format';

/** CoRE link format listing every page, so `coap-client -m get coap://oriom.dev/.well-known/core` works. */
export function wellKnownCore(app: App): string {
  const q = (s: string) => s.replace(/["\\]/g, '');
  return [
    ...Object.values(app.site.pages).map((p) => `<${p.path}>;ct=0;title="${q(p.title)}"`),
    '</api/stats>;ct=50;obs;rt="oriom.stats"',
  ].join(',');
}

export function coapServer(app: App, statsJson: () => string, observeEvery = 20_000) {
  const server = coap.createServer({ type: 'udp6', piggybackReplyMs: 50 });
  server.on('request', (req: any, res: any) => {
    try { handle(req, res); } catch (e) { console.warn('coap:', e); res.code = '5.00'; res.end(); }
  });
  const handle = (req: any, res: any) => {
    if (req.method !== 'GET') { res.code = '4.05'; return res.end(); }
    const accept = req.headers.Accept as string | undefined;
    const url = new URL(req.url || '/', 'coap://x');

    if (url.pathname === '/.well-known/core') {
      res.setOption('Content-Format', LINK);
      return res.end(Buffer.from(wellKnownCore(app)));
    }
    if (url.pathname === '/api/stats') {
      if (accept && accept !== JSON_CF) { res.code = '4.06'; return res.end(); }
      res.setOption('Content-Format', JSON_CF);
      if (req.headers.Observe !== 0) return res.end(Buffer.from(statsJson()));
      res.write(Buffer.from(statsJson()));
      const t = setInterval(() => res.write(Buffer.from(statsJson())), observeEvery);
      res.on('finish', () => clearInterval(t));
      return;
    }
    if (accept && accept !== TEXT) { res.code = '4.06'; return res.end(); }

    // CoAP has no redirects: follow them here (same as HTTP/0.9).
    let reply = app.respond({ path: url.pathname + url.search, protocol: 'coap', client: req.rsinfo?.address });
    if (reply.status === 301) reply = app.respond({ path: reply.headers.location!, protocol: 'coap', client: req.rsinfo?.address });
    res.code = reply.status === 200 ? '2.05' : '4.04';
    res.setOption('Content-Format', TEXT);
    res.setOption('Max-Age', 60);
    // A Buffer, not a string: node-coap decides on Block2 by .length, which for a
    // string counts UTF-16 units and lets multi-byte Japanese overflow a datagram.
    res.end(Buffer.from(reply.body));
  };
  return server;
}
