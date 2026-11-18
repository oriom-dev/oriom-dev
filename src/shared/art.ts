// One-stroke line art (content/art/*.json, made by tools/lineart.py).
// Points are on a 0..1000 grid across the box width, delta-encoded. A repeated
// point marks a sharp corner; everything else is a smooth Catmull-Rom curve.

export interface Art { aspect: number; p: number[]; title?: string }
export type Pt = [number, number];

export function decode(p: readonly number[]): Pt[] {
  let x = p[0]!, y = p[1]!;
  const out: Pt[] = [[x, y]];
  for (let i = 2; i < p.length; i += 2) out.push([(x += p[i]!), (y += p[i + 1]!)]);
  return out;
}

const f = (n: number) => String(Math.round(n * 10) / 10);

/**
 * Cubic Bézier segments (without the initial M) through the points, mapped by
 * (x, y) => (ox + x*s, oy + y*s). Shared by the build (static SVG) and the 1D thread.
 */
export function curve(pts: Pt[], s = 1, ox = 0, oy = 0): string {
  // split at corners (repeated points) into smooth runs
  const runs: Pt[][] = [[pts[0]!]];
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1]!, pts[i]!];
    if (a[0] === b[0] && a[1] === b[1]) runs.push([b]);
    else runs[runs.length - 1]!.push(b);
  }
  let d = '';
  for (const run of runs) {
    for (let i = 0; i < run.length - 1; i++) {
      const p0 = run[Math.max(i - 1, 0)]!, p1 = run[i]!, p2 = run[i + 1]!, p3 = run[Math.min(i + 2, run.length - 1)]!;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += `C${f(ox + c1x * s)} ${f(oy + c1y * s)} ${f(ox + c2x * s)} ${f(oy + c2y * s)} ${f(ox + p2[0] * s)} ${f(oy + p2[1] * s)}`;
    }
  }
  return d;
}

/** `data-art` attribute value: "aspect;x0,y0,dx,dy,...". */
export const artAttr = (a: Art) => `${a.aspect};${a.p.join(',')}`;
export function parseArtAttr(v: string): Art {
  const [aspect, list] = v.split(';');
  return { aspect: Number(aspect), p: list!.split(',').map(Number) };
}
