/* =======================================================================
   cased2.0 — launch site
   -----------------------------------------------------------------------
   The directors gallery is not a set of videos or GIFs: each card runs the
   renderer's own fragment shader live, loaded from assets/bed.js, which is
   generated straight out of cased/engine/stage.html. What you hover is what
   the film renders with.
   ======================================================================= */
'use strict';

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a = 0, b = 1) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;

function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* --- the six directors, mirroring cased/directors.py ------------------ */
const DIRECTORS = [
  { id:'cinematic', label:'Cinematic', mode:'aurora', bg:'#06070C', a1:'#7C5CFF', a2:'#39D0FF',
    blurb:'Deep blacks, slow pushes, letterbox. Takes the work seriously.', tag:'default' },
  { id:'brutalist', label:'Brutalist', mode:'plasma', bg:'#F2719E', a1:'#141414', a2:'#FFFFFF',
    blurb:'Hot pink, hard cuts, dialog boxes, type the size of a bus.', tag:'loud' },
  { id:'terminal',  label:'Terminal',  mode:'grid',   bg:'#04080A', a1:'#38F58C', a2:'#FFC24D',
    blurb:'Phosphor green, scanlines, code first. For things with a prompt.', tag:'cli' },
  { id:'hype',      label:'Hype',      mode:'rings',  bg:'#08030F', a1:'#FF2D71', a2:'#00F0FF',
    blurb:'Flash cuts, glitch, neon. Built to stop a thumb mid-scroll.', tag:'social' },
  { id:'orbit',     label:'Orbit',     mode:'stars',  bg:'#01030A', a1:'#FF7A1A', a2:'#2E7BFF',
    blurb:'Starfield, a turning globe, long arcs. For things that ship wide.', tag:'scale' },
  { id:'warm',      label:'Warm',      mode:'aurora', bg:'#0C0A09', a1:'#FF9E5E', a2:'#8FD4C1',
    blurb:'Soft light, unhurried, generous margins. Quietly confident.', tag:'calm' },
];

/* =======================================================================
   film grain
   ======================================================================= */
function makeGrain(seed = 11) {
  const n = 128, c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(n, n);
  const r = rng(seed);
  for (let i = 0; i < n * n; i++) {
    const up = r() > 0.5;
    img.data[i*4] = img.data[i*4+1] = img.data[i*4+2] = up ? 255 : 0;
    img.data[i*4+3] = Math.pow(r(), 2.2) * 255;
  }
  ctx.putImageData(img, 0, 0);
  document.documentElement.style.setProperty('--grain', `url(${c.toDataURL('image/png')})`);
}

/* =======================================================================
   boot dialog
   ======================================================================= */
function boot() {
  document.body.classList.add('booting');
  const fill = $('#boot-fill'), pct = $('#boot-pct'), task = $('#boot-task'), dots = $('#boot-dots');
  const stages = ['shader programs', 'beat map, 92 BPM', 'director beds ×6', 'globe geometry', 'ready'];
  let p = 0, i = 0;
  const done = () => {
    $('#boot').classList.add('gone');
    document.body.classList.remove('booting');
    setTimeout(() => $('#boot')?.remove(), 700);
    start();
  };
  if (REDUCED) return done();

  const tick = setInterval(() => {
    // Uneven steps read as real work; a linear bar reads as a fake.
    p = Math.min(100, p + 4 + Math.random() * 16);
    fill.style.width = p + '%';
    pct.textContent = Math.floor(p) + '%';
    dots.textContent = '.'.repeat(1 + (Math.floor(p / 7) % 3));
    const next = Math.min(stages.length - 1, Math.floor(p / 100 * stages.length));
    if (next !== i) { i = next; task.textContent = stages[i]; }
    if (p >= 100) { clearInterval(tick); setTimeout(done, 260); }
  }, 95);
}

/* =======================================================================
   cursor + magnetic buttons
   ======================================================================= */
