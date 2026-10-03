/* GENERATED FILE -- do not edit.
 *
 * Produced by scripts/sync_bed.py from cased/engine/stage.html, so the
 * launch site renders with exactly the shader the film renderer uses.
 * Edit the shader in stage.html, then re-run the script.
 */

// 82 beds, extracted verbatim from the engine.

const CASED_VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

const CASED_PRELUDE = `
precision highp float;
uniform vec2  u_res;
uniform float u_time;
uniform float u_energy;
uniform float u_seed;
uniform vec3  u_bg;
uniform vec3  u_a1;
uniform vec3  u_a2;

const float PI = 3.14159265;

float hash11(float p){ return fract(sin(p * 127.1 + u_seed) * 43758.5453); }
float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)) + u_seed) * 43758.5453); }
vec2  hash22(vec2 p){
  return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))
                   + u_seed) * 43758.5453);
}

float n2(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++){ v += a * n2(p); p *= 2.03; a *= 0.5; }
  return v;
}

mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

/** Cell id + distance to the nearest feature point. */
vec3 worley(vec2 p){
  vec2 ip = floor(p), fp = fract(p);
  float d = 8.0; vec2 id = vec2(0.0);
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++){
    vec2 g = vec2(float(x), float(y));
    vec2 o = hash22(ip + g);
    o = 0.5 + 0.45 * sin(u_time * 0.35 + 6.2831 * o);
    float dist = length(g + o - fp);
    if (dist < d){ d = dist; id = ip + g; }
  }
  return vec3(d, id);
}

/** Aspect-corrected centred coordinates. */
vec2 cen(vec2 uv){ return (uv - 0.5) * vec2(u_res.x / u_res.y, 1.0); }

/** Mix toward accent 1 then accent 2, scaled by energy. The house gradient. */
vec3 tint(float a, float b){
  vec3 c = mix(u_bg, u_a1, clamp(a, 0.0, 1.0) * (0.42 + u_energy * 0.45));
  return mix(c, u_a2, clamp(b, 0.0, 1.0) * (0.24 + u_energy * 0.32));
}
`;

const CASED_MAIN = `
void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  vec3 col = bed(uv);
  float v = smoothstep(1.15, 0.22, length(uv - 0.5));
  col *= mix(0.72, 1.0, v);
  gl_FragColor = vec4(col, 1.0);
}
`;

