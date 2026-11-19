// Signs in the world. Text is drawn with HTML-in-Canvas (`<canvas layoutsubtree>` +
// drawElementImage) when the browser has it, so the sign shows the real, accessible
// DOM; otherwise the text is laid out by hand on a 2D canvas.
import { parseArtAttr, separatePath } from '../../shared/art.ts';
import type { Item } from '../../shared/types.ts';

export interface Sign { id: number; quad: Float32Array; canvas: HTMLCanvasElement; href?: string; label: string; center: number[]; normal: number[]; w: number; h: number; areas?: Area[] }

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const FONT = 'system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif';

/** A vertical quad centred at c, facing `normal` (horizontal), w by h. */
export function quadAt(c: number[], normal: number[], w: number, h: number, o = 0.08): Float32Array {
  const r = [normal[2]!, 0, -normal[0]!]; // right vector when looking at the sign
  const P = (sx: number, sy: number) => [c[0]! + r[0]! * sx * w / 2 + normal[0]! * o, c[1]! + sy * h / 2, c[2]! + r[2]! * sx * w / 2 + normal[2]! * o];
  const v = [[-1, -1, 0, 1], [1, -1, 1, 1], [1, 1, 1, 0], [-1, 1, 0, 0]];
  return new Float32Array(v.flatMap(([sx, sy, u, t]) => [...P(sx!, sy!), u!, t!]));
}

/** Wraps text into lines; when it runs out of room the last line ends with "…". */
function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number, maxY: number): number {
  const ellipsis = (line: string) => {
    while (line && ctx.measureText(`${line}…`).width > maxW) line = line.slice(0, -1);
    return `${line}…`;
  };
  for (const para of text.split(/\n+/)) {
    let line = '';
    for (const ch of para.trim()) {
      if (ctx.measureText(line + ch).width > maxW) {
        if (y + lh > maxY) { ctx.fillText(ellipsis(line), x, y); return y + lh; }
        ctx.fillText(line, x, y);
        y += lh;
        line = ch;
      } else line += ch;
    }
    if (line) { ctx.fillText(line, x, y); y += lh * 1.35; }
    if (y > maxY) return y;
  }
  return y;
}

function frame(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  ctx.fillStyle = css('--bg') || '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = css('--line') || '#888';
  ctx.lineWidth = 6;
  ctx.strokeRect(10, 10, W - 20, H - 20);
}

/** When: the date, the school year, or "進行中" for work without an end. */
export const when = (it: Item) => (it.date ? (it.date.length === 4 ? `${it.date} 年度` : it.date) : '進行中');

/** The same card drawn by hand, for browsers without HTML-in-Canvas. `corner` is a
 *  number in the bottom right (the visit counter). */
/** A run of text, linked or not (an affiliation can be partly a link, as in 2D). */
export interface Run { text: string; href?: string }
export interface Intro { affiliations: Run[][]; links: { label: string; handle: string; href: string }[] }
/** A link on a sign, in its canvas's pixels. */
export interface Area { x: number; y: number; w: number; h: number; href: string; label: string }

/** The top page's intro, as the 2D page lays it out: the name, the affiliations as
 *  chips (links underlined), the links with their handles, and the visit count. */
