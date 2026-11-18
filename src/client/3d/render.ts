import type { Mesh } from './mesh.ts';

export interface Renderer {
  kind: 'webgpu' | 'webgl2';
  resize(w: number, h: number): void;
  setChunk(key: string, m: Mesh, center: [number, number]): void;
  dropChunk(key: string): void;
  /** A textured quad: 4 vertices of x, y, z, u, v. */
  setPanel(id: number, quad: Float32Array, image: HTMLCanvasElement): void;
  render(uniforms: Float32Array, visible: (cx: number, cz: number) => boolean): void;
}

export const UNIFORM_FLOATS = 64; // 2 mat4 + 8 vec4
export const MAX_QUADS = 1 << 16;

export function quadIndices(): Uint32Array<ArrayBuffer> {
  const idx = new Uint32Array(MAX_QUADS * 6);
  for (let q = 0, i = 0; q < MAX_QUADS; q++, i += 6) {
    const v = q * 4;
    idx[i] = v; idx[i + 1] = v + 1; idx[i + 2] = v + 2; idx[i + 3] = v; idx[i + 4] = v + 2; idx[i + 5] = v + 3;
  }
  return idx;
}
