// A stand-in for the cluster dashboard agent (/v1/cluster on a Unix socket), for seeing
// the header meters, the cluster popup and the 3D lamps without the real cluster:
//   node tools/fake-agent.ts /tmp/agent.sock &
//   CLUSTER_AGENT_SOCKET=/tmp/agent.sock npm run dev
import http from 'node:http';
import { rmSync } from 'node:fs';

const sock = process.argv[2] ?? '/tmp/oriom-fake-agent.sock';
rmSync(sock, { force: true });
let busy = [0, 0], total = [0, 0], rx = [0, 0];
const nodes = [
  { name: 'kagoya-vps', cpus: 3, mem: 3_000_000_000, load: 0.55, used: 0.62 },
  { name: 'home-desktop', cpus: 16, mem: 32_000_000_000, load: 0.18, used: 0.35 },
];
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