export function cardCanvas(intro: Intro, corner = ''): { canvas: HTMLCanvasElement; areas: Area[] } {
  const W = 1024, H = 768, L = 72, R = W - 72;
  const cv = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = cv.getContext('2d')!;
  const fg = css('--fg') || '#000', muted = css('--muted') || '#666', line = css('--line') || '#888';
  const areas: Area[] = [];
  frame(ctx, W, H);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = fg;
  ctx.font = `200 76px ${FONT}`;
  ctx.fillText('oriom.dev', L, 128);
  // chips
  const CH = 56, PAD = 22, GAP = 14;
  ctx.font = `300 30px ${FONT}`;
  let x = L, y = 210;
  for (const runs of intro.affiliations) {
    const widths = runs.map((r) => ctx.measureText(r.text).width);
    const w = widths.reduce((a, b) => a + b, 0) + PAD * 2;
    if (x + w > R && x > L) { x = L; y += CH + GAP; }
    ctx.strokeStyle = line; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.roundRect(x, y, w, CH, CH / 2); ctx.stroke();
    let tx = x + PAD;
    runs.forEach((r, k) => {
      ctx.fillStyle = fg;
      ctx.fillText(r.text, tx, y + CH / 2 + 1);
      if (r.href) {
        ctx.fillRect(tx, y + CH / 2 + 18, widths[k]!, 2);
        areas.push({ x: tx - 6, y, w: widths[k]! + 12, h: CH, href: r.href, label: r.text.trim() });
      }
      tx += widths[k]!;
    });
    x += w + GAP;
  }
  // links: the name, then the handle in the muted colour
  x = L; y += CH + 52;
  ctx.font = `300 32px ${FONT}`;
  for (const l of intro.links) {
    const a = ctx.measureText(l.label).width, gap = 12, b = ctx.measureText(l.handle).width;
    if (x + a + gap + b > R && x > L) { x = L; y += 56; }
    ctx.fillStyle = fg; ctx.fillText(l.label, x, y);
    ctx.fillStyle = muted; ctx.fillText(l.handle, x + a + gap, y);
    areas.push({ x: x - 8, y: y - 28, w: a + gap + b + 16, h: 56, href: l.href, label: `${l.label} ${l.handle}` });
    x += a + gap + b + 48;
  }
  if (corner) {
    ctx.textAlign = 'right';
    ctx.fillStyle = fg;
    ctx.font = `200 40px ${FONT}`;
    ctx.fillText(corner, R, H - 80);
  }
  return { canvas: cv, areas };
}

/** A work's or a badge's sign: when, its line drawing, title and summary, and its
 *  live number if it has one. */
export function workCanvas(it: Item, stat = ''): HTMLCanvasElement {
  const W = 512, H = 384;
  const cv = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = cv.getContext('2d')!;
  frame(ctx, W, H);
  ctx.fillStyle = css('--muted') || '#666';
  ctx.font = `400 20px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText(when(it), W - 30, 26);
  ctx.textAlign = 'left';
  if (it.art) {
    const art = parseArtAttr(it.art);
    const boxH = 170, s = Math.min((W - 120) / 1000, boxH / (1000 / art.aspect));
    const ox = (W - 1000 * s) / 2, oy = 36 + (boxH - (1000 / art.aspect) * s) / 2;
    ctx.strokeStyle = css('--line') || '#888';
    ctx.lineWidth = 3;
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.stroke(new Path2D(separatePath(art, s, ox, oy)));
  }
  ctx.fillStyle = css('--fg') || '#000';
  ctx.textBaseline = 'top';
  // long titles (badges have very long ones) get smaller and more lines, so they are
  // read to the end; the summary starts below with some air
  ctx.font = `500 34px ${FONT}`;
  const long = ctx.measureText(it.title).width / (W - 64);
  const size = long > 2.6 ? 22 : long > 1.6 ? 27 : 34;
  ctx.font = `500 ${size}px ${FONT}`;
  const y = wrap(ctx, it.title, 32, 214, W - 64, size + 6, long > 2.6 ? 290 : 262) + 8;
  ctx.font = `300 20px ${FONT}`;
  ctx.fillStyle = css('--muted') || '#666';
  wrap(ctx, it.summary, 32, y - 6, W - 64, 27, stat ? 300 : 330);
  if (stat) {
    ctx.fillStyle = css('--fg') || '#000';
    ctx.font = `400 24px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(stat, W - 32, H - 52);
  }
  return cv;
}

/** A post's sign: date, title, the first lines of its description. */
export function postCanvas(it: Item): HTMLCanvasElement {
  const W = 512, H = 384;
  const cv = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = cv.getContext('2d')!;
  frame(ctx, W, H);
  ctx.textBaseline = 'top';
  ctx.fillStyle = css('--muted') || '#666';
  ctx.font = `400 22px ${FONT}`;
  ctx.fillText(`${when(it)}${it.by ? `・${it.by}` : ''}`, 32, 36, W - 64);
  ctx.fillStyle = css('--fg') || '#000';
  ctx.font = `400 36px ${FONT}`;
  const y = wrap(ctx, it.title, 32, 76, W - 64, 46, 200);
  ctx.font = `300 21px ${FONT}`;
  ctx.fillStyle = css('--muted') || '#666';
  wrap(ctx, it.summary, 32, y + 4, W - 64, 30, 330);
  return cv;
}

