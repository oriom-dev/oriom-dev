// A stand-in for the cluster dashboard agent (/v1/cluster on a Unix socket), for seeing
// the header meters, the cluster popup and the 3D lamps without the real cluster:
//   [FAKE_NODES=3] node tools/fake-agent.ts /tmp/agent.sock &
//   CLUSTER_AGENT_SOCKET=/tmp/agent.sock npm run dev
import http from 'node:http';
import { rmSync } from 'node:fs';

const sock = process.argv[2] ?? '/tmp/oriom-fake-agent.sock';
rmSync(sock, { force: true });
let busy: number[] = [], total: number[] = [], rx: number[] = [];
// FAKE_NODES=3 adds more nodes, to see the 3D lamp rows follow the cluster
const nodes = [
  { name: 'kagoya-vps', cpus: 3, mem: 3_000_000_000, load: 0.55, used: 0.62 },
  { name: 'home-desktop', cpus: 16, mem: 32_000_000_000, load: 0.18, used: 0.35 },
  { name: 'lab-server', cpus: 64, mem: 256_000_000_000, load: 0.8, used: 0.7 },
  { name: 'raspberry-pi', cpus: 4, mem: 8_000_000_000, load: 0.3, used: 0.5 },
].slice(0, Number(process.env.FAKE_NODES ?? 2));
busy = nodes.map(() => 0); total = nodes.map(() => 0); rx = nodes.map(() => 0);
http.createServer((_, res) => {
  const now = Date.now() / 1000;
  const out = nodes.map((n, i) => {
    const l = Math.min(0.95, Math.max(0.03, n.load + (Math.random() - 0.5) * 0.2));
    total[i]! += 100; busy[i]! += 100 * l; rx[i]! += 2e6 * Math.random();
    return {
      name: n.name, ok: true,
      data: {
        at: now, system: { cpus: n.cpus, load: [l * n.cpus, 1, 1], uptime: 864000 + now % 1000 },
        cpu: { busy: busy[i], total: total[i] },
        memory: { total: n.mem, available: n.mem * (1 - n.used) },
        interfaces: { eth0: { rx: rx[i], tx: rx[i]! / 3 } },
        containers: ['caddy', 'oriom-dev', 'mosimo-pds', 'happyview'].slice(0, i ? 2 : 4).map((c, k) => ({ id: `${c}${k}`, name: c, state: 'running', cpu_usec: busy[i]! * 1e4 * (k + 1), memory: 1e8 * (k + 1) })),
      },
    };
  });
  res.end(JSON.stringify({ collector: 'fake', nodes: out }));
}).listen(sock, () => console.log(`fake agent on ${sock}`));