const CASED_BEDS = {

/* ---- flowing fields -------------------------------------------------- */
aurora: `
  float t = u_time * 0.055;
  vec2 q = vec2(fbm(uv * 1.7 + vec2(t, t * 0.7)), fbm(uv * 1.7 + vec2(5.2, 1.3) - t * 0.6));
  float f = fbm(uv * 2.1 + q * 1.9 + t * 0.4);
  float g = fbm(uv * 3.3 - q * 1.2 - t * 0.25);
  return tint(smoothstep(0.28, 0.92, f), smoothstep(0.42, 1.0, g));`,

smoke: `
  float t = u_time * 0.03;
  float f = fbm(uv * 2.4 + vec2(t, -t * 0.6));
  float g = fbm(uv * 1.2 - vec2(t * 0.4, t));
  float m = smoothstep(0.30, 0.86, f * 0.7 + g * 0.5);
  return tint(m * 0.7, smoothstep(0.55, 1.0, g) * 0.5);`,

noisefield: `
  float f = fbm(uv * 6.0 + u_time * 0.04);
  float g = fbm(uv * 14.0 - u_time * 0.02);
  return tint(smoothstep(0.35, 0.8, f), g * 0.35);`,

warp: `
  vec2 p = uv * 3.0;
  vec2 w = vec2(fbm(p + u_time * 0.07), fbm(p + vec2(3.1, 1.7) - u_time * 0.05));
  float f = fbm(p + w * 2.6);
  return tint(smoothstep(0.30, 0.85, f), smoothstep(0.6, 1.0, w.x));`,

gradientfield: `
  float f = fbm(uv * 1.4 + u_time * 0.03);
  float d = uv.y * 0.75 + uv.x * 0.25 + (f - 0.5) * 0.35;
  return tint(1.0 - d, smoothstep(0.55, 1.0, d));`,

silk: `
  vec2 p = uv * vec2(3.0, 1.6);
  float f = sin(p.x * 3.0 + fbm(p + u_time * 0.05) * 5.0 + u_time * 0.25);
  float m = smoothstep(-0.2, 1.0, f) * 0.8;
  return tint(m, smoothstep(0.7, 1.0, m));`,

velvet: `
  vec2 p = cen(uv);
  float r = length(p);
  float f = fbm(uv * 5.0 + u_time * 0.02);
  float m = smoothstep(0.95, 0.05, r) * (0.6 + f * 0.5);
  return tint(m * 0.65, smoothstep(0.75, 0.0, r) * 0.4);`,

washes: `
  float a = fbm(uv * 2.2 + vec2(u_time * 0.02, 0.0));
  float b = fbm(uv * 3.1 - vec2(0.0, u_time * 0.018) + 4.0);
  float m = smoothstep(0.42, 0.78, a) * smoothstep(0.80, 0.35, b);
  return tint(m, smoothstep(0.52, 0.9, b) * 0.6);`,

curtains: `
  float x = uv.x * 4.0;
  float sway = fbm(vec2(x * 0.5, u_time * 0.10)) * 1.6;
  float band = sin(x * 2.4 + sway * 2.2 + u_time * 0.22) * 0.5 + 0.5;
  float fall = smoothstep(1.05, 0.05, uv.y + band * 0.22);
  return tint(band * fall, fall * 0.5);`,

nebula: `
  float a = fbm(uv * 2.3 + u_time * 0.016);
  float b = fbm(uv * 4.4 - u_time * 0.011 + 7.0);
  vec3 col = mix(u_bg, u_a1 * 0.9, smoothstep(0.45, 1.0, a) * 0.55);
  col = mix(col, u_a2 * 0.8, smoothstep(0.55, 1.0, b) * 0.40);
  for (int i = 0; i < 2; i++){
    float sc = 110.0 + float(i) * 140.0;
    vec2 g = uv * sc; vec2 id = floor(g);
    if (hash21(id + float(i) * 13.0) > 0.982){
      col += vec3(1.0) * smoothstep(0.32, 0.0, length(fract(g) - 0.5)) * 0.5;
    }
  }
  return col;`,

/* ---- space ----------------------------------------------------------- */
stars: `
  vec3 col = u_bg;
  float neb = fbm(uv * 2.6 + vec2(u_time * 0.025, 0.0));
  col = mix(col, u_a1 * 0.75, smoothstep(0.52, 1.0, neb) * 0.40);
  col = mix(col, u_a2 * 0.55, smoothstep(0.62, 1.0, fbm(uv * 4.0 - u_time * 0.015)) * 0.22);
  for (int i = 0; i < 3; i++){
    float sc = 90.0 + float(i) * 95.0;
    vec2 g = uv * sc; vec2 id = floor(g);
    float h = hash21(id + float(i) * 31.7);
    if (h > 0.976){
      float tw = 0.60 + 0.40 * sin(u_time * (1.6 + h * 3.4) + h * 28.0);
      col += vec3(1.0) * smoothstep(0.30, 0.0, length(fract(g) - 0.5)) * tw * (0.55 - float(i) * 0.13);
    }
  }
  return col;`,

corona: `
  vec2 p = cen(uv);
  float r = length(p);
  float a = atan(p.y, p.x);
  float rays = 0.5 + 0.5 * sin(a * 14.0 + u_time * 0.4 + fbm(vec2(a * 2.0, u_time * 0.1)) * 4.0);
  float core = smoothstep(0.75, 0.0, r);
  return tint(core * (0.45 + rays * 0.55), smoothstep(0.35, 0.0, r));`,

rays: `
  vec2 p = uv - vec2(0.5, 1.12);
  float a = atan(p.x, -p.y);
  float beam = 0.5 + 0.5 * sin(a * 22.0 + u_time * 0.3);
  beam *= smoothstep(1.1, 0.0, length(p));
  return tint(beam * 0.9, smoothstep(0.9, 0.1, uv.y) * 0.4);`,

bloom: `
  vec3 col = u_bg;
  for (int i = 0; i < 5; i++){
    float f = float(i);
    vec2 c = vec2(0.5 + 0.34 * sin(u_time * 0.21 + f * 2.1),
                  0.5 + 0.28 * cos(u_time * 0.17 + f * 1.7));
    float d = length((uv - c) * vec2(u_res.x / u_res.y, 1.0));
    float g = smoothstep(0.42, 0.0, d);
    col = mix(col, mod(f, 2.0) < 1.0 ? u_a1 : u_a2, g * (0.30 + u_energy * 0.30));
  }
  return col;`,

vortex: `
  vec2 p = cen(uv);
  float r = length(p);
  float a = atan(p.y, p.x) + r * 5.0 - u_time * 0.4;
  float arm = 0.5 + 0.5 * sin(a * 3.0);
  float m = arm * smoothstep(1.0, 0.04, r);
  return tint(m, smoothstep(0.5, 0.0, r) * 0.6);`,

tunnel: `
  vec2 p = cen(uv);
  float r = length(p) + 0.001;
  float a = atan(p.y, p.x);
  float z = 0.45 / r + u_time * 0.5;
  float ring = smoothstep(0.42, 0.5, fract(z));
  float spoke = smoothstep(0.44, 0.5, fract(a * 4.0 / PI));
  float m = max(ring, spoke * 0.6) * smoothstep(1.3, 0.1, r);
  return tint(m, smoothstep(0.26, 0.0, r));`,

starburst: `
  vec2 p = cen(uv);
  float a = atan(p.y, p.x), r = length(p);
  float lines = smoothstep(0.80, 1.0, sin(a * 28.0 + u_time * 0.25) * 0.5 + 0.5);
  float m = lines * smoothstep(1.1, 0.06, r);
  return tint(m, smoothstep(0.3, 0.0, r) * 0.8);`,

/* ---- geometric / technical ------------------------------------------- */
grid: `
  vec2 p = uv - 0.5;
  p.y = abs(p.y) + 0.035;
  vec2 g = vec2(p.x / p.y, 1.0 / p.y + u_time * 0.55);
  vec2 l = abs(fract(g * vec2(2.2, 0.9)) - 0.5);
  float w = smoothstep(0.055, 0.0, min(l.x, l.y)) * smoothstep(1.35, 0.06, p.y * 6.0);
  vec3 col = mix(u_bg, u_a1, w * (0.52 + u_energy * 0.48));
  col += u_a2 * smoothstep(0.42, 0.0, length(uv - 0.5)) * 0.14 * u_energy;
  return col;`,

sungrid: `
  vec3 col = u_bg;
  float sun = smoothstep(0.30, 0.0, length((uv - vec2(0.5, 0.62)) * vec2(u_res.x / u_res.y, 1.0)));
  float slice = step(0.5, fract(uv.y * 34.0 - u_time * 0.2));
  col = mix(col, u_a1, sun * mix(0.55, 1.0, slice));
  if (uv.y < 0.42){
    vec2 p = vec2(uv.x - 0.5, 0.44 - uv.y);
    vec2 g = vec2(p.x / max(p.y, 0.004), 1.0 / max(p.y, 0.004) + u_time * 0.55);
    vec2 l = abs(fract(g * vec2(1.6, 0.6)) - 0.5);
    float w = smoothstep(0.06, 0.0, min(l.x, l.y));
    col = mix(col, u_a2, w * 0.75);
  }
  return col;`,

checkerhorizon: `
  if (uv.y > 0.5) return mix(u_bg, u_a2 * 0.5, smoothstep(0.5, 1.0, uv.y) * 0.35);
  vec2 p = vec2(uv.x - 0.5, 0.52 - uv.y);
  float z = 1.0 / max(p.y, 0.004);
  vec2 g = vec2(p.x * z, z + u_time * 0.8);
  float c = mod(floor(g.x * 2.0) + floor(g.y * 0.6), 2.0);
  float fade = smoothstep(0.0, 0.42, uv.y);
  return mix(u_bg, mix(u_a1, u_a2, c), (0.25 + c * 0.5) * fade);`,

rulegrid: `
  vec2 g = uv * vec2(u_res.x / u_res.y, 1.0) * 18.0;
  vec2 l = abs(fract(g) - 0.5);
  float fine = smoothstep(0.48, 0.5, max(l.x, l.y));
  vec2 lb = abs(fract(g / 6.0) - 0.5);
  float bold = smoothstep(0.485, 0.5, max(lb.x, lb.y));
  return tint(fine * 0.22 + bold * 0.5, 0.0);`,

draft: `
  vec2 g = uv * vec2(u_res.x / u_res.y, 1.0) * 24.0;
  vec2 l = abs(fract(g) - 0.5);
  float fine = smoothstep(0.47, 0.5, max(l.x, l.y)) * 0.35;
  vec2 c = abs(fract(g / 8.0) - 0.5);
  float cross = (smoothstep(0.49, 0.5, c.x) + smoothstep(0.49, 0.5, c.y)) * 0.5;
  vec3 col = mix(u_bg, u_a1, fine * 0.5 + cross * 0.45);
  return col;`,

dotmatrix: `
  vec2 g = uv * vec2(u_res.x / u_res.y, 1.0) * 46.0;
  vec2 f = fract(g) - 0.5;
  float wave = 0.5 + 0.5 * sin(length(cen(uv)) * 14.0 - u_time * 1.6);
  float d = smoothstep(0.34 * (0.4 + wave), 0.0, length(f));
  return tint(d * (0.35 + wave * 0.65), 0.0);`,

halftone: `
  vec2 g = uv * vec2(u_res.x / u_res.y, 1.0) * 52.0;
  g = rot(0.4) * g;
  float v = fbm(uv * 2.2 + u_time * 0.04);
  float d = length(fract(g) - 0.5);
  float dot_ = smoothstep(v * 0.52, v * 0.52 - 0.06, d);
  return mix(u_bg, u_a1, dot_ * (0.22 + u_energy * 0.22));`,

circuit: `
  vec2 g = uv * vec2(u_res.x / u_res.y, 1.0) * 14.0;
  vec2 id = floor(g), f = fract(g);
  float h = hash21(id);
  float line = h < 0.5
    ? smoothstep(0.07, 0.0, abs(f.y - 0.5))
    : smoothstep(0.07, 0.0, abs(f.x - 0.5));
  float pad = smoothstep(0.17, 0.10, length(f - 0.5)) * step(0.86, h);
  float pulse = 0.45 + 0.55 * sin(u_time * 1.6 + h * 24.0);
  return tint(line * 0.4 + pad * pulse, pad * 0.8);`,

hexfield: `
  vec2 p = cen(uv) * 9.0;
  p.x *= 1.1547;
  p.y += mod(floor(p.x), 2.0) * 0.5;
  vec2 f = abs(fract(p) - 0.5);
  float e = smoothstep(0.46, 0.5, max(f.x, f.y));
  float pulse = 0.5 + 0.5 * sin(u_time * 0.9 - length(cen(uv)) * 6.0);
  return tint(e * (0.3 + pulse * 0.55), 0.0);`,

plates: `
  vec3 w = worley(uv * vec2(u_res.x / u_res.y, 1.0) * 5.0);
  float edge = smoothstep(0.12, 0.0, w.x);
  float fill = hash21(w.yz) * 0.4;
  return tint(edge * 0.75 + fill * 0.35, edge * 0.5);`,

facets: `
  vec3 w = worley(uv * vec2(u_res.x / u_res.y, 1.0) * 7.0);
  float shade = hash21(w.yz);
  vec3 col = mix(u_bg, mix(u_a1, u_a2, shade), 0.18 + shade * 0.34 * (0.5 + u_energy));
  return mix(col, u_bg, smoothstep(0.0, 0.07, w.x) * 0.0 + smoothstep(0.30, 0.0, w.x) * 0.25);`,

crystal: `
  vec3 w = worley(uv * vec2(u_res.x / u_res.y, 1.0) * 6.0);
  float edge = smoothstep(0.10, 0.0, w.x);
  float sheen = 0.5 + 0.5 * sin(hash21(w.yz) * 20.0 + u_time * 0.5);
  return tint(edge * 0.8, sheen * 0.3);`,

metaballs: `
  vec2 p = cen(uv);
  float s = 0.0;
  for (int i = 0; i < 5; i++){
    float f = float(i) + 1.0;
    vec2 c = vec2(sin(u_time * 0.31 * f + f) * 0.42, cos(u_time * 0.27 * f + f * 2.0) * 0.32);
    s += 0.035 / (dot(p - c, p - c) + 0.004);
  }
  float m = smoothstep(0.8, 1.9, s);
  return tint(m, smoothstep(1.6, 3.0, s));`,

/* ---- waves / water ---------------------------------------------------- */
waves: `
  float y = uv.y * 7.0;
  float w = sin(uv.x * 7.0 + u_time * 0.6) * 0.25
          + sin(uv.x * 13.0 - u_time * 0.4) * 0.12;
  float band = smoothstep(0.42, 0.5, abs(fract(y + w) - 0.5));
  float depth = smoothstep(1.0, 0.0, uv.y);
  return tint(band * depth * 0.85, depth * 0.45);`,

caustics: `
  vec2 p = uv * 5.0;
  float t = u_time * 0.4;
  float a = sin(p.x + t) + sin(p.y * 1.3 - t * 0.8) + sin((p.x + p.y) * 0.8 + t * 0.6);
  float b = sin(p.x * 1.7 - t * 0.7) + sin(p.y * 0.9 + t);
  float m = pow(abs(sin(a * 0.8 + b * 0.4)), 4.0);
  return tint(m, smoothstep(0.5, 1.0, m) * 0.8);`,

ripples: `
  vec2 p = cen(uv);
  float s = 0.0;
  for (int i = 0; i < 3; i++){
    float f = float(i);
    vec2 c = vec2(sin(f * 2.1) * 0.35, cos(f * 1.7) * 0.28);
    s += sin(length(p - c) * 26.0 - u_time * 1.8 + f * 2.0);
  }
  float m = smoothstep(0.4, 2.2, s + 1.5);
  return tint(m * 0.8, 0.0);`,

interference: `
  vec2 p = cen(uv);
  float a = sin(length(p - vec2(0.22, 0.0)) * 60.0 - u_time * 1.2);
  float b = sin(length(p + vec2(0.22, 0.0)) * 60.0 - u_time * 1.2);
  float m = smoothstep(0.6, 1.0, (a * b) * 0.5 + 0.5);
  return tint(m, 0.0);`,

lissajous: `
  vec2 p = cen(uv);
  float m = 0.0;
  for (int i = 0; i < 24; i++){
    float t = float(i) / 24.0 * 6.2831 + u_time * 0.25;
    vec2 q = vec2(sin(t * 3.0) * 0.42, sin(t * 2.0 + u_time * 0.1) * 0.34);
    m = max(m, smoothstep(0.05, 0.0, length(p - q)));
  }
  return tint(m, m * 0.6);`,

rainfall: `
  vec2 g = vec2(uv.x * 50.0, uv.y);
  float col_ = floor(g.x);
  float sp = 0.6 + hash11(col_) * 1.4;
  float y = fract(g.y + u_time * sp * 0.35 + hash11(col_ + 7.0));
  float streak = smoothstep(0.32, 0.0, y) * smoothstep(0.0, 0.03, y);
  return tint(streak * 0.7, 0.0);`,

rain: `
  vec2 g = vec2(uv.x * 42.0, uv.y * 26.0);
  float col_ = floor(g.x);
  float head = fract(hash11(col_) + u_time * (0.25 + hash11(col_ + 3.0) * 0.5));
  float d = fract(g.y) ;
  float cell = floor(g.y) / 26.0;
  float lit = smoothstep(0.30, 0.0, fract(cell - head + 1.0));
  float glyph = step(0.45, hash21(vec2(col_, floor(g.y) + floor(u_time * 6.0))));
  return tint(lit * glyph * 0.9, lit * glyph * step(0.97, fract(cell - head + 1.0)));`,

/* ---- terrain / organic ------------------------------------------------ */
dunes: `
  float m = 0.0;
  for (int i = 0; i < 4; i++){
    float f = float(i);
    float base = 0.18 + f * 0.17;
    float h = base + sin(uv.x * (2.0 + f) + u_time * 0.06 * (1.0 + f)) * 0.055
                   + fbm(vec2(uv.x * 2.0 + f * 3.0, f)) * 0.07;
    m = max(m, step(uv.y, h) * (0.3 + f * 0.2));
  }
  return tint(m, smoothstep(0.65, 1.0, uv.y) * 0.5);`,

contours: `
  float h = fbm(uv * 3.0 + u_time * 0.015);
  float band = abs(fract(h * 16.0) - 0.5);
  float line = smoothstep(0.08, 0.0, band);
  return tint(line * 0.8, smoothstep(0.55, 0.9, h) * 0.4);`,

topo: `
  float h = fbm(uv * 2.2 + vec2(u_time * 0.01, 0.0));
  float band = abs(fract(h * 9.0) - 0.5);
  float line = smoothstep(0.06, 0.0, band);
  float fill = floor(h * 9.0) / 9.0;
  return tint(line * 0.7 + fill * 0.28, fill * 0.5);`,

canopy: `
  float m = 0.0;
  for (int i = 0; i < 3; i++){
    float f = float(i);
    vec2 p = uv * (5.0 + f * 3.0) + vec2(u_time * 0.02 * (f + 1.0), f * 4.0);
    m += step(0.62, fbm(p)) * (0.22 - f * 0.05);
  }
  float light = smoothstep(0.1, 1.0, uv.y);
  return tint(1.0 - m * 2.2, light * 0.5);`,

magma: `
  float f = fbm(uv * 3.4 + vec2(0.0, -u_time * 0.05));
  float crack = smoothstep(0.52, 0.46, abs(f - 0.5));
  float heat = smoothstep(0.30, 0.0, abs(f - 0.5));
  vec3 col = mix(u_bg, u_a1, crack * 0.9);
  return mix(col, u_a2, heat * 0.55 * (0.4 + u_energy));`,

embers: `
  vec3 col = u_bg;
  for (int i = 0; i < 3; i++){
    float f = float(i);
    vec2 g = vec2(uv.x * (16.0 + f * 7.0), uv.y);
    float c = floor(g.x);
    float y = fract(uv.y + u_time * (0.05 + hash11(c + f) * 0.09));
    float d = length(vec2(fract(g.x) - 0.5, (y - 0.5) * 2.2));
    col += (f < 1.5 ? u_a1 : u_a2) * smoothstep(0.22, 0.0, d) * (0.22 - f * 0.05)
         * step(0.70, hash11(c + f * 11.0));
  }
  return col;`,

/* ---- texture / print -------------------------------------------------- */
static: `
  float n = hash21(floor(gl_FragCoord.xy / 2.0) + floor(u_time * 24.0) * 37.0);
  float band = step(0.5, fract(uv.y * 3.0 - u_time * 0.1)) * 0.08;
  return mix(u_bg, u_a1, n * (0.14 + u_energy * 0.14) + band);`,

scanfield: `
  float line = step(0.5, fract(uv.y * u_res.y / 3.0));
  float sweep = smoothstep(0.08, 0.0, abs(fract(uv.y - u_time * 0.12) - 0.5));
  float f = fbm(uv * 2.0 + u_time * 0.02);
  return tint(f * 0.5 + sweep * 0.7, line * 0.10);`,

risograin: `
  float n = hash21(floor(gl_FragCoord.xy / 3.0));
  float f = fbm(uv * 2.6);
  float a = smoothstep(0.42, 0.72, f + n * 0.18);
  float b = smoothstep(0.52, 0.86, fbm(uv * 3.4 + 9.0) + n * 0.16);
  return tint(a * 0.8, b * 0.7);`,

chalkdust: `
  float n = hash21(floor(gl_FragCoord.xy / 2.0)) * 0.5;
  float f = fbm(uv * 4.0 + u_time * 0.01);
  float m = smoothstep(0.40, 0.85, f + n * 0.3);
  return tint(m * 0.45, 0.0);`,

brushed: `
  float n = n2(vec2(uv.x * 420.0, uv.y * 3.0));
  float sheen = 0.5 + 0.5 * sin(uv.x * 2.4 + u_time * 0.12);
  return tint(n * 0.35 + sheen * 0.35, sheen * 0.3);`,

plasma: `
  float f = fbm(uv * 3.0 + vec2(u_time * 0.14, u_time * 0.09));
  float band = step(0.5, fract(f * 3.4 + u_time * 0.1));
  float dither = step(0.5, hash21(floor(uv * u_res / 3.0)));
  float m = clamp(band * 0.72 + dither * 0.28, 0.0, 1.0);
  return mix(u_bg, u_a1, m * (0.30 + u_energy * 0.34));`,

rings: `
  vec2 p = cen(uv);
  float d = length(p);
  float r = sin(d * 22.0 - u_time * 1.7) * 0.5 + 0.5;
  float m = smoothstep(0.62, 1.0, r) * smoothstep(0.85, 0.10, d);
  vec3 col = mix(u_bg, u_a1, m * (0.14 + u_energy * 0.17));
  return mix(col, u_a2, smoothstep(0.62, 0.0, d) * 0.07 * u_energy);`,

/* ---- geometry, part two ---------------------------------------------- */
spiral: `
  vec2 p = cen(uv);
  float a = atan(p.y, p.x), r = length(p);
  float s = fract((a / 6.2831) * 6.0 + r * 7.0 - u_time * 0.3);
  float m = smoothstep(0.46, 0.54, s) * smoothstep(1.1, 0.03, r);
  return tint(m, smoothstep(0.35, 0.0, r) * 0.6);`,

triangles: `
  vec2 p = cen(uv) * 8.0;
  p.x += p.y * 0.5;
  vec2 f = fract(p);
  float up = step(f.x + f.y, 1.0);
  vec2 id = floor(p) + up * 0.3;
  float h = hash21(id);
  float pulse = 0.5 + 0.5 * sin(u_time * 0.8 + h * 20.0);
  return tint(h * 0.5 + pulse * 0.35, up * h * 0.4);`,

diamonds: `
  vec2 p = cen(uv) * 11.0;
  p = rot(0.785) * p;
  vec2 f = abs(fract(p) - 0.5);
  float e = smoothstep(0.42, 0.5, f.x + f.y);
  float pulse = 0.5 + 0.5 * sin(u_time * 1.1 - length(cen(uv)) * 7.0);
  return tint(e * (0.35 + pulse * 0.5), 0.0);`,

scales: `
  vec2 p = uv * vec2(u_res.x / u_res.y, 1.0) * 13.0;
  p.x += mod(floor(p.y), 2.0) * 0.5;
  vec2 f = fract(p) - vec2(0.5, 0.0);
  float d = length(vec2(f.x, f.y * 1.3));
  float e = smoothstep(0.52, 0.46, d) - smoothstep(0.42, 0.36, d);
  return tint(e * 0.8 + smoothstep(0.42, 0.0, d) * 0.22, 0.0);`,

chevron: `
  vec2 p = uv * vec2(u_res.x / u_res.y, 1.0) * 9.0;
  float v = abs(fract(p.x) - 0.5) * 2.0;
  float band = fract(p.y - v * 0.5 + u_time * 0.18);
  float m = step(0.5, band);
  return tint(m * 0.4 + (1.0 - m) * 0.12, 0.0);`,

stripes: `
  vec2 p = rot(0.6) * (uv * vec2(u_res.x / u_res.y, 1.0));
  float s = fract(p.x * 14.0 - u_time * 0.25);
  float m = smoothstep(0.46, 0.5, abs(s - 0.5) * 2.0);
  return tint(m * 0.35, (1.0 - m) * 0.14);`,

ladder: `
  vec2 p = uv - vec2(0.5, 0.0);
  float z = 1.0 / max(1.02 - uv.y, 0.02);
  float rung = smoothstep(0.42, 0.5, abs(fract(z * 0.8 + u_time * 0.5) - 0.5) * 2.0);
  float rail = smoothstep(0.03, 0.0, abs(abs(p.x) - 0.22 * z * 0.25));
  return tint(max(rung * 0.5, rail * 0.8) * smoothstep(1.0, 0.1, uv.y), 0.0);`,

pillars: `
  float x = uv.x * 16.0;
  float id = floor(x);
  float h = 0.25 + hash11(id) * 0.6 + sin(u_time * 0.5 + id) * 0.08;
  float m = step(uv.y, h) * smoothstep(0.5, 0.46, abs(fract(x) - 0.5));
  return tint(m * 0.55, step(uv.y, h * 0.4) * 0.4);`,

mesh: `
  vec2 p = uv * 10.0;
  p.y += fbm(vec2(p.x * 0.3, u_time * 0.08)) * 2.2;
  vec2 f = abs(fract(p) - 0.5);
  float e = smoothstep(0.46, 0.5, max(f.x, f.y));
  return tint(e * 0.6, smoothstep(0.7, 1.0, fbm(uv * 2.0)) * 0.4);`,

terrain: `
  float m = 0.0;
  for (int i = 0; i < 5; i++){
    float f = float(i);
    float h = 0.12 + f * 0.15 + fbm(vec2(uv.x * (3.0 + f) + f * 7.0, f * 2.0 + u_time * 0.02)) * 0.16;
    m = max(m, step(uv.y, h) * (0.22 + f * 0.17));
  }
  return tint(m, smoothstep(0.6, 1.0, uv.y) * 0.45);`,

/* ---- atmosphere ------------------------------------------------------- */
clouds: `
  float f = fbm(uv * vec2(2.4, 3.4) + vec2(u_time * 0.035, 0.0));
  float g = fbm(uv * vec2(4.8, 6.0) - vec2(u_time * 0.02, 0.0) + 5.0);
  float m = smoothstep(0.46, 0.86, f * 0.75 + g * 0.35);
  return tint(m, smoothstep(0.66, 1.0, f) * 0.5);`,

mist: `
  float m = 0.0;
  for (int i = 0; i < 4; i++){
    float f = float(i);
    float y = fract(uv.y * 1.3 + f * 0.25 + u_time * 0.012 * (1.0 + f));
    m += smoothstep(0.5, 0.0, abs(y - 0.5)) * (0.18 - f * 0.03)
       * (0.6 + fbm(vec2(uv.x * 3.0 + f, f)) * 0.8);
  }
  return tint(m * 1.6, 0.0);`,

shimmer: `
  float x = uv.x * 10.0;
  float band = sin(x + fbm(vec2(x * 0.4, u_time * 0.14)) * 4.0 + u_time * 0.3);
  float m = smoothstep(0.2, 1.0, band) * smoothstep(0.0, 0.8, uv.y);
  return tint(m * 0.8, smoothstep(0.6, 1.0, m) * 0.6);`,

prism: `
  vec2 p = cen(uv);
  float a = atan(p.y, p.x) / 6.2831 + 0.5;
  float band = fract(a * 6.0 + u_time * 0.08);
  float m = smoothstep(0.1, 0.5, band) * smoothstep(1.2, 0.1, length(p));
  return tint(m * 0.6, (1.0 - band) * 0.4 * smoothstep(1.0, 0.0, length(p)));`,

bands: `
  float y = uv.y * 7.0 + fbm(vec2(uv.x * 2.0, u_time * 0.03)) * 1.4;
  float k = floor(y) / 7.0;
  return tint(k * 0.7, (1.0 - k) * 0.4);`,

sonar: `
  vec2 p = cen(uv);
  float d = length(p);
  float t = fract(u_time * 0.35);
  float ring = smoothstep(0.03, 0.0, abs(d - t * 1.2));
  float ring2 = smoothstep(0.03, 0.0, abs(d - fract(t + 0.5) * 1.2));
  float sweep = smoothstep(0.0, 0.6, 1.0 - abs(fract(atan(p.y, p.x) / 6.2831 - u_time * 0.12) - 0.0));
  return tint(max(ring, ring2) * 0.9 + sweep * 0.12, 0.0);`,

/* ---- material --------------------------------------------------------- */
paper: `
  float f = n2(gl_FragCoord.xy * 0.35) * 0.5 + n2(gl_FragCoord.xy * 0.08) * 0.5;
  float fibre = n2(vec2(gl_FragCoord.x * 0.02, gl_FragCoord.y * 0.6));
  return tint(f * 0.22 + fibre * 0.16, 0.0);`,

concrete: `
  float f = fbm(uv * 8.0) * 0.6 + hash21(floor(gl_FragCoord.xy / 2.0)) * 0.4;
  float blotch = smoothstep(0.55, 0.85, fbm(uv * 3.0 + 4.0));
  return tint(f * 0.3 + blotch * 0.25, 0.0);`,

marble: `
  vec2 p = uv * 3.0;
  float v = fbm(p + fbm(p * 2.0 + u_time * 0.01) * 3.0);
  float vein = smoothstep(0.04, 0.0, abs(fract(v * 4.0) - 0.5) - 0.42);
  return tint(vein * 0.85 + v * 0.18, 0.0);`,

wood: `
  vec2 p = uv * vec2(1.6, 7.0);
  float rings = fract(length(p - vec2(0.4, 0.0)) * 3.0 + fbm(p * 1.4) * 1.8);
  float grain = n2(vec2(uv.x * 220.0, uv.y * 4.0));
  return tint(smoothstep(0.35, 0.65, rings) * 0.45 + grain * 0.14, 0.0);`,

carbon: `
  vec2 g = uv * vec2(u_res.x / u_res.y, 1.0) * 46.0;
  vec2 id = floor(g); vec2 f = fract(g);
  float weave = mod(id.x + id.y, 2.0) < 1.0
    ? smoothstep(0.5, 0.0, abs(f.y - 0.5))
    : smoothstep(0.5, 0.0, abs(f.x - 0.5));
  float sheen = 0.5 + 0.5 * sin(uv.x * 3.0 + uv.y * 2.0 + u_time * 0.2);
  return tint(weave * (0.18 + sheen * 0.30), 0.0);`,

denim: `
  vec2 g = uv * vec2(u_res.x / u_res.y, 1.0) * 180.0;
  float twill = step(0.5, fract((g.x + g.y * 2.0) / 3.0));
  float slub = n2(vec2(g.x * 0.08, g.y * 0.02));
  return tint(twill * 0.18 + slub * 0.22, 0.0);`,

crosshatch: `
  vec2 g = uv * vec2(u_res.x / u_res.y, 1.0) * 40.0;
  float v = fbm(uv * 2.4 + u_time * 0.02);
  float a = smoothstep(0.48, 0.5, abs(fract((rot(0.7) * g).x) - 0.5));
  float b = smoothstep(0.48, 0.5, abs(fract((rot(-0.7) * g).x) - 0.5));
  float ink = (v > 0.55 ? a : 0.0) + (v > 0.68 ? b : 0.0);
  return tint(clamp(ink, 0.0, 1.0) * 0.55, 0.0);`,

engraving: `
  float v = fbm(uv * 2.6 + u_time * 0.015);
  float line = abs(fract(uv.y * 90.0 + v * 6.0) - 0.5) * 2.0;
  float ink = smoothstep(v * 0.9, v * 0.9 - 0.25, line);
  return tint(ink * 0.5, 0.0);`,

stipple: `
  vec2 g = uv * vec2(u_res.x / u_res.y, 1.0) * 90.0;
  vec2 id = floor(g);
  float v = fbm(uv * 2.6);
  float r = hash21(id);
  float dot_ = step(r, v * 0.9) * smoothstep(0.42, 0.1, length(fract(g) - 0.5));
  return tint(dot_ * 0.6, 0.0);`,

tartan: `
  vec2 p = uv * vec2(u_res.x / u_res.y, 1.0) * 7.0;
  float a = step(0.5, fract(p.x)) + step(0.82, fract(p.x * 2.0));
  float b = step(0.5, fract(p.y)) + step(0.82, fract(p.y * 2.0));
  return tint(a * 0.22, b * 0.22);`,

/* ---- signal / screen --------------------------------------------------- */
bubbles: `
  vec3 col = u_bg;
  for (int i = 0; i < 4; i++){
    float f = float(i);
    vec2 g = vec2(uv.x * (7.0 + f * 4.0), uv.y);
    float c = floor(g.x);
    float y = fract(uv.y + u_time * (0.03 + hash11(c + f) * 0.06));
    float d = length(vec2(fract(g.x) - 0.5, (y - 0.5) * 1.4)) ;
    float ring = smoothstep(0.34, 0.30, d) - smoothstep(0.28, 0.24, d);
    col += u_a2 * ring * (0.5 - f * 0.08) * step(0.55, hash11(c + f * 9.0));
  }
  return col;`,

firefly: `
  vec3 col = u_bg;
  for (int i = 0; i < 3; i++){
    float f = float(i);
    vec2 g = uv * (9.0 + f * 5.0);
    vec2 id = floor(g);
    vec2 o = hash22(id + f * 17.0);
    vec2 pos = 0.5 + 0.38 * sin(u_time * (0.4 + o.x * 0.6) + o * 6.28);
    float d = length(fract(g) - pos);
    float tw = 0.4 + 0.6 * sin(u_time * (1.2 + o.y * 2.0) + o.x * 20.0);
    col += u_a1 * smoothstep(0.17, 0.0, d) * tw * (0.5 - f * 0.12)
         * step(0.80, hash21(id + f * 5.0));
  }
  return col;`,

lcd: `
  vec2 g = gl_FragCoord.xy / 3.0;
  float sub = mod(floor(g.x), 3.0);
  float cell = smoothstep(0.5, 0.0, abs(fract(g.y) - 0.5));
  float f = fbm(uv * 2.4 + u_time * 0.03);
  vec3 mask = vec3(step(sub, 0.5), step(abs(sub - 1.0), 0.5), step(1.5, sub));
  return mix(u_bg, u_a1 * mask * 3.0, f * cell * (0.10 + u_energy * 0.12));`,

crtbed: `
  vec2 p = cen(uv);
  // Barrel distortion, so the scanlines sit on a curved tube.
  vec2 q = p * (1.0 + 0.16 * dot(p, p));
  vec2 uv2 = q + 0.5;
  float inside = step(0.0, uv2.x) * step(uv2.x, 1.0) * step(0.0, uv2.y) * step(uv2.y, 1.0);
  float f = fbm(uv2 * 2.2 + u_time * 0.05);
  float line = 0.5 + 0.5 * sin(uv2.y * u_res.y * 0.9);
  float glow = smoothstep(1.0, 0.0, length(p));
  return mix(u_bg, u_a1, f * line * inside * (0.22 + u_energy * 0.26) + glow * 0.05);`,

datamosh: `
  vec2 g = floor(uv * vec2(28.0, 16.0));
  float h = hash21(g + floor(u_time * 3.0));
  vec2 off = (h > 0.86) ? vec2(h - 0.5, 0.0) * 0.12 : vec2(0.0);
  float f = fbm((uv + off) * 3.0);
  float block = step(0.92, h);
  return tint(f * 0.6 + block * 0.5, block * 0.8);`,

rgbsplit: `
  float f = fbm(uv * 2.6 + u_time * 0.05);
  float j = step(0.93, hash11(floor(u_time * 8.0))) * 0.02;
  float r = fbm((uv + vec2(j, 0.0)) * 2.6 + u_time * 0.05);
  float b = fbm((uv - vec2(j, 0.0)) * 2.6 + u_time * 0.05);
  vec3 col = u_bg;
  col = mix(col, u_a1, smoothstep(0.4, 0.9, r) * 0.45);
  col = mix(col, u_a2, smoothstep(0.4, 0.9, b) * 0.35);
  return col;`,
};

