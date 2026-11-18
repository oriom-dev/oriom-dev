// The popup (the "1D" design) draws its marks as ONE continuous Bézier path. It runs
// down the margins ("lanes") and only enters the column through empty space: the gaps
// between blocks and under headings. It never crosses a line of text. Line drawings
// are shown as they are, not woven into the path.
import { cr, type Pt } from '../../shared/art.ts';

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
// coordinates relative to the popup's inner box (which scrolls with its content)
let origin = { x: 0, y: 0 };
const rel = (r: DOMRect | DOMRectReadOnly): Box => ({ l: r.left - origin.x, t: r.top - origin.y, r: r.right - origin.x, b: r.bottom - origin.y });
const box = (el: Element): Box => rel(el.getBoundingClientRect());
/** First line box of an element (for bullets on multi-line items). */
const firstLine = (el: Element): Box => {
  const range = document.createRange();
  range.selectNodeContents(el);
  return rel(range.getClientRects()[0] ?? el.getBoundingClientRect());
};

export function buildThread(root: HTMLElement): string {
  const ro = root.getBoundingClientRect();
  origin = { x: ro.left, y: ro.top };
  const main = root.querySelector<HTMLElement>('#c')!;
  const mb = box(main);
  const cs = getComputedStyle(main);
  const L = mb.l + parseFloat(cs.paddingLeft), Rx = mb.r - parseFloat(cs.paddingRight);
  const W = root.clientWidth;
  const margin = Math.min(L, W - Rx); // space beside the column
  const g = Math.min(Math.max(margin * 0.5, 6), 56);
  const lanes = { L: L - g, R: Rx + g };
  const wander = Math.max(0, Math.min(margin - g - 14, g - 10, 12)); // meander, but never near the text
  let side: 'L' | 'R' = 'L';
  const lane = () => lanes[side];
  // enter from the top edge of the popup, curl once, and drop down the left lane
  const pen = new Pen([lanes.L + 40, -4], 24, wander);
  pen.to([lanes.L + 40, 10]).loop([lanes.L + 40 - 6, 16], 6).to([lanes.L, 22]);

  /** Cross the column in the empty gap just above `y` (between blocks). */
  const cross = (to: 'L' | 'R', y: number) => {
    if (side === to) return;
    pen.to([lane(), y]);
    side = to;
    pen.to([lane(), y]);
  };

  const sel = '#c h1,#c h2,#c li,#c table,#c pre,#c .cluster dl,#c blockquote,.pop-end';
  for (const el of root.querySelectorAll(sel)) {
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
      case 'LI': {
        if (el.querySelector(':scope > a > figure.art')) break; // a work with its drawing: no bullet
        const list = el.parentElement!;
        if (list.tagName !== 'UL' || list.className) break; // designed lists (tags, facts, works) get no bullet
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
        // .pop-end: a spiral where the page ends
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
        const seg = cr(pts, false);
        const a = pts[pts.length - 1]!;
        pen.raw([cx - 26, cy], seg, a);
      }
    }
  }
  pen.flush();
  return pen.d;
}

/** Draws (and, the first time for this content, animates) the thread inside `root`. */
export function drawThread(root: HTMLElement, animate: boolean): void {
  const svg = root.querySelector<SVGSVGElement>('svg.thread');
  const path = svg?.querySelector('path');
  if (!svg || !path || !root.offsetParent) return;
  svg.setAttribute('width', String(root.scrollWidth));
  svg.setAttribute('height', String(root.scrollHeight));
  path.setAttribute('d', buildThread(root));
  svg.classList.remove('draw');
  path.style.strokeDasharray = '';
  if (animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const len = path.getTotalLength();
    path.style.setProperty('--len', String(len));
    path.style.strokeDasharray = String(len);
    void svg.getBoundingClientRect();
    svg.classList.add('draw');
    path.addEventListener('animationend', () => { path.style.strokeDasharray = ''; svg.classList.remove('draw'); }, { once: true });
  }
}
