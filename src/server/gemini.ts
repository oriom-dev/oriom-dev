// Gemini (gemini://, TCP 1965, TLS). A self-signed certificate is the norm here:
// clients pin it on first use (TOFU).
import tls from 'node:tls';
import type { App } from './app.ts';
import { gemtext } from './gemtext.ts';

export function geminiServer(app: App, opts: { key: Buffer; cert: Buffer }): tls.Server {
  return tls.createServer({ ...opts, minVersion: 'TLSv1.2' }, (sock) => {
    sock.setTimeout(10_000, () => sock.destroy());
    let buf = '';
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      const end = buf.indexOf('\r\n');
      if (end < 0) {
        if (buf.length > 1026) sock.end('59 request too long\r\n');
        return;
      }
      sock.removeAllListeners('data');
      sock.end(handle(app, buf.slice(0, end), sock.remoteAddress));
    });
    sock.on('error', () => {});
  });
}

export function handle(app: App, line: string, client?: string): string {
  let url: URL;
  try { url = new URL(line); } catch { return '59 bad request\r\n'; }
  if (url.protocol !== 'gemini:') return '53 proxy request refused\r\n';
  const path = decodeURIComponent(url.pathname) || '/';
  if (path === '/api/stats') return `20 application/json\r\n${app.statsJson()}`;
  const r = app.markdown(path, client, 'gemini');
  if (r.status === 301) return `31 ${r.location}\r\n`;
  if (r.status === 404) return '51 見つかりません\r\n';
  return `20 text/gemini; charset=utf-8; lang=ja\r\n${gemtext(r.body)}`;
}
