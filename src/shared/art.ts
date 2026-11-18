// Line art (content/art/*.json, made by tools/lineart.py): a few smooth strokes on a
// 0..1000 grid across the box width, delta-encoded, "c" marking closed ones, each
// drawn as a Catmull-Rom curve.

/** d: an SVG path on a 0..1000 grid (M/L/C/Z, integers: Bézier curves fitted to the
 *  outlines), r: exact rounded rectangles [x, y, w, h, radius] (a circle is a square
 *  with radius w/2). */
export interface Art { aspect: number; d: string; r?: number[][]; title?: string }
export type Pt = [number, number];

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


const K = 0.5523;
/** A rounded rectangle as 4 lines and 4 cubic arcs: exact, and 5 numbers to store. */
function rrect([x, y, w, h, r]: number[], s: number, ox: number, oy: number): string {
  const X = (v: number) => f(ox + v * s), Y = (v: number) => f(oy + v * s);
  const R = r!, k = R * K, x2 = x! + w!, y2 = y! + h!;
  return `M${X(x! + R)} ${Y(y!)}H${X(x2 - R)}C${X(x2 - R + k)} ${Y(y!)} ${X(x2)} ${Y(y! + R - k)} ${X(x2)} ${Y(y! + R)}`
    + `V${Y(y2 - R)}C${X(x2)} ${Y(y2 - R + k)} ${X(x2 - R + k)} ${Y(y2)} ${X(x2 - R)} ${Y(y2)}`
    + `H${X(x! + R)}C${X(x! + R - k)} ${Y(y2)} ${X(x!)} ${Y(y2 - R + k)} ${X(x!)} ${Y(y2 - R)}`
    + `V${Y(y! + R)}C${X(x!)} ${Y(y! + R - k)} ${X(x! + R - k)} ${Y(y!)} ${X(x! + R)} ${Y(y!)}Z`;
}

/** The drawing as a path, scaled by s and moved to (ox, oy) (2D, 3D, static SVG). */
export function separatePath(a: Art, s = 1, ox = 0, oy = 0): string {
  // absolute M moves (scale and offset); relative c/l/z (scale only)
  const d = a.d.replace(/([MmLlCcZz])([^MmLlCcZz]*)/g, (_, cmd: string, args: string) => {
    const ns = args.match(/-?\d+(?:\.\d+)?/g) ?? [];
    const abs = cmd === 'M' || cmd === 'L' || cmd === 'C';
    return cmd + ns.map((n, i) => f(Number(n) * s + (abs ? (i % 2 ? oy : ox) : 0))).join(' ');
  });
  return d + (a.r ?? []).map((r) => rrect(r, s, ox, oy)).join('');
}

/** `data-art` attribute: "aspect;closed flags;stroke|stroke" with comma-separated numbers. */
export const artAttr = (a: Art) => `${a.aspect};${a.d};${(a.r ?? []).map((r) => r.join(',')).join('|')}`;
export function parseArtAttr(v: string): Art {
  const [aspect, d, r] = v.split(';');
  return { aspect: Number(aspect), d: d ?? '', ...(r ? { r: r.split('|').map((p) => p.split(',').map(Number)) } : {}) };
}
