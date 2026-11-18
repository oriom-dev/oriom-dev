// Signs in the world. Text is drawn with HTML-in-Canvas (`<canvas layoutsubtree>` +
// drawElementImage) when the browser has it, so the sign shows the real, accessible
// DOM; otherwise the text is laid out by hand on a 2D canvas.
import { parseArtAttr, separatePath } from '../../shared/art.ts';

export interface Sign { id: number; quad: Float32Array; canvas: HTMLCanvasElement; href?: string; reader?: boolean; label: string; center: number[]; normal: number[]; w: number; h: number }

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const FONT = 'system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif';

/** A vertical quad centred at c, facing `normal` (horizontal), w by h. */
export function quadAt(c: number[], normal: number[], w: number, h: number): Float32Array {
  const r = [normal[2]!, 0, -normal[0]!]; // right vector when looking at the sign
  const o = 0.08;
  const P = (sx: number, sy: number) => [c[0]! + r[0]! * sx * w / 2 + normal[0]! * o, c[1]! + sy * h / 2, c[2]! + r[2]! * sx * w / 2 + normal[2]! * o];
  const v = [[-1, -1, 0, 1], [1, -1, 1, 1], [1, 1, 1, 0], [-1, 1, 0, 0]];
  return new Float32Array(v.flatMap(([sx, sy, u, t]) => [...P(sx!, sy!), u!, t!]));
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number, maxY: number): number {
  for (const para of text.split(/\n+/)) {
    let line = '';
    for (const ch of para.trim()) {
      if (ctx.measureText(line + ch).width > maxW) {
        ctx.fillText(line, x, y);
        y += lh;
        line = ch;
        if (y > maxY) return y;
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

const NOTES = {
  desktop: ['WASD・矢印キーで歩く／ドラッグで見回す', 'Space でジャンプ／F で飛ぶ', '看板をクリックすると開きます', 'この看板をクリックすると本文を読めます'],
  touch: ['左下をドラッグして歩く／右側をドラッグで見回す', '▲ でジャンプ', '看板をタップすると開きます', 'この看板をタップすると本文を読めます'],
};

/** The title card: what is in view first. A real element, so HTML-in-Canvas can paint it. */
export function titleCard(title: string, touch: boolean): HTMLElement {
  const el = document.createElement('div');
  el.className = 'title-card';
  const h = document.createElement('p');
  h.className = 't';
  h.textContent = title;
  const ul = document.createElement('ul');
  for (const n of NOTES[touch ? 'touch' : 'desktop']) ul.append(Object.assign(document.createElement('li'), { textContent: n }));
  el.append(h, ul);
  return el;
}

/** The same card drawn by hand, for browsers without HTML-in-Canvas. */
export function cardCanvas(card: HTMLElement): HTMLCanvasElement {
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
  ctx.fillStyle = css('--muted') || '#666';
  ctx.font = `300 32px ${FONT}`;
  let ly = y + 64;
  for (const li of card.querySelectorAll('li')) { ctx.fillText(li.textContent ?? '', 72, ly, W - 144); ly += 52; }
  return cv;
}

/** A work's sign: its one-stroke drawing, title and summary. */
export function workCanvas(a: HTMLAnchorElement): HTMLCanvasElement {
  const W = 512, H = 384;
  const cv = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = cv.getContext('2d')!;
  frame(ctx, W, H);
  const fig = a.querySelector<HTMLElement>('figure.art');
  if (fig?.dataset.art) {
    const art = parseArtAttr(fig.dataset.art);
    const boxH = 170, s = Math.min((W - 120) / 1000, boxH / (1000 / art.aspect));
    const ox = (W - 1000 * s) / 2, oy = 36 + (boxH - (1000 / art.aspect) * s) / 2;
    ctx.strokeStyle = css('--line') || '#888';
    ctx.lineWidth = 3;
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.stroke(new Path2D(separatePath(art, s, ox, oy)));
  }
  ctx.fillStyle = css('--fg') || '#000';
  ctx.textBaseline = 'top';
  ctx.font = `500 34px ${FONT}`;
  const y = wrap(ctx, a.querySelector('b')?.textContent ?? '', 32, 220, W - 64, 40, 262);
  ctx.font = `300 20px ${FONT}`;
  ctx.fillStyle = css('--muted') || '#666';
  wrap(ctx, a.querySelector('span')?.textContent ?? '', 32, y - 6, W - 64, 27, 330);
  return cv;
}

/** A label: one line of large text. */
export function labelCanvas(text: string, sub = ''): HTMLCanvasElement {
  const W = 512, H = 160;
  const cv = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = cv.getContext('2d')!;
  frame(ctx, W, H);
  ctx.fillStyle = css('--fg') || '#000';
  ctx.textBaseline = 'top';
  ctx.font = `400 40px ${FONT}`;
  ctx.fillText(text, 32, 30, W - 64);
  ctx.fillStyle = css('--muted') || '#666';
  ctx.font = `300 28px ${FONT}`;
  ctx.fillText(sub, 32, 90, W - 64);
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
