// HTTP/0.9: the request is a single line `GET /path`, the response is the bare
// body with no status line or headers, and closing the connection ends it.
// In production caddy-l4 forwards only such requests here, prefixed with a PROXY
// protocol header so the counter still sees the client's address.
import net from 'node:net';
import type { App } from './app.ts';

const MAX_LINE = 8192;
const V2_SIG = Buffer.from([0x0d, 0x0a, 0x0d, 0x0a, 0x00, 0x0d, 0x0a, 0x51, 0x55, 0x49, 0x54, 0x0a]);

/** Strips a PROXY protocol v1/v2 header. Returns the client address and the rest, or null if incomplete. */
export function parseProxy(buf: Buffer): { client?: string; rest: Buffer } | null {
  if (buf.length >= 12 && buf.subarray(0, 12).equals(V2_SIG)) {
    if (buf.length < 16) return null;
    const len = buf.readUInt16BE(14);
    if (buf.length < 16 + len) return null;
    const fam = buf[13]! >> 4;
    let client: string | undefined;
    if (fam === 1 && len >= 12) client = [...buf.subarray(16, 20)].join('.');
    if (fam === 2 && len >= 36) client = net.isIPv6(fmt6(buf.subarray(16, 32))) ? fmt6(buf.subarray(16, 32)) : undefined;
    return { client, rest: buf.subarray(16 + len) };
  }
  if (buf.subarray(0, 6).toString('latin1') === 'PROXY ') {
    const end = buf.indexOf('\r\n');
    if (end < 0) return buf.length > 107 ? { rest: buf } : null;
    const parts = buf.subarray(0, end).toString('latin1').split(' ');
    return { client: parts[2], rest: buf.subarray(end + 2) };
  }
  return { rest: buf };
}

const fmt6 = (b: Buffer) => Array.from({ length: 8 }, (_, i) => b.readUInt16BE(i * 2).toString(16)).join(':');

export function http09Server(app: App): net.Server {
  return net.createServer((sock) => {
    sock.setTimeout(10_000, () => sock.destroy());
    let buf: Buffer = Buffer.alloc(0);
    let client = sock.remoteAddress;
    let proxyDone = false;
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!proxyDone) {
        const p = parseProxy(buf);
        if (!p) return;
        proxyDone = true;
        client = p.client ?? client;
        buf = p.rest;
      }
      const nl = buf.indexOf(0x0a);
      if (nl < 0) {
        if (buf.length > MAX_LINE) sock.destroy();
        return;
      }
      sock.removeAllListeners('data');
      const line = buf.subarray(0, nl).toString('latin1').replace(/\r$/, '');
      const m = /^GET (\/\S*)$/.exec(line);
      if (!m) { sock.end(); return; }
      // No headers in 0.9: no user agent, so never the 3D page.
      const reply = app.respond({ path: m[1]!, protocol: 'http/0.9', client });
      sock.end(reply.status === 301 ? app.respond({ path: reply.headers.location!, protocol: 'http/0.9', client }).body : reply.body);
    });
    sock.on('error', () => {});
  });
}
