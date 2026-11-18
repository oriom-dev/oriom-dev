import http from 'node:http';
import { App, type Reply, type Req } from './app.ts';
import { Counter } from './counter.ts';
import { http09Server } from './http09.ts';
import { startStats } from './stats.ts';

const env = process.env;
const [host, port] = (env.LISTEN ?? '127.0.0.1:8080').split(/:(?=\d+$)/) as [string, string];
const counter = new Counter(env.STATE_DIR ? `${env.STATE_DIR}/counter.json` : undefined);
const stats = startStats(counter, { agentSocket: env.CLUSTER_AGENT_SOCKET });
const app = new App(counter, stats, undefined, env.ADMIN_PATH ?? '');
if (env.NODE_ENV === 'development') app.watch();

// Run-time pages: the site's own posts (on its PDS, written from the admin page), posts
// from followed standard.site publications, and the Bluesky replies under every post.
// Only the pages are rebuilt, never the templates.
if (env.FEEDS !== '0') {
  const { fetchFollowed } = await import('./feeds.ts');
  const { fetchOwn } = await import('./own.ts');
  const { fetchComments } = await import('./comments.ts');
  const { buildPages } = await import('../build/pages.ts');
  const { setPublication } = await import('../build/render.ts');
  const { loadStandard, loadWorks } = await import('../build/content.ts');
  let own: import('./own.ts').Own | null = null; // the last good read: a PDS hiccup keeps the posts
  const refresh = async () => {
    try { own = await fetchOwn(); } catch (e) { console.warn('own posts:', (e as Error).message); }
    const team = await fetchFollowed(loadStandard().follow);
    const posts = [...(own?.posts ?? []), ...team].sort((a, b) => b.date.localeCompare(a.date));
    const comments: import('../shared/types.ts').Comments = {};
    for (const p of posts) {
      if (!p.bsky) continue;
      try { comments[p.path] = await fetchComments(p.bsky.uri); } catch (e) { console.warn(`comments ${p.path}:`, (e as Error).message); }
    }
    setPublication(own?.publication ?? '');
    app.publication = own?.publication ?? '';
    app.setPages(buildPages(loadWorks(), posts, comments));
  };
  // one refresh at a time; a request while one runs queues exactly one more
  let running: Promise<void> | null = null, again = false;
  const tick = (): Promise<void> => {
    if (running) { again = true; return running; }
    running = refresh().catch((e) => console.warn('refresh:', e)).finally(() => {
      running = null;
      if (again) { again = false; void tick(); }
    });
    return running;
  };
  void tick();
  setInterval(tick, 10 * 60_000).unref();
  app.onRefresh = () => void tick(); // the admin page asks after it writes
}

// Behind Caddy: trust X-Forwarded-For and -Proto only from it. Directly on this machine
// that is loopback; in the container (TRUST_PROXY=1), whose port is published on the
// host's loopback only, every connection comes through the container network from Caddy.
const TRUST_PROXY = env.TRUST_PROXY === '1';
const loopback = (req: http.IncomingMessage) => TRUST_PROXY || /^(::ffff:)?127\.|^::1$/.test(req.socket.remoteAddress ?? '');
const clientOf = (req: http.IncomingMessage) => {
  const remote = req.socket.remoteAddress ?? '';
  const fwd = req.headers['x-forwarded-for'];
  return loopback(req) && typeof fwd === 'string' ? fwd.split(',')[0]!.trim() : remote;
};
/** Over TLS: Caddy says so; in development, a browser on this machine (a secure context). */
const secureOf = (req: http.IncomingMessage) =>
  loopback(req) && (req.headers['x-forwarded-proto'] === 'https' || (!TRUST_PROXY && env.NODE_ENV === 'development' && !req.headers['x-forwarded-for']));

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD', 'content-type': 'text/plain' }).end('Method Not Allowed\n');
    return;
  }
  const r: Req = {
    path: req.url ?? '/',
    method: req.method,
    userAgent: req.headers['user-agent'],
    cookie: req.headers.cookie,
    accept: req.headers.accept,
    client: clientOf(req),
    secure: secureOf(req),
    protocol: 'http',
  };
  let reply: Reply;
  try { reply = app.respond(r); }
  catch (e) { console.warn('http:', e); reply = { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' }, body: 'error\n' }; }
  const body = typeof reply.body === 'string' ? Buffer.from(reply.body) : reply.body;
  res.writeHead(reply.status, { ...reply.headers, 'content-length': body.length });
  res.end(req.method === 'HEAD' ? undefined : body);
});
server.keepAliveTimeout = 65_000;
server.listen(Number(port), host, () => console.log(`http on ${host}:${port}`));

if (env.HTTP09_LISTEN) {
  const [h, p] = env.HTTP09_LISTEN.split(/:(?=\d+$)/) as [string, string];
  http09Server(app).listen(Number(p), h, () => console.log(`http/0.9 on ${h}:${p}`));
}

if (env.COAP_PORT) {
  const { coapServer } = await import('./coap.ts');
  coapServer(app, () => JSON.stringify(stats())).listen(Number(env.COAP_PORT), () => console.log(`coap on udp/${env.COAP_PORT}`));
}

if (env.GOPHER_LISTEN) {
  const [h, p] = env.GOPHER_LISTEN.split(/:(?=\d+$)/) as [string, string];
  const { gopherServer } = await import('./gopher.ts');
  gopherServer(app, env.GOPHER_HOST ?? 'oriom.dev', Number(env.GOPHER_PORT ?? 70)).listen(Number(p), h, () => console.log(`gopher on ${h}:${p}`));
}

if (env.GEMINI_LISTEN && env.GEMINI_CERT && env.GEMINI_KEY) {
  const [h, p] = env.GEMINI_LISTEN.split(/:(?=\d+$)/) as [string, string];
  const { readFileSync } = await import('node:fs');
  const { geminiServer } = await import('./gemini.ts');
  geminiServer(app, { cert: readFileSync(env.GEMINI_CERT), key: readFileSync(env.GEMINI_KEY) }).listen(Number(p), h, () => console.log(`gemini on ${h}:${p}`));
}
