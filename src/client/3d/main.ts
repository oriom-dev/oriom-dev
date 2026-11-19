// 3D: walk around a block world generated from noise. Every work and post stands on
// a sign around the plaza; opening one shows the page in the popup, in place.
import { bytes } from '../../shared/stats.ts';
import type { Item, Stats } from '../../shared/types.ts';
import { NO3D_COOKIE } from '../../shared/variant.ts';
import { sortKey } from '../../shared/compose.ts';
import { boot, readStats } from '../common.ts';
import { initPopup } from '../popup/popup.ts';
import { webgl2 } from './gl.ts';
import { webgpu } from './gpu.ts';
import { moon as moonPos, place, sun as sunPos, toVector } from './astro.ts';
import { FIRST_RING, firstSeat, ringLayout } from './layout.ts';
import { forward, invert, mul, perspective, view } from './math.ts';
import { meshChunk } from './mesh.ts';
import { HTML_IN_CANVAS, paintHtml } from './html.ts';
import { type Area, cardCanvas, cardEl, floorQuad, type Intro, plaqueCanvas, postCanvas, postEl, quadAt, type Run, type Sign, textCanvas, textEl, workCanvas, workEl } from './panels.ts';
import { Player } from './player.ts';
import type { Renderer } from './render.ts';
import { UNIFORM_FLOATS } from './render.ts';
import { B, CS, PLAZA_Y, World } from './world.ts';

boot();

const root = document.documentElement;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('view');
const tip = $('tip');
const mobile = matchMedia('(pointer:coarse)').matches;
const popped = () => root.classList.contains('popped');

// ---------------------------------------------------------------- popup
const popup = initPopup({
  onOpen: () => { keys.clear(); if (document.pointerLockElement) document.exitPointerLock(); },
  onClose: () => canvas.focus({ preventScroll: true }),
});

// ---------------------------------------------------------------- world and signs
let items: Item[] = [];
try { items = JSON.parse($('items').textContent || '[]'); } catch { /* no signs */ }
// ?debug&fake=N adds N made-up posts, to see how the layout copes with growth
const fake = new URLSearchParams(location.search).has('debug') ? Number(new URLSearchParams(location.search).get('fake') ?? 0) : 0;
// (one a month back from today, so they spread over the years like real posts)
for (let i = 0; i < fake; i++) {
  const d = new Date(); d.setMonth(d.getMonth() - i);
  items.push({ kind: 'post', path: `/blog/fake-${i}`, title: `テストの記事 ${i + 1}：少し長めのタイトルで折り返しを確かめる`, date: d.toISOString().slice(0, 10), summary: '仮の概要です。'.repeat(4) });
}
if (fake) items.sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
// a free seat between years, so each year reads as its own stretch
const yearOf = (it: Item) => (it.date ?? '').slice(0, 4) || String(new Date().getFullYear());
const seq: (Item | null)[] = [];
items.forEach((it, i) => { if (i && yearOf(items[i - 1]!) !== yearOf(it)) seq.push(null); seq.push(it); });
const layout = ringLayout(seq.length);
const world = new World(layout.plaza);
const player = new Player(world);
if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { __player: player, __keys: () => keys, __signs: () => signs });
player.p = [0.5, PLAZA_Y + 1, 3.5];
player.pitch = 0.08;

const signs: Sign[] = [];
const sign = (s: Omit<Sign, 'id' | 'quad'> & { offset?: number }) => {
  const sg = { ...s, id: signs.length, quad: quadAt(s.center, s.normal, s.w, s.h, s.offset) };
  signs.push(sg);
  return sg;
};
/** Where the browser can, a sign's face is its element painted by HTML-in-Canvas (and
 *  painted again whenever the element changes); elsewhere the hand-drawn canvas stays. */
type Face = { id: number; quad: Float32Array; canvas: HTMLCanvasElement; areas?: Area[] };
const face = (f: Face, el: HTMLElement, W: number, H: number): (() => void) | null =>
  HTML_IN_CANVAS ? paintHtml(el, W, H, (cv, areas) => { f.canvas = cv; if (f.areas) f.areas = areas; renderer?.setPanel(f.id, f.quad, cv); }) : null;
const post = (x: number, z: number, top: number) => { for (let y = PLAZA_Y + 1; y <= top; y++) world.overrides.set(`${x},${y},${z}`, B.Log); };

