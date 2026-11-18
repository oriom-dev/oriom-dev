// 3D: walk around a block world generated from noise. The site's content stands on
// signs in the plaza around the spawn point; the reader overlay holds the same DOM.
import { oklchToLinearSrgb } from '../../shared/color.ts';
import { bytes } from '../../shared/stats.ts';
import type { Stats } from '../../shared/types.ts';
import { NO3D_COOKIE } from '../../shared/variant.ts';
import { boot, readStats } from '../common.ts';
import { webgl2 } from './gl.ts';
import { webgpu } from './gpu.ts';
import { forward, invert, mul, perspective, view } from './math.ts';
import { meshChunk } from './mesh.ts';
import { htmlCanvas, labelCanvas, pageCanvas, quadAt, type Sign, workCanvas } from './panels.ts';
import { Player } from './player.ts';
import type { Renderer } from './render.ts';
import { UNIFORM_FLOATS } from './render.ts';
import { B, CS, PLAZA_Y, World } from './world.ts';

boot();

const root = document.documentElement;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('view');
const main = $('c');
const sheet = document.querySelector<HTMLElement>('.sheet')!;
const tip = $('tip');
const mobile = matchMedia('(pointer:coarse)').matches;
const hue = Number(root.style.getPropertyValue('--h')) || 220;

// ---------------------------------------------------------------- reader
let playing = false;
function openReader(): void {
  if (main.parentElement !== sheet) sheet.querySelector('.close')!.after(main);
  root.classList.add('reading');
  stopPlaying();
  $('start').hidden = true;
  (main.querySelector('h1') as HTMLElement | null)?.focus?.();
}
function closeReader(): void {
  root.classList.remove('reading');
  $('start').hidden = false;
}
$('read').onclick = openReader;
$('read2').onclick = openReader;
sheet.querySelector<HTMLButtonElement>('.close')!.onclick = closeReader;
main.querySelector('h1')?.setAttribute('tabindex', '-1');

// ---------------------------------------------------------------- world and signs
const world = new World();
const player = new Player(world);
if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { __player: player, __keys: () => keys });
player.p = [0.5, PLAZA_Y + 1, 4.5];
player.pitch = 0.08;

const signs: Sign[] = [];
// every work, from a <template> the build embeds in the 3D page (inert: not in the a11y tree twice)
const workLinks = [...(document.querySelector<HTMLTemplateElement>('template#works-data')?.content.querySelectorAll<HTMLAnchorElement>('a') ?? [])];
const sign = (s: Omit<Sign, 'id' | 'quad'>) => {
  const sg = { ...s, id: signs.length, quad: quadAt(s.center, s.normal, s.w, s.h) };
  signs.push(sg);
  return sg;
};
const post = (x: number, z: number, top: number) => { for (let y = PLAZA_Y + 1; y <= top; y++) world.overrides.set(`${x},${y},${z}`, B.Log); };

// the page itself, facing the spawn
const pageSign = sign({ canvas: pageCanvas(main), reader: true, label: '本文を読む', center: [0.5, PLAZA_Y + 4.2, -6], normal: [0, 0, 1], w: 6, h: 4.5 });
post(-2, -7, PLAZA_Y + 2); post(2, -7, PLAZA_Y + 2);

// works in an arc around the plaza
const arcWorks = workLinks;
arcWorks.forEach((a, i) => {
  const n = arcWorks.length;
  const ang = Math.PI * (0.32 + (1.36 * (i + 0.5)) / n); // from the left of the page sign, round the back, to the right
  const r = 8.5;
  const x = -Math.sin(ang) * r, z = -Math.cos(ang) * r;
  const nx = Math.sin(ang), nz = Math.cos(ang); // face the centre
  const bx = Math.floor(x), bz = Math.floor(z);
  post(bx, bz, PLAZA_Y + 1);
  sign({ canvas: workCanvas(a), href: a.getAttribute('href')!, label: `${a.querySelector('b')?.textContent ?? ''} を開く`, center: [bx + 0.5, PLAZA_Y + 3.05, bz + 0.5], normal: [nx, 0, nz], w: 2.4, h: 1.8 });
});