/** A board lying on the floor, its top towards -z (read from the spawn, facing north). */
export function floorQuad(cx: number, y: number, cz: number, w: number, h: number): Float32Array {
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - h / 2, z1 = cz + h / 2;
  // read from the south (+z): the text's top edge is the far (north) edge
  return new Float32Array([x0, y, z1, 0, 1, x1, y, z1, 1, 1, x1, y, z0, 1, 0, x0, y, z0, 0, 0]);
}

/** One line of text on a plain board (labels on the floor, the note under the title). */
export function textCanvas(text: string, W = 512, H = 96, size = 44): HTMLCanvasElement {
  const cv = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = cv.getContext('2d')!;
  frame(ctx, W, H);
  ctx.fillStyle = css('--fg') || '#000';
  ctx.font = `300 ${size}px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 28, H / 2 + 2, W - 56);
  return cv;
}

/** A small plaque on a post: the year where a stretch of signs begins. */
export function plaqueCanvas(text: string): HTMLCanvasElement {
  const W = 256, H = 128;
  const cv = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = cv.getContext('2d')!;
  frame(ctx, W, H);
  ctx.fillStyle = css('--fg') || '#000';
  ctx.font = `300 56px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, W / 2, H / 2 + 4);
  return cv;
}


// ---------------------------------------------------------------- the same signs as HTML
// (painted by HTML-in-Canvas where the browser can: html.ts; style.css .html-signs)
const el = (tag: string, cls = '', text = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/** The title card from the top page's intro (its lists, links and all) and the visits. */
export function cardEl(intro: DocumentFragment | undefined, corner: HTMLElement): HTMLElement {
  const box = el('div', 'hs card');
  box.append(el('p', 't', 'oriom.dev'));
  const chips = intro?.querySelector('ul:not(.links)')?.cloneNode(true) as HTMLElement | undefined;
  const links = intro?.querySelector('ul.links')?.cloneNode(true) as HTMLElement | undefined;
  if (chips) { chips.className = 'chips'; box.append(chips); }
  if (links) box.append(links);
  corner.className = 'corner';
  box.append(corner);
  return box;
}

const titleSize = (title: string) => {
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.font = `500 34px ${FONT}`;
  const long = ctx.measureText(title).width / (512 - 64);
  return long > 2.6 ? 22 : long > 1.6 ? 27 : 34;
};

/** A work's or a badge's sign. `stat` is updated in place for live numbers. */
export function workEl(it: Item, stat: HTMLElement): HTMLElement {
  const box = el('div', 'hs work');
  box.append(el('p', 'when', when(it)));
  if (it.art) {
    const art = parseArtAttr(it.art);
    const W = 512, boxH = 170, s = Math.min((W - 120) / 1000, boxH / (1000 / art.aspect));
    const ox = (W - 1000 * s) / 2, oy = 36 + (boxH - (1000 / art.aspect) * s) / 2;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'art'); svg.setAttribute('width', '512'); svg.setAttribute('height', '220');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', separatePath(art, s, ox, oy));
    svg.append(path);
    box.append(svg);
  }
  const t = el('p', 'title', it.title);
  t.style.fontSize = `${titleSize(it.title)}px`;
  box.append(t, el('p', 'summary', it.summary));
  stat.className = 'stat';
  box.append(stat);
  return box;
}

/** A post's sign. */
export function postEl(it: Item): HTMLElement {
  const box = el('div', 'hs post');
  box.append(el('p', 'when', `${when(it)}${it.by ? `・${it.by}` : ''}`), el('p', 'title', it.title), el('p', 'summary', it.summary));
  return box;
}

/** One line on a plain board; `size` in pixels. A year's plaque is centred. */
export function textEl(text: string, size: number, centred = false): HTMLElement {
  const box = el('div', `hs line${centred ? ' centred' : ''}`, text);
  box.style.fontSize = `${size}px`;
  return box;
}
