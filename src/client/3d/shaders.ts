// The same shading in WGSL (WebGPU) and GLSL ES 3.0 (WebGL 2). Uniform block layout
// (floats): viewProj[16] invViewProj[16] cam[4: xyz, time] sun[4: dir, daylight]
// zenith[4: rgb, fog density] horizon[4: rgb, sunrise/sunset glow] light[4: ambient, lamp glow, night vision, -] moon[4: dir, -].
// Blocks: 0 air 1 grass 2 dirt 3 stone 4 sand 5 water 6 log 7 leaves 8 snow
//         9 lamp off 10 lamp on 11 plank 12 gravel

const PALETTE = [
  '0.,0.,0.', '.36,.6,.24', '.48,.34,.22', '.5,.5,.52', '.86,.8,.56', '.2,.4,.75', '.42,.31,.18', '.24,.48,.2',
  '.93,.95,.98', '.36,.18,.12', '1.,.62,.32', '.7,.55,.34', '.55,.53,.5',
];

const common = (lang: 'wgsl' | 'glsl') => {
  const v3 = lang === 'wgsl' ? 'vec3f' : 'vec3';
  return PALETTE.map((c) => `${v3}(${c})`).join(',');
};

export const WGSL = /* wgsl */ `
struct U { vp: mat4x4f, ivp: mat4x4f, cam: vec4f, sun: vec4f, zenith: vec4f, horizon: vec4f, light: vec4f, moon: vec4f };
@group(0) @binding(0) var<uniform> u: U;
var<private> PAL: array<vec3f, 13> = array<vec3f, 13>(${common('wgsl')});
fn hash3(p: vec3f) -> f32 { return fract(sin(dot(p, vec3f(12.9898, 78.233, 37.719))) * 43758.5453); }
fn fog(c: vec3f, d: f32) -> vec3f { return mix(c, u.horizon.rgb, (1.0 - exp(-d * u.zenith.w)) * (1.0 - 0.5 * u.light.z)); }
fn nrm(i: u32) -> vec3f {
  var n = array<vec3f, 6>(vec3f(1,0,0), vec3f(-1,0,0), vec3f(0,1,0), vec3f(0,-1,0), vec3f(0,0,1), vec3f(0,0,-1));
  return n[i];
}

struct VO { @builtin(position) pos: vec4f, @location(0) wp: vec3f, @location(1) @interpolate(flat) d: u32, @location(2) ao: f32 };
@vertex fn vs(@location(0) p: vec3f, @location(1) d: u32) -> VO {
  var o: VO; o.pos = u.vp * vec4f(p, 1.0); o.wp = p; o.d = d; o.ao = f32((d >> 8u) & 3u); return o;
}
fn shade(i: VO) -> vec4f {
  let n = nrm(i.d & 7u); let b = (i.d >> 3u) & 31u;
  var c = PAL[b];
  let f = fract(i.wp);
  if (b == 1u && n.y == 0.0 && f.y < 0.8) { c = PAL[2]; }
  if (b == 6u && n.y != 0.0) { c = PAL[11]; }
  let cell = floor(i.wp * 8.0 - n * 0.5);
  c *= 0.9 + 0.2 * hash3(cell);
  if (b == 9u || b == 10u) { // lamps: a frame and a cross, lit or not, so they never read as plain floor
    let e = min(min(f.x, 1.0 - f.x), min(f.z, 1.0 - f.z));
    let g = min(abs(f.x - 0.5), abs(f.z - 0.5));
    if (e < 0.1 || g < 0.05) { c *= 0.45; }
  }
  if (b == 10u) { return vec4f(fog(c * (1.2 + 0.3 * u.light.y), distance(i.wp, u.cam.xyz)), 1.0); }
  let face = select(select(0.8, 1.0, n.y > 0.5), 0.6, n.y < -0.5);
  let diff = max(dot(n, u.sun.xyz), 0.0) * u.sun.w;
  // night vision lifts everything to daylight, as if the sun were up
  let light = max(u.light.x + diff * 0.65, u.light.z * 0.95) * face * (0.5 + 0.5 * i.ao / 3.0);
  var a = 1.0;
  if (b == 5u) { a = 0.68; c += vec3f(0.12) * u.sun.w * (0.5 + 0.5 * sin(u.cam.w * 1.5 + i.wp.x * 0.7 + i.wp.z * 0.5)); }
  return vec4f(fog(c * light, distance(i.wp, u.cam.xyz)), a);
}
@fragment fn fs(i: VO) -> @location(0) vec4f { return shade(i); }

struct SO { @builtin(position) pos: vec4f, @location(0) ndc: vec2f };
@vertex fn sky_vs(@builtin(vertex_index) k: u32) -> SO {
  let p = vec2f(f32((k << 1u) & 2u), f32(k & 2u)) * 2.0 - 1.0;
  var o: SO; o.pos = vec4f(p, 0.0, 1.0); o.ndc = p; return o;
}
@fragment fn sky_fs(i: SO) -> @location(0) vec4f {
  let w = u.ivp * vec4f(i.ndc, 1.0, 1.0);
  let dir = normalize(w.xyz / w.w - u.cam.xyz);
  var c = mix(u.horizon.rgb, u.zenith.rgb, smoothstep(-0.02, 0.5, dir.y));
  // the glow of sunrise and sunset: low in the sky, strongest towards the sun
  let toSun = max(0.0, dot(normalize(dir.xz + vec2f(1e-5)), normalize(u.sun.xz + vec2f(1e-5))));
  c = mix(c, vec3f(0.98, 0.52, 0.26), u.horizon.w * (0.25 + 0.75 * toSun * toSun) * (1.0 - smoothstep(-0.05, 0.45, dir.y)));
  let s = dot(dir, u.sun.xyz);
  c += vec3f(1.0, 0.95, 0.85) * (smoothstep(0.99955, 0.99970, s) * 1.5 + pow(max(s, 0.0), 64.0) * 0.06 * u.sun.w);
  let night = 1.0 - smoothstep(0.0, 0.35, u.sun.w);
  // the moon: a sphere lit by the sun, so its phase follows the real date
  let md = u.moon.xyz; let cm = dot(dir, md);
  if (cm > 0.9993) {
    let q = (dir - md * cm) / 0.0374; let z = sqrt(max(0.0, 1.0 - dot(q, q)));
    let lit = smoothstep(-0.04, 0.04, dot(normalize(q - md * z), u.sun.xyz));
    c = mix(c, vec3f(0.92, 0.94, 1.0) * (0.06 + 0.94 * lit), smoothstep(0.9993, 0.99945, cm) * (0.45 + 0.55 * night));
  }
  let st = hash3(floor(dir * 300.0));
  c += vec3f(step(0.9975, st) * night * smoothstep(0.0, 0.2, dir.y));
  return vec4f(c, 1.0);
}

struct PO { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) wp: vec3f };
@group(1) @binding(0) var ps: sampler;
@group(1) @binding(1) var pt: texture_2d<f32>;
@vertex fn panel_vs(@location(0) p: vec3f, @location(1) uv: vec2f) -> PO {
  var o: PO; o.pos = u.vp * vec4f(p, 1.0); o.uv = uv; o.wp = p; return o;
}
@fragment fn panel_fs(i: PO, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  var t = textureSample(pt, ps, i.uv);
  if (!front) { t = vec4f(PAL[11] * (0.9 + 0.2 * hash3(floor(i.wp * 8.0))), 1.0); } // the back of the board
  let l = 0.55 + 0.45 * max(max(u.light.x * 1.6, u.sun.w), u.light.z);
  return vec4f(mix(t.rgb * l, u.horizon.rgb, (1.0 - exp(-distance(i.wp, u.cam.xyz) * u.zenith.w)) * 0.6), 1.0);
}
`;

