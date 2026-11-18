// Live numbers rendered into pages at serve time. The same functions run in the
// server and in the service worker, so an offline page shows the last known values.
import type { ClusterNode, Stats } from './types.ts';

const nf = new Intl.NumberFormat('ja-JP');
const n = (v: number | null | undefined, unit = '') => (v == null ? '—' : nf.format(Math.round(v)) + unit);
const pct = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(1)}%`);
export const bytes = (v: number | null | undefined) => {
  if (v == null) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (v >= 1000 && i < u.length - 1) { v /= 1000; i++; }
  return `${v < 10 && i ? v.toFixed(1) : Math.round(v)} ${u[i]}`;
};
const dur = (s: number | null) => (s == null ? '—' : s >= 86400 ? `${Math.floor(s / 86400)}日` : `${Math.floor(s / 3600)}時間`);

type Row = [label: string, value: string, key: string];

/** One number where it belongs (views, とんペディア, Mosimo), or the whole cluster ("full"). */
function rows(s: Stats | undefined, mode: string): Row[] {
  if (mode === 'views') return [['訪問', n(s?.views), 'views']];
  if (mode === 'tompedia') return [['利用者', n(s?.tompedia?.total, '人'), 'tompedia']];
  if (mode === 'mosimo') return [['投稿', n(s?.mosimo?.posts, '件'), 'mosimo']];
  return [];
}

/** What every page carries inline: a handful of numbers, no per-container data or history. */
export function compactStats(s: Stats | undefined): Stats | undefined {
  if (!s) return s;
  return {
    at: s.at, views: s.views, tompedia: s.tompedia, mosimo: s.mosimo,
    ...(s.cluster ? { cluster: { nodes: s.cluster.nodes.map((x) => ({ name: x.name, cpu: x.cpu, memory: x.memory } as ClusterNode)) } } : {}),
  };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&${({ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' } as const)[c as '&']};`);

const nodeFacts = (x: ClusterNode): [string, string][] => [
  ['CPU', pct(x.cpu)],
  ['メモリ', `${bytes(x.memory.used)} / ${bytes(x.memory.total)}`],
  ['通信', `↓${bytes(x.rx)}/s ↑${bytes(x.tx)}/s`],
  ['稼働', dur(x.uptime)],
];

export function statsMarkdown(s: Stats | undefined, mode: string): string {
  if (mode !== 'full') return rows(s, mode).map(([l, v]) => `${l} ${v}`).join('');
  const nodes = s?.cluster?.nodes ?? [];
  if (!nodes.length) return '_データなし_';
  return nodes.map((x) => `### ${x.name}\n\n${nodeFacts(x).map(([k, v]) => `- ${k} ${v}`).join('\n')}\n\n`
    + (x.containers ?? []).map((c) => `- ${c.name}：CPU ${c.cpu == null ? '—' : `${(c.cpu * 100).toFixed(1)}%`}・${bytes(c.memory)}`).join('\n')).join('\n\n');
}

/** The cluster popup: a block per node, then its running containers as bars. */
function clusterHtml(s: Stats | undefined): string {
  const nodes = s?.cluster?.nodes ?? [];
  if (!nodes.length) return '<div class="cluster" data-stats="full"><p>データなし</p></div>';
  return `<div class="cluster" data-stats="full">${nodes.map((x) => {
    const maxMem = Math.max(1, ...(x.containers ?? []).map((c) => c.memory ?? 0));
    return `<section><h3>${esc(x.name)}</h3><dl>${nodeFacts(x).map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`
      + `<ul class="ctr">${(x.containers ?? []).map((c) => `<li><span>${esc(c.name)}</span>`
        + `<i class="c" style="--v:${Math.min(100, (c.cpu ?? 0) * 100).toFixed(0)}%" title="CPU"></i>`
        + `<i class="m" style="--v:${((100 * (c.memory ?? 0)) / maxMem).toFixed(0)}%" title="メモリ"></i>`
        + `<small>${c.cpu == null ? '—' : `${(c.cpu * 100).toFixed(1)}%`} · ${bytes(c.memory)}</small></li>`).join('')}</ul></section>`;
  }).join('')}</div>`;
}

/** The header's resource meters: CPU and memory of each node as small bars. */
function metersHtml(s: Stats | undefined): string {
  const nodes = s?.cluster?.nodes ?? [];
  const bar = (k: string, label: string, v: number | null) =>
    `<dd data-k="${esc(k)}"><span class="lbl">${label}</span><i style="--v:${v == null ? 0 : Math.max(2, Math.min(100, v)).toFixed(0)}%"></i></dd>`;
  return `<dl class="stats meters" data-stats="meters">${nodes.map((n) => {
    const mem = n.memory.total ? (100 * n.memory.used) / n.memory.total : null;
    const short = esc(n.name.split('-').pop() ?? n.name);
    return `<div title="${esc(n.name)} CPU ${pct(n.cpu)} メモリ ${pct(mem)}"><dt>${short}</dt>${bar(`cpu:${n.name}`, 'CPU', n.cpu)}${bar(`mem:${n.name}`, 'MEM', mem)}</div>`;
  }).join('')}</dl>`;
}

export function statsHtml(s: Stats | undefined, mode: string): string {
  if (mode === 'meters') return metersHtml(s);
  if (mode === 'full') return clusterHtml(s);
  const r = rows(s, mode);
  return `<dl class="stats" data-stats="${mode}">${r
    .map(([l, v, k]) => `<div><dt>${esc(l)}</dt><dd data-k="${esc(k)}">${esc(v)}</dd></div>`)
    .join('')}</dl>`;
}

const SLOT = /<!--@stats:(\w+)-->/g;
export const fillStatsMd = (md: string, s?: Stats) => md.replace(SLOT, (_, m) => statsMarkdown(s, m));
export const fillStatsHtml = (html: string, s?: Stats) => html.replace(SLOT, (_, m) => statsHtml(s, m));
