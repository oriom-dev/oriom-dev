// Where the signs stand. Works and posts fill concentric arcs around the plaza, the
// nearest arc first; every arc keeps the signs at least SPACING apart and leaves a
// gap around the title sign (where the two label signs stand). Odd arcs are staggered
// by half a step and the arcs are far apart, so inner signs do not hide outer ones;
// all signs stand on the plaza floor. More content just adds arcs.

export interface Slot { x: number; z: number; y: number; nx: number; nz: number; ring: number }

export const FIRST_RING = 10;
export const RING_STEP = 7;
export const SPACING = 3.6; // sign width 2.4 + a gap
export const FRONT_GAP = 0.3 * Math.PI; // either side of straight ahead (-z)

export function ringLayout(n: number): { slots: Slot[]; plaza: number } {
  const slots: Slot[] = [];
  let ring = 0;
  while (slots.length < n) {
    const r = FIRST_RING + ring * RING_STEP;
    const arc = 2 * Math.PI - 2 * FRONT_GAP;
    const cap = Math.max(1, Math.floor((r * arc) / SPACING));
    const count = Math.min(cap, n - slots.length);
    // a full arc spreads evenly; a partial one keeps the full spacing, centred behind
    // the spawn, and odd arcs shift by half a step when there is room
    const step = count === cap ? arc / count : (r * arc) / cap / r;
    const span = step * count;
    const slack = (arc - span) / 2;
    const shift = ring % 2 && slack >= step / 2 ? step / 2 : 0;
    const angles = Array.from({ length: count }, (_, j) => FRONT_GAP + slack + (j + 0.5) * step + shift);
    // the nearest to straight behind the spawn first, so a half-full arc stays balanced
    angles.sort((a, b) => Math.abs(a - Math.PI) - Math.abs(b - Math.PI));
    for (const ang of angles) {
      slots.push({ x: -Math.sin(ang) * r, z: -Math.cos(ang) * r, y: 0, nx: Math.sin(ang), nz: Math.cos(ang), ring });
    }
    ring++;
  }
  return { slots, plaza: FIRST_RING + Math.max(0, ring - 1) * RING_STEP + 3 };
}
