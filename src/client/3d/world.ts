// The world: terrain, biomes and trees from noise, plus the fixed "plaza" around the
// spawn point where the site's content stands. Near the spawn a fixed seed is used,
// so the plaza and its surroundings are always the same; farther out the terrain
// blends into a seed that is new on every page load.
import { fbm, hash, noise2, smoothstep } from './noise.ts';

export const CS = 16; // chunk size (x, z)
export const H = 80; // world height
export const SEA = 24;

export const B = { Air: 0, Grass: 1, Dirt: 2, Stone: 3, Sand: 4, Water: 5, Log: 6, Leaves: 7, Snow: 8, LampOff: 9, LampOn: 10, Plank: 11, Gravel: 12 } as const;
export const SOLID = (b: number) => b !== B.Air && b !== B.Water;
export const OPAQUE = (b: number) => b !== B.Air && b !== B.Water;

const FIXED_SEED = 20261118;
export const PLAZA = 9; // radius of the flat plaza
export const PLAZA_Y = 32; // its surface height

export interface Column { h: number; top: number; filler: number; tree: number }

export class World {
  readonly seed: number;
  /** Blocks placed on top of the terrain (plaza furniture, lamps), by "x,y,z". */
  readonly overrides = new Map<string, number>();

  constructor(seed = (Math.random() * 2 ** 31) | 0) {
    this.seed = seed;
  }

  /** 0 at the spawn, 1 far away: how much of the per-visit random world shows. */
  static blend(x: number, z: number): number {
    return smoothstep(40, 140, Math.hypot(x, z));
  }

  private shape(x: number, z: number, seed: number) {
    const temp = fbm(x / 420, z / 420, seed + 7, 2);
    const wet = fbm(x / 380, z / 380, seed + 13, 2);
    const cont = fbm(x / 260, z / 260, seed + 3, 3);
    const hills = fbm(x / 70, z / 70, seed, 4);
    const ridge = 1 - Math.abs(noise2(x / 140, z / 140, seed + 29));
    const mountain = smoothstep(0.15, 0.5, cont) * ridge * ridge;
    const h = SEA + 6 + cont * 14 + hills * 9 + mountain * 34;
    return { h, temp, wet, mountain };
  }

  column(x: number, z: number): Column {
    const w = World.blend(x, z);
    const a = this.shape(x, z, FIXED_SEED);
    const s = w > 0 ? this.shape(x, z, this.seed) : a;
    let h = a.h + (s.h - a.h) * w;
    const temp = a.temp + (s.temp - a.temp) * w, wet = a.wet + (s.wet - a.wet) * w, mtn = a.mountain + (s.mountain - a.mountain) * w;
    // the plaza: flat in the middle, easing into the terrain
    const d = Math.hypot(x + 0.5, z + 0.5);
    const p = smoothstep(PLAZA + 1, PLAZA + 14, d);
    h = PLAZA_Y + (h - PLAZA_Y) * p;
    const hi = Math.max(1, Math.min(H - 12, Math.floor(h)));
    let top: number = B.Grass, filler: number = B.Dirt;
    if (hi <= SEA + 1 && temp > -0.25) { top = B.Sand; filler = B.Sand; }
    else if (temp > 0.25 && wet < 0) { top = B.Sand; filler = B.Sand; } // desert
    if (hi > SEA + 26 || (temp < -0.3 && hi > SEA + 4)) top = B.Snow;
    if (mtn > 0.35 && hi > SEA + 18 && top !== B.Snow) { top = B.Stone; filler = B.Stone; }
    if (d < PLAZA) { top = hash(x, z, 5) < 0.85 ? B.Gravel : B.Stone; filler = B.Stone; }
    // trees: forests where it is wet, a few on plains, none on sand, snow peaks or the plaza
    const seed = w > 0.5 ? this.seed : FIXED_SEED;
    const forest = smoothstep(-0.1, 0.4, wet) * 0.07 + 0.004;
    const tree = top === B.Grass && hi > SEA + 1 && d > PLAZA + 3 && hash(x, z, seed + 99) < forest ? 4 + Math.floor(hash(x, z, seed + 7) * 3) : 0;
    return { h: hi, top, filler, tree };
  }

  /**
   * Fills a chunk with a one-block apron on every side (so meshing never needs the
   * neighbours): index ((y * (CS+2)) + (z+1)) * (CS+2) + (x+1).
   */
  generate(cx: number, cz: number): Uint8Array {
    const S = CS + 2;
    const v = new Uint8Array(S * S * H);
    const ox = cx * CS - 1, oz = cz * CS - 1;
    const set = (x: number, y: number, z: number, b: number, soft = false) => {
      if (x < 0 || z < 0 || x >= S || z >= S || y < 0 || y >= H) return;
      const i = (y * S + z) * S + x;
      if (!soft || v[i] === B.Air) v[i] = b;
    };
    const R = 2; // tree crown radius: trees from columns just outside still reach in
    for (let z = -R; z < S + R; z++) {
      for (let x = -R; x < S + R; x++) {
        const c = this.column(ox + x, oz + z);
        const inside = x >= 0 && z >= 0 && x < S && z < S;
        if (inside) {
          for (let y = 0; y <= c.h; y++) set(x, y, z, y === c.h ? c.top : y > c.h - 4 ? c.filler : B.Stone);
          for (let y = c.h + 1; y <= SEA; y++) set(x, y, z, B.Water);
        }
        if (c.tree) {
          const t = c.h + c.tree;
          for (let y = c.h + 1; y <= t; y++) set(x, y, z, B.Log);
          for (let dy = -2; dy <= 1; dy++) {
            const r = dy < 0 ? 2 : 1;
            for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
              if (Math.abs(dx) === r && Math.abs(dz) === r && (dy === 1 || hash(ox + x + dx, oz + z + dz, t + dy) < 0.5)) continue;
              set(x + dx, t + dy, z + dz, B.Leaves, true);
            }
          }
          set(x, t + 2, z, B.Leaves, true);
        }
      }
    }
    for (const [k, b] of this.overrides) {
      const [x, y, z] = k.split(',').map(Number) as [number, number, number];
      set(x - ox, y, z - oz, b);
    }
    return v;
  }

  /** Solid block test for collisions (does not include the apron logic). */
  solidAt(x: number, y: number, z: number): boolean {
    if (y < 0) return true;
    if (y >= H) return false;
    const o = this.overrides.get(`${x},${y},${z}`);
    if (o !== undefined) return SOLID(o);
    const c = this.column(x, z);
    if (y <= c.h) return true;
    if (c.tree && y <= c.h + c.tree) {
      return true; // trunk (crowns are not solid enough to stand in; we walk through leaves)
    }
    return false;
  }

  waterAt(x: number, y: number, z: number): boolean {
    const c = this.column(x, z);
    return y > c.h && y <= SEA;
  }
}
