import { VARIANTS, type Variant } from './types.ts';

/** Cookie set by the 1D/2D pages once they detect neither WebGPU nor WebGL 2. */
export const NO3D_COOKIE = 'no3d';

const TEXT_BROWSERS = /\b(lynx|w3m|links|elinks|curl|wget|httpie|python|go-http|java|bot|crawl|spider|slurp|facebookexternalhit|bingpreview)\b/i;

/**
 * Whether the 3D page can possibly work. Only rules out clients that are known
 * not to: no browser UA, text browsers and crawlers (they get the content either
 * way, but a WebGPU canvas helps nobody), and browsers that told us via cookie.
 */
export function maybe3d(userAgent: string | null | undefined, cookie: string | null | undefined): boolean {
  if (!userAgent || !/Mozilla\//.test(userAgent) || TEXT_BROWSERS.test(userAgent)) return false;
  if (cookie && new RegExp(`(?:^|;\\s*)${NO3D_COOKIE}=1`).test(cookie)) return false;
  return true;
}

/** `?v=1d|2d|3d` pins a variant (for sharing a specific look); otherwise uniform random. */
export function pickVariant(allow3d: boolean, forced?: string | null, rnd = Math.random): Variant {
  if (forced && (VARIANTS as readonly string[]).includes(forced)) return forced as Variant;
  const pool = allow3d ? VARIANTS : VARIANTS.filter((v) => v !== '3d');
  return pool[Math.floor(rnd() * pool.length)]!;
}
