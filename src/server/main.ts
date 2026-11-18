import http from 'node:http';
import { App, type Req } from './app.ts';
import { Counter } from './counter.ts';
import { http09Server } from './http09.ts';
import { startStats } from './stats.ts';

const env = process.env;
const [host, port] = (env.LISTEN ?? '127.0.0.1:8080').split(/:(?=\d+$)/) as [string, string];
const counter = new Counter(env.STATE_DIR ? `${env.STATE_DIR}/counter.json` : undefined);
const stats = startStats(counter, { agentSocket: env.CLUSTER_AGENT_SOCKET });
const app = new App(counter, stats);
if (env.NODE_ENV === 'development') app.watch();

// Behind Caddy: trust X-Forwarded-For only from loopback.
const clientOf = (req: http.IncomingMessage) => {
  const remote = req.socket.remoteAddress ?? '';
  const fwd = req.headers['x-forwarded-for'];
  return /^(::ffff:)?127\.|^::1$/.test(remote) && typeof fwd === 'string' ? fwd.split(',')[0]!.trim() : remote;
};

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
    protocol: 'http',
  };
  const reply = app.respond(r);
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