// redstone lamps: one row per node for CPU and one for memory, ten lamps each
const LAMP_X0 = -4, LAMP_Z0 = 5;
const lampSign = sign({ canvas: labelCanvas('クラスタ', '読み込み中…'), label: 'クラスタの CPU とメモリ', center: [0.5, PLAZA_Y + 2.55, LAMP_Z0 + 4], normal: [0, 0, -1], w: 3.2, h: 1 });
post(0, LAMP_Z0 + 4, PLAZA_Y + 1); post(-6, 2, PLAZA_Y + 1);
const numSign = sign({ canvas: labelCanvas('いまの数字', '読み込み中…'), href: '/stats', label: 'いま動いているものを開く', center: [-5.5, PLAZA_Y + 2.55, 2.5], normal: [1, 0, 0], w: 3.2, h: 1 });

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
    for (const key of ['-1,0', '0,0']) if (loaded.has(key)) dirty.add(key);
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

function startPlaying(): void {
  playing = true;
  root.classList.add('playing');
  $('start').hidden = true;
  if (!mobile) canvas.requestPointerLock?.();
}
function stopPlaying(): void {
  playing = false;
  root.classList.remove('playing');
  if (document.pointerLockElement) document.exitPointerLock();
  keys.clear();
}
$('go').onclick = startPlaying;
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && playing && !mobile) { stopPlaying(); if (!root.classList.contains('reading')) $('start').hidden = false; }
});
document.addEventListener('keydown', (e) => {
  if (root.classList.contains('reading')) { if (e.key === 'Escape') closeReader(); return; }
  if (!playing) return;
  keys.add(e.code);
  if (e.code === 'KeyF') player.fly = !player.fly;
  if (e.code === 'Enter' || e.code === 'KeyE') activate(aimed());
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
document.addEventListener('keyup', (e) => keys.delete(e.code));
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  player.yaw -= e.movementX * 0.0025;
  player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch - e.movementY * 0.0025));
});
canvas.addEventListener('click', () => {
  if (mobile) return;
  if (!playing) startPlaying();
  else if (document.pointerLockElement === canvas) activate(aimed());
});
// keyboard users who tab into the content get the reader
main.addEventListener('focusin', () => { if (!root.classList.contains('reading')) openReader(); });

// touch: left half moves (joystick), right half looks, a tap opens what it hits
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') return;
  if (!playing) startPlaying();
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
    player.yaw -= (e.clientX - look.x) * 0.006;
    player.pitch = Math.max(-1.55, Math.min(1.55, player.pitch - (e.clientY - look.y) * 0.006));
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
    if (!s.href && !s.reader) continue;
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
  if (!s) return;
  if (s.reader) openReader();
  else if (s.href) location.href = s.href;
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
    return; // the reader stays open: still the whole page
  }
  root.classList.add('world');
  root.dataset.renderer = renderer.kind;
  $('start').hidden = false;
  const r = renderer;
  for (const s of signs) r.setPanel(s.id, s.quad, s.canvas);
  // HTML-in-Canvas: when available the big sign shows the live DOM itself
  htmlCanvas(main, (cv) => r.setPanel(pageSign.id, pageSign.quad, cv));
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
    if (playing) {
      const k = (c: string) => (keys.has(c) ? 1 : 0);
      const mx = k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft') + joy.x;
      const mz = k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown') + joy.y;
      player.step(dt, [Math.max(-1, Math.min(1, mx)), Math.max(-1, Math.min(1, mz))], keys.has('Space') || jumpHeld, keys.has('ShiftLeft') && player.fly || keys.has('KeyC'), keys.has('ShiftLeft') || keys.has('ShiftRight'));
      const a = aimed();
      tip.textContent = a ? a.label : '';
    }
    updateChunks(mobile ? 4 : 7);
    const eye = [player.p[0]!, player.p[1]! + player.eye, player.p[2]!];
    const proj = perspective(1.15, innerWidth / innerHeight, 0.08, RADIUS * CS * 1.5, r.kind === 'webgpu');
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
