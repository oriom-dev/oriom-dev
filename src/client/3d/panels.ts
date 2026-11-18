// Signs in the world. Text is drawn with HTML-in-Canvas (`<canvas layoutsubtree>` +
// drawElementImage) when the browser has it, so the sign shows the real, accessible
// DOM; otherwise the text is laid out by hand on a 2D canvas.
import { parseArtAttr, separatePath } from '../../shared/art.ts';
import type { Item } from '../../shared/types.ts';

export interface Sign { id: number; quad: Float32Array; canvas: HTMLCanvasElement; href?: string; label: string; center: number[]; normal: number[]; w: number; h: number }

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

/** The title card: the name and where its owner belongs. A real element, so
 *  HTML-in-Canvas can paint it. */
export function titleCard(title: string, lines: string[]): HTMLElement {
  const el = document.createElement('div');
  el.className = 'title-card';
  const h = document.createElement('p');
  h.className = 't';
  h.textContent = title;
  const ul = document.createElement('ul');
  for (const n of lines) ul.append(Object.assign(document.createElement('li'), { textContent: n }));
  el.append(h, ul);
  return el;
}

/** When: the date, the school year, or "進行中" for work without an end. */
export const when = (it: Item) => (it.date ? (it.date.length === 4 ? `${it.date} 年度` : it.date) : '進行中');

/** The same card drawn by hand, for browsers without HTML-in-Canvas. `corner` is a
 *  number in the bottom right (the visit counter). */
export function cardCanvas(card: HTMLElement, corner = ''): HTMLCanvasElement {
  const W = 1024, H = 768;
  const cv = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = cv.getContext('2d')!;
  frame(ctx, W, H);
  ctx.fillStyle = css('--fg') || '#000';
  ctx.textBaseline = 'top';
  ctx.font = `200 76px ${FONT}`;
  const y = wrap(ctx, card.querySelector('.t')?.textContent ?? '', 72, 96, W - 144, 92, 380);
  ctx.strokeStyle = css('--line') || '#888';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(72, y + 24); ctx.lineTo(W - 72, y + 24); ctx.stroke();
  ctx.fillStyle = css('--fg') || '#000';
  ctx.font = `300 34px ${FONT}`;
  let ly = y + 60;
  for (const li of card.querySelectorAll('li')) { ctx.fillText(`・${li.textContent ?? ''}`, 72, ly, W - 144); ly += 54; }
  if (corner) {
    ctx.textAlign = 'right';
    ctx.font = `200 40px ${FONT}`;
    ctx.fillText(corner, W - 72, H - 110);
  }
  return cv;
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
  // long titles get a smaller size so the summary keeps at least two lines
  ctx.font = `500 ${ctx.measureText(it.title).width > (W - 64) * 1.6 ? 28 : 34}px ${FONT}`;
  const y = wrap(ctx, it.title, 32, 220, W - 64, 38, 262);
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

/** A small plaque on a post: the year where a stretch of signs begins. */
export function plaqueCanvas(text: string): HTMLCanvasElement {
  const W = 256, H = 128;
  const cv = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = cv.getContext('2d')!;
  frame(ctx, W, H);
  ctx.fillStyle = css('--fg') || '#000';
  ctx.font = `300 64px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, W / 2, H / 2 + 4);
  return cv;
}

/**
 * HTML-in-Canvas: when supported, the title card is a real element inside a
 * `<canvas layoutsubtree>` and is painted from the DOM. Returns null when the API is missing.
 */
export function htmlCanvas(el: HTMLElement, onPaint: (c: HTMLCanvasElement) => void): HTMLCanvasElement | null {
  const proto = CanvasRenderingContext2D.prototype as any;
  const draw = proto.drawElementImage ?? proto.drawElement;
  if (!draw) return null;
  const cv = document.createElement('canvas');
  cv.setAttribute('layoutsubtree', '');
  cv.width = 1024; cv.height = 768;
  cv.className = 'html-canvas';
  cv.setAttribute('aria-hidden', 'true'); // the same title is in the header and the reader
  document.body.append(cv);
  cv.append(el);
  const ctx = cv.getContext('2d')!;
  const paint = () => {
    try {
      frame(ctx, cv.width, cv.height);
      draw.call(ctx, el, 0, 0);
      onPaint(cv);
    } catch { /* API shape changed: keep the hand-drawn sign */ }
  };
  cv.addEventListener('paint', paint);
  (cv as any).requestPaint?.();
  requestAnimationFrame(paint);
  return cv;
}