function cursor() {
  if (matchMedia('(hover: none)').matches || REDUCED) return;
  const c = $('#cursor');
  let x = innerWidth / 2, y = innerHeight / 2, tx = x, ty = y;
  addEventListener('mousemove', e => { tx = e.clientX; ty = e.clientY; c.classList.add('on'); });
  addEventListener('mouseleave', () => c.classList.remove('on'));
  const loop = () => {
    x = lerp(x, tx, 0.19); y = lerp(y, ty, 0.19);
    c.style.transform = `translate(${x}px, ${y}px)`;
    requestAnimationFrame(loop);
  };
  loop();
  $$('a, button, .dir').forEach(n => {
    n.addEventListener('mouseenter', () => c.classList.add('hot'));
    n.addEventListener('mouseleave', () => c.classList.remove('hot'));
  });
}

function magnetic() {
  if (matchMedia('(hover: none)').matches || REDUCED) return;
  $$('.magnetic').forEach(btn => {
    btn.addEventListener('mousemove', e => {
      const r = btn.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      btn.style.transform = `translate(${dx * 0.22}px, ${dy * 0.3}px)`;
    });
    btn.addEventListener('mouseleave', () => { btn.style.transform = ''; });
  });
}

/* =======================================================================
   reveals
   ======================================================================= */
function reveals() {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      e.target.classList.add('in');
      io.unobserve(e.target);
    });
  }, { threshold: 0.16, rootMargin: '0px 0px -8% 0px' });

  $$('.reveal, .reveal-lines').forEach((n, i) => {
    // Stagger siblings so a grid lands as a wave, not a slab.
    const sibs = [...(n.parentElement?.children || [])].filter(s =>
      s.classList.contains('reveal') || s.classList.contains('reveal-lines'));
    n.style.transitionDelay = (sibs.indexOf(n) * 0.075) + 's';
    io.observe(n);
  });
}

/* =======================================================================
   hero
   ======================================================================= */
