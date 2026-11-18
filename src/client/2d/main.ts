import { boot } from '../common.ts';
import { initPopup } from '../popup/popup.ts';

boot();

const plane = document.querySelector<HTMLElement>('.plane')!;
const space = document.getElementById('space')!;
const card = document.getElementById('home')!;
let here: HTMLElement | null = null;

/** Light up the node of the work that is open, and tie the top card to it. */
function focus(path: string | null): void {
  here?.classList.remove('here');
  document.querySelectorAll('.edges g.on').forEach((e) => e.classList.remove('on'));
  const slug = path && /^\/works\/([^/]+)$/.exec(path)?.[1];
  here = slug ? document.getElementById(`n-${slug}`) : null;
  if (here) {
    here.classList.add('here');
    document.querySelectorAll(`.edges g[data-from="${CSS.escape(slug!)}"],.edges g[data-to="${CSS.escape(slug!)}"]`).forEach((e) => e.classList.add('on'));
    here.scrollIntoView({ block: 'center', inline: 'center' });
  }
  drawLink();
}

function drawLink(): void {
  const svg = plane.querySelector<SVGSVGElement>('svg.link')!;
  const path = svg.querySelector('path')!;
  if (!here) { path.removeAttribute('d'); return; }
  const p = plane.getBoundingClientRect(), c = card.getBoundingClientRect(), n = here.getBoundingClientRect();
  svg.setAttribute('width', String(plane.scrollWidth));
  svg.setAttribute('height', String(plane.scrollHeight));
  const x1 = c.right - p.left, y1 = Math.min(c.top - p.top + 120, c.bottom - p.top - 20);
  const x2 = n.left - p.left, y2 = n.top - p.top + n.height / 2;
  const k = Math.max(80, (x2 - x1) / 2);
  path.setAttribute('d', `M${x1} ${y1}C${x1 + k} ${y1} ${x2 - k} ${y2} ${x2} ${y2}`);
}
new ResizeObserver(drawLink).observe(plane);

const popup = initPopup({ onOpen: focus, onClose: () => focus(null) });
focus(popup.path);

// Hovering or focusing a node lights up the technologies it shares with others.
for (const node of document.querySelectorAll<HTMLElement>('.node')) {
  const id = node.id.slice(2);
  const edges = document.querySelectorAll(`.edges g[data-from="${CSS.escape(id)}"],.edges g[data-to="${CSS.escape(id)}"]`);
  const on = (v: boolean) => () => { if (node !== here) edges.forEach((e) => e.classList.toggle('on', v)); };
  node.addEventListener('pointerenter', on(true));
  node.addEventListener('pointerleave', on(false));
  node.addEventListener('focus', on(true));
  node.addEventListener('blur', on(false));
}

// Drag the background to pan (touch already pans natively).
let drag: { x: number; y: number; sx: number; sy: number } | null = null;
document.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse' || e.button !== 0) return;
  if ((e.target as Element).closest('a,button,.card,.pop,input,summary')) return;
  drag = { x: e.clientX, y: e.clientY, sx: space.scrollLeft, sy: space.scrollTop };
  document.body.classList.add('panning');
});
document.addEventListener('pointermove', (e) => {
  if (drag) space.scrollTo(drag.sx - (e.clientX - drag.x), drag.sy - (e.clientY - drag.y));
});
document.addEventListener('pointerup', () => { drag = null; document.body.classList.remove('panning'); });

// "地図 →" scrolls sideways to the map instead of jumping.
document.querySelector('.tomap')?.addEventListener('click', (e) => {
  e.preventDefault();
  (here ?? document.getElementById('map'))?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
});
