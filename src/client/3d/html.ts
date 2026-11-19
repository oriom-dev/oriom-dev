// HTML-in-Canvas (https://github.com/WICG/html-in-canvas): a sign is a real element laid out
// inside <canvas layoutsubtree> and painted from the DOM with drawElementImage, so it is
// typeset by the browser like the 2D page, its links are real <a>, and a change to its
// text repaints it. Where the browser lacks the API, panels.ts draws the same sign by hand.
import type { Area } from './panels.ts';

export const HTML_IN_CANVAS =
  typeof (CanvasRenderingContext2D.prototype as any).drawElementImage === 'function' && 'layoutSubtree' in HTMLCanvasElement.prototype;

let host: HTMLElement | null = null;
const hostEl = () => {
  if (!host) {
    host = document.createElement('div');
    host.className = 'html-signs';
    host.setAttribute('aria-hidden', 'true'); // the same content is in the page and the popup
    document.body.append(host);
  }
  return host;
};

/** The links of an element, in its own pixels (the canvas is as large as the element). */
function areasOf(el: HTMLElement): Area[] {
  const o = el.getBoundingClientRect();
  return [...el.querySelectorAll<HTMLAnchorElement>('a[href]')].map((a) => {
    const r = a.getBoundingClientRect();
    return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height, href: a.getAttribute('href')!, label: (a.textContent ?? '').trim() };
  });
}

/** Paints `el` (W×H CSS pixels) into a canvas of the same size, now and whenever it
 *  changes. Returns a function that removes it. */
export function paintHtml(el: HTMLElement, W: number, H: number, onPaint: (canvas: HTMLCanvasElement, areas: Area[]) => void): () => void {
  const cv = document.createElement('canvas');
  cv.setAttribute('layoutsubtree', '');
  cv.width = W; cv.height = H;
  cv.style.width = `${W}px`; cv.style.height = `${H}px`;
  el.style.width = `${W}px`; el.style.height = `${H}px`;
  cv.append(el);
  hostEl().append(cv);
  const ctx = cv.getContext('2d')!;
  const paint = () => {
    try {
      ctx.clearRect(0, 0, W, H);
      (ctx as any).drawElementImage(el, 0, 0);
      onPaint(cv, areasOf(el));
    } catch (e) { console.warn('html-in-canvas:', e); }
  };
  cv.addEventListener('paint', paint);
  (cv as any).requestPaint?.();
  return () => cv.remove();
}
