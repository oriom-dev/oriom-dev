import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { buildSync, transformSync } from 'esbuild';
import { PALETTE } from '../shared/color.ts';
import type { Variant } from '../shared/types.ts';
import { ROOT } from './content.ts';

const CLIENT = path.join(ROOT, 'src/client');
const DEV = process.env.NODE_ENV === 'development';

export function bundleJs(entry: string, format: 'iife' | 'esm' = 'iife'): string {
  const r = buildSync({
    entryPoints: [entry], bundle: true, write: false, format, target: 'es2022',
    minify: !DEV, legalComments: 'none', charset: 'utf8', define: { 'process.env.NODE_ENV': '"production"' },
  });
  return r.outputFiles[0]!.text.trim();
}

const minCss = (css: string) => transformSync(css, { loader: 'css', minify: !DEV, target: ['chrome110', 'safari16', 'firefox115'] }).code.trim();

function paletteCss(): string {
  const decl = (t: keyof typeof PALETTE) =>
    Object.entries(PALETTE[t]).map(([k, [l, c]]) => `--${k}:oklch(${l} ${c} var(--h))`).join(';');
  return `:root{${decl('light')}}@media (prefers-color-scheme:dark){:root{${decl('dark')}}}`;
}

// Favicon: one Bézier stroke in the page's hue, inline so it costs no request.
const icon = (variant: Variant) => {
  const d = { '1d': 'M4 24C10 4 22 4 28 24', '2d': 'M5 5h22v22H5z', '3d': 'M16 3 28 10v12L16 29 4 22V10z' }[variant];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="${d}" fill="none" stroke="oklch(0.6 0.12 __HUE__)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};

/**
 * The full page minus the slots filled at serve time:
 * <!--@head--> page meta, <!--@body--> content, <!--@stats--> JSON, __HUE__ hue.
 */
export function template(variant: Variant, slots: Record<string, string> = {}): string {
  const dir = path.join(CLIENT, variant);
  const css = minCss(
    paletteCss() + readFileSync(path.join(CLIENT, 'base.css'), 'utf8') + readFileSync(path.join(dir, 'style.css'), 'utf8'),
  );
  const js = bundleJs(path.join(dir, 'main.ts')).replace(/<\/script/gi, '<\\/script');
  let html = existsSync(path.join(dir, 'shell.html')) ? readFileSync(path.join(dir, 'shell.html'), 'utf8').trim() : '<main id="c"><!--@body--></main>';
  // build-time slots (site-wide parts such as the 2D map); serve-time slots stay
  for (const [k, v] of Object.entries(slots)) html = html.replace(`<!--#${k}-->`, () => v);
  html = html.replace(/>\s+</g, '><');
  return '<!doctype html>'
    + `<html lang="ja" data-v="${variant}" style="--h:__HUE__">`
    + '<head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
    + '<meta name="color-scheme" content="light dark">'
    + `<link rel="icon" href="${icon(variant)}">`
    + '<!--@head-->'
    + `<style>${css}</style></head>`
    + `<body><a class="skip" href="#c">本文へ移動</a>${html}`
    + '<script type="application/json" id="stats"><!--@stats--></script>'
    + `<script>${js}</script></body></html>`;
}
