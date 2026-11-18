import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FRONT_GAP, ringLayout, SPACING } from '../src/client/3d/layout.ts';

for (const n of [0, 1, 5, 11, 12, 30, 80, 200]) {
  test(`${n} signs: no two closer than the spacing, none behind the title sign`, () => {
    const { slots, plaza } = ringLayout(n);
    assert.equal(slots.length, n);
    for (let i = 0; i < n; i++) {
      const a = slots[i]!;
      const ang = Math.atan2(-a.x, -a.z); // 0 = straight ahead
      assert.ok(Math.abs(ang) >= FRONT_GAP - 1e-6, `slot ${i} is behind the title sign`);
      assert.ok(Math.hypot(a.x, a.z) <= plaza - 2, `slot ${i} is off the plaza`);
      for (let j = i + 1; j < n; j++) {
        const b = slots[j]!;
        assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= SPACING - 0.6, `slots ${i} and ${j} overlap`);
      }
    }
  });
}
