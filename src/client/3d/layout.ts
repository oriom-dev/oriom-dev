// Where the signs stand. Works and posts fill concentric arcs around the plaza, the
// nearest arc first; every arc keeps the signs at least SPACING apart and leaves a
// gap around the title sign; the nearest signs show at the edge of the first view. Odd arcs are staggered
// by half a step and the arcs are far apart, so inner signs do not hide outer ones;
// all signs stand on the plaza floor. More content just adds arcs.

export interface Slot { x: number; z: number; y: number; nx: number; nz: number; ring: number }

export const FIRST_RING = 10;
export const RING_STEP = 7;
export const SPACING = 3.6; // sign width 2.4 + a gap
export const FRONT_GAP = 0.2 * Math.PI; // either side of straight ahead (-z), around the title sign

export function ringLayout(n: number): { slots: Slot[]; plaza: number } {
  const slots: Slot[] = [];
  let ring = 0;
  while (slots.length < n) {
    const r = FIRST_RING + ring * RING_STEP;
    const arc = 2 * Math.PI - 2 * FRONT_GAP;
    const cap = Math.max(1, Math.floor((r * arc) / SPACING));
    const count = Math.min(cap, n - slots.length);
    // every seat of the arc, evenly spaced (odd arcs shifted by half a step so they
    // show between the signs of the arc inside), then the seats nearest the title sign
    // first: the newest signs stand beside it, at the edges of the first view
    const step = arc / cap;
    const shift = ring % 2 ? step / 2 : 0;
    const seats = Array.from({ length: cap }, (_, j) => FRONT_GAP + (j + 0.5) * step + shift);
    seats.sort((a, b) => Math.abs(b - Math.PI) - Math.abs(a - Math.PI));
    const angles = seats.slice(0, count);
    for (const ang of angles) {
      slots.push({ x: -Math.sin(ang) * r, z: -Math.cos(ang) * r, y: 0, nx: Math.sin(ang), nz: Math.cos(ang), ring });
    }
    ring++;
  }
  return { slots, plaza: FIRST_RING + Math.max(0, ring - 1) * RING_STEP + 3 };
}
