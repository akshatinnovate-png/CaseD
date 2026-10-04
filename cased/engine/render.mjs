#!/usr/bin/env node
/**
 * cased2.0 / render
 * -----------------------------------------------------------------------
 * Drives the stage one frame at a time and pipes the result straight into
 * FFmpeg. Nothing is recorded in real time: for every frame index i we call
 * `__CASED.seek(i / fps)` and screenshot the result.
 *
 * That matters. A screen recorder drops frames under load and bakes the
 * host machine's performance into the output. Stepping means a slow laptop
 * and a fast CI box produce the same file, byte for byte.
 */

import { spawn, execSync } from 'node:child_process';
import { readFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Find Playwright wherever the user keeps it.
 *
 * ESM deliberately ignores NODE_PATH, so a globally installed Playwright is
 * invisible to a bare import. Rather than force every user into a local
 * `npm install`, walk the places it realistically lives and import by URL.
 */
async function loadPlaywright() {
  const tried = [];
  try { return await import('playwright'); } catch (e) { tried.push('bare import'); }
  const roots = [];
  if (process.env.CASED_PLAYWRIGHT) roots.push(process.env.CASED_PLAYWRIGHT);
  for (const cmd of ['npm root -g', 'npm root']) {
    try { roots.push(execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()); }
    catch { /* npm may not be on PATH; keep going */ }
  }
  roots.push(join(HERE, '..', '..', 'node_modules'), join(process.cwd(), 'node_modules'));
  for (const r of roots) {
    if (!r) continue;
    for (const name of ['playwright', 'playwright-core']) {
      const entry = join(r, name, 'index.mjs');
      const pkg = join(r, name, 'package.json');
      try {
        if (existsSync(pkg)) {
          const main = JSON.parse(readFileSync(pkg, 'utf8')).main || 'index.js';
          const target = existsSync(entry) ? entry : join(r, name, main);
          if (existsSync(target)) return await import(pathToFileURL(target).href);
        }
      } catch { tried.push(entry); }
    }
  }
  throw new Error(
    'Playwright not found. Install it with:  npm i -g playwright  (or npm i playwright)\n' +
    'Searched: ' + roots.filter(Boolean).join(', '));
}

const { chromium } = await loadPlaywright();

function arg(name, dflt = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const flag = name => process.argv.includes(`--${name}`);

const SPEC_PATH  = resolve(arg('spec'));
const OUT_PATH   = resolve(arg('out', 'cased.mp4'));
const AUDIO_PATH = arg('audio') ? resolve(arg('audio')) : null;
const QUALITY    = arg('quality', 'high');
const POSTER     = arg('poster') ? resolve(arg('poster')) : null;
const GIF         = arg('gif') ? resolve(arg('gif')) : null;
const QUIET      = flag('quiet');

const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf8'));
const { width, height, fps, duration } = spec;
const TOTAL = Math.round(duration * fps);

// `width` is a cap, not a resize: a stage already narrower than the cap is
// left alone, so vertical formats are never upscaled.
const PRESETS = {
  draft: { crf: 28, preset: 'veryfast', jpeg: 72, width: 960 },
  good:  { crf: 23, preset: 'medium',   jpeg: 92, width: 1280 },
  high:  { crf: 19, preset: 'slow',     jpeg: 97, width: 0 },
};
const Q = PRESETS[QUALITY] || PRESETS.high;

const log = (...a) => { if (!QUIET) process.stderr.write(a.join(' ') + '\n'); };

/** Resolve a usable chromium: the one Playwright knows, else a system build. */
function launchOpts() {
  const o = {
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=swiftshader',                  // deterministic software WebGL
      '--enable-unsafe-swiftshader',
      '--disable-lcd-text',                    // keep glyph AA identical everywhere
      '--force-color-profile=srgb',
      '--disable-font-subpixel-positioning',
      '--hide-scrollbars',
      '--mute-audio',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
    ],
  };
  const envPath = process.env.CASED_CHROMIUM;
  if (envPath && existsSync(envPath)) o.executablePath = envPath;
  return o;
}

async function main() {
  mkdirSync(dirname(OUT_PATH), { recursive: true });

  log(`cased2.0 · ${spec.project} · ${spec.director} · ${width}x${height} · ${TOTAL} frames @ ${fps}fps`);

  const browser = await chromium.launch(launchOpts());
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  page.on('pageerror', e => log('  ! page error:', e.message));

  await page.goto(pathToFileURL(join(HERE, 'stage.html')).href, { waitUntil: 'load' });
  // A spec from the invented path carries the source of the shots the model
  // wrote. Register them before loading, or the film renders title cards where
  // those beats should be. Each goes through the engine's own checks.
  for (const g of spec.generated || []) {
    const r = await page.evaluate(
      ([n, src]) => window.__CASED.register(n, src), [g.name, g.source]);
    if (!r || !r.ok) {
      throw new Error(`generated shot ${g.name} was rejected: ${r && r.error}`);
    }
  }
  await page.evaluate(s => window.__CASED.load(s), spec);
  // One warm-up seek so shader compilation and font metrics settle before
  // frame 0 is captured.
  await page.evaluate(() => window.__CASED.seek(0));
  await page.waitForTimeout(260);

  if (POSTER) {
    const at = Math.min(duration * 0.5, duration - 0.3);
    await page.evaluate(t => window.__CASED.seek(t), at);
    await page.screenshot({ path: POSTER, type: 'png' });
    log(`  poster -> ${POSTER}`);
  }

  // --- FFmpeg ----------------------------------------------------------
  const vf = [];
  if (Q.width && Q.width < width) vf.push(`scale=${Q.width}:-2:flags=lanczos`);
  vf.push('format=yuv420p');

  const ff = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(fps), '-i', 'pipe:0',
  ];
  if (AUDIO_PATH) ff.push('-i', AUDIO_PATH);
  ff.push(
    '-map', '0:v:0',
    ...(AUDIO_PATH ? ['-map', '1:a:0', '-c:a', 'aac', '-b:a', '192k', '-shortest'] : []),
    '-c:v', 'libx264', '-preset', Q.preset, '-crf', String(Q.crf),
    '-vf', vf.join(','),
    '-movflags', '+faststart',
    '-r', String(fps),
    OUT_PATH,
  );

  const proc = spawn('ffmpeg', ff, { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => {
    proc.on('close', c => (c === 0 ? res() : rej(new Error('ffmpeg exited ' + c))));
    proc.on('error', rej);
  });

  const write = buf => new Promise((res, rej) => {
    if (proc.stdin.write(buf)) return res();
    proc.stdin.once('drain', res);
    proc.stdin.once('error', rej);
  });

  // --- the frame loop --------------------------------------------------
  const t0 = Date.now();
  let lastPct = -1;
  for (let i = 0; i < TOTAL; i++) {
    const t = i / fps;
    await page.evaluate(x => window.__CASED.seek(x), t);
    const buf = await page.screenshot({ type: 'jpeg', quality: Q.jpeg });
    await write(buf);

    const pct = Math.floor((i + 1) / TOTAL * 100);
    if (pct !== lastPct && pct % 5 === 0) {
      lastPct = pct;
      const el = (Date.now() - t0) / 1000;
      const eta = el / (i + 1) * (TOTAL - i - 1);
      log(`  ${String(pct).padStart(3)}%  frame ${i + 1}/${TOTAL}  eta ${eta.toFixed(0)}s`);
    }
  }

  proc.stdin.end();
  await done;
  await browser.close();

  log(`  video -> ${OUT_PATH}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  if (GIF) {
    const pal = OUT_PATH + '.palette.png';
    const run = (args) => new Promise((res, rej) => {
      const p = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args],
        { stdio: 'inherit' });
      p.on('close', c => (c === 0 ? res() : rej(new Error('ffmpeg ' + c))));
    });
    // GIF has no interframe compression, so grain costs far more here than in
    // H.264. Fewer frames, fewer colours, and a coarse ordered dither keep a
    // 24-second film inside a few megabytes.
    const gfps = 10, gw = width >= height ? 360 : 260;
    const chain = `fps=${gfps},scale=${gw}:-2:flags=lanczos`;
    await run(['-i', OUT_PATH, '-vf',
      `${chain},palettegen=max_colors=48:stats_mode=diff`, pal]);
    await run(['-i', OUT_PATH, '-i', pal, '-lavfi',
      `${chain}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5`, GIF]);
    rmSync(pal, { force: true });        // the palette is scratch, not output
    log(`  gif   -> ${GIF}`);
  }
}

main().catch(e => { console.error('render failed:', e.message); process.exit(1); });
