// The 2D design's map: works as nodes in time order (columns = years), with an edge
// from each work to the next one that uses the same technology. Layout is computed
// here so the page needs no JavaScript to show it.
import type { Work } from '../shared/types.ts';
import { esc, figure } from './render.ts';

export const NODE_W = 248, NODE_H = 168, COL_GAP = 150, ROW_GAP = 56, TOP = 96, LEFT = 40;

export interface GNode { work: Work; col: number; row: number; x: number; y: number }
export interface GEdge { from: string; to: string; labels: string[] }
export interface Graph { nodes: GNode[]; edges: GEdge[]; width: number; height: number; years: { year: string; x: number }[] }

const yearOf = (w: Work) => (w.date ?? '2025').slice(0, 4);

export function layout(works: Work[]): Graph {
  const ws = [...works].sort((a, b) => (a.date ?? '2025-06').localeCompare(b.date ?? '2025-06'));
  const edgeMap = new Map<string, GEdge>();
  const lastByTech = new Map<string, Work>();
  for (const w of ws) {
    for (const t of new Set([...w.tech])) {
      const prev = lastByTech.get(t);
      if (prev) {
        const key = `${prev.slug}>${w.slug}`;
        const e = edgeMap.get(key) ?? { from: prev.slug, to: w.slug, labels: [] };
        e.labels.push(t);
        edgeMap.set(key, e);
      }
      lastByTech.set(t, w);
    }
  }
  const edges = [...edgeMap.values()];
  const years = [...new Set(ws.map(yearOf))].sort();
  const cols = years.map((y) => ws.filter((w) => yearOf(w) === y));
  // order each column by the mean row of its predecessors (two sweeps)
  const row = new Map<string, number>();
  cols.forEach((c) => c.forEach((w, i) => row.set(w.slug, i)));
  for (let sweep = 0; sweep < 4; sweep++) {
    for (const c of sweep % 2 ? [...cols].reverse() : cols) {
      const score = (w: Work) => {
        const nb = edges.filter((e) => e.to === w.slug || e.from === w.slug).map((e) => row.get(e.to === w.slug ? e.from : e.to)!);
        return nb.length ? nb.reduce((a, b) => a + b, 0) / nb.length : row.get(w.slug)!;
      };
      c.sort((a, b) => score(a) - score(b)).forEach((w, i) => row.set(w.slug, i));
    }
  }
  const maxRows = Math.max(...cols.map((c) => c.length));
  const nodes: GNode[] = [];
  cols.forEach((c, ci) => {
    const offset = ((maxRows - c.length) * (NODE_H + ROW_GAP)) / 2; // centre short columns
    c.forEach((w, ri) => nodes.push({
      work: w, col: ci, row: ri,
      x: LEFT + ci * (NODE_W + COL_GAP),
      y: TOP + offset + ri * (NODE_H + ROW_GAP),
    }));
  });
  return {
    nodes, edges,
    width: LEFT * 2 + cols.length * NODE_W + (cols.length - 1) * COL_GAP,
    height: TOP + maxRows * (NODE_H + ROW_GAP) + 40,
    years: years.map((year, i) => ({ year, x: LEFT + i * (NODE_W + COL_GAP) })),
  };
}

/** Static HTML+SVG of the map, embedded in the 2D template. */
export function graphHtml(g: Graph): string {
  const at = new Map(g.nodes.map((n) => [n.work.slug, n]));
  const paths = g.edges.map((e) => {
    const a = at.get(e.from)!, b = at.get(e.to)!;
    let d: string, lx: number, ly: number;
    if (a.col === b.col) { // same year: down the right side
      const x = a.x + NODE_W, y1 = a.y + NODE_H / 2, y2 = b.y + NODE_H / 2, bulge = 60 + Math.abs(b.row - a.row) * 20;
      d = `M${x} ${y1}C${x + bulge} ${y1} ${x + bulge} ${y2} ${x} ${y2}`;
      lx = x + bulge * 0.75; ly = (y1 + y2) / 2;
    } else {
      const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2, x2 = b.x, y2 = b.y + NODE_H / 2, k = Math.max(60, (x2 - x1) * 0.5);
      d = `M${x1} ${y1}C${x1 + k} ${y1} ${x2 - k} ${y2} ${x2} ${y2}`;
      lx = (x1 + x2) / 2; ly = (y1 + y2) / 2;
    }
    return `<g data-from="${e.from}" data-to="${e.to}"><path d="${d}"/><text x="${lx}" y="${ly - 6}">${esc(e.labels.join(' · '))}</text></g>`;
  }).join('');
  const nodes = g.nodes.map((n) => {
    const w = n.work;
    return `<a class="node" id="n-${w.slug}" href="/works/${w.slug}" style="left:${n.x}px;top:${n.y}px">`
      + (w.art ? figure(w.art, w.art.title ?? w.title) : '')
      + `<b>${esc(w.title)}</b><small>${w.date ?? ''}${w.awards.length ? `・受賞 ${w.awards.length}` : ''}</small></a>`;
  }).join('');
  const years = g.years.map((y) => `<span class="year" style="left:${y.x}px">${y.year}</span>`).join('');
  return `<section class="map" aria-label="実績の地図：時間は左から右へ、線は同じ技術でつながる実績" style="width:${g.width}px;height:${g.height}px">`
    + `<svg class="edges" width="${g.width}" height="${g.height}" aria-hidden="true">${paths}</svg>${years}${nodes}</section>`;
}