// straight ahead: the top page's intro as 2D shows it (affiliations as chips, the links),
// each link on it clickable
const introEl = document.querySelector<HTMLTemplateElement>('template#intro')?.content;
const runsOf = (li: Element): Run[] => [...li.childNodes].map((n) =>
  n instanceof HTMLAnchorElement ? { text: n.textContent ?? '', href: n.getAttribute('href') ?? '' } : { text: n.textContent ?? '' }).filter((r) => r.text.trim());
const intro: Intro = {
  affiliations: [...(introEl?.querySelectorAll('ul:not(.links) > li') ?? [])].map(runsOf),
  links: [...(introEl?.querySelectorAll('ul.links a') ?? [])].map((a) => ({
    label: (a.firstChild?.textContent ?? '').trim(), handle: a.querySelector('span')?.textContent ?? '', href: a.getAttribute('href') ?? '',
  })),
};
const card0 = cardCanvas(intro);
const titleSign = sign({ canvas: card0.canvas, areas: card0.areas, label: '', center: [0.5, PLAZA_Y + 3.7, -5], normal: [0, 0, 1], w: 5.6, h: 4.2 });
const visitsEl = document.createElement('p');
face(titleSign, cardEl(introEl, visitsEl), 1024, 768);
post(-2, -6, PLAZA_Y + 1); post(2, -6, PLAZA_Y + 1);

// works, posts and badges, newest first, round the arcs; each year starts with a plaque
const itemSigns: Sign[] = [];
const statEls = new Map<number, HTMLElement>(); // item index -> its live number
let prevSeat = -1;
seq.forEach((it, k) => {
  if (!it) return;
  const i = itemSigns.length;
  const sl = layout.slots[k]!;
  const bx = Math.floor(sl.x), bz = Math.floor(sl.z);
  post(bx, bz, PLAZA_Y + 1);
  const center = [bx + 0.5, PLAZA_Y + 3.05, bz + 0.5], normal = [sl.nx, 0, sl.nz];
  const sg = sign({
    canvas: it.kind === 'post' ? postCanvas(it) : workCanvas(it),
    href: it.path,
    label: `${it.title} を開く`,
    center, normal, w: 2.4, h: 1.8,
  });
  itemSigns.push(sg);
  if (it.kind === 'post') face(sg, postEl(it), 512, 384);
  else {
    const st = document.createElement('p');
    statEls.set(i, st);
    face(sg, workEl(it, st), 512, 384);
  }
  const prev = items[i - 1];
  const prevRing = prevSeat < 0 ? -1 : layout.slots[prevSeat]!.ring;
  prevSeat = k;
  if (!prev || yearOf(prev) !== yearOf(it) || prevRing !== sl.ring) {
    // the year's signs go on to the left of this one (the arcs run left to right behind you)
    const pl = sign({ canvas: plaqueCanvas(`← ${yearOf(it)}`), label: '', center: [center[0]!, PLAZA_Y + 1.5, center[2]!], normal, w: 1.1, h: 0.55, offset: 0.76 }); // clear of the block corners when it faces the plaza at an angle
    face(pl, textEl(`← ${yearOf(it)}`, 56, true), 256, 128);
  }
});

// redstone lamps on the floor between the spawn and the title sign: one row per node
// for CPU and one for memory, ten lamps each. A note under the title sign points down
// at them, and a board on the floor at the left end of each row says what it shows.
// The rows follow the cluster: as many nodes as it has (two rows each), added and taken
// away as nodes come and go.
const LAMP_X0 = -4, LAMP_Z0 = -2, MAX_NODES = 6;
const FLOOR = PLAZA_Y + 1.02;
const notePanel = { id: 999, quad: floorQuad(0.5, FLOOR, -3.2, 4.4, 0.8), canvas: textCanvas('↓ 今のサーバーのリソース', 768, 128, 60) };
face(notePanel, textEl('↓ 今のサーバーのリソース', 60), 768, 128);
const rowFaces = new Map<number, { el: HTMLElement; drop: (() => void) | null }>(); // HTML-in-Canvas boards by row
let lampRows = 0; // rows currently on the floor
const lampChunks = (rows: number) => {
  const keys = new Set<string>();
  for (const x of [LAMP_X0, LAMP_X0 + 9]) for (const z of [LAMP_Z0, LAMP_Z0 + Math.max(0, rows - 1)]) keys.add(`${Math.floor(x / CS)},${Math.floor(z / CS)}`);
  return keys;
};

