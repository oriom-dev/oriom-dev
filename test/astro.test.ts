import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moon, sun } from '../src/client/3d/astro.ts';

const sendai = { lat: 38.27, lon: 140.87 };
const jst = (s: string) => Date.parse(`${s}+09:00`);

/** The time (ms) in [from, to] where f crosses zero, by bisection. */
function crossing(f: (t: number) => number, from: number, to: number): number {
  let a = from, b = to;
  for (let i = 0; i < 40; i++) { const m = (a + b) / 2; if (Math.sign(f(m)) === Math.sign(f(a))) a = m; else b = m; }
  return (a + b) / 2;
}
const hm = (t: number) => new Date(t + 9 * 3600_000).toISOString().slice(11, 16);

test('sunrise and sunset in Sendai are where and when they really are', () => {
  // 2026-11-15, Sendai: sunrise 06:17, azimuth 113.0°; sunset 16:25, 246.9° (NAOJ,
  // eco.mtk.nao.ac.jp/koyomi/dni/2026/s0411.html; 0.833° is refraction plus the sun's radius)
  const alt = (t: number) => sun(t, sendai).alt + 0.833;
  const rise = crossing(alt, jst('2026-11-15T04:00'), jst('2026-11-15T09:00'));
  const set = crossing(alt, jst('2026-11-15T14:00'), jst('2026-11-15T19:00'));
  const mins = (t: number, hhmm: string) => Math.abs(t - jst(`2026-11-15T${hhmm}`)) / 60_000;
  assert.ok(mins(rise, '06:17') < 2, `sunrise ${hm(rise)}`);
  assert.ok(mins(set, '16:25') < 2, `sunset ${hm(set)}`);
  assert.ok(Math.abs(sun(rise, sendai).az - 113.0) < 1, `sunrise azimuth ${sun(rise, sendai).az}`);
  assert.ok(Math.abs(sun(set, sendai).az - 246.9) < 1, `sunset azimuth ${sun(set, sendai).az}`);
  // noon: high in the south
  const noon = sun(jst('2026-11-15T11:21'), sendai);
  assert.ok(noon.alt > 32.5 && noon.alt < 34 && Math.abs(noon.az - 180) < 5, JSON.stringify(noon));
});

test('the moon is full when it is opposite the sun', () => {
  // full moon 2026-11-24 23:53 JST: rises near sunset in the east, sets near sunrise in the west
  const t = jst('2026-11-24T23:53');
  const m = moon(t, sendai), s = sun(t, sendai);
  const v = (h: { alt: number; az: number }) => [Math.cos(h.alt * Math.PI / 180) * Math.sin(h.az * Math.PI / 180), Math.sin(h.alt * Math.PI / 180), Math.cos(h.alt * Math.PI / 180) * Math.cos(h.az * Math.PI / 180)];
  const a = v(m), b = v(s);
  const angle = Math.acos(a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!) * 180 / Math.PI;
  assert.ok(angle > 172, `moon-sun angle ${angle}`);
  assert.ok(m.alt > 50, `the full moon is high at midnight in November: ${m.alt}`);
});

test('moonrise and moonset in Sendai are where and when they really are', () => {
  // NAOJ, eco.mtk.nao.ac.jp/koyomi/dni/2026/m0411.html: 11-15 rise 11:17 at 120.4°, set
  // 20:58 at 241.4°; 11-20 rise 13:27 at 87.4° (upper limb, with refraction: about -0.84°
  // for the topocentric centre)
  const alt = (t: number) => moon(t, sendai).alt + 0.84;
  const cases: [string, string, string, number][] = [
    ['2026-11-15T09:00', '2026-11-15T14:00', '11:17', 120.4],
    ['2026-11-15T18:00', '2026-11-15T23:00', '20:58', 241.4],
    ['2026-11-20T11:00', '2026-11-20T16:00', '13:27', 87.4],
  ];
  for (const [from, to, at, az] of cases) {
    const t = crossing(alt, jst(from), jst(to));
    const want = jst(`${from.slice(0, 10)}T${at}`);
    assert.ok(Math.abs(t - want) < 6 * 60_000, `${from.slice(0, 10)} ${hm(t)}, want ${at}`);
    assert.ok(Math.abs(moon(t, sendai).az - az) < 1.5, `azimuth ${moon(t, sendai).az}, want ${az}`);
  }
});

test('the place comes from the time zone', async () => {
  const { place } = await import('../src/client/3d/astro.ts');
  assert.deepEqual(place('Asia/Tokyo', 540), { lat: 35.7, lon: 139.7 });
  assert.deepEqual(place('America/New_York', -300), { lat: 40.7, lon: -74 });
  assert.deepEqual(place('Asia/Calcutta', 330), place('Asia/Kolkata', 330)); // an old name
  assert.deepEqual(place('Etc/UTC', 0), { lat: 35, lon: 0 }); // no city: the offset's meridian
});