function hero() {
  const gl = $('#hero-gl');
  const bed = new CasedBed(gl, { mode: 'aurora', bg: '#06070C', a1: '#7C5CFF',
                                 a2: '#FF2D71', energy: 0.72, scale: 0.42, speed: 0.85 });
  bed.start();
  gl.__bed = bed;                 // the directors gallery re-themes this one
  addEventListener('resize', () => bed.resize(), { passive: true });

  // Drifting motes on a 2D layer above the bed.
  const fx = $('#hero-fx'), ctx = fx.getContext('2d');
  let W = 0, H = 0;
  const r = rng(404);
  const motes = Array.from({ length: 110 }, () => ({
    x: r(), y: r(), z: .25 + r() * .75, s: .5 + r() * 2, ph: r() * 6.28,
    vx: (r() - .5) * .02, vy: -.01 - r() * .03,
  }));
  const size = () => {
    const d = Math.min(devicePixelRatio || 1, 2);
    W = fx.width = Math.round(fx.clientWidth * d);
    H = fx.height = Math.round(fx.clientHeight * d);
  };
  size();
  addEventListener('resize', size, { passive: true });

  let mx = 0.5, my = 0.5;
  addEventListener('mousemove', e => { mx = e.clientX / innerWidth; my = e.clientY / innerHeight; }, { passive: true });

  const t0 = performance.now();
  const loop = (now) => {
    const t = (now - t0) / 1000;
    ctx.clearRect(0, 0, W, H);
    for (const m of motes) {
      const px = (((m.x + m.vx * t) % 1) + 1) % 1;
      const py = (((m.y + m.vy * t) % 1) + 1) % 1;
      // Parallax against the pointer — depth without a 3D scene.
      const ox = (mx - 0.5) * m.z * 44;
      const oy = (my - 0.5) * m.z * 30;
      ctx.globalAlpha = m.z * 0.4 * (0.45 + 0.55 * Math.sin(t * 1.3 + m.ph));
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(px * W + ox, py * H + oy, m.s * m.z * (W / 1600), 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(loop);
  };
  if (!REDUCED) requestAnimationFrame(loop);
}

/* =======================================================================
   directors gallery
   ======================================================================= */
function directors() {
  const grid = $('#dir-grid');
  const beds = [];
  DIRECTORS.forEach((d, i) => {
    const card = document.createElement('article');
    card.className = 'dir reveal';
    card.innerHTML =
      `<canvas aria-hidden="true"></canvas>` +
      `<span class="tag">${d.tag}</span>` +
      `<div class="meta"><h3>${d.label}</h3><p>${d.blurb}</p></div>`;
    grid.appendChild(card);

    const bed = new CasedBed(card.querySelector('canvas'), {
      mode: d.mode, bg: d.bg, a1: d.a1, a2: d.a2,
      energy: 0.62, seed: 3 + i * 11, scale: 0.5, speed: 0.75,
    });
    beds.push({ bed, card });

    // Lean into the look on hover; idle back out when the pointer leaves.
    card.addEventListener('mouseenter', () => bed.set({ energy: 1.0, speed: 1.45 }));
    card.addEventListener('mouseleave', () => bed.set({ energy: 0.62, speed: 0.75 }));
    card.addEventListener('click', () => {
      const h = $('#hero-gl');
      if (h && h.__bed) h.__bed.set({ mode: d.mode, bg: d.bg, a1: d.a1, a2: d.a2 });
    });
  });

  // Only animate the cards that are actually on screen.
  const io = new IntersectionObserver(es => es.forEach(e => {
    const b = beds.find(x => x.card === e.target);
    if (!b) return;
    e.isIntersecting ? b.bed.start() : b.bed.stop();
  }), { threshold: 0.05 });
  beds.forEach(b => io.observe(b.card));
  addEventListener('resize', () => beds.forEach(b => b.bed.resize()), { passive: true });

  reveals();
}

/* =======================================================================
   globe — the same construction the renderer uses for its scale beat
   ======================================================================= */
function globe() {
  const cv = $('#globe');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, DPR = 1;

  const r = rng(77);
  const pts = [];
  const N = 1500, GA = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    const rad = Math.sqrt(Math.max(0, 1 - y * y));
    const th = GA * i;
    const x = Math.cos(th) * rad, z = Math.sin(th) * rad;
    const n = Math.sin(x*4.1+1.3)*Math.cos(z*3.7-0.8) + Math.sin(y*5.2)*0.7 + Math.cos(x*7.9+z*6.1)*0.45;
    if (n > 0.18) pts.push([x, y, z]);
  }
  const pick = () => {
    const u = r()*2-1, a = r()*Math.PI*2, rad = Math.sqrt(1-u*u);
    return [Math.cos(a)*rad, u, Math.sin(a)*rad];
  };
  const arcs = Array.from({ length: 12 }, () => ({ a: pick(), b: pick(), off: r(), spd: .3 + r()*.45 }));

  const size = () => {
    DPR = Math.min(devicePixelRatio || 1, 2);
    W = cv.width = Math.round(cv.clientWidth * DPR);
    H = cv.height = Math.round(cv.clientHeight * DPR);
  };
  size();
  addEventListener('resize', size, { passive: true });

  const t0 = performance.now();
  let running = false;
  const io = new IntersectionObserver(es => { running = es[0].isIntersecting; },
    { threshold: 0.02 });
  io.observe(cv);

  const draw = (now) => {
    requestAnimationFrame(draw);
    if (!running) return;
    const t = (now - t0) / 1000;
    ctx.clearRect(0, 0, W, H);

    const wide = W / H > 1.15;
    const cx = wide ? W * 0.72 : W * 0.5;
    const cy = wide ? H * 0.5 : H * 0.72;
    // 1.3R of atmosphere plus arcs lifted to 1.3 means the drawn extent is
    // well past R -- size for the extent, not the sphere.
    const R = Math.min(W, H) * (wide ? 0.33 : 0.30);

    const rot = t * 0.2, tilt = -0.42;
    const cR = Math.cos(rot), sR = Math.sin(rot), cT = Math.cos(tilt), sT = Math.sin(tilt);
    const proj = ([x, y, z]) => {
      let X = x*cR - z*sR, Z = x*sR + z*cR;
      let Y = y*cT - Z*sT; Z = y*sT + Z*cT;
      return [cx + X*R, cy + Y*R, Z];
    };

    const g = ctx.createRadialGradient(cx, cy, R*0.7, cx, cy, R*1.3);
    g.addColorStop(0, 'rgba(46,123,255,0)');
    g.addColorStop(.72, 'rgba(46,123,255,.20)');
    g.addColorStop(1, 'rgba(46,123,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, R*1.3, 0, 6.2832); ctx.fill();

    for (const p of pts) {
      const [X, Y, Z] = proj(p);
      if (Z < -0.08) continue;
      const d = clamp((Z + 0.1) / 1.1);
      ctx.globalAlpha = 0.14 + d * 0.7;
      ctx.fillStyle = '#fff';
      const s = (0.7 + d * 1.3) * (R / 420) * DPR;
      ctx.fillRect(X - s, Y - s, s * 2, s * 2);
    }
    ctx.globalAlpha = 1;

    ctx.strokeStyle = 'rgba(46,123,255,.5)';
    ctx.lineWidth = 1.6 * (R / 420) * DPR;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.2832); ctx.stroke();

    for (const a of arcs) {
      const prog = clamp(((t * a.spd + a.off) % 1.45) / 1.0);
      if (prog <= 0.002) continue;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i <= 46; i++) {
        const u = i / 46;
        if (u > prog) break;
        const dot = clamp(a.a[0]*a.b[0] + a.a[1]*a.b[1] + a.a[2]*a.b[2], -1, 1);
        const om = Math.acos(dot) || 1e-4, so = Math.sin(om);
        const k1 = Math.sin((1-u)*om)/so, k2 = Math.sin(u*om)/so;
        const lift = 1 + 0.3 * Math.sin(u * Math.PI);
        const [X, Y, Z] = proj([(a.a[0]*k1 + a.b[0]*k2)*lift,
                                (a.a[1]*k1 + a.b[1]*k2)*lift,
                                (a.a[2]*k1 + a.b[2]*k2)*lift]);
        if (Z < -0.45) { started = false; continue; }
        if (!started) { ctx.moveTo(X, Y); started = true; } else ctx.lineTo(X, Y);
      }
      ctx.strokeStyle = 'rgba(255,122,26,.85)';
      ctx.lineWidth = 2 * (R / 420) * DPR;
      ctx.shadowColor = 'rgba(255,122,26,.9)';
      ctx.shadowBlur = 14 * (R / 420) * DPR;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  };
  requestAnimationFrame(draw);
}

/* =======================================================================
   terminal demo
   ======================================================================= */
const DEMO = [
  ['p', '$ python3 -m cased .'], ['', ''],
  ['p', '1/4  reading the repository'],
  ['g', '  ✓ cased2.0 — 3,140 lines, 11 files, 1 commit'],
  ['g', '  ✓ hero language: Python; code moments: 2'],
  ['g', '  ✓ director: Cinematic — deep blacks, slow pushes'], ['', ''],
  ['p', '2/4  writing the score'],
  ['g', '  ✓ 92 BPM minor, 4 sections -> score.wav'], ['', ''],
  ['p', '3/4  cutting the edit'],
  ['g', '  ✓ 9 shots, cuts snapped to the 92 BPM grid'],
  ['g', '  ✓ PLAN.md + SHARE.md written'], ['', ''],
  ['p', '4/4  rendering'],
  ['d', '  → 16:9 -> cased.mp4 (1920×1080)'],
  ['d', '    100%  frame 720/720  eta 0s'], ['', ''],
  ['p', 'done in 214s'],
  ['c', '  cased.mp4      8.4 MB'],
  ['c', '  poster.png     1.1 MB'],
  ['c', '  score.wav      4.2 MB'],
  ['c', '  SHARE.md       1.2 KB'],
];

function demo() {
  const out = $('#demo-out');
  if (!out) return;
  let started = false;
  const io = new IntersectionObserver(es => {
    if (!es[0].isIntersecting || started) return;
    started = true;
    if (REDUCED) {
      out.innerHTML = DEMO.map(([c, t]) => `<span class="${c}">${t}</span>`).join('\n');
      return;
    }
    let li = 0, ci = 0;
    const step = () => {
      if (li >= DEMO.length) return;
      const [cls, text] = DEMO[li];
      ci++;
      const done = DEMO.slice(0, li).map(([c, t]) => `<span class="${c}">${t}</span>`).join('\n');
      const cur = `<span class="${cls}">${text.slice(0, ci)}</span>`;
      out.innerHTML = (done ? done + '\n' : '') + cur;
      out.scrollTop = out.scrollHeight;
      if (ci >= text.length) { li++; ci = 0; setTimeout(step, text ? 150 : 60); }
      else setTimeout(step, 11);
    };
    step();
  }, { threshold: 0.3 });
  io.observe(out);
}

/* =======================================================================
   odds and ends
   ======================================================================= */
function copyButtons() {
  $$('.copy').forEach(b => {
    b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy || ''); }
      catch { return; }
      const was = b.textContent;
      b.textContent = 'copied'; b.classList.add('done');
      setTimeout(() => { b.textContent = was; b.classList.remove('done'); }, 1500);
    });
  });
}

