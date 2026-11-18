// 3D: walk around a block world generated from noise. Every work and post stands on
// a sign around the plaza; opening one shows the page in the popup, in place.
import { oklchToLinearSrgb } from '../../shared/color.ts';
import { bytes } from '../../shared/stats.ts';
import type { Item, Stats } from '../../shared/types.ts';
import { NO3D_COOKIE } from '../../shared/variant.ts';
import { boot, readStats } from '../common.ts';
import { initPopup } from '../popup/popup.ts';
import { webgl2 } from './gl.ts';
import { webgpu } from './gpu.ts';
import { ringLayout } from './layout.ts';
import { forward, invert, mul, perspective, view } from './math.ts';
import { meshChunk } from './mesh.ts';
import { cardCanvas, htmlCanvas, labelCanvas, postCanvas, quadAt, type Sign, titleCard, workCanvas } from './panels.ts';
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
const hue = Number(root.style.getPropertyValue('--h')) || 220;
const popped = () => root.classList.contains('popped');

// ---------------------------------------------------------------- popup
const popup = initPopup({
  onOpen: () => keys.clear(),
  onClose: () => canvas.focus({ preventScroll: true }),
});

// ---------------------------------------------------------------- world and signs
let items: Item[] = [];
try { items = JSON.parse($('items').textContent || '[]'); } catch { /* no signs */ }
// ?debug&fake=N adds N made-up posts, to see how the layout copes with growth
const fake = new URLSearchParams(location.search).has('debug') ? Number(new URLSearchParams(location.search).get('fake') ?? 0) : 0;
for (let i = 0; i < fake; i++) items.push({ kind: 'post', path: `/blog/fake-${i}`, title: `テストの記事 ${i + 1}：少し長めのタイトルで折り返しを確かめる`, date: '2026-01-01', summary: '仮の概要です。'.repeat(4) });
const layout = ringLayout(items.length);
const world = new World(layout.plaza);
const player = new Player(world);
if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { __player: player, __keys: () => keys, __signs: () => signs });
player.p = [0.5, PLAZA_Y + 1, 3.5];
player.pitch = 0.08;

const signs: Sign[] = [];
const sign = (s: Omit<Sign, 'id' | 'quad'>) => {
  const sg = { ...s, id: signs.length, quad: quadAt(s.center, s.normal, s.w, s.h) };
  signs.push(sg);
  return sg;
};
const post = (x: number, z: number, top: number) => { for (let y = PLAZA_Y + 1; y <= top; y++) world.overrides.set(`${x},${y},${z}`, B.Log); };

// straight ahead: the site's name and how to move; clicking it opens the top page
const card = titleCard('oriom', mobile);
const titleSign = sign({ canvas: cardCanvas(card), href: '/', label: 'トップを開く', center: [0.5, PLAZA_Y + 3.7, -5], normal: [0, 0, 1], w: 5.6, h: 4.2 });
post(-2, -6, PLAZA_Y + 1); post(2, -6, PLAZA_Y + 1);

// works, then posts, on the arcs around the plaza
items.forEach((it, i) => {
  const sl = layout.slots[i]!;
  const bx = Math.floor(sl.x), bz = Math.floor(sl.z);
  const lift = 0;
  post(bx, bz, PLAZA_Y + 1 + lift);
  sign({
    canvas: it.kind === 'work' ? workCanvas(it) : postCanvas(it),
    href: it.path,
    label: `${it.title} を開く`,
    center: [bx + 0.5, PLAZA_Y + 3.05 + lift, bz + 0.5],
    normal: [sl.nx, 0, sl.nz],
    w: 2.4,
    h: 1.8,
  });
});