const FOVY = 1.15;
/** How far back to stand so a sign `w` wide whose top is `top` fits the screen both
 *  ways (phones are narrow, desktops are short). */
const fitDistance = (w: number, top: number) => {
  const half = Math.atan(Math.tan(FOVY / 2) * (innerWidth / innerHeight));
  const across = (w / 2 + 0.4) / Math.tan(half);
  const up = (top - (PLAZA_Y + 1 + player.eye) + 0.4) / Math.tan(FOVY / 2);
  return Math.max(3.4, across, up);
};
const topOf = (s: Sign) => s.center[1]! + s.h / 2;
// the spawn: in front of the title sign, always the same place whatever the content.
// On wide screens far enough back that the seats beside the title sign (the first
// arc's nearest seats, fixed by the layout) are whole in view; never past the first arc.
const seat = firstSeat();
const spanW = innerWidth > innerHeight * 1.2 ? 2 * (Math.abs(seat.x) + 1.2 + 0.6) : titleSign.w;
const spawnZ = Math.min(titleSign.center[2]! + fitDistance(spanW, topOf(titleSign)), FIRST_RING - 3);
player.p = [0.5, PLAZA_Y + 1, spawnZ];
player.yaw = 0;

/** Opened by URL: stand in front of that page's sign (the popup is already open). */
function spawnAt(path: string): void {
  const s = signs.find((x) => x.href === path && x !== titleSign);
  if (!s) return;
  const d = fitDistance(s.w, topOf(s));
  player.p = [s.center[0]! + s.normal[0]! * d, PLAZA_Y + 1, s.center[2]! + s.normal[2]! * d];
  player.yaw = Math.atan2(s.normal[0]!, s.normal[2]!);
  player.pitch = 0;
}
if (location.pathname !== '/') spawnAt(location.pathname);

const nf = new Intl.NumberFormat('ja-JP');
/** Live numbers go on the signs they belong to; the lamps show the cluster. */
function applyStats(s: Stats | null): void {
  if (!s) return;
  const statText = (k?: string) =>
    k === 'tompedia' && s.tompedia ? `利用者 ${nf.format(s.tompedia.total)} 人` : k === 'mosimo' && s.mosimo ? `投稿 ${nf.format(s.mosimo.posts)} 件` : '';
  const nodes = (s.cluster?.nodes ?? []).slice(0, MAX_NODES);
  const rows = nodes.length * 2;
  for (let row = 0; row < Math.max(rows, lampRows); row++) {
    const n = nodes[row >> 1];
    const v = n ? (row % 2 ? (100 * n.memory.used) / n.memory.total : n.cpu ?? 0) : 0;
    const z = LAMP_Z0 + row;
    for (let k = 0; k < 10; k++) {
      const key = `${LAMP_X0 + k},${PLAZA_Y},${z}`;
      if (row < rows) world.overrides.set(key, v > k * 10 + 1 ? B.LampOn : B.LampOff);
      else world.overrides.delete(key); // a node went away: back to the plaza floor
    }
    const label = n ? `${n.name} ${row % 2 ? 'メモリ' : 'CPU'}` : '';
    const quad = floorQuad(LAMP_X0 - 1.75, FLOOR, z + 0.5, 3.3, 0.8);
    if (row < rows && HTML_IN_CANVAS) {
      const f = rowFaces.get(row);
      if (f) f.el.textContent = label; // painted again by itself
      else {
        const el = textEl(label, 46);
        rowFaces.set(row, { el, drop: face({ id: 1000 + row, quad, canvas: textCanvas(label, 512, 124, 46) }, el, 512, 124) });
      }
    } else if (row < rows) renderer?.setPanel(1000 + row, quad, textCanvas(label, 512, 124, 46));
    else {
      rowFaces.get(row)?.drop?.();
      rowFaces.delete(row);
      renderer?.dropPanel(1000 + row);
    }
  }
  const touched = lampChunks(Math.max(rows, lampRows));
  lampRows = rows;
  const visits = s.views != null ? `訪問 ${nf.format(s.views)}` : '';
  visitsEl.textContent = visits; // HTML-in-Canvas paints the change itself
  if (!HTML_IN_CANVAS) {
    ({ canvas: titleSign.canvas, areas: titleSign.areas } = cardCanvas(intro, visits));
    renderer?.setPanel(titleSign.id, titleSign.quad, titleSign.canvas);
  }
  items.forEach((it, i) => {
    if (!it.stat) return;
    const text = statText(it.stat);
    const st = statEls.get(i);
    if (st && st.textContent !== text) st.textContent = text;
    if (HTML_IN_CANVAS) return;
    const sg = itemSigns[i]!;
    sg.canvas = workCanvas(it, text);
    renderer?.setPanel(sg.id, sg.quad, sg.canvas);
  });
  if (renderer) for (const key of touched) if (loaded.has(key)) dirty.add(key);
}

