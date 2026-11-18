// Gopher (RFC 1436, TCP 70). The root and /works, /blog are menus; every page is a
// text document: its Markdown, which reads fine as plain text.
import net from 'node:net';
import type { App } from './app.ts';

const CRLF = '\r\n';

export function gopherServer(app: App, host: string, port: number): net.Server {
  return net.createServer((sock) => {
    sock.setTimeout(10_000, () => sock.destroy());
    let buf = '';
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      const nl = buf.indexOf('\n');
      if (nl < 0) { if (buf.length > 1024) sock.destroy(); return; }
      sock.removeAllListeners('data');
      try { sock.end(handle(app, buf.slice(0, nl).replace(/\r$/, '').split('\t')[0]!, host, port, sock.remoteAddress)); }
      catch (e) { console.warn('gopher:', e); sock.end(`3error\t\terror.host\t1\r\n.\r\n`); }
    });
    sock.on('error', () => {});
  });
}

const item = (type: string, text: string, selector: string, host: string, port: number) =>
  `${type}${text.replace(/[\t\r\n]/g, ' ')}\t${selector}\t${host}\t${port}${CRLF}`;
const info = (text: string) => item('i', text, '', 'error.host', 1);

export function handle(app: App, selector: string, host: string, port: number, client?: string): string {
  const sel = selector.trim() || '/';
  const menu = (title: string, rows: string[]) => info(title) + info('') + rows.join('') + `.${CRLF}`;
  if (sel === '/') {
    return menu('oriom.dev', [
      item('0', 'プロフィール', '/index', host, port),
      item('1', '実績', '/works', host, port),
      ...(app.list('/blog').length ? [item('1', '記事', '/blog', host, port)] : []),
      item('0', 'クラスタ', '/stats', host, port),
      info(''),
      item('h', 'https://oriom.dev/', 'URL:https://oriom.dev/', host, port),
      item('h', 'gemini://oriom.dev/', 'URL:gemini://oriom.dev/', host, port),
    ]);
  }
  if (sel === '/works' || sel === '/blog') {
    const rows = app.list(sel).map((p) => item('0', p.title, p.path, host, port));
    return menu(sel === '/works' ? '実績' : '記事', [...rows, info(''), item('1', 'oriom.dev', '/', host, port)]);
  }
  const r = app.markdown(sel === '/index' ? '/index.md' : sel, client, 'gopher');
  if (r.status === 301) return handle(app, r.location, host, port, client);
  if (r.status === 404) return item('3', '見つかりません', '', 'error.host', 1) + `.${CRLF}`;
  // RFC 1436 text: CRLF lines, a lone "." ends it, so lines starting with "." are doubled
  return r.body.split('\n').map((l) => (l.startsWith('.') ? `.${l}` : l)).join(CRLF) + `${CRLF}.${CRLF}`;
}
