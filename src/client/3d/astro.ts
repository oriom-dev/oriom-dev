// Where the sun and the moon are in the visitor's sky: low-precision formulas (NOAA's for
// the sun, the main periodic terms for the moon), good to about a degree and a minute or
// two of rise and set time, which is plenty for a sky to walk under.
import { LINKS, ZONES } from './zones.ts';

const RAD = Math.PI / 180;
const sin = (d: number) => Math.sin(d * RAD), cos = (d: number) => Math.cos(d * RAD);
const norm = (d: number) => ((d % 360) + 360) % 360;

export interface Place { lat: number; lon: number } // degrees, east positive
export interface Horizontal { alt: number; az: number } // degrees; azimuth from north towards east

/** Days since J2000.0 (2000-01-01 12:00 TT, ignoring ΔT). */
const days = (t: number) => t / 86_400_000 - 10957.5;

/** Equatorial (right ascension, declination; degrees) -> horizontal for a place and time. */
function horizontal(ra: number, dec: number, t: number, p: Place): Horizontal {
  const gmst = norm(280.46061837 + 360.98564736629 * days(t));
  const ha = norm(gmst + p.lon - ra);
  const alt = Math.asin(sin(p.lat) * sin(dec) + cos(p.lat) * cos(dec) * cos(ha)) / RAD;
  const az = Math.atan2(-sin(ha) * cos(dec), cos(p.lat) * sin(dec) - sin(p.lat) * cos(dec) * cos(ha)) / RAD;
  return { alt, az: norm(az) };
}

function equatorial(lambda: number, beta: number, d: number) {
  const eps = 23.439 - 0.0000004 * d;
  const ra = Math.atan2(sin(lambda) * cos(eps) - Math.tan(beta * RAD) * sin(eps), cos(lambda)) / RAD;
  const dec = Math.asin(sin(beta) * cos(eps) + cos(beta) * sin(eps) * sin(lambda)) / RAD;
  return { ra: norm(ra), dec };
}

export function sun(t: number, p: Place): Horizontal {
  const d = days(t);
  const g = norm(357.529 + 0.98560028 * d); // mean anomaly
  const q = norm(280.459 + 0.98564736 * d); // mean longitude
  const lambda = norm(q + 1.915 * sin(g) + 0.02 * sin(2 * g));
  const { ra, dec } = equatorial(lambda, 0, d);
  return horizontal(ra, dec, t, p);
}

export function moon(t: number, p: Place): Horizontal {
  const d = days(t);
  const L = norm(218.316 + 13.176396 * d); // mean longitude
  const M = norm(134.963 + 13.064993 * d); // mean anomaly
  const F = norm(93.272 + 13.22935 * d); // argument of latitude
  const D = norm(297.85 + 12.190749 * d); // elongation
  const Ms = norm(357.529 + 0.98560028 * d); // the sun's mean anomaly
  const lambda = L + 6.289 * sin(M) + 1.274 * sin(2 * D - M) + 0.658 * sin(2 * D) + 0.214 * sin(2 * M) - 0.186 * sin(Ms) - 0.114 * sin(2 * F);
  const beta = 5.128 * sin(F) + 0.281 * sin(M + F) + 0.278 * sin(M - F);
  const { ra, dec } = equatorial(norm(lambda), beta, d);
  const h = horizontal(ra, dec, t, p);
  // topocentric: the moon is close enough for parallax (about 1°) to matter near the horizon
  return { alt: h.alt - 0.95 * cos(h.alt), az: h.az };
}

/** Direction in the world: north is -z, east is +x, up is +y. */
export const toVector = ({ alt, az }: Horizontal) => [cos(alt) * sin(az), sin(alt), -cos(alt) * cos(az)];

/** Where the visitor is, without asking: the principal city of their time zone (tzdata's
 *  zone.tab). An unknown zone falls back to its UTC offset's meridian at 35°N. */
export function place(tz = Intl.DateTimeFormat().resolvedOptions().timeZone, offsetMin = -new Date().getTimezoneOffset()): Place {
  const find = (name: string) => {
    const i = ZONES.indexOf(`${name} `);
    if (i < 0 || (i > 0 && ZONES[i - 1] !== ';')) return null;
    const [, lat, lon] = ZONES.slice(i, (ZONES.indexOf(';', i) + 1 || ZONES.length + 1) - 1).split(' ');
    return { lat: Number(lat), lon: Number(lon) };
  };
  const link = LINKS.split(';').find((l) => l.startsWith(`${tz} `))?.split(' ')[1];
  return find(tz) ?? (link ? find(link) : null) ?? { lat: 35, lon: (offsetMin / 60) * 15 };
}
