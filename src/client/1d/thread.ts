// The 1D page draws every non-text mark as ONE continuous Bézier path. It runs down
// the margins ("lanes") and only enters the column through empty space: the gaps
// between blocks, under headings, around tables, and through line drawings. It never
// crosses a line of text.
import { curve, decode, parseArtAttr, type Pt } from '../../shared/art.ts';

const K = 0.5523; // circle-ish cubic handle length
const fx = (n: number) => Math.round(n * 10) / 10;
const P = (p: Pt) => `${fx(p[0])} ${fx(p[1])}`;

class Pen {
  d = '';
  private wps: Pt[] = [];
  private R: number;
  private wander: number;
  private flip = 1;

  constructor(start: Pt, radius: number, wander: number) {
    this.d = `M${P(start)}`;
    this.wps = [start];
    this.R = radius;
    this.wander = wander;
  }

  get at(): Pt { return this.wps[this.wps.length - 1]!; }

  /** A waypoint; corners between waypoints are rounded. Long vertical runs meander. */
  to(p: Pt): this {
    const a = this.at;
    if (Math.abs(p[0] - a[0]) < 0.5 && Math.abs(p[1] - a[1]) < 0.5) return this; // a repeated point would drop its corner
    const dy = p[1] - a[1];
    if (this.wander > 2 && Math.abs(p[0] - a[0]) < 1 && Math.abs(dy) > 260) {
      const n = Math.floor(Math.abs(dy) / 200);
      for (let i = 1; i < n; i++) {
        this.wps.push([a[0] + this.flip * this.wander, a[1] + (dy * i) / n]);
        this.flip = -this.flip;
      }
    }
    this.wps.push(p);
    return this;
  }

  /** Raw path data that starts at `from` and ends at `end` (loops, line art). */
  raw(from: Pt, seg: string, end: Pt): this {
    this.to(from).flush();
    this.d += seg;
    this.wps = [end];
    return this;
  }

  flush(): void {
    const w = this.wps;
    for (let i = 1; i < w.length; i++) {
      const b = w[i]!;
      const c = w[i + 1];
      if (!c) { this.d += `L${P(b)}`; break; }
      const a = w[i - 1]!;
      const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]), l2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
      if (l1 < 0.5 || l2 < 0.5) continue;
      const r = Math.min(this.R, l1 / 2, l2 / 2);
      const p1: Pt = [b[0] + ((a[0] - b[0]) / l1) * r, b[1] + ((a[1] - b[1]) / l1) * r];
      const p2: Pt = [b[0] + ((c[0] - b[0]) / l2) * r, b[1] + ((c[1] - b[1]) / l2) * r];
      const h1: Pt = [p1[0] + (b[0] - p1[0]) * K, p1[1] + (b[1] - p1[1]) * K];
      const h2: Pt = [p2[0] + (b[0] - p2[0]) * K, p2[1] + (b[1] - p2[1]) * K];
      this.d += `L${P(p1)}C${P(h1)} ${P(h2)} ${P(p2)}`;
    }
    this.wps = [w[w.length - 1]!];
  }

  /** A small clockwise loop of radius r whose leftmost point is `at` (a bullet). */
  loop(at: Pt, r: number): this {
    const [x, y] = at, cx = x + r;
    const k = r * K;
    const seg = `C${P([x, y - k])} ${P([cx - k, y - r])} ${P([cx, y - r])}`
      + `C${P([cx + k, y - r])} ${P([cx + r, y - k])} ${P([cx + r, y])}`
      + `C${P([cx + r, y + k])} ${P([cx + k, y + r])} ${P([cx, y + r])}`
      + `C${P([cx - k, y + r])} ${P([x, y + k])} ${P([x, y])}`;
    return this.raw(at, seg, at);
  }
}

interface Box { l: number; t: number; r: number; b: number }
const box = (el: Element): Box => {
  const r = el.getBoundingClientRect();
  return { l: r.left + scrollX, t: r.top + scrollY, r: r.right + scrollX, b: r.bottom + scrollY };
};
/** First line box of an element (for bullets on multi-line items). */
const firstLine = (el: Element): Box => {
  const range = document.createRange();
  range.selectNodeContents(el);
  const r = range.getClientRects()[0] ?? el.getBoundingClientRect();
  return { l: r.left + scrollX, t: r.top + scrollY, r: r.right + scrollX, b: r.bottom + scrollY };
};

