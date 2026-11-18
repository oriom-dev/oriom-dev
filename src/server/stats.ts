// Collects the live numbers. Every source is optional: a failing source keeps its
// last good value, and a missing one is simply left out of the page.
import http from 'node:http';
import type { ClusterNode, Stats } from '../shared/types.ts';
import type { Counter } from './counter.ts';

const UA = 'oriom.dev-stats (+https://oriom.dev)';
const HISTORY = 90; // samples kept per series (15 min at 10 s)

async function getJson(url: string): Promise<any> {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

/** とんペディア's public user count, the same API info.tompedia.jp uses. */
export async function tompedia(): Promise<Stats['tompedia']> {
  const j = await getJson('https://www.tompedia.jp/api/public/user');
  return {
    total: Number(j.data.total),
    byYear: (j.data.counts as any[]).map((c) => ({ year: Number(c.entryYear), count: Number(c.count) })),
  };
}

/** Mosimo posts on the Oriom PDS: no count endpoint exists, so page through every repo. */
export async function mosimo(pds = 'https://pds.oriom.dev'): Promise<Stats['mosimo']> {
  const dids: string[] = [];
  let cursor = '';
  do {
    const j = await getJson(`${pds}/xrpc/com.atproto.sync.listRepos?limit=1000${cursor && `&cursor=${encodeURIComponent(cursor)}`}`);
    dids.push(...j.repos.filter((r: any) => r.active !== false).map((r: any) => r.did));
    cursor = j.cursor ?? '';
  } while (cursor);
  let posts = 0, authors = 0;
  for (const did of dids) {
    let n = 0, c = '';
    do {
      const j = await getJson(`${pds}/xrpc/com.atproto.repo.listRecords?repo=${did}&collection=dev.jisaku.mosimo.post&limit=100${c && `&cursor=${encodeURIComponent(c)}`}`);
      n += j.records.length;
      c = j.records.length === 100 ? (j.cursor ?? '') : '';
    } while (c);
    posts += n;
    if (n) authors++;
  }
  return { posts, authors };
}

function agentRequest(socketPath: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.get({ socketPath, path: '/v1/cluster', timeout: 60_000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`agent HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('agent timeout')));
    req.on('error', reject);
  });
}

const rate = (cur?: number, prev?: number, dt?: number) =>
  cur == null || prev == null || !dt || dt <= 0 || cur < prev ? null : (cur - prev) / dt;
const round = (v: number | null, d = 2) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

/** Turns the cluster agent's cumulative counters into the public, allowlisted view. */
export class ClusterView {
  private prev = new Map<string, { at: number; data: any }>();
  private hist = new Map<string, { cpu: (number | null)[]; mem: (number | null)[] }>();

  update(raw: any): ClusterNode[] {
    const out: ClusterNode[] = [];
    for (const node of raw.nodes ?? []) {
      const data = node.data;
      if (!node.ok || !data) continue;
      const name = String(node.name);
      const at = Number(data.at);
      const p = this.prev.get(name);
      this.prev.set(name, { at, data });
      const dt = p ? at - p.at : 0;
      let cpu: number | null = null;
      if (p) {
        const busy = rate(data.cpu.busy, p.data.cpu.busy, 1), total = rate(data.cpu.total, p.data.cpu.total, 1);
        cpu = busy != null && total ? (100 * busy) / total : null;
      }
      let rx: number | null = null, tx: number | null = null;
      for (const [ifname, c] of Object.entries<any>(data.interfaces ?? {})) {
        const o = p?.data.interfaces?.[ifname];
        const r = rate(c.rx, o?.rx, dt), t = rate(c.tx, o?.tx, dt);
        if (r != null) { rx = (rx ?? 0) + r; tx = (tx ?? 0) + (t ?? 0); }
      }
      const prevCtr = new Map<string, any>((p?.data.containers ?? []).map((c: any) => [c.id, c]));
      const containers = (data.containers ?? [])
        .filter((c: any) => c.state === 'running')
        .map((c: any) => {
          const r = rate(c.cpu_usec, prevCtr.get(c.id)?.cpu_usec, dt);
          return { name: String(c.name), cpu: round(r == null ? null : r / 1e6, 3), memory: c.memory ?? null };
        });
      const used = data.memory.total - data.memory.available;
      const h = this.hist.get(name) ?? { cpu: [], mem: [] };
      h.cpu.push(round(cpu, 1));
      h.mem.push(round(data.memory.total ? (100 * used) / data.memory.total : null, 1));
      if (h.cpu.length > HISTORY) { h.cpu.shift(); h.mem.shift(); }
      this.hist.set(name, h);
      out.push({
        name,
        cpus: Number(data.system?.cpus ?? 1),
        load: (data.system?.load ?? []).map(Number),
        cpu: round(cpu, 1),
        memory: { used, total: data.memory.total },
        rx: round(rx, 0), tx: round(tx, 0),
        uptime: data.system?.uptime ?? null,
        containers,
        history: { cpu: [...h.cpu], mem: [...h.mem] },
      });
    }
    return out;
  }
}

type Source = { every: number; run: () => Promise<void> };

/** Starts the pollers and returns a getter for the current snapshot. */
export function startStats(counter: Counter, opts: { agentSocket?: string } = {}): () => Stats {
  const s: Stats = { at: new Date().toISOString() };
  const view = new ClusterView();
  const sources: Source[] = [
    { every: 5 * 60_000, run: async () => { s.tompedia = await tompedia(); } },
    { every: 10 * 60_000, run: async () => { s.mosimo = await mosimo(); } },
  ];
  if (opts.agentSocket) {
    const sock = opts.agentSocket;
    sources.push({ every: 10_000, run: async () => { s.cluster = { nodes: view.update(await agentRequest(sock)) }; } });
  }
  for (const src of sources) {
    const tick = () => src.run().catch((e) => console.warn(`stats: ${e.message ?? e}`));
    tick();
    setInterval(tick, src.every).unref();
  }
  return () => ({ ...s, views: counter.total(), at: new Date().toISOString() });
}
