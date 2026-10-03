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
"""


def extract(src: str) -> tuple:
    vert = re.search(r"const VERT = `([^`]*)`", src)
    frag = re.search(r"const FRAG = `([^`]*)`", src)
    if not vert or not frag:
        raise SystemExit("could not find VERT/FRAG in stage.html")
    return vert.group(1), frag.group(1)


def render() -> str:
    vert, frag = extract(STAGE.read_text(encoding="utf-8"))
    return (HEADER
            + "\nconst CASED_VERT = `" + vert + "`;\n"
            + "\nconst CASED_FRAG = `" + frag + "`;\n"
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