function stickyNav() {
  const nav = $('#nav');
  const on = () => nav.classList.toggle('stuck', scrollY > 40);
  on();
  addEventListener('scroll', on, { passive: true });
}

function endCard() {
  const gl = $('#end-gl');
  if (gl) {
    const bed = new CasedBed(gl, { mode: 'rings', bg: '#06070C', a1: '#FF2D71',
                                   a2: '#7C5CFF', energy: 0.5, scale: 0.4, speed: 0.6 });
    bed.start();
    addEventListener('resize', () => bed.resize(), { passive: true });
  }
  // Split the wordmark so each glyph can land on its own.
  const w = $('#end-word');
  if (!w) return;
  const html = [...w.childNodes].map(n => {
    if (n.nodeType === 3) return [...n.textContent].map(c => `<span class="char">${c}</span>`).join('');
    return `<em>${[...n.textContent].map(c => `<span class="char">${c}</span>`).join('')}</em>`;
  }).join('');
  w.innerHTML = html;
  const chars = $$('.char', w);
  chars.forEach(c => { c.style.opacity = '0'; c.style.transform = 'translateY(50px) rotate(-7deg)'; });
  const io = new IntersectionObserver(es => {
    if (!es[0].isIntersecting) return;
    chars.forEach((c, i) => {
      c.style.transition = `opacity .7s var(--ease) ${i * 0.045}s, transform .9s var(--ease) ${i * 0.045}s`;
      c.style.opacity = '1'; c.style.transform = 'none';
    });
    io.disconnect();
  }, { threshold: 0.4 });
  io.observe(w);
}

function readouts() {
  // Small living detail: the hero's BPM readout cycles the tempos the scorer
  // actually picks, so the number is never decorative nonsense.
  const bpm = $('#bpm-read');
  if (!bpm || REDUCED) return;
  const vals = [88, 92, 96, 104, 112, 118, 124, 132];
  let i = 0;
  setInterval(() => { i = (i + 1) % vals.length; bpm.textContent = vals[i] + ' BPM'; }, 2600);
}

/* =======================================================================
   start
   ======================================================================= */
function start() {
  hero();
  directors();
  globe();
  demo();
  endCard();
  readouts();
}

makeGrain();
stickyNav();
cursor();
magnetic();
copyButtons();
reveals();
boot();
