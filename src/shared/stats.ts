// Live numbers rendered into pages at serve time. The same functions run in the
// server and in the service worker, so an offline page shows the last known values.
import type { Stats } from './types.ts';

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

function rows(s: Stats | undefined, full: boolean): Row[] {
  const out: Row[] = [
    ['このサイトの訪問数', n(s?.views), 'views'],
    ['とんペディアのユーザー', n(s?.tompedia?.total, '人'), 'tompedia'],
    ['Mosimo の投稿', n(s?.mosimo?.posts, '件'), 'mosimo'],
  ];
  for (const node of s?.cluster?.nodes ?? []) {
    out.push([`${node.name} の CPU`, pct(node.cpu), `cpu:${node.name}`]);
    out.push([`${node.name} のメモリ`, `${bytes(node.memory.used)} / ${bytes(node.memory.total)}`, `mem:${node.name}`]);
    if (full) {
      out.push([`${node.name} の通信`, `↓${bytes(node.rx)}/s ↑${bytes(node.tx)}/s`, `net:${node.name}`]);
      out.push([`${node.name} のコンテナ`, n(node.containers.length, '個'), `ctr:${node.name}`]);
      out.push([`${node.name} の稼働時間`, dur(node.uptime), `up:${node.name}`]);
    }
  }
  return out;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&${({ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' } as const)[c as '&']};`);

export function statsMarkdown(s: Stats | undefined, mode: string): string {
  const r = rows(s, mode === 'full');
  const when = s?.at ? `\n\n${new Date(s.at).toISOString()} 時点` : '';
  return `| 項目 | 値 |\n|---|---|\n${r.map(([l, v]) => `| ${l} | ${v} |`).join('\n')}${when}`;
}

export function statsHtml(s: Stats | undefined, mode: string): string {
  const r = rows(s, mode === 'full');
  return `<dl class="stats" data-stats="${mode}">${r
    .map(([l, v, k]) => `<div><dt>${esc(l)}</dt><dd data-k="${esc(k)}">${esc(v)}</dd></div>`)
    .join('')}</dl>`;
}

const SLOT = /<!--@stats:(\w+)-->/g;
export const fillStatsMd = (md: string, s?: Stats) => md.replace(SLOT, (_, m) => statsMarkdown(s, m));
export const fillStatsHtml = (html: string, s?: Stats) => html.replace(SLOT, (_, m) => statsHtml(s, m));