const GLSL_HEAD = `#version 300 es
precision highp float; precision highp int;
layout(std140) uniform U { mat4 vp; mat4 ivp; vec4 cam; vec4 sun; vec4 zenith; vec4 horizon; vec4 light; vec4 moon; };
const vec3 PAL[13] = vec3[13](${common('glsl')});
float hash3(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
vec3 fogc(vec3 c, float d) { return mix(c, horizon.rgb, (1.0 - exp(-d * zenith.w)) * (1.0 - 0.5 * light.z)); }
`;

export const GL = {
  vs: `${GLSL_HEAD}
layout(location=0) in vec3 p; layout(location=1) in uint d;
out vec3 wp; flat out uint fd; out float ao;
void main() { gl_Position = vp * vec4(p, 1.0); wp = p; fd = d; ao = float((d >> 8u) & 3u); }`,
  fs: `${GLSL_HEAD}
in vec3 wp; flat in uint fd; in float ao; out vec4 o;
const vec3 N[6] = vec3[6](vec3(1,0,0), vec3(-1,0,0), vec3(0,1,0), vec3(0,-1,0), vec3(0,0,1), vec3(0,0,-1));
void main() {
  vec3 n = N[fd & 7u]; uint b = (fd >> 3u) & 31u; vec3 c = PAL[b]; vec3 f = fract(wp);
  if (b == 1u && n.y == 0.0 && f.y < 0.8) c = PAL[2];
  if (b == 6u && n.y != 0.0) c = PAL[11];
  c *= 0.9 + 0.2 * hash3(floor(wp * 8.0 - n * 0.5));
  float d = distance(wp, cam.xyz);
  if (b == 9u || b == 10u) { float e = min(min(f.x, 1.0 - f.x), min(f.z, 1.0 - f.z)); float g = min(abs(f.x - 0.5), abs(f.z - 0.5)); if (e < 0.1 || g < 0.05) c *= 0.45; }
  if (b == 10u) { o = vec4(fogc(c * (1.2 + 0.3 * light.y), d), 1.0); return; }
  float face = n.y > 0.5 ? 1.0 : n.y < -0.5 ? 0.6 : 0.8;
  float l = max(light.x + max(dot(n, sun.xyz), 0.0) * sun.w * 0.65, light.z * 0.95) * face * (0.5 + 0.5 * ao / 3.0);
  float a = 1.0;
  if (b == 5u) { a = 0.68; c += vec3(0.12) * sun.w * (0.5 + 0.5 * sin(cam.w * 1.5 + wp.x * 0.7 + wp.z * 0.5)); }
  o = vec4(fogc(c * l, d), a);
}`,
  skyVs: `#version 300 es
out vec2 ndc; void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0; ndc = p; gl_Position = vec4(p, 0.9999, 1.0); }`,
  skyFs: `${GLSL_HEAD}
in vec2 ndc; out vec4 o;
void main() {
  vec4 w = ivp * vec4(ndc, 1.0, 1.0); vec3 dir = normalize(w.xyz / w.w - cam.xyz);
  vec3 c = mix(horizon.rgb, zenith.rgb, smoothstep(-0.02, 0.5, dir.y));
  float toSun = max(0.0, dot(normalize(dir.xz + vec2(1e-5)), normalize(sun.xz + vec2(1e-5))));
  c = mix(c, vec3(0.98, 0.52, 0.26), horizon.w * (0.25 + 0.75 * toSun * toSun) * (1.0 - smoothstep(-0.05, 0.45, dir.y)));
  float s = dot(dir, sun.xyz);
  c += vec3(1.0, 0.95, 0.85) * (smoothstep(0.99955, 0.99970, s) * 1.5 + pow(max(s, 0.0), 64.0) * 0.06 * sun.w);
  float night = 1.0 - smoothstep(0.0, 0.35, sun.w);
  vec3 md = moon.xyz; float cm = dot(dir, md);
  if (cm > 0.9993) {
    vec3 q = (dir - md * cm) / 0.0374; float z = sqrt(max(0.0, 1.0 - dot(q, q)));
    float lit = smoothstep(-0.04, 0.04, dot(normalize(q - md * z), sun.xyz));
    c = mix(c, vec3(0.92, 0.94, 1.0) * (0.06 + 0.94 * lit), smoothstep(0.9993, 0.99945, cm) * (0.45 + 0.55 * night));
  }
  c += vec3(step(0.9975, hash3(floor(dir * 300.0))) * night * smoothstep(0.0, 0.2, dir.y));
  o = vec4(c, 1.0);
}`,
  panelVs: `${GLSL_HEAD}
layout(location=0) in vec3 p; layout(location=1) in vec2 uv; out vec2 v; out vec3 wp;
void main() { gl_Position = vp * vec4(p, 1.0); v = uv; wp = p; }`,
  panelFs: `${GLSL_HEAD}
uniform sampler2D t; in vec2 v; in vec3 wp; out vec4 o;
void main() { vec4 c = gl_FrontFacing ? texture(t, v) : vec4(PAL[11] * (0.9 + 0.2 * hash3(floor(wp * 8.0))), 1.0); float l = 0.55 + 0.45 * max(max(light.x * 1.6, sun.w), light.z);
  o = vec4(mix(c.rgb * l, horizon.rgb, (1.0 - exp(-distance(wp, cam.xyz) * zenith.w)) * 0.6), 1.0); }`,
};
