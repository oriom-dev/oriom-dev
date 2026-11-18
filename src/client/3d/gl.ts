// WebGL 2 renderer: the same scene for browsers without WebGPU.
import type { Mesh } from './mesh.ts';
import { quadIndices, type Renderer, UNIFORM_FLOATS } from './render.ts';
import { GL } from './shaders.ts';

export function webgl2(canvas: HTMLCanvasElement): Renderer | null {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
  if (!gl) return null;
  const prog = (vs: string, fs: string) => {
    const p = gl.createProgram()!;
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    const bi = gl.getUniformBlockIndex(p, 'U');
    if (bi !== gl.INVALID_INDEX) gl.uniformBlockBinding(p, bi, 0);
    return p;
  };
  const terrain = prog(GL.vs, GL.fs), sky = prog(GL.skyVs, GL.skyFs), panel = prog(GL.panelVs, GL.panelFs);
  const ubo = gl.createBuffer();
  gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
  gl.bufferData(gl.UNIFORM_BUFFER, UNIFORM_FLOATS * 4, gl.DYNAMIC_DRAW);
  gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, ubo);
  const ibo = gl.createBuffer();
  const indices = quadIndices();
  const skyVao = gl.createVertexArray();

  const vao = (data: ArrayBuffer, panelLayout = false) => {
    const v = gl.createVertexArray()!;
    gl.bindVertexArray(v);
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.enableVertexAttribArray(0); gl.enableVertexAttribArray(1);
    if (panelLayout) {
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    } else {
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 16, 0);
      gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_INT, 16, 12);
    }
    gl.bindVertexArray(null);
    return { v, b };
  };
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

  type V = { v: WebGLVertexArrayObject; b: WebGLBuffer | null };
  const chunks = new Map<string, { cx: number; cz: number; op?: V; opN: number; wa?: V; waN: number }>();
  const panels = new Map<number, { o: V; t: WebGLTexture }>();
  const free = (o?: V) => { if (o) { gl.deleteVertexArray(o.v); gl.deleteBuffer(o.b); } };

  const drop = (key: string) => {
    const c = chunks.get(key);
    if (c) { free(c.op); free(c.wa); chunks.delete(key); }
  };

  return {
    kind: 'webgl2',
    resize(w, h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); },
    setChunk(key, m, [cx, cz]) {
      drop(key);
      chunks.set(key, { cx, cz, op: m.opaqueQuads ? vao(m.opaque) : undefined, opN: m.opaqueQuads, wa: m.waterQuads ? vao(m.water) : undefined, waN: m.waterQuads });
    },
    dropChunk: drop,
    setPanel(id, quad, image) {
      const old = panels.get(id);
      if (old) { free(old.o); gl.deleteTexture(old.t); }
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      panels.set(id, { o: vao(quad.buffer as ArrayBuffer, true), t });
    },
    render(u, visible) {
      gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
      gl.bufferSubData(gl.UNIFORM_BUFFER, 0, u, 0, UNIFORM_FLOATS);
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.disable(gl.BLEND);
      gl.useProgram(sky);
      gl.bindVertexArray(skyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.useProgram(terrain);
      const vis = [...chunks.values()].filter((c) => visible(c.cx, c.cz));
      for (const c of vis) if (c.op) { gl.bindVertexArray(c.op.v); gl.drawElements(gl.TRIANGLES, c.opN * 6, gl.UNSIGNED_INT, 0); }
      gl.useProgram(panel);
      for (const p of panels.values()) { gl.bindTexture(gl.TEXTURE_2D, p.t); gl.bindVertexArray(p.o.v); gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_INT, 0); }
      gl.useProgram(terrain);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      for (const c of vis) if (c.wa) { gl.bindVertexArray(c.wa.v); gl.drawElements(gl.TRIANGLES, c.waN * 6, gl.UNSIGNED_INT, 0); }
      gl.bindVertexArray(null);
    },
  };
}
