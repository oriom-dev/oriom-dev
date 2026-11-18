// WebGPU renderer.
import type { Mesh } from './mesh.ts';
import { quadIndices, type Renderer, UNIFORM_FLOATS } from './render.ts';
import { WGSL } from './shaders.ts';

interface Chunk { cx: number; cz: number; op?: GPUBuffer; opN: number; wa?: GPUBuffer; waN: number }

export async function webgpu(canvas: HTMLCanvasElement): Promise<Renderer | null> {
  const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  device.addEventListener('uncapturederror', (e) => console.error('WebGPU:', (e as GPUUncapturedErrorEvent).error.message));
  const ctx = canvas.getContext('webgpu');
  if (!ctx) return null;
  const format = navigator.gpu.getPreferredCanvasFormat();
  // COPY_SRC only for ?debug snapshots (headless browsers cannot screenshot a WebGPU canvas)
  const debug = new URLSearchParams(location.search).has('debug');
  ctx.configure({ device, format, alphaMode: 'opaque', usage: GPUTextureUsage.RENDER_ATTACHMENT | (debug ? GPUTextureUsage.COPY_SRC : 0) });

  const module = device.createShaderModule({ code: WGSL });
  module.getCompilationInfo().then((i) => i.messages.forEach((m) => console.warn(`WGSL ${m.type} ${m.lineNum}:${m.linePos} ${m.message}`)));
  const ubuf = device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const g0 = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} }] });
  const g1 = device.createBindGroupLayout({ entries: [
    { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
  ] });
  const bind0 = device.createBindGroup({ layout: g0, entries: [{ binding: 0, resource: { buffer: ubuf } }] });
  const idxData = quadIndices();
  const ibuf = device.createBuffer({ size: idxData.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(ibuf, 0, idxData);
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' });

  const depthStencil = (write: boolean, compare: GPUCompareFunction = 'less'): GPUDepthStencilState => ({ format: 'depth24plus', depthWriteEnabled: write, depthCompare: compare });
  const blend: GPUBlendState = { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
  const terrainLayout: GPUVertexBufferLayout = { arrayStride: 16, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'uint32' }] };
  const layout0 = device.createPipelineLayout({ bindGroupLayouts: [g0] });
  const mk = (water: boolean) => device.createRenderPipeline({
    layout: layout0,
    vertex: { module, entryPoint: 'vs', buffers: [terrainLayout] },
    fragment: { module, entryPoint: 'fs', targets: [{ format, blend: water ? blend : undefined }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: depthStencil(!water),
  });
  const opaque = mk(false), water = mk(true);
  const sky = device.createRenderPipeline({
    layout: layout0,
    vertex: { module, entryPoint: 'sky_vs' },
    fragment: { module, entryPoint: 'sky_fs', targets: [{ format }] },
    depthStencil: depthStencil(false, 'always'),
  });
  const panelPipe = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [g0, g1] }),
    vertex: { module, entryPoint: 'panel_vs', buffers: [{ arrayStride: 20, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x2' }] }] },
    fragment: { module, entryPoint: 'panel_fs', targets: [{ format }] },
    primitive: { cullMode: 'none' },
    depthStencil: depthStencil(true),
  });

  let depth: GPUTexture | null = null;
  const chunks = new Map<string, Chunk>();
  const panels = new Map<number, { vb: GPUBuffer; bg: GPUBindGroup; tex: GPUTexture }>();
  const buf = (data: ArrayBuffer) => {
    const b = device.createBuffer({ size: Math.max(16, data.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    if (data.byteLength) device.queue.writeBuffer(b, 0, data);
    return b;
  };

  const drop = (key: string) => {
    const c = chunks.get(key);
    c?.op?.destroy(); c?.wa?.destroy();
    chunks.delete(key);
  };

  return {
    kind: 'webgpu',
    resize(w, h) {
      canvas.width = w; canvas.height = h;
      depth?.destroy();
      depth = device.createTexture({ size: [w, h], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
    },
    setChunk(key, m, [cx, cz]) {
      drop(key);
      chunks.set(key, { cx, cz, op: m.opaqueQuads ? buf(m.opaque) : undefined, opN: m.opaqueQuads, wa: m.waterQuads ? buf(m.water) : undefined, waN: m.waterQuads });
    },
    dropChunk: drop,
    setPanel(id, quad, image) {
      const old = panels.get(id);
      old?.vb.destroy(); old?.tex.destroy();
      const tex = device.createTexture({ size: [image.width, image.height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
      device.queue.copyExternalImageToTexture({ source: image }, { texture: tex }, [image.width, image.height]);
      const vb = buf(quad.buffer as ArrayBuffer);
      const bg = device.createBindGroup({ layout: g1, entries: [{ binding: 0, resource: sampler }, { binding: 1, resource: tex.createView() }] });
      panels.set(id, { vb, bg, tex });
    },
    render(u, visible) {
      device.queue.writeBuffer(ubuf, 0, u.buffer, u.byteOffset, UNIFORM_FLOATS * 4);
      const enc = device.createCommandEncoder();
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }],
        depthStencilAttachment: { view: depth!.createView(), depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1 },
      });
      pass.setBindGroup(0, bind0);
      pass.setPipeline(sky); pass.draw(3);
      pass.setPipeline(opaque);
      pass.setIndexBuffer(ibuf, 'uint32');
      const vis = [...chunks.values()].filter((c) => visible(c.cx, c.cz));
      for (const c of vis) if (c.op) { pass.setVertexBuffer(0, c.op); pass.drawIndexed(c.opN * 6); }
      pass.setPipeline(panelPipe);
      for (const p of panels.values()) { pass.setBindGroup(1, p.bg); pass.setVertexBuffer(0, p.vb); pass.drawIndexed(6); }
      pass.setPipeline(water);
      for (const c of vis) if (c.wa) { pass.setVertexBuffer(0, c.wa); pass.drawIndexed(c.waN * 6); }
      pass.end();
      if (debug && !(window as any).__snap) {
        const tex = ctx.getCurrentTexture(), bpr = Math.ceil((tex.width * 4) / 256) * 256;
        const out = device.createBuffer({ size: bpr * tex.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        enc.copyTextureToBuffer({ texture: tex }, { buffer: out, bytesPerRow: bpr }, [tex.width, tex.height]);
        (window as any).__snap = 'pending';
        device.queue.submit([enc.finish()]);
        out.mapAsync(GPUMapMode.READ).then(() => {
          const src = new Uint8Array(out.getMappedRange()), img = new ImageData(tex.width, tex.height);
          const bgra = format === 'bgra8unorm';
          for (let y = 0; y < tex.height; y++) for (let x = 0; x < tex.width; x++) {
            const i = y * bpr + x * 4, o = (y * tex.width + x) * 4;
            img.data[o] = src[i + (bgra ? 2 : 0)]!; img.data[o + 1] = src[i + 1]!; img.data[o + 2] = src[i + (bgra ? 0 : 2)]!; img.data[o + 3] = 255;
          }
          const c = Object.assign(document.createElement('canvas'), { width: tex.width, height: tex.height });
          c.getContext('2d')!.putImageData(img, 0, 0);
          (window as any).__snap = c.toDataURL('image/png');
        });
        return;
      }
      device.queue.submit([enc.finish()]);
    },
  };
}
