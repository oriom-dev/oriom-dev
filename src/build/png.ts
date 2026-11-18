// A tiny PNG writer and stroke rasteriser for the PWA icons (no image libraries).
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf: Buffer) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};

/** RGBA pixels -> PNG. */
export function png(w: number, h: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** A filled background with an anti-aliased stroke along a polyline (unit coordinates). */
export function strokeIcon(size: number, pts: [number, number][], width: number, fg: number[], bg: number[]): Buffer {
  const px = new Uint8Array(size * size * 4);
  const P = pts.map(([x, y]) => [x * size, y * size] as const);
  const half = (width * size) / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let d = Infinity;
    for (let i = 1; i < P.length; i++) {
      const [ax, ay] = P[i - 1]!, [bx, by] = P[i]!;
      const vx = bx - ax, vy = by - ay, t = Math.max(0, Math.min(1, ((x + 0.5 - ax) * vx + (y + 0.5 - ay) * vy) / (vx * vx + vy * vy || 1)));
      d = Math.min(d, Math.hypot(x + 0.5 - ax - t * vx, y + 0.5 - ay - t * vy));
    }
    const a = Math.max(0, Math.min(1, half - d + 0.5));
    const o = (y * size + x) * 4;
    for (let c = 0; c < 3; c++) px[o + c] = Math.round(bg[c]! * (1 - a) + fg[c]! * a);
    px[o + 3] = 255;
  }
  return png(size, size, px);
}