export function buildThread(): string {
  const main = document.getElementById('c')!;
  const mb = box(main);
  const cs = getComputedStyle(main);
  const L = mb.l + parseFloat(cs.paddingLeft), Rx = mb.r - parseFloat(cs.paddingRight);
  const W = document.documentElement.clientWidth;
  const margin = L; // space left of the column (same on the right)
  const g = Math.min(Math.max(margin * 0.45, 6), 72);
  const lanes = { L: L - g, R: Rx + g };
  const wander = Math.max(0, Math.min(margin - g - 8, g - 8, 28));
  let side: 'L' | 'R' = 'L';
  const lane = () => lanes[side];

  const name = document.querySelector('.top .name');
  const nb = name ? box(name) : { l: L, t: 40, r: L + 80, b: 70 };
  // Enter from the left edge, underline the site name, curl, then drop to the lane.
  const pen = new Pen([-4, nb.b + 2], 28, wander);
  pen.to([nb.r + 6, nb.b + 2]);
  const lx = nb.r + 6, ly = nb.b + 2, s = Math.min(14, (nb.b - nb.t) * 0.45);
  pen.raw([lx, ly], `C${P([lx + s * 1.6, ly])} ${P([lx + s * 1.8, ly - s * 2])} ${P([lx + s * 0.8, ly - s * 2])}`
    + `C${P([lx - s * 0.4, ly - s * 2])} ${P([lx, ly + s * 0.3])} ${P([lx + s * 2.2, ly + s * 0.6])}`, [lx + s * 2.2, ly + s * 0.6]);
  const nav = document.querySelector('.top nav');
  const navB = nav ? box(nav).b : nb.b + 30;
  // the underline carries on to the right lane: a rule between the name and the nav
  pen.to([lanes.R, ly + s * 0.6]).to([lanes.R, navB + 12]);
  void W;
  side = 'R';

  /** Cross the column in the empty gap just above `y` (between blocks). */
  const cross = (to: 'L' | 'R', y: number) => {
    if (side === to) return;
    pen.to([lane(), y]);
    side = to;
    pen.to([lane(), y]);
  };

  const sel = '#c h1,#c h2,#c figure.art,#c li,#c table,#c pre,#c dl.stats,#c blockquote,.end';
  for (const el of document.querySelectorAll(sel)) {
    const b = box(el);
    const gapAbove = parseFloat(getComputedStyle(el).marginTop) || 12;
    if (b.b - b.t < 1) continue;
    switch (el.tagName) {
      case 'H1':
      case 'H2': {
        // A rule under the heading, from one lane to the other.
        const y = b.b - 2;
        pen.to([lane(), y]);
        side = side === 'L' ? 'R' : 'L';
        pen.to([lane(), y]);
        break;
      }
      case 'FIGURE': {
        const art = parseArtAttr((el as HTMLElement).dataset.art!);
        const pts = decode(art.p);
        const sc = (b.r - b.l) / 1000;
        const first = pts[0]!, last = pts[pts.length - 1]!;
        const enter: Pt = [b.l + first[0] * sc, b.t + first[1] * sc];
        const exit: Pt = [b.l + last[0] * sc, b.t + last[1] * sc];
        const thumb = el.classList.contains('thumb');
        if (thumb) cross('L', b.t - 8);
        else cross(side, 0);
        pen.to([lane(), enter[1]]);
        if (side === 'R') {
          // come around the top of the drawing to its left edge
          pen.to([lane(), b.t - gapAbove / 2]).to([b.l - 10, b.t - gapAbove / 2]).to([b.l - 10, enter[1]]);
        }
        pen.raw(enter, curve(pts, sc, b.l, b.t), exit);
        if (thumb) {
          // down the gutter beside the text, then back to the left lane under the item
          const li = el.closest('li')!;
          const lb = box(li);
          const gx = exit[0] + 10;
          pen.to([gx, exit[1]]).to([gx, lb.b + 8]).to([lanes.L, lb.b + 8]);
          side = 'L';
        } else {
          pen.to([lanes.R, exit[1]]);
          side = 'R';
        }
        break;
      }
      case 'LI': {
        if (el.querySelector(':scope > a > figure.art')) break; // drawn by its thumbnail
        const list = el.parentElement!;
        if (list.tagName !== 'UL') break;
        if (side === 'R') cross('L', box(list).t - (parseFloat(getComputedStyle(list).marginTop) || 12) / 2 - 4);
        const fl = firstLine(el);
        const cy = (fl.t + fl.b) / 2;
        const r = Math.min(3.2, (b.l - lanes.L) / 4);
        const bx = b.l - parseFloat(getComputedStyle(list).paddingLeft) * 0.55 - r;
        pen.to([lane(), cy]).to([bx, cy]).loop([bx, cy], r).to([lane(), cy]);
        break;
      }
      case 'BLOCKQUOTE': {
        cross('L', b.t - gapAbove / 2);
        const x = b.l + 4;
        pen.to([lane(), b.t]).to([x, b.t]).to([x, b.b]).to([lane(), b.b]);
        break;
      }
      case 'TABLE':
      case 'PRE':
      case 'DL': {
        // A frame whose left side is the lane: down past the block, along the
        // bottom, up the right side, back along the top, and down the lane again.
        cross('L', b.t - gapAbove / 2);
        const o = 8, right = Math.min(b.r, Rx) + o;
        pen.to([lane(), b.t - o]).to([lane(), b.b + o]).to([right, b.b + o]).to([right, b.t - o]).to([lane(), b.t - o]).to([lane(), b.b + o]);
        break;
      }
      default: {
        // .end: a spiral where the page ends
        const y = b.t + 8;
        cross('L', y);
        const cx = Math.min(Math.max(W / 2, L + 40), W - 60), cy = b.b - 30;
        pen.to([lane(), y]).to([lane(), cy]).to([cx - 26, cy]);
        // an inward spiral, sampled and passed through the same smooth curve as the art
        const pts: Pt[] = [];
        for (let t = 0; t <= 1.0001; t += 1 / 48) {
          const ang = Math.PI + t * 5 * Math.PI, rr = 26 * (1 - t * 0.9);
          pts.push([cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr]);
        }
        const seg = curve(pts);
        const a = pts[pts.length - 1]!;
        pen.raw([cx - 26, cy], seg, a);
      }
    }
  }
  pen.flush();
  return pen.d;
}

let first = true;
export function drawThread(): void {
  const svg = document.querySelector<SVGSVGElement>('svg.thread');
  const path = svg?.querySelector('path');
  if (!svg || !path) return;
  const doc = document.documentElement;
  svg.setAttribute('width', String(doc.clientWidth));
  svg.setAttribute('height', String(doc.scrollHeight));
  path.setAttribute('d', buildThread());
  doc.classList.add('thread-on');
  if (first && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const len = path.getTotalLength();
    path.style.setProperty('--len', String(len));
    path.style.strokeDasharray = String(len);
    svg.classList.add('draw');
    path.addEventListener('animationend', () => { path.style.strokeDasharray = ''; svg.classList.remove('draw'); }, { once: true });
  }
  first = false;
}
