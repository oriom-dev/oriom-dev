// Contact sheet of content/art: each drawing as separate strokes (2D/3D) above the
// same drawing as one line (1D).  node tools/artpreview.ts > sheet.svg
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { oneStroke, separatePath, type Art } from '../src/shared/art.ts';

const dir = path.resolve(import.meta.dirname, '../content/art');
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
const W = 260, cols = 5;
let out = '';
files.forEach((f, i) => {
  const a: Art = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
  const s = (W - 40) / 1000, x = (i % cols) * W + 20, y = Math.floor(i / cols) * 2 * W + 20;
  const one = oneStroke(a, s, x, y + W);
  out += `<text x="${x}" y="${y - 4}" font-size="12">${f}</text>`
    + `<path d="${separatePath(a, s, x, y)}"/>`
    + `<path d="M${one.start[0]} ${one.start[1]}${one.d}" stroke="#a33"/>`;
});
const rows = Math.ceil(files.length / cols);
console.log(`<svg xmlns="http://www.w3.org/2000/svg" width="${cols * W}" height="${rows * 2 * W}" viewBox="0 0 ${cols * W} ${rows * 2 * W}"><rect width="100%" height="100%" fill="#fff"/><g fill="none" stroke="#222" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${out}</g></svg>`);