// ---------------------------------------------------------------- chunks
let renderer: Renderer | null = null;
const loaded = new Set<string>();
const dirty = new Set<string>();
const RADIUS = mobile ? 4 : 7;

function updateChunks(budgetMs: number): void {
  const t0 = performance.now();
  const pcx = Math.floor(player.p[0]! / CS), pcz = Math.floor(player.p[2]! / CS);
  for (const key of dirty) {
    const [cx, cz] = key.split(',').map(Number) as [number, number];
    renderer!.setChunk(key, meshChunk(world.generate(cx, cz), cx, cz), [cx, cz]);
    dirty.delete(key);
  }
  const want: [number, number, number][] = [];
  for (let dz = -RADIUS; dz <= RADIUS; dz++) for (let dx = -RADIUS; dx <= RADIUS; dx++) {
    const d = dx * dx + dz * dz;
    if (d <= RADIUS * RADIUS && !loaded.has(`${pcx + dx},${pcz + dz}`)) want.push([d, pcx + dx, pcz + dz]);
  }
  want.sort((a, b) => a[0] - b[0]);
  for (const [, cx, cz] of want) {
    if (performance.now() - t0 > budgetMs) break;
    const key = `${cx},${cz}`;
    renderer!.setChunk(key, meshChunk(world.generate(cx, cz), cx, cz), [cx, cz]);
    loaded.add(key);
  }
  for (const key of loaded) {
    const [cx, cz] = key.split(',').map(Number) as [number, number];
    if ((cx - pcx) ** 2 + (cz - pcz) ** 2 > (RADIUS + 2) ** 2) { renderer!.dropChunk(key); loaded.delete(key); }
  }
}

