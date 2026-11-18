// OKLCH -> sRGB math, used at build time to pick lightness/chroma pairs that stay
// in the sRGB gamut and keep the required contrast for *every* hue. At runtime only
// the hue changes (CSS custom property --h), so any random hue is safe.

export type Lch = readonly [l: number, c: number];

export function oklchToLinearSrgb(l: number, c: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h), b = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

const EPS = 1e-4;
export const inGamut = (rgb: readonly number[]) => rgb.every((v) => v >= -EPS && v <= 1 + EPS);

/** WCAG 2 relative luminance (input is already linear light). */
export const luminance = ([r, g, b]: readonly number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export const contrast = (x: readonly number[], y: readonly number[]) => {
  const [a, b] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (a + 0.05) / (b + 0.05);
};

/** Largest chroma at lightness l that is inside sRGB for all hues (sampled every degree). */
export function maxChromaAllHues(l: number): number {
  let lo = 0, hi = 0.4;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    let ok = true;
    for (let h = 0; h < 360 && ok; h++) ok = inGamut(oklchToLinearSrgb(l, mid, h));
    if (ok) lo = mid; else hi = mid;
  }
  return lo;
}

/**
 * The single-hue palettes. `fg` on `bg` must reach 7:1 (WCAG AAA) and `muted` on
 * `bg` 4.5:1 for every hue; test/color.test.ts enforces both and the gamut.
 */
export const PALETTE = {
  light: { bg: [0.975, 0.011], fg: [0.42, 0.07], muted: [0.52, 0.085], line: [0.56, 0.095] },
  dark: { bg: [0.19, 0.03], fg: [0.88, 0.055], muted: [0.74, 0.08], line: [0.74, 0.12] },
} as const satisfies Record<string, Record<string, Lch>>;

/** `oklch(L C var(--h))` declarations for one theme. */
export function cssVars(theme: keyof typeof PALETTE): string {
  return Object.entries(PALETTE[theme])
    .map(([k, [l, c]]) => `--${k}:oklch(${l} ${c} var(--h))`)
    .join(';');
}

/** Uniform random hue; the server and the service worker both call this. */
export const randomHue = () => Math.floor(Math.random() * 360);