// redstone lamps on the floor between the spawn and the title sign: one row per node
// for CPU and one for memory, ten lamps each. Their labels stand beside the title
// sign, inside the gap the arcs leave open, so they hide no other sign.
const LAMP_X0 = -4, LAMP_Z0 = -2;
post(-5, -6, PLAZA_Y + 1); post(6, -6, PLAZA_Y + 1);
const lampSign = sign({ canvas: labelCanvas('クラスタ', '読み込み中…'), label: 'クラスタの CPU とメモリ', center: [-4.5, PLAZA_Y + 2.55, -5], normal: [0, 0, 1], w: 3.2, h: 1 });
const numSign = sign({ canvas: labelCanvas('いまの数字', '読み込み中…'), href: '/stats', label: 'いま動いているものを開く', center: [6.5, PLAZA_Y + 2.55, -5], normal: [0, 0, 1], w: 3.2, h: 1 });

const FOVY = 1.15;
/** How far back to stand so a sign `w` wide fits the screen (phones are narrow). */
const fitDistance = (w: number) => {
  const half = Math.atan(Math.tan(FOVY / 2) * (innerWidth / innerHeight));
  return Math.max(3.4, (w / 2 + 0.4) / Math.tan(half));
};
// the spawn: the whole title sign in view
player.p = [0.5, PLAZA_Y + 1, titleSign.center[2]! + fitDistance(titleSign.w)];

/** Opened by URL: stand in front of that page's sign (the popup is already open). */
function spawnAt(path: string): void {
  const s = signs.find((x) => x.href === path && x !== titleSign);
  if (!s) return;
  const d = fitDistance(s.w);
  player.p = [s.center[0]! + s.normal[0]! * d, PLAZA_Y + 1, s.center[2]! + s.normal[2]! * d];
  player.yaw = Math.atan2(s.normal[0]!, s.normal[2]!);
  player.pitch = 0;
}
if (location.pathname !== '/') spawnAt(location.pathname);

function applyStats(s: Stats | null): void {
  if (!s) return;
  const nodes = (s.cluster?.nodes ?? []).slice(0, 2);
  for (let i = 0; i < 2; i++) {
    const n = nodes[i];
    const cpu = n?.cpu ?? 0, mem = n ? (100 * n.memory.used) / n.memory.total : 0;
    for (let k = 0; k < 10; k++) {
      world.overrides.set(`${LAMP_X0 + k},${PLAZA_Y},${LAMP_Z0 + i * 2}`, n && cpu > k * 10 + 1 ? B.LampOn : B.LampOff);
      world.overrides.set(`${LAMP_X0 + k},${PLAZA_Y},${LAMP_Z0 + i * 2 + 1}`, n && mem > k * 10 + 1 ? B.LampOn : B.LampOff);
    }
  }
  lampSign.canvas = labelCanvas('クラスタ（列ごとに CPU / メモリ）', nodes.map((n) => `${n.name} ${n.cpu?.toFixed(0) ?? '—'}% / ${bytes(n.memory.used)}`).join('・') || 'データなし');
  numSign.canvas = labelCanvas(`訪問 ${s.views ?? '—'}`, `とんペディア ${s.tompedia?.total ?? '—'}人・Mosimo ${s.mosimo?.posts ?? '—'}件`);
  if (renderer) {
    renderer.setPanel(lampSign.id, lampSign.quad, lampSign.canvas);
    renderer.setPanel(numSign.id, numSign.quad, numSign.canvas);
    for (const key of ['-1,-1', '0,-1', '-1,0', '0,0']) if (loaded.has(key)) dirty.add(key);
  }
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
const srgb = (l: number, c: number, h: number) =>
  oklchToLinearSrgb(l, c, h).map((v) => { v = Math.max(0, Math.min(1, v)); return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; });
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i]! - v) * t);
const DAY_Z = srgb(0.66, 0.11, hue), DAY_H = srgb(0.88, 0.05, hue);
const NIGHT_Z = srgb(0.13, 0.03, hue), NIGHT_H = srgb(0.22, 0.04, hue);
const DUSK = srgb(0.72, 0.13, 45);