// ---------------------------------------------------------------- sky and time
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i]! - v) * t);
// the sky keeps its own, ordinary colours (sRGB): the page's random hue is for the
// signs and the popup, not for the world
const hex = (h: number) => [(h >> 16) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const DAY_Z = hex(0x78a7ff), DAY_H = hex(0xc4dcff);
const NIGHT_Z = hex(0x05070f), NIGHT_H = hex(0x10172a);
const DUSK = hex(0xf2a35e);

// ?at=2026-11-24T23:00 shows the sky of another moment (sun, moon phase, stars); an
// invalid value is ignored and the visitor's own time is used
const atParam = new URLSearchParams(location.search).get('at');
const atTime = atParam && !Number.isNaN(Date.parse(atParam)) ? Date.parse(atParam) : null;
const here = place();
/** How light the sky is for the sun at `alt` degrees: full day from 6° up, then civil
 *  (0°..-6°), nautical (..-12°) and astronomical (..-18°) twilight down to the night. */
function daylight(alt: number): number {
  const stops: [number, number][] = [[-18, 0], [-12, 0.05], [-6, 0.25], [0, 0.7], [6, 1]];
  if (alt <= -18) return 0;
  if (alt >= 6) return 1;
  for (let i = 1; i < stops.length; i++) {
    const [a1, v1] = stops[i]!, [a0, v0] = stops[i - 1]!;
    if (alt <= a1) return v0 + ((v1 - v0) * (alt - a0)) / (a1 - a0);
  }
  return 1;
}
function sky() {
  const t = atTime ?? Date.now();
  // the real sun and moon for where the visitor is: their rising, setting and phase
  const sh = sunPos(t, here);
  const sun = toVector(sh);
  const moon = toVector(moonPos(t, here));
  const day = daylight(sh.alt);
  // the glow of sunrise and sunset, from a little above the horizon to nautical twilight
  const dusk = Math.max(0, 1 - Math.abs(sh.alt + 3) / 9);
  return { sun, moon, day, zenith: mix(NIGHT_Z, DAY_Z, day), horizon: mix(mix(NIGHT_H, DAY_H, day), DUSK, dusk * 0.3), dusk };
}

// ---------------------------------------------------------------- input
const keys = new Set<string>();
const joy = { x: 0, y: 0, id: -1, ox: 0, oy: 0 };
let look: { id: number; x: number; y: number; moved: number } | null = null;
let jumpHeld = false;

const locked = () => document.pointerLockElement === canvas;
const lockMouse = () => { if (!popped()) canvas.requestPointerLock?.()?.catch?.(() => {}); };
const keysText = $('keys');
const K = (keys: string[], what: string) => `<span>${keys.map((k) => `<kbd>${k}</kbd>`).join('')}${what}</span>`;
const setKeys = () => {
  keysText.innerHTML = locked()
    ? [K(['W', 'A', 'S', 'D'], '歩く'), K(['マウス'], '見回す'), K(['Space'], 'ジャンプ'), K(['クリック'], '看板を開く'), K(['Esc'], 'マウスを解放')].join('')
    : [K(['クリック'], '見回す・看板を開く'), K(['W', 'A', 'S', 'D'], '歩く'), K(['Space'], 'ジャンプ')].join('');
};
setKeys();
document.addEventListener('pointerlockchange', setKeys);
// keys are a user gesture: the first step also hands the mouse to the view
document.addEventListener('keydown', (e) => {
  if (popped() || !root.classList.contains('world') || e.altKey || e.ctrlKey || e.metaKey) return;
  if ((e.target as Element).closest?.('a,button,input,textarea')) return;
  // any key of the world (not Esc, Tab or the browser's own) hands the mouse to the view
  if (!locked() && !mobile && !/^(Escape|Tab|F\d+|Meta|Alt|Control|Shift|OS)/.test(e.code)) lockMouse();
  keys.add(e.code);
  if (e.code === 'KeyN') toggleNight();
  if (e.code === 'Enter' || e.code === 'KeyE') activate(aimed());
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
document.addEventListener('keyup', (e) => keys.delete(e.code));

// mouse: drag to look, click to open. touch: the left half is a joystick, the right
// half looks around; a tap opens what it hits.
document.addEventListener('mousemove', (e) => {
  if (!locked()) return;
  player.yaw -= e.movementX * 0.0025;
  player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch - e.movementY * 0.0025));
});
function moveStick(x: number, y: number): void {
  const dx = x - joy.ox, dy = y - joy.oy, l = Math.max(50, Math.hypot(dx, dy));
  joy.x = dx / l; joy.y = -dy / l;
  document.querySelector<HTMLElement>('#joy i')!.style.transform = `translate(${joy.x * 40}px,${-joy.y * 40}px)`;
}
canvas.addEventListener('pointerdown', (e) => {
  if (locked()) { if (e.button === 0) activate(aimed()); return; } // the crosshair picks
  // a click on a sign opens it (on release); any other click hands the mouse to the view
  if (e.pointerType === 'mouse' && !aimed(e.clientX, e.clientY)) { lockMouse(); return; }
  try { canvas.setPointerCapture(e.pointerId); } catch { /* a pointer already gone: still steer */ }
  if (e.pointerType === 'mouse') { if (e.button === 0) look = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 }; return; }
  if (e.clientX < innerWidth / 2 && joy.id < 0) {
    // on the drawn stick its centre is the origin (the knob follows the finger); elsewhere
    // on the left half, wherever the finger lands
    const r = document.getElementById('joy')!.getBoundingClientRect();
    const onStick = Math.hypot(e.clientX - (r.left + r.right) / 2, e.clientY - (r.top + r.bottom) / 2) <= r.width / 2 + 16;
    joy.id = e.pointerId;
    joy.ox = onStick ? (r.left + r.right) / 2 : e.clientX;
    joy.oy = onStick ? (r.top + r.bottom) / 2 : e.clientY;
    moveStick(e.clientX, e.clientY);
  }
  else look = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId === joy.id) {
    moveStick(e.clientX, e.clientY);
  } else if (look && e.pointerId === look.id) {
    const k = e.pointerType === 'mouse' ? 0.004 : 0.006;
    player.yaw -= (e.clientX - look.x) * k;
    player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch - (e.clientY - look.y) * k));
    look.moved += Math.abs(e.clientX - look.x) + Math.abs(e.clientY - look.y);
    look.x = e.clientX; look.y = e.clientY;
  }
});
const endTouch = (e: PointerEvent) => {
  if (e.pointerId === joy.id) { joy.id = -1; joy.x = joy.y = 0; document.querySelector<HTMLElement>('#joy i')!.style.transform = ''; }
  if (look && e.pointerId === look.id) {
    if (look.moved < 8) activate(aimed(e.clientX, e.clientY));
    look = null;
  }
};
canvas.addEventListener('pointerup', endTouch);
canvas.addEventListener('pointercancel', endTouch);
$('jump').addEventListener('pointerdown', () => (jumpHeld = true));
$('jump').addEventListener('pointerup', () => (jumpHeld = false));

