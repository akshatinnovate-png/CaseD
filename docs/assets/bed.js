/* GENERATED FILE -- do not edit.
 *
 * Produced by scripts/sync_bed.py from cased/engine/stage.html, so the
 * launch site renders with exactly the shader the film renderer uses.
 * Edit the shader in stage.html, then re-run the script.
 */

const CASED_VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

const CASED_FRAG = `
precision highp float;
uniform vec2  u_res;
uniform float u_time;
uniform float u_mode;
uniform float u_energy;
uniform float u_seed;
uniform vec3  u_bg;
uniform vec3  u_a1;
uniform vec3  u_a2;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)) + u_seed) * 43758.5453123); }

float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++){ v += a * noise(p); p *= 2.02; a *= 0.5; }
  return v;
}

/* Soft flowing gradient. The default cinematic bed. */
vec3 aurora(vec2 uv){
  float t = u_time * 0.055;
  vec2 q = vec2(fbm(uv * 1.7 + vec2(t, t * 0.7)), fbm(uv * 1.7 + vec2(5.2, 1.3) - t * 0.6));
  float f = fbm(uv * 2.1 + q * 1.9 + t * 0.4);
  float g = fbm(uv * 3.3 - q * 1.2 - t * 0.25);
  vec3 col = u_bg;
  col = mix(col, u_a1, smoothstep(0.28, 0.92, f) * (0.46 + u_energy * 0.40));
  col = mix(col, u_a2, smoothstep(0.42, 1.0, g) * (0.26 + u_energy * 0.30));
  return col;
}

/* Perspective grid rushing toward the horizon. */
vec3 gridTunnel(vec2 uv){
  vec2 p = uv - 0.5;
  p.y = abs(p.y) + 0.035;
  vec2 g = vec2(p.x / p.y, 1.0 / p.y + u_time * 0.55);
  vec2 l = abs(fract(g * vec2(2.2, 0.9)) - 0.5);
  float line = min(l.x, l.y);
  float w = smoothstep(0.055, 0.0, line) * smoothstep(1.35, 0.06, p.y * 6.0);
  vec3 col = mix(u_bg, u_a1, w * (0.52 + u_energy * 0.48));
  col += u_a2 * smoothstep(0.42, 0.0, length(uv - vec2(0.5, 0.5))) * 0.14 * u_energy;
  return col;
}

/* Starfield with a soft nebula wash. */
vec3 starfield(vec2 uv){
  vec3 col = u_bg;
  float neb = fbm(uv * 2.6 + vec2(u_time * 0.025, 0.0));
  col = mix(col, u_a1 * 0.75, smoothstep(0.52, 1.0, neb) * 0.40);
  col = mix(col, u_a2 * 0.55, smoothstep(0.62, 1.0, fbm(uv * 4.0 - u_time * 0.015)) * 0.22);
  for (int i = 0; i < 3; i++){
    float sc = 90.0 + float(i) * 95.0;
    vec2 gp = uv * sc;
    vec2 id = floor(gp);
    float h = hash(id + float(i) * 31.7);
    if (h > 0.976){
      vec2 c = fract(gp) - 0.5;
      float tw = 0.60 + 0.40 * sin(u_time * (1.6 + h * 3.4) + h * 28.0);
      col += vec3(1.0) * smoothstep(0.30, 0.0, length(c)) * tw * (0.55 - float(i) * 0.13);
    }
  }
  return col;
}

/* Hard, dithered two-tone plasma. The brutalist bed. */
vec3 plasma(vec2 uv){
  float f = fbm(uv * 3.0 + vec2(u_time * 0.14, u_time * 0.09));
  float band = step(0.5, fract(f * 3.4 + u_time * 0.1));
  float dither = step(0.5, hash(floor(uv * u_res / 3.0)));
  float m = clamp(band * 0.72 + dither * 0.28, 0.0, 1.0);
  return mix(u_bg, u_a1, m * (0.30 + u_energy * 0.34));
}

/* Concentric pulse rings radiating from centre. */
vec3 rings(vec2 uv){
  vec2 p = (uv - 0.5) * vec2(u_res.x / u_res.y, 1.0);
  float d = length(p);
  float r = sin(d * 22.0 - u_time * 1.7) * 0.5 + 0.5;
  float m = smoothstep(0.62, 1.0, r) * smoothstep(0.85, 0.10, d);
  vec3 col = mix(u_bg, u_a1, m * (0.14 + u_energy * 0.17));
  col = mix(col, u_a2, smoothstep(0.62, 0.0, d) * 0.07 * u_energy);
  return col;
}

void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  vec3 col;
  if      (u_mode < 0.5) col = aurora(uv);
  else if (u_mode < 1.5) col = gridTunnel(uv);
  else if (u_mode < 2.5) col = starfield(uv);
  else if (u_mode < 3.5) col = plasma(uv);
  else                   col = rings(uv);

  /* Subtle chromatic lift at the edges -- reads as lens, not as a filter. */
  float vig = smoothstep(1.15, 0.22, length(uv - 0.5));
  col *= mix(0.72, 1.0, vig);
  gl_FragColor = vec4(col, 1.0);
}`;

/**
 * A full-screen shader bed on a canvas. Same five modes as the renderer.
 *
 *   const bed = new CasedBed(canvas, { mode: 'aurora', bg, a1, a2 });
 *   bed.start();     // rAF loop
 *   bed.frame(t);    // or drive it yourself
 */
class CasedBed {
  static MODES = { aurora: 0, grid: 1, stars: 2, plasma: 3, rings: 4 };

  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.opts = Object.assign(
      { mode: 'aurora', energy: 0.6, seed: 7, scale: 0.6,
        bg: '#06070C', a1: '#FF2D71', a2: '#00F0FF', speed: 1 }, opts);
    this.ok = this._init();
    this._raf = null;
    this._t0 = null;
  }

  _hex(h) {
    h = (h || '#000').replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    return [parseInt(h.slice(0,2),16)/255, parseInt(h.slice(2,4),16)/255, parseInt(h.slice(4,6),16)/255];
  }

  _sh(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn('cased bed shader:', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  }

  _init() {
    const gl = this.canvas.getContext('webgl', { antialias: false, alpha: false, depth: false });
    if (!gl) return false;
    const vs = this._sh(gl, gl.VERTEX_SHADER, CASED_VERT);
    const fs = this._sh(gl, gl.FRAGMENT_SHADER, CASED_FRAG);
    if (!vs || !fs) return false;
    const p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return false;
    gl.useProgram(p);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(p, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.gl = gl;
    this.u = {};
    for (const n of ['u_res','u_time','u_mode','u_energy','u_seed','u_bg','u_a1','u_a2'])
      this.u[n] = gl.getUniformLocation(p, n);
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
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.uniform2f(this.u.u_res, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.u.u_time, t * o.speed);
    gl.uniform1f(this.u.u_mode, CasedBed.MODES[o.mode] ?? 0);
    gl.uniform1f(this.u.u_energy, o.energy);
    gl.uniform1f(this.u.u_seed, o.seed);
    gl.uniform3fv(this.u.u_bg, this._hex(o.bg));
    gl.uniform3fv(this.u.u_a1, this._hex(o.a1));
    gl.uniform3fv(this.u.u_a2, this._hex(o.a2));
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
