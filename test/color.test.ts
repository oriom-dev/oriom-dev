import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PALETTE, contrast, inGamut, oklchToLinearSrgb } from '../src/shared/color.ts';

// The hue is chosen at random per response, so every hue must satisfy the rules.
for (const [theme, p] of Object.entries(PALETTE)) {
  test(`${theme} palette: in sRGB gamut and contrast for all 360 hues`, () => {
    for (let h = 0; h < 360; h += 0.5) {
      const c = (k: keyof typeof p) => oklchToLinearSrgb(p[k][0], p[k][1], h);
      for (const k of Object.keys(p) as (keyof typeof p)[]) assert.ok(inGamut(c(k)), `${k} out of gamut at h=${h}`);
      assert.ok(contrast(c('fg'), c('bg')) >= 7, `fg/bg < 7:1 at h=${h}`);
      assert.ok(contrast(c('muted'), c('bg')) >= 4.5, `muted/bg < 4.5:1 at h=${h}`);
      assert.ok(contrast(c('line'), c('bg')) >= 3, `line/bg < 3:1 at h=${h}`);
    }
  });
}