// ---------------------------------------------------------------- night vision
let night = false;
const nvButton = $('nv'), nvTouch = $('nvt'); // the status bar's, and the phone's above the jump
function toggleNight(): void {
  night = !night;
  for (const b of [nvButton, nvTouch]) b.setAttribute('aria-pressed', String(night));
}
nvTouch.addEventListener('click', toggleNight);
nvButton.addEventListener('click', () => { toggleNight(); canvas.focus({ preventScroll: true }); });

// ---------------------------------------------------------------- compass
const DIRS = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東', '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西'];
const needle = $('needle'), heading = $('heading');
let lastDir = -1;
/** North is -z (behind the title sign), east is +x (where the sun rises). The arrowhead
 *  always points north; the text says which way you face, in 16 points. */
function compass(yaw: number): void {
  const deg = (((-yaw * 180) / Math.PI) % 360 + 360) % 360;
  needle.style.transform = `rotate(${-deg}deg)`;
  const d = Math.round(deg / 22.5) % 16;
  if (d !== lastDir) { heading.textContent = DIRS[d]!; lastDir = d; }
}

// ---------------------------------------------------------------- picking
let viewProj = new Float32Array(16);
/** What the crosshair (or the pointer at sx, sy) is on: a sign, or a link on one. */
interface Aim { href: string; label: string }
function aimed(sx?: number, sy?: number): Aim | null {
  const eye = [player.p[0]!, player.p[1]! + player.eye, player.p[2]!];
  let dir = forward(player.yaw, player.pitch);
  if (sx !== undefined && sy !== undefined) {
    const inv = invert(viewProj);
    const nx = (sx / innerWidth) * 2 - 1, ny = 1 - (sy / innerHeight) * 2;
    const far = [0, 1, 2, 3].map((r) => inv[r]! * nx + inv[4 + r]! * ny + inv[8 + r]! + inv[12 + r]!);
    const p = [far[0]! / far[3]!, far[1]! / far[3]!, far[2]! / far[3]!];
    const l = Math.hypot(p[0]! - eye[0]!, p[1]! - eye[1]!, p[2]! - eye[2]!);
    dir = [(p[0]! - eye[0]!) / l, (p[1]! - eye[1]!) / l, (p[2]! - eye[2]!) / l];
  }
  let best: Aim | null = null, bestT = 14;
  for (const s of signs) {
    if (!s.href && !s.areas?.length) continue;
    const n = s.normal;
    const denom = dir[0]! * n[0]! + dir[2]! * n[2]!;
    if (denom >= -1e-3) continue; // looking at its back or edge-on
    const t = ((s.center[0]! - eye[0]!) * n[0]! + (s.center[2]! - eye[2]!) * n[2]!) / denom;
    if (t <= 0 || t >= bestT) continue;
    const hit = [eye[0]! + dir[0]! * t, eye[1]! + dir[1]! * t, eye[2]! + dir[2]! * t];
    const along = (hit[0]! - s.center[0]!) * n[2]! - (hit[2]! - s.center[2]!) * n[0]!;
    if (Math.abs(along) > s.w / 2 || Math.abs(hit[1]! - s.center[1]!) > s.h / 2) continue;
    if (s.href) { best = { href: s.href, label: s.label }; bestT = t; continue; }
    // a link on the sign: the hit in the canvas's pixels
    const px = (0.5 + along / s.w) * s.canvas.width, py = (0.5 - (hit[1]! - s.center[1]!) / s.h) * s.canvas.height;
    const a = s.areas!.find((r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h);
    if (a) { best = { href: a.href, label: a.label }; bestT = t; }
  }
  return best;
}
/** Pages of the site open in the popup; mail in the mail app; other sites in a new tab. */
function activate(a: Aim | null): void {
  if (!a) return;
  if (a.href.startsWith('/')) popup.open(a.href, { show: true });
  else if (a.href.startsWith('mailto:')) location.href = a.href;
  else window.open(a.href, '_blank', 'noopener');
}

// ---------------------------------------------------------------- start
async function start(): Promise<void> {
  const forceGl = new URLSearchParams(location.search).get('r') === 'gl';
  try { renderer = (forceGl ? null : await webgpu(canvas)) ?? webgl2(canvas); } catch (e) { console.warn('3D:', e); renderer = null; }
  if (!renderer) {
    try { renderer = webgl2(canvas); } catch { renderer = null; }
  }
  if (!renderer) {
    document.cookie = `${NO3D_COOKIE}=1;path=/;max-age=31536000;samesite=lax;secure`;
    return; // the popup and its links still work without the world
  }
  root.classList.add('world');
  root.dataset.renderer = renderer.kind;
  canvas.tabIndex = 0;
  canvas.focus({ preventScroll: true });
  const r = renderer;
  for (const s of signs) r.setPanel(s.id, s.quad, s.canvas);
  r.setPanel(notePanel.id, notePanel.quad, notePanel.canvas);
  // HTML-in-Canvas: when available the big sign shows the live DOM itself
  applyStats(readStats());
  document.addEventListener('stats', (e) => applyStats((e as CustomEvent<Stats>).detail));

  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, mobile ? 1 : 1.5);
    r.resize(Math.max(1, Math.floor(innerWidth * dpr)), Math.max(1, Math.floor(innerHeight * dpr)));
  };
  resize();
  addEventListener('resize', resize);
  updateChunks(1e9); // the first view is complete before the first frame
  for (let i = 0; i < 40 && world.solidAt(Math.floor(player.p[0]!), Math.floor(player.p[1]!), Math.floor(player.p[2]!)); i++) player.p[1]! += 1;

  const u = new Float32Array(UNIFORM_FLOATS);
  const fog = (RADIUS - 0.5) * CS; // where the fog is whole: the edge of the loaded chunks
  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!popped()) {
      const k = (c: string) => (keys.has(c) ? 1 : 0);
      const mx = k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft') + joy.x;
      const mz = k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown') + joy.y;
      player.step(dt, [Math.max(-1, Math.min(1, mx)), Math.max(-1, Math.min(1, mz))], keys.has('Space') || jumpHeld, false, keys.has('ShiftLeft') || keys.has('ShiftRight'));
      const a = aimed();
      tip.textContent = a ? a.label : '';
      compass(player.yaw);
    }
    updateChunks(mobile ? 4 : 7);
    const eye = [player.p[0]!, player.p[1]! + player.eye, player.p[2]!];
    const proj = perspective(FOVY, innerWidth / innerHeight, 0.08, RADIUS * CS * 1.5, r.kind === 'webgpu');
    viewProj = mul(proj, view(eye, player.yaw, player.pitch));
    const s = sky();
    u.set(viewProj, 0);
    u.set(invert(viewProj), 16);
    u.set([eye[0]!, eye[1]!, eye[2]!, now / 1000], 32);
    u.set([...s.sun, s.day], 36);
    u.set([...s.zenith, fog], 40);
    u.set([...s.horizon, s.dusk * 0.75], 44);
    u.set([0.2 + 0.4 * s.day, 1 - s.day, night ? 1 : 0, 0], 48);
    u.set([...s.moon, 0], 52);
    u.set([canvas.width, canvas.height, 0, 0], 56);
    const f = forward(player.yaw, 0);
    r.render(u, (cx, cz) => {
      const dx = (cx + 0.5) * CS - eye[0]!, dz = (cz + 0.5) * CS - eye[2]!;
      const d = Math.hypot(dx, dz);
      return d < 2 * CS || (dx * f[0]! + dz * f[2]!) / d > -0.35;
    });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
start();
