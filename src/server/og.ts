// OGP images (1200×630 PNG) for every page, made when first asked for and kept while the
// page stays the same: the site's name, the title, the summary and, for a work or a badge,
// its line drawing, on a card in the site's palette. The hue comes from the path, so each
// page has its own colour but always the same one. SVG -> PNG by resvg (WebAssembly), with
// the fonts of tools/ogfont.py (OGP_FONTS: og-300.ttf, og-500.ttf).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseArtAttr, separatePath } from '../shared/art.ts';
import { oklchToLinearSrgb, PALETTE } from '../shared/color.ts';
import type { PageOut } from '../shared/types.ts';

export const OG_W = 1200, OG_H = 630;
const FAMILY = 'Noto Sans CJK JP';

const hex = (l: number, c: number, h: number) =>
  `#${oklchToLinearSrgb(l, c, h).map((v) => {
    v = Math.max(0, Math.min(1, v));
    return Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)).toString(16).padStart(2, '0');
  }).join('')}`;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Width in em: full-width characters 1, the rest about half (Noto Sans's Latin). */
const emWidth = (ch: string) => (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 1 : /[A-Z@#%&mw]/.test(ch) ? 0.66 : 0.52);

/** Lines of at most `width` em, breaking anywhere for Japanese and at spaces for words;
 *  the last allowed line ends with "…" when the text goes on. */
export function wrapEm(text: string, width: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = '', w = 0;
  // words (with their brackets and trailing punctuation) stay whole; Japanese breaks anywhere
  const tokens = text.replace(/\s+/g, ' ').trim().match(/[(（]?[A-Za-z0-9.,'’\-_/:]+[)）]?[,.:;]?|\s|./gu) ?? [];
  for (const t of tokens) {
    const tw = [...t].reduce((a, ch) => a + emWidth(ch), 0);
    // kinsoku: punctuation and closing brackets never start a line (they overhang instead)
    if (w + tw > width && line.trim() && /^[、。・，．）」』】！？!?:;,.…ー]$/.test(t)) { line += t; w += tw; continue; }
    if (w + tw > width && line.trim()) {
      lines.push(line.trimEnd());
      line = ''; w = 0;
      if (t === ' ') continue;
    }
    if (tw > width) { // a word longer than the line: split it
      for (const ch of t) { if (w + emWidth(ch) > width) { lines.push(line); line = ''; w = 0; } line += ch; w += emWidth(ch); }
      continue;
    }
    line += t; w += tw;
  }
  if (line.trim()) lines.push(line.trimEnd());
  if (lines.length > maxLines) {
    const last = [...lines[maxLines - 1]!];
    while (last.length && last.reduce((a, ch) => a + emWidth(ch), 0) > width - 1) last.pop();
    return [...lines.slice(0, maxLines - 1), `${last.join('')}…`];
  }
  return lines;
}

const KIND = { work: '実績', badge: 'バッジ', post: '記事' } as const;

/** The card as SVG (exported for the tests). */
export function ogSvg(page: PageOut): string {
  const h = parseInt(createHash('sha256').update(page.path).digest('hex').slice(0, 4), 16) % 360;
  const P = PALETTE.light;
  const bg = hex(...P.bg, h), fg = hex(...P.fg, h), muted = hex(...P.muted, h), line = hex(...P.line, h);
  const it = page.item;
  const top = page.path === '/';
  const desc = unesc(/<meta name="description" content="([^"]*)"/.exec(page.head)?.[1] ?? '');
  const summary = it?.summary || desc;
  const art = it?.art ? parseArtAttr(it.art) : null;
  const textW = art ? 660 : 1000; // the drawing takes the right side
  // long titles (badges have very long ones) get smaller, so they are read to the end
  const title = top ? 'oriom.dev' : page.title;
  const maxLines = (z: number) => (z >= 52 ? 3 : 4);
  const titleSize = top ? 96 : [64, 52, 44, 36].find((z) => wrapEm(title, textW / z, 99).length <= maxLines(z)) ?? 36;
  const titleLines = wrapEm(title, textW / titleSize, maxLines(titleSize));
  const sumSize = 30;
  const sumLines = wrapEm(summary, textW / sumSize, titleLines.length >= 4 ? 1 : titleLines.length > 2 ? 2 : 3);
  const parts: string[] = [];
  parts.push(`<rect width="${OG_W}" height="${OG_H}" fill="${bg}"/>`);
  parts.push(`<rect x="24" y="24" width="${OG_W - 48}" height="${OG_H - 48}" fill="none" stroke="${line}" stroke-width="6" rx="4"/>`);
  if (!top) parts.push(`<text x="96" y="112" font-family="${FAMILY}" font-weight="300" font-size="32" fill="${muted}">oriom.dev</text>`);
  const meta = [it ? KIND[it.kind] : '', it?.date ?? (it && it.kind !== 'post' ? '進行中' : ''), it?.by ?? ''].filter(Boolean).join('・');
  if (meta) parts.push(`<text x="${OG_W - 96}" y="112" text-anchor="end" font-family="${FAMILY}" font-weight="300" font-size="28" fill="${muted}">${esc(meta)}</text>`);
  // the title and the summary sit in the middle, as a block
  const blockH = titleLines.length * titleSize * 1.25 + 28 + sumLines.length * sumSize * 1.6;
  let y = Math.max(200, (OG_H - blockH) / 2 + 40) + titleSize * 0.9;
  for (const l of titleLines) { parts.push(`<text x="96" y="${y}" font-family="${FAMILY}" font-weight="500" font-size="${titleSize}" fill="${fg}">${esc(l)}</text>`); y += titleSize * 1.25; }
  y += 28 - titleSize * 0.25 + sumSize * 0.6;
  for (const l of sumLines) { parts.push(`<text x="96" y="${y}" font-family="${FAMILY}" font-weight="300" font-size="${sumSize}" fill="${muted}">${esc(l)}</text>`); y += sumSize * 1.6; }
  if (art) {
    const box = 300, s = Math.min(box / 1000, box / (1000 / art.aspect));
    const ox = OG_W - 96 - box + (box - 1000 * s) / 2, oy = (OG_H - (1000 / art.aspect) * s) / 2 + 20;
    parts.push(`<path d="${separatePath(art, s, ox, oy)}" fill="none" stroke="${line}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_W}" height="${OG_H}" viewBox="0 0 ${OG_W} ${OG_H}">${parts.join('')}</svg>`;
}

export interface OgMaker { (page: PageOut): Buffer }

/** Null when the fonts are not there (the pages then still name the image; it is a 404). */
export async function ogMaker(fontDir = process.env.OGP_FONTS): Promise<OgMaker | null> {
  if (!fontDir || !existsSync(path.join(fontDir, 'og-500.ttf'))) return null;
  const { initWasm, Resvg } = await import('@resvg/resvg-wasm');
  const require = createRequire(import.meta.url);
  await initWasm(readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
  const fontBuffers = ['og-300.ttf', 'og-500.ttf'].map((f) => readFileSync(path.join(fontDir, f)));
  const cache = new Map<string, { key: string; png: Buffer }>();
  return (page) => {
    const svg = ogSvg(page);
    const key = createHash('sha256').update(svg).digest('hex');
    const hit = cache.get(page.path);
    if (hit?.key === key) return hit.png;
    const png = Buffer.from(new Resvg(svg, { font: { fontBuffers, loadSystemFonts: false, defaultFontFamily: FAMILY } }).render().asPng());
    if (cache.size > 300) cache.clear();
    cache.set(page.path, { key, png });
    return png;
  };
}