/**
 * A full-screen shader bed on a canvas, with the engine's whole bed library.
 *
 *   const bed = new CasedBed(canvas, { mode: 'aurora', bg, a1, a2 });
 *   bed.start();     // rAF loop
 *   bed.frame(t);    // or drive it yourself
 *   CasedBed.MODES   // every bed name
 *
 * Programs are compiled per bed, on demand, exactly as the renderer does it:
 * a page showing six beds should not compile eighty.
 */
class CasedBed {
  static MODES = Object.keys(CASED_BEDS);

  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.opts = Object.assign(
      { mode: 'aurora', energy: 0.6, seed: 7, scale: 0.6,
        bg: '#06070C', a1: '#FF2D71', a2: '#00F0FF', speed: 1 }, opts);
    this.progs = {};
    this.ok = this._init();
    this._raf = null;
    this._t0 = null;
  }

  _hex(h) {
    h = (h || '#000').replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    return [parseInt(h.slice(0,2),16)/255, parseInt(h.slice(2,4),16)/255, parseInt(h.slice(4,6),16)/255];
  }

  _sh(type, src) {
    const gl = this.gl;
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('cased bed:', gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  _program(mode) {
    if (this.progs[mode]) return this.progs[mode];
    const gl = this.gl;
    const body = CASED_BEDS[mode] || CASED_BEDS.aurora;
    const vs = this._sh(gl.VERTEX_SHADER, CASED_VERT);
    const fs = this._sh(gl.FRAGMENT_SHADER,
      CASED_PRELUDE + '\nvec3 bed(vec2 uv){\n' + body + '\n}\n' + CASED_MAIN);
    if (!vs || !fs) {
      this.progs[mode] = mode === 'aurora' ? null : this._program('aurora');
      return this.progs[mode];
    }
    const p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs);
    gl.bindAttribLocation(p, 0, 'p');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      this.progs[mode] = mode === 'aurora' ? null : this._program('aurora');
      return this.progs[mode];
    }
    const u = {};
    for (const n of ['u_res','u_time','u_energy','u_seed','u_bg','u_a1','u_a2'])
      u[n] = gl.getUniformLocation(p, n);
    this.progs[mode] = { p, u };
    return this.progs[mode];
  }

  _init() {
    const gl = this.canvas.getContext('webgl', { antialias: false, alpha: false, depth: false });
    if (!gl) return false;
    this.gl = gl;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.resize();
    return true;
  }

  resize() {
    if (!this.ok) return;
    const r = this.canvas.getBoundingClientRect();
    const s = this.opts.scale;
    const w = Math.max(2, Math.round((r.width || 300) * s));
    const h = Math.max(2, Math.round((r.height || 200) * s));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
  }

  set(opts) { Object.assign(this.opts, opts); }

  frame(t) {
    if (!this.ok) return;
    const gl = this.gl, o = this.opts;
    const pr = this._program(o.mode in CASED_BEDS ? o.mode : 'aurora');
    if (!pr) return;
    gl.useProgram(pr.p);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.uniform2f(pr.u.u_res, this.canvas.width, this.canvas.height);
    gl.uniform1f(pr.u.u_time, t * o.speed);
    gl.uniform1f(pr.u.u_energy, o.energy);
    gl.uniform1f(pr.u.u_seed, o.seed);
    gl.uniform3fv(pr.u.u_bg, this._hex(o.bg));
    gl.uniform3fv(pr.u.u_a1, this._hex(o.a1));
    gl.uniform3fv(pr.u.u_a2, this._hex(o.a2));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  start() {
    if (!this.ok || this._raf) return;
    const loop = (now) => {
      if (this._t0 === null) this._t0 = now;
      this.frame((now - this._t0) / 1000);
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  stop() { if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; } }
}

window.CasedBed = CasedBed;
