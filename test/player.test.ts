import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Player } from '../src/client/3d/player.ts';
import { B, CS, H, World } from '../src/client/3d/world.ts';

test('what collides is exactly what the world draws (leaves included)', () => {
  const w = new World(9, 12345);
  let leaves = 0;
  for (const [cx, cz] of [[3, 3], [-4, 2], [6, -5]] as const) {
    const v = w.generate(cx, cz), S = CS + 2;
    for (let y = 0; y < H; y++) for (let z = 1; z <= CS; z++) for (let x = 1; x <= CS; x++) {
      const b = v[(y * S + z) * S + x]!;
      if (b === B.Leaves) leaves++;
      const drawn = b !== B.Air && b !== B.Water;
      assert.equal(w.solidAt(cx * CS + x - 1, y, cz * CS + z - 1), drawn, `${cx * CS + x - 1},${y},${cz * CS + z - 1} is ${b}`);
    }
  }
  assert.ok(leaves > 0, 'the chunks have trees');
});

/** A flat floor (y < 1) and the given blocks. */
const flat = (blocks: [number, number, number][]) => {
  const set = new Set(blocks.map((b) => b.join(',')));
  return { solidAt: (x: number, y: number, z: number) => y < 1 || set.has(`${x},${y},${z}`), waterAt: () => false } as unknown as World;
};

test('walking into a one-block ledge jumps onto it, as Space does: no teleport', () => {
  const p = new Player(flat(Array.from({ length: 8 }, (_, i) => [2 + i, 1, 0] as [number, number, number]))); // a step up, x 2..9
  p.p = [0.5, 1, 0.5]; p.yaw = -Math.PI / 2; // facing +x
  let lastY = p.p[1]!, maxStep = 0;
  for (let i = 0; i < 120; i++) {
    p.step(1 / 60, [0, 1], false, false, false);
    maxStep = Math.max(maxStep, Math.abs(p.p[1]! - lastY));
    lastY = p.p[1]!;
  }
  assert.ok(p.p[0]! > 2.3 && Math.abs(p.p[1]! - 2) < 0.01, `on top of the ledge: ${p.p}`);
  assert.ok(maxStep < 0.2, `rises smoothly (largest step per frame ${maxStep.toFixed(3)})`);
});

test('a gap one block high does not let you through: the head needs room too', () => {
  const p = new Player(flat([[2, 2, 0]])); // a block at head height
  p.p = [0.5, 1, 0.5]; p.yaw = -Math.PI / 2;
  for (let i = 0; i < 120; i++) p.step(1 / 60, [0, 1], false, false, false);
  assert.ok(p.p[0]! < 1.71, `stopped before it: ${p.p[0]}`);
});

test('out of the water onto the bank, by swimming at it, with or without Space', () => {
  const SEA = 30;
  for (const bank of [SEA, SEA + 1]) for (const up of [false, true]) {
    const world = {
      solidAt: (x: number, y: number) => (x >= 3 ? y <= bank : y <= SEA - 3), // 3 deep, then the bank
      waterAt: (x: number, y: number) => x < 3 && y > SEA - 3 && y <= SEA,
    } as unknown as World;
    const p = new Player(world);
    p.p = [0.5, SEA - 1.5, 0.5]; p.yaw = -Math.PI / 2;
    let lastY = p.p[1]!, maxStep = 0;
    for (let i = 0; i < 600 && p.p[0]! < 4; i++) {
      p.step(1 / 60, [0, 1], up, false, false);
      maxStep = Math.max(maxStep, Math.abs(p.p[1]! - lastY));
      lastY = p.p[1]!;
    }
    assert.ok(p.p[0]! >= 4 && p.p[1]! >= bank + 1 - 0.01, `bank +${bank - SEA}, Space ${up}: ${p.p}`);
    assert.ok(maxStep < 0.2, `smoothly (largest step ${maxStep.toFixed(3)})`);
  }
});
