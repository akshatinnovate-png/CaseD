#!/usr/bin/env python3
"""
Extract the engine's background shader into a browser module for the site.

The launch site runs the *same* shader the renderer does -- that is the point
of the directors gallery. Copying the source by hand guarantees the two drift
apart, so it is generated here instead. Run this after editing the shader in
`cased/engine/stage.html`.

    python3 scripts/sync_bed.py [--check]

`--check` verifies the generated file is current and exits non-zero if not,
which is what CI should run.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STAGE = ROOT / "cased" / "engine" / "stage.html"
OUT = ROOT / "docs" / "assets" / "bed.js"

HEADER = """/* GENERATED FILE -- do not edit.
 *
 * Produced by scripts/sync_bed.py from cased/engine/stage.html, so the
 * launch site renders with exactly the shader the film renderer uses.
 * Edit the shader in stage.html, then re-run the script.
 */
"""

BODY = """
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
      CASED_PRELUDE + '\\nvec3 bed(vec2 uv){\\n' + body + '\\n}\\n' + CASED_MAIN);
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
"""


def extract(src: str) -> tuple:
    """Pull the vertex shader, the shared prelude, the main wrapper and the
    whole bed library out of the engine."""
    def one(name):
        m = re.search(r"const %s = `(.*?)`;" % name, src, re.S)
        if not m:
            raise SystemExit(f"could not find {name} in stage.html")
        return m.group(1)

    vert = one("VERT")
    prelude = one("GL_PRELUDE")
    main = one("GL_MAIN")

    m = re.search(r"const BEDS = \{(.*?)\n\};", src, re.S)
    if not m:
        raise SystemExit("could not find BEDS in stage.html")
    beds_body = m.group(1)
    names = re.findall(r"^([a-z_][a-z0-9_]*):\s*`", beds_body, re.M)
    return vert, prelude, main, beds_body, names


def render() -> str:
    vert, prelude, main, beds_body, names = extract(STAGE.read_text(encoding="utf-8"))
    return (HEADER
            + f"\n// {len(names)} beds, extracted verbatim from the engine.\n"
            + "\nconst CASED_VERT = `" + vert + "`;\n"
            + "\nconst CASED_PRELUDE = `" + prelude + "`;\n"
            + "\nconst CASED_MAIN = `" + main + "`;\n"
            + "\nconst CASED_BEDS = {" + beds_body + "\n};\n"
            + BODY)


def main(argv) -> int:
    want = render()
    if "--check" in argv:
        have = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        if have != want:
            print("docs/assets/bed.js is stale -- run: python3 scripts/sync_bed.py",
                  file=sys.stderr)
            return 1
        print("bed.js is in sync")
        return 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(want, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({len(want):,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
