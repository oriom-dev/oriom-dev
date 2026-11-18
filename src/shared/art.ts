// Line art (content/art/*.json, made by tools/lineart.py): a few smooth strokes on a
// 0..1000 grid across the box width, delta-encoded, "c" marking closed ones, each
// drawn as a Catmull-Rom curve.

export interface Art { aspect: number; s: number[][]; c: number[]; title?: string }
export type Pt = [number, number];
interface Stroke { pts: Pt[]; closed: boolean }

function decode(p: readonly number[]): Pt[] {
  let x = p[0]!, y = p[1]!;
  const out: Pt[] = [[x, y]];
  for (let i = 2; i < p.length; i += 2) out.push([(x += p[i]!), (y += p[i + 1]!)]);
  return out;
}

export const strokes = (a: Art): Stroke[] => a.s.map((p, i) => ({ pts: decode(p), closed: a.c[i] === 1 }));

const f = (n: number) => String(Math.round(n * 10) / 10);
type Map = (p: Pt) => Pt;

/** Catmull-Rom through the points as cubic segments (no leading M). */
export function cr(pts: Pt[], closed: boolean, m: Map = (p) => p): string {
  const n = pts.length;
  const at = (i: number) => (closed ? pts[(i + n) % n]! : pts[Math.max(0, Math.min(n - 1, i))]!);
  let d = '';
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const c1 = m([p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]);
    const c2 = m([p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]);
    const e = m(p2);
    d += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(e[0])} ${f(e[1])}`;
  }
  return d;
}

const mapper = (s: number, ox: number, oy: number): Map => ([x, y]) => [ox + x * s, oy + y * s];

/** Every stroke on its own (2D, 3D, static SVG). */
export function separatePath(a: Art, s = 1, ox = 0, oy = 0): string {
  const m = mapper(s, ox, oy);
  return strokes(a).map(({ pts, closed }) => {
    const p = m(pts[0]!);
    return `M${f(p[0])} ${f(p[1])}${cr(pts, closed, m)}`;
  }).join('');
}

/** `data-art` attribute: "aspect;closed flags;stroke|stroke" with comma-separated numbers. */
export const artAttr = (a: Art) => `${a.aspect};${a.c.join('')};${a.s.map((p) => p.join(',')).join('|')}`;
export function parseArtAttr(v: string): Art {
  const [aspect, c, s] = v.split(';');
  return { aspect: Number(aspect), c: [...c!].map(Number), s: s!.split('|').map((p) => p.split(',').map(Number)) };
}