function sky() {
  const d = new Date();
  const hours = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  const a = ((hours - 6) / 24) * Math.PI * 2; // sunrise in the east (+x) at 6:00
  const sun = [Math.cos(a), Math.sin(a), 0.3];
  const l = Math.hypot(...sun);
  sun.forEach((v, i) => (sun[i] = v / l));
  const day = Math.min(1, Math.max(0, (sun[1]! + 0.08) / 0.35));
  const dusk = Math.max(0, 1 - Math.abs(sun[1]!) / 0.22);
  return { sun, day, zenith: mix(NIGHT_Z, DAY_Z, day), horizon: mix(mix(NIGHT_H, DAY_H, day), DUSK, dusk * 0.6) };
}

// ---------------------------------------------------------------- input
const keys = new Set<string>();
const joy = { x: 0, y: 0, id: -1, ox: 0, oy: 0 };
let look: { id: number; x: number; y: number; moved: number } | null = null;
let jumpHeld = false;

document.addEventListener('keydown', (e) => {
  if (popped() || !root.classList.contains('world') || e.altKey || e.ctrlKey || e.metaKey) return;
  if ((e.target as Element).closest?.('a,button,input,textarea')) return;
  keys.add(e.code);
  if (e.code === 'KeyF') player.fly = !player.fly;
  if (e.code === 'Enter' || e.code === 'KeyE') activate(aimed());
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
document.addEventListener('keyup', (e) => keys.delete(e.code));

// mouse: drag to look, click to open. touch: the left half is a joystick, the right
// half looks around; a tap opens what it hits.
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  if (e.pointerType === 'mouse') { if (e.button === 0) look = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 }; return; }
  if (e.clientX < innerWidth / 2 && joy.id < 0) { joy.id = e.pointerId; joy.ox = e.clientX; joy.oy = e.clientY; }
  else look = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId === joy.id) {
    const dx = e.clientX - joy.ox, dy = e.clientY - joy.oy, l = Math.max(50, Math.hypot(dx, dy));
    joy.x = dx / l; joy.y = -dy / l;
    const knob = document.querySelector<HTMLElement>('#joy i')!;
    knob.style.transform = `translate(${joy.x * 40}px,${-joy.y * 40}px)`;
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

// ---------------------------------------------------------------- picking
let viewProj = new Float32Array(16);
function aimed(sx?: number, sy?: number): Sign | null {
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
  let best: Sign | null = null, bestT = 14;
  for (const s of signs) {
    if (!s.href) continue;
    const n = s.normal;
    const denom = dir[0]! * n[0]! + dir[2]! * n[2]!;
    if (denom >= -1e-3) continue; // looking at its back or edge-on
    const t = ((s.center[0]! - eye[0]!) * n[0]! + (s.center[2]! - eye[2]!) * n[2]!) / denom;
    if (t <= 0 || t >= bestT) continue;
    const hit = [eye[0]! + dir[0]! * t, eye[1]! + dir[1]! * t, eye[2]! + dir[2]! * t];
    const along = (hit[0]! - s.center[0]!) * n[2]! - (hit[2]! - s.center[2]!) * n[0]!;
    if (Math.abs(along) <= s.w / 2 && Math.abs(hit[1]! - s.center[1]!) <= s.h / 2) { best = s; bestT = t; }
  }
  return best;
}
function activate(s: Sign | null): void {
  if (s?.href) popup.open(s.href, { show: true });
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
  // HTML-in-Canvas: when available the big sign shows the live DOM itself
  htmlCanvas(card, (cv) => r.setPanel(titleSign.id, titleSign.quad, cv));
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
  const fog = 1 / (RADIUS * CS * 0.42);
  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!popped()) {
      const k = (c: string) => (keys.has(c) ? 1 : 0);
      const mx = k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft') + joy.x;
      const mz = k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown') + joy.y;
      player.step(dt, [Math.max(-1, Math.min(1, mx)), Math.max(-1, Math.min(1, mz))], keys.has('Space') || jumpHeld, keys.has('ShiftLeft') && player.fly || keys.has('KeyC'), keys.has('ShiftLeft') || keys.has('ShiftRight'));
      const a = aimed();
      tip.textContent = a ? a.label : '';
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
    u.set([...s.horizon, 1], 44);
    u.set([0.2 + 0.4 * s.day, 1 - s.day, 0, 0], 48);
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
