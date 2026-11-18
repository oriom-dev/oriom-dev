// Chunk meshing: one quad per visible face, with per-vertex ambient occlusion.
// Vertex = float32 x, y, z + uint32 (normal | block << 3 | ao << 8): 16 bytes.
import { B, CS, H, OPAQUE } from './world.ts';

const S = CS + 2;
// normal, tangent u, tangent v
const FACES: [number[], number[], number[]][] = [
  [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 1, 0], [0, 0, 1]],
  [[0, 1, 0], [1, 0, 0], [0, 0, 1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [1, 0, 0], [0, 1, 0]],
];
const CORNERS = [[0, 0], [1, 0], [1, 1], [0, 1]];

export interface Mesh { opaque: ArrayBuffer; opaqueQuads: number; water: ArrayBuffer; waterQuads: number }

export function meshChunk(v: Uint8Array, cx: number, cz: number): Mesh {
  const at = (x: number, y: number, z: number) => (y < 0 ? B.Stone : y >= H ? B.Air : v[(y * S + z + 1) * S + x + 1]!);
  const op: number[] = [], wa: number[] = [];
  const ox = cx * CS, oz = cz * CS;
  for (let y = 0; y < H; y++) for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
    const b = at(x, y, z);
    if (b === B.Air) continue;
    const water = b === B.Water;
    for (let f = 0; f < 6; f++) {
      const [n, u, w] = FACES[f]!;
      const nb = at(x + n[0]!, y + n[1]!, z + n[2]!);
      if (water ? nb !== B.Air : OPAQUE(nb)) continue;
      if (water && f !== 2 && nb !== B.Air) continue;
      const out = water ? wa : op;
      const ao: number[] = [];
      const pos: number[][] = [];
      for (const [cu, cv] of CORNERS) {
        const du = cu ? 1 : -1, dv = cv ? 1 : -1;
        const px = x + n[0]!, py = y + n[1]!, pz = z + n[2]!;
        const s1 = OPAQUE(at(px + u[0]! * du, py + u[1]! * du, pz + u[2]! * du)) ? 1 : 0;
        const s2 = OPAQUE(at(px + w[0]! * dv, py + w[1]! * dv, pz + w[2]! * dv)) ? 1 : 0;
        const c = OPAQUE(at(px + u[0]! * du + w[0]! * dv, py + u[1]! * du + w[1]! * dv, pz + u[2]! * du + w[2]! * dv)) ? 1 : 0;
        ao.push(water ? 3 : s1 && s2 ? 0 : 3 - s1 - s2 - c);
        const bx = x + (n[0]! > 0 ? 1 : 0), by = y + (n[1]! > 0 ? 1 : 0), bz = z + (n[2]! > 0 ? 1 : 0);
        pos.push([ox + bx + u[0]! * cu + w[0]! * cv, by + u[1]! * cu + w[1]! * cv - (water && f === 2 ? 0.12 : 0), oz + bz + u[2]! * cu + w[2]! * cv]);
      }
      // the shared index buffer always splits 0-2; rotate when the other diagonal looks better
      const start = ao[0]! + ao[2]! < ao[1]! + ao[3]! ? 1 : 0;
      for (let k = 0; k < 4; k++) {
        const i = (k + start) % 4;
        out.push(pos[i]![0]!, pos[i]![1]!, pos[i]![2]!, f | (b << 3) | (ao[i]! << 8));
      }
    }
  }
  const pack = (a: number[]) => {
    const buf = new ArrayBuffer(a.length * 4);
    const f = new Float32Array(buf), u = new Uint32Array(buf);
    for (let i = 0; i < a.length; i += 4) { f[i] = a[i]!; f[i + 1] = a[i + 1]!; f[i + 2] = a[i + 2]!; u[i + 3] = a[i + 3]!; }
    return buf;
  };
  return { opaque: pack(op), opaqueQuads: op.length / 16, water: pack(wa), waterQuads: wa.length / 16 };
}
