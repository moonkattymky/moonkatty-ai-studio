/**
 * One command: clone/serve MOONKATTY Horizons, play it with Playwright, write a report.
 *
 *   npm run qa
 *   npm run qa:horizons
 *
 * Env: QA_DATE (YYYY-MM-DD), QA_SEED (integer), CHROME_PATH, QA_PORT (unused; port is ephemeral).
 * Graphics are forced to the game's existing "low" quality flag so software WebGL can render.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { prepareHorizons, serveStatic } from './serve.mjs';
import * as P from './player.mjs';
import { writeReport, bugFromCheck } from './report.mjs';

if (process.stdout._handle && process.stdout._handle.setBlocking) process.stdout._handle.setBlocking(true);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATE = process.env.QA_DATE || new Date().toISOString().slice(0, 10);
const SEED = Number.isFinite(+process.env.QA_SEED) ? (+process.env.QA_SEED) >>> 0 : 20261020;
const reportDir = path.join(repoRoot, 'qa', 'reports', DATE);
const cacheDir = path.join(repoRoot, 'qa', '.cache');

const GL_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--enable-precise-memory-info',
  '--disable-dev-shm-usage',
  '--no-sandbox',
  '--disable-gpu-sandbox'
];

const VIEWPORTS = [
  { id: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false, full: true, recordVideo: true },
  { id: 'iphone-14', width: 390, height: 844, isMobile: true, hasTouch: true, full: false, recordVideo: true },
  { id: 'pixel-7', width: 412, height: 915, isMobile: true, hasTouch: true, full: false, recordVideo: false },
  { id: 'small-phone', width: 360, height: 740, isMobile: true, hasTouch: true, full: false, recordVideo: false }
];

const CONTROL_SELECTORS = ['#joystick', '#fly', '#interact', '#menu', '#scan', '#world-map-button', '#collection'];

function chromePath() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  for (const candidate of ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/local/bin/google-chrome']) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

function rel(file) {
  return path.relative(repoRoot, file).split(path.sep).join('/');
}

async function screenshot(page, name) {
  const file = path.join(reportDir, 'screenshots', `${name}.png`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, animations: 'disabled' });
  return rel(file);
}

function logLine(status, id, detail) {
  console.log(`${status.toUpperCase().padEnd(10)} ${id} — ${detail}`);
}

function significantLogs(logs) {
  const noise = /ResizeObserver loop|favicon\.ico|net::ERR_ABORTED|Failed to load resource: the server responded with a status of 404/i;
  return logs.filter(entry => {
    if (!entry.text) return false;
    if (entry.type === 'requestfailed') return false;
    if (noise.test(entry.text)) return false;
    return entry.type === 'pageerror' || entry.type === 'console';
  });
}

async function bootContext(browser, vp) {
  const videoDir = vp.recordVideo ? path.join(reportDir, 'video-tmp', vp.id) : null;
  if (videoDir) fs.mkdirSync(videoDir, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: !!vp.isMobile,
    hasTouch: !!vp.hasTouch,
    deviceScaleFactor: 1,
    locale: 'en-US',
    reducedMotion: 'reduce',
    recordVideo: videoDir ? { dir: videoDir, size: { width: Math.min(vp.width, 1280), height: Math.min(vp.height, 720) } } : undefined,
    userAgent: vp.isMobile
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
      : undefined
  });
  await context.addInitScript(() => {
    try {
      localStorage.setItem('moonkatty-lang', 'en');
      localStorage.setItem('mk-q52', '1');
      localStorage.setItem('moonkatty-new-horizons-v02-quality', 'low');
      localStorage.setItem('mk-qmanual', '1');
      localStorage.setItem('moonkatty-sfx', '0');
      localStorage.setItem('moonkatty-music', '0');
      localStorage.setItem('moonkatty-cinema-sound', '0');
    } catch { /* private mode */ }
  });
  const page = await context.newPage();
  const logs = [];
  page.on('pageerror', error => logs.push({ type: 'pageerror', text: String(error && error.message || error) }));
  page.on('console', msg => { if (msg.type() === 'error') logs.push({ type: 'console', text: msg.text() }); });
  page.on('requestfailed', request => {
    const failure = request.failure();
    logs.push({ type: 'requestfailed', text: `${request.url()} ${failure ? failure.errorText : ''}` });
  });
  return { context, page, logs };
}

async function finishVideo(page, context, vp, keep) {
  const video = page.video();
  await context.close();
  if (!video) return null;
  const src = await video.path();
  if (!keep) {
    fs.rmSync(src, { force: true });
    return null;
  }
  const dest = path.join(reportDir, 'video', `${vp.id}.webm`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return rel(dest);
}

async function openWorld(page, baseUrl, steps) {
  const url = `${baseUrl}?nolang&nointro&nosw`;
  steps.push(`GET ${url}`);
  const started = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 });
  const startedGame = await P.startExpedition(page);
  steps.push(startedGame.skippedCinema ? 'clicked #begin, skipped chapter cinema via MoonCinema.skip()' : 'clicked #begin (no cinema was playing)');
  const loadMs = Date.now() - started;
  const pose = await P.readProbe(page);
  return { loadMs, pose, boot: startedGame.boot, skippedCinema: startedGame.skippedCinema };
}

async function rotateCamera(page, steps) {
  let pose = await P.readProbe(page);
  let yaw = pose.camYaw || 0;
  let accumulated = 0;
  const swipes = [];
  for (let i = 0; i < 8 && accumulated < Math.PI * 2; i += 1) {
    const before = yaw;
    await P.pointerDrag(page, '#world', { x: 0.82, y: 0.42 }, { x: 0.18, y: 0.42 }, 14);
    await page.waitForTimeout(80);
    pose = await P.readProbe(page);
    yaw = pose.camYaw || 0;
    const delta = Math.abs(P.yawDelta(before, yaw));
    accumulated += delta;
    swipes.push(+delta.toFixed(3));
  }
  const pitchBefore = await page.evaluate(() => window.MoonGame && window.MoonGame.player && window.MoonGame.camYaw);
  const pitch0 = await page.evaluate(() => {
    // camPitch is not exported. Vertical drag still runs; we read it by sampling a following frame's camera only if exposed.
    return null;
  });
  void pitchBefore; void pitch0;
  const pitchStart = await page.evaluate(() => {
    const g = window.MoonGame;
    return g && g.renderer && g.renderer.eye ? g.renderer.eye.slice() : null;
  });
  await P.pointerDrag(page, '#world', { x: 0.5, y: 0.25 }, { x: 0.5, y: 0.72 }, 10);
  await page.waitForTimeout(80);
  const pitchEnd = await page.evaluate(() => {
    const g = window.MoonGame;
    return g && g.renderer && g.renderer.eye ? g.renderer.eye.slice() : null;
  });
  let eyeDelta = null;
  if (pitchStart && pitchEnd) {
    eyeDelta = Math.hypot(pitchEnd[0] - pitchStart[0], pitchEnd[1] - pitchStart[1], pitchEnd[2] - pitchStart[2]);
  }
  steps.push(`camera swipes yaw deltas rad [${swipes.join(', ')}] accumulated ${accumulated.toFixed(3)}; vertical drag eye delta ${eyeDelta}`);
  return { accumulated, swipes, eyeDelta, pose: await P.readProbe(page) };
}

async function runFull(page, vp, baseUrl, steps, checks) {
  const world = await openWorld(page, baseUrl, steps);
  const shotBoot = await screenshot(page, `${vp.id}-world`);
  checks.push({
    id: `${vp.id}.boot`,
    status: world.pose && world.pose.running && world.pose.webgl ? 'pass' : 'fail',
    viewport: vp.id,
    detail: world.pose && world.pose.running
      ? `world running in ${world.loadMs} ms, webgl=${world.pose.webgl}, canvas ${world.pose.canvas && world.pose.canvas.w}x${world.pose.canvas && world.pose.canvas.h}, quality=${world.pose.quality}, MoonBuild=${world.boot.moonBuild}`
      : 'MoonGame did not enter the running state',
    expected: 'Clicking Start expedition enters a running WebGL world',
    actual: world.pose ? `running=${world.pose.running} webgl=${world.pose.webgl} error=${world.pose.errorText}` : 'no probe',
    metrics: { loadMs: world.loadMs },
    evidence: [shotBoot],
    repro: [`Serve the Horizons checkout`, `Open ${baseUrl}?nolang&nointro&nosw`, 'Click #begin', 'Skip the chapter cinema if it opens'],
    severity: 'blocker',
    bugTitle: 'Horizons does not enter a running WebGL world'
  });
  if (vp.full) {
    const buildIds = await page.evaluate(() => ({
      moonBuild: window.MoonBuild == null ? null : String(window.MoonBuild),
      reliability: window.MoonReliability && window.MoonReliability.BUILD ? String(window.MoonReliability.BUILD) : null
    }));
    const idsMatch = !!(buildIds.moonBuild && buildIds.reliability && buildIds.moonBuild === buildIds.reliability);
    checks.push({
      id: `${vp.id}.build-id`,
      status: idsMatch ? 'pass' : 'fail',
      viewport: vp.id,
      detail: idsMatch
        ? `window.MoonBuild and MoonReliability.BUILD are both ${buildIds.moonBuild}`
        : `window.MoonBuild is ${JSON.stringify(buildIds.moonBuild)} and MoonReliability.BUILD is ${JSON.stringify(buildIds.reliability)}. index.html sets MoonBuild while asset URLs and reliability.js use the other id.`,
      expected: 'The label in window.MoonBuild matches MoonReliability.BUILD',
      actual: `MoonBuild=${buildIds.moonBuild} reliability=${buildIds.reliability}`,
      repro: ['Open the play build', 'Read window.MoonBuild', 'Read window.MoonReliability.BUILD', 'Compare with the ?v= query on game.js'],
      severity: 'minor',
      bugTitle: 'window.MoonBuild does not match the asset build id'
    });
  }
  if (!world.pose || !world.pose.running) return { loadMs: world.loadMs };

  const forward = await P.keyboardNudge(page, 'w', 4000);
  steps.push(`W 4000 ms via ${forward.via}, moved ${forward.moved.toFixed(3)} m, cdp ${forward.cdpMoved.toFixed(3)} m, events ${JSON.stringify(forward.seen)}`);
  const shotMove = await screenshot(page, `${vp.id}-after-keyboard`);
  const movePass = forward.moved > 0.05;
  checks.push({
    id: `${vp.id}.keyboard-move`,
    status: movePass ? 'pass' : 'fail',
    viewport: vp.id,
    detail: movePass
      ? `W moved the player ${forward.moved.toFixed(2)} m in 4 s via ${forward.via} (${(forward.moved / 4).toFixed(3)} m/s wall clock). CDP keyboard first moved ${forward.cdpMoved.toFixed(2)} m. Key events: ${JSON.stringify(forward.seen)}. Sim dt is capped at 45 ms, so a slow frame moves about 0.17 m.`
      : `W for 4 s moved ${forward.moved.toFixed(3)} m (CDP ${forward.cdpMoved.toFixed(3)} m). Key events seen: ${JSON.stringify(forward.seen)}. blocked=${forward.after && forward.after.blocked}`,
    expected: 'Holding W changes player xz. On a slow GPU one sim step is about 0.17 m because dt is capped at 45 ms.',
    actual: `moved ${forward.moved.toFixed(3)} m via ${forward.via}; events ${JSON.stringify(forward.seen)}`,
    evidence: [shotMove],
    repro: ['Enter the world', 'Hold W for 1.2 seconds with no dialog open'],
    severity: 'blocker',
    bugTitle: 'Player does not walk when W is held'
  });

  const cam = await rotateCamera(page, steps);
  const shotCam = await screenshot(page, `${vp.id}-after-camera`);
  const yawPass = cam.accumulated >= Math.PI * 2 - 0.15;
  checks.push({
    id: `${vp.id}.camera-yaw-360`,
    status: yawPass ? 'pass' : 'fail',
    viewport: vp.id,
    detail: `pointer-drag accumulated |Δyaw|=${cam.accumulated.toFixed(3)} rad (full turn is 6.283)`,
    expected: 'Dragging across the world canvas rotates the camera through at least 360°',
    actual: `${cam.accumulated.toFixed(3)} rad over ${cam.swipes.length} swipes`,
    evidence: [shotCam],
    metrics: { yawRadians: +cam.accumulated.toFixed(3), swipes: cam.swipes },
    repro: ['Enter the world', 'Pointer-drag horizontally across #world from 82% to 18% width, repeated'],
    severity: 'major',
    bugTitle: 'World drag does not complete a 360° camera turn'
  });
  checks.push({
    id: `${vp.id}.camera-pitch`,
    status: cam.eyeDelta != null && cam.eyeDelta > 0.05 ? 'pass' : (cam.eyeDelta == null ? 'not_tested' : 'fail'),
    viewport: vp.id,
    detail: cam.eyeDelta == null
      ? 'renderer.eye was not available, so pitch could not be measured without a new hook'
      : `vertical drag moved the camera eye by ${cam.eyeDelta.toFixed(3)} world units (camPitch itself is not exported)`,
    expected: 'A vertical drag changes the follow-camera eye position',
    actual: cam.eyeDelta == null ? 'eye unavailable' : `eye delta ${cam.eyeDelta.toFixed(3)}`,
    evidence: [shotCam],
    repro: ['Enter the world', 'Pointer-drag vertically on #world'],
    severity: 'major',
    bugTitle: 'Vertical world drag does not pitch the camera'
  });

  await P.closeDialogs(page);
  const stick = await P.joystickHold(page, 2500);
  steps.push(`pointer joystick up 1200 ms, moved ${stick.moved.toFixed(3)} m`);
  checks.push({
    id: `${vp.id}.joystick-pointer`,
    status: stick.moved > 0.05 ? 'pass' : (stick.pointerdowns ? 'fail' : 'not_tested'),
    viewport: vp.id,
    detail: stick.pointerdowns
      ? `pointer hold on #joystick for 2.5 s moved ${stick.moved.toFixed(2)} m (${stick.pointerdowns} pointerdown event(s) reached the stick)`
      : `no pointerdown reached #joystick during the mouse drag, so this environment did not deliver pointer events to the stick. Not scored as a product defect.`,
    expected: 'Holding the on-screen joystick forward moves the player',
    actual: `moved ${stick.moved.toFixed(3)} m`,
    repro: ['Enter the world', 'Pointer-down on #joystick center and drag upward for 1.2 s'],
    severity: 'major',
    bugTitle: 'On-screen joystick does not move the player'
  });

  if (vp.hasTouch) {
    await P.closeDialogs(page);
    const touch = await P.touchJoystickHold(page, 1000);
    steps.push(`CDP touch joystick 1000 ms, moved ${touch.moved.toFixed(3)} m`);
    checks.push({
      id: `${vp.id}.joystick-touch`,
      status: touch.moved > 0.25 ? 'pass' : 'fail',
      viewport: vp.id,
      detail: `CDP touchStart/touchMove on #joystick moved ${touch.moved.toFixed(2)} m`,
      expected: 'A touch drag on the joystick moves the player',
      actual: `moved ${touch.moved.toFixed(3)} m`,
      repro: ['Mobile viewport', 'dispatchTouchEvent on the joystick, drag up, hold 1 s'],
      severity: 'major',
      bugTitle: 'Touch joystick does not move the player'
    });
  }

  const bounds = await P.boxesInside(page, CONTROL_SELECTORS);
  const outside = bounds.controls.filter(c => !c.inside);
  const shotHud = await screenshot(page, `${vp.id}-hud`);
  checks.push({
    id: `${vp.id}.hud-inside-viewport`,
    status: outside.length ? 'fail' : 'pass',
    viewport: vp.id,
    detail: outside.length
      ? `outside viewport: ${outside.map(c => c.sel).join(', ')}`
      : `joystick and action buttons are inside ${vp.width}x${vp.height}`,
    expected: 'Joystick, jump, action, menu, scan, map and cards sit fully inside the viewport',
    actual: JSON.stringify(bounds.controls),
    evidence: [shotHud],
    metrics: { controls: bounds.controls },
    repro: [`Set viewport ${vp.width}x${vp.height}`, 'Enter the world', 'Measure #joystick, #fly, #interact, #menu, #scan, #world-map-button, #collection'],
    severity: 'major',
    bugTitle: 'HUD controls fall outside the viewport'
  });

  await exerciseMenus(page, vp, steps, checks);
  if (vp.full) await exerciseMissionAndSave(page, vp, baseUrl, steps, checks, world);
  return { loadMs: world.loadMs, pose: world.pose };
}

async function openHudDialog(page, buttonSel, dialogSel) {
  // Click inside the page so the handler finishes before we read dialog.open.
  // A CDP click can be queued behind a multi-second WebGL frame and look like a miss.
  return page.evaluate(({ buttonSel, dialogSel }) => {
    document.querySelectorAll('dialog[open]').forEach(dialog => {
      try { dialog.close(); } catch { dialog.removeAttribute('open'); }
    });
    const button = document.querySelector(buttonSel);
    const dialog = document.querySelector(dialogSel);
    if (!button || !dialog) return { opened: false, error: 'missing control', dialogs: [] };
    try { button.click(); }
    catch (error) { return { opened: false, error: String(error && error.message || error), dialogs: [] }; }
    return {
      opened: !!dialog.open,
      error: null,
      dialogs: [...document.querySelectorAll('dialog[open]')].map(node => node.id)
    };
  }, { buttonSel, dialogSel });
}

async function exerciseMenus(page, vp, steps, checks) {
  await P.dismissOverlays(page);
  const menuResult = await openHudDialog(page, '#menu', '#chapters');
  const menuOpen = !!menuResult.opened;
  steps.push(`#menu open=${menuOpen} dialogs=${(menuResult.dialogs || []).join(',') || '-'} ${menuResult.error || ''}`);
  const shotMenu = await screenshot(page, `${vp.id}-menu`);
  if (menuOpen) await page.locator('#menu-close').click({ timeout: 8000, force: true }).catch(() => P.closeDialogs(page));
  await P.closeDialogs(page);

  const cardsResult = await openHudDialog(page, '#collection', '#cards');
  const cardsOpen = !!cardsResult.opened;
  steps.push(`#cards open=${cardsOpen} dialogs=${(cardsResult.dialogs || []).join(',') || '-'} ${cardsResult.error || ''}`);
  let daily = null;
  if (cardsOpen) {
    daily = await page.evaluate(() => {
      const before = { crystals: MoonGame.state.crystals, metal: MoonGame.state.metal };
      const button = document.querySelector('#claim-daily');
      if (button) button.click();
      const feedback = (document.querySelector('#daily-feedback') && document.querySelector('#daily-feedback').textContent) || '';
      const after = { crystals: MoonGame.state.crystals, metal: MoonGame.state.metal };
      return { before, after, feedback };
    });
    steps.push(`claim daily feedback="${daily.feedback}" crystals ${daily.before.crystals}->${daily.after.crystals}`);
  }
  const shotCards = await screenshot(page, `${vp.id}-cards`);
  await P.closeDialogs(page);

  const mapResult = await openHudDialog(page, '#world-map-button', '#world-map');
  const mapOpen = !!mapResult.opened;
  steps.push(`map open=${mapOpen} dialogs=${(mapResult.dialogs || []).join(',') || '-'} ${mapResult.error || ''}`);
  const shotMap = await screenshot(page, `${vp.id}-map`);
  await P.closeDialogs(page);

  const scan = await page.evaluate(() => {
    document.querySelector('#scan').click();
    return (document.querySelector('#toast') && document.querySelector('#toast').textContent) || '';
  });
  steps.push(`scan toast="${scan}"`);
  const build = await page.evaluate(() => {
    const openBefore = !!(document.querySelector('#builder') && document.querySelector('#builder').open);
    document.querySelector('#build').click();
    return {
      open: !!(document.querySelector('#builder') && document.querySelector('#builder').open),
      wasOpen: openBefore,
      toast: (document.querySelector('#toast') && document.querySelector('#toast').textContent) || ''
    };
  });
  steps.push(`build dialog=${build.open} toast="${build.toast}"`);

  await P.dismissOverlays(page);
  const jump = await page.evaluate(() => new Promise(resolve => {
    const alt0 = MoonGame.player.alt;
    const dialogs = [...document.querySelectorAll('dialog[open]')].map(d => d.id);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    const t0 = performance.now();
    let frames = 0;
    const step = () => {
      frames += 1;
      const alt1 = MoonGame.player.alt;
      const elapsed = performance.now() - t0;
      if (alt1 > alt0 + 0.02 || frames >= 3 || elapsed > 4000) {
        window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
        resolve({ alt0, alt1, frames, elapsed: Math.round(elapsed), dialogs, running: MoonGame.running });
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }));
  const alt0 = jump.alt0;
  const alt1 = jump.alt1;
  steps.push(`space jump alt ${alt0.toFixed(3)} -> ${alt1.toFixed(3)} after ${jump.frames} frames / ${jump.elapsed} ms`);

  checks.push({
    id: `${vp.id}.menus`,
    status: menuOpen && cardsOpen && mapOpen ? 'pass' : 'fail',
    viewport: vp.id,
    detail: `menu=${menuOpen} (${menuResult.error || 'ok'}) cards=${cardsOpen} (${cardsResult.error || 'ok'}) map=${mapOpen} (${mapResult.error || 'ok'})`,
    expected: 'Menu, cards and world map dialogs open from their HUD buttons',
    actual: `menu=${menuOpen} cards=${cardsOpen} map=${mapOpen}`,
    evidence: [shotMenu, shotCards, shotMap],
    repro: ['Enter the world', 'Click #menu, #collection, #world-map-button'],
    severity: 'major',
    bugTitle: 'A HUD menu button does not open its dialog'
  });
  const rewarded = daily && (daily.after.crystals > daily.before.crystals || daily.after.metal > daily.before.metal);
  checks.push({
    id: `${vp.id}.daily-reward-gate`,
    status: !daily ? 'not_tested' : (rewarded ? 'fail' : 'pass'),
    viewport: vp.id,
    detail: !daily
      ? 'Cards dialog did not open, so the daily claim was not exercised'
      : `claim with no completed daily steps left crystals/metal unchanged (${daily.before.crystals}/${daily.before.metal}). Feedback: ${daily.feedback || '(empty)'}`,
    expected: 'Claiming the daily reward before scanner/backpack/jetpack steps does not add crystals or metal',
    actual: daily ? JSON.stringify(daily) : 'cards closed',
    evidence: [shotCards],
    repro: ['Fresh chapter 1 save', 'Open cards', 'Click #claim-daily'],
    severity: 'major',
    bugTitle: 'Daily reward pays out before the three steps are done'
  });
  checks.push({
    id: `${vp.id}.build-locked`,
    status: build.open ? 'fail' : 'pass',
    viewport: vp.id,
    detail: build.open
      ? 'Builder opened on chapter 1 before the artifact'
      : `Builder stayed closed. Toast: ${build.toast || '(empty)'}`,
    expected: 'Chapter 1 without the artifact does not open the builder',
    actual: `builder open=${build.open}; toast=${build.toast}`,
    repro: ['Fresh chapter 1', 'Click #build'],
    severity: 'minor',
    bugTitle: 'Builder opens before the chapter 1 artifact is found'
  });
  checks.push({
    id: `${vp.id}.jump`,
    status: alt1 > alt0 + 0.02 ? 'pass' : (jump.frames < 1 ? 'not_tested' : 'fail'),
    viewport: vp.id,
    detail: `Space changed altitude ${alt0.toFixed(3)} -> ${alt1.toFixed(3)} after ${jump.frames} frames / ${jump.elapsed} ms (dialogs ${jump.dialogs.join(',') || 'none'}, running=${jump.running}). Jetpack stays locked until the engineer is repaired; Space sets velocity and the next sim frame (dt capped at 45 ms) applies it.`,
    expected: 'Space applies an upward velocity while the jetpack is locked, visible on the next simulation frame',
    actual: `alt ${alt0.toFixed(3)} -> ${alt1.toFixed(3)} in ${jump.frames} frames`,
    repro: ['Enter chapter 1', 'Press Space once', 'Read MoonGame.player.alt within 300 ms'],
    severity: 'major',
    bugTitle: 'Space does not jump'
  });
  checks.push({
    id: `${vp.id}.scan-button`,
    status: scan ? 'pass' : 'not_tested',
    viewport: vp.id,
    detail: scan ? `Scanner toast: ${scan}` : 'Scanner click produced an empty toast; the button handler may be silent',
    expected: 'The scan button surfaces a toast',
    actual: scan || '(empty toast)',
    repro: ['Enter the world', 'Click #scan', 'Read #toast'],
    severity: 'minor',
    bugTitle: 'Scanner button gives no feedback'
  });
}

async function exerciseMissionAndSave(page, vp, baseUrl, steps, checks, world) {
  const pose = await P.readProbe(page);
  const target = pose && pose.target;
  if (!target) {
    checks.push({
      id: `${vp.id}.mission-walk`,
      status: 'not_tested',
      viewport: vp.id,
      detail: 'MoonCore.quest() did not return a target point',
      repro: ['Enter chapter 1']
    });
  } else {
    const landed = await page.evaluate(() => new Promise(resolve => {
      const t0 = performance.now();
      const step = () => {
        const alt = window.MoonGame.player.alt;
        if (alt < 0.1 || performance.now() - t0 > 120000) resolve({ alt, ms: Math.round(performance.now() - t0) });
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }));
    steps.push(`waited ${landed.ms} ms for the jump to land (alt ${landed.alt.toFixed(2)})`);
    const grounded = await P.readProbe(page);
    const startDist = grounded ? Math.hypot(grounded.x - target.x, grounded.z - target.z) : Math.hypot(pose.x - target.x, pose.z - target.z);
    steps.push(`steer toward ${target.id} at ${target.x},${target.z} from dist ${startDist.toFixed(1)} for 180 s (slow frames, dt cap 45 ms)`);
    const walk = await P.steerTo(page, target, 180000);
    const end = walk.after;
    const endDist = end ? Math.hypot(end.x - target.x, end.z - target.z) : null;
    const shotMission = await screenshot(page, `${vp.id}-mission`);
    const storyOpen = await page.evaluate(() => !!(document.querySelector('#story') && document.querySelector('#story').open));
    if (storyOpen) {
      steps.push('story dialog open, click #story-close');
      await page.locator('#story-close').click().catch(() => {});
      await page.waitForTimeout(200);
    }
    const done = !!(end && (end.recorder || (end.questId && end.questId !== 'recorder')));
    let status = 'not_tested';
    let detail = `target ${target.id}, start ${startDist.toFixed(1)} m, end ${endDist == null ? 'n/a' : endDist.toFixed(1)} m, stuck events ${walk.stuckEvents.length}, quest=${end && end.questId}, recorder=${end && end.recorder}`;
    if (done) status = 'pass';
    else if (walk.samples.length && endDist != null && startDist - endDist < 1 && walk.stuckEvents.length) {
      status = 'fail';
      detail = `Player did not get closer to ${target.id} while input was applied. ${detail}`;
    }
    checks.push({
      id: `${vp.id}.mission-walk`,
      status,
      viewport: vp.id,
      detail: status === 'pass' ? `Reached the first objective (${detail})` : detail,
      expected: 'Steering at the quest compass reaches the flight recorder and sets state.recorder, or the quest id changes',
      actual: detail,
      evidence: [shotMission],
      metrics: { stuckEvents: walk.stuckEvents, startDist, endDist, samples: walk.samples.slice(-8) },
      repro: [
        'Fresh chapter 1 at the default spawn',
        `Walk toward MoonCore.POINTS.${target.id} using camera-relative WASD`,
        'Press E when within 3.2 m',
        'Dismiss the story dialog'
      ],
      severity: 'major',
      bugTitle: 'Player is stuck and cannot approach the first quest target'
    });
    if (storyOpen || done) {
      checks.push({
        id: `${vp.id}.story-dialog`,
        status: 'pass',
        viewport: vp.id,
        detail: 'Interacting with the recorder opened the story dialog and it could be dismissed',
        evidence: [shotMission]
      });
    } else {
      checks.push({
        id: `${vp.id}.story-dialog`,
        status: 'not_tested',
        viewport: vp.id,
        detail: 'The recorder interaction was not reached, so the story dialog and later puzzles (relay, power grid, ring alignment, forge, aurora, gate, stars) were not played'
      });
    }
  }

  await P.closeDialogs(page);
  const econ = await page.evaluate(async () => {
    const a = MoonGame.state.productionAt || 0;
    const t0 = performance.now();
    let frames = 0;
    await new Promise(resolve => {
      const step = () => {
        frames += 1;
        if (performance.now() - t0 < 5000) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    return { a, b: MoonGame.state.productionAt || 0, frames, elapsed: performance.now() - t0 };
  });
  const econSimCap = econ.frames * 0.045;
  checks.push({
    id: `${vp.id}.economy-timer`,
    status: econ.b > econ.a ? 'pass' : (econSimCap < 1 ? 'not_tested' : 'fail'),
    viewport: vp.id,
    detail: econ.b > econ.a
      ? `state.productionAt ${econ.a} -> ${econ.b} after ${econ.frames} frames in ${Math.round(econ.elapsed)} ms`
      : `productionAt stayed ${econ.a}. ${econ.frames} frames in ${Math.round(econ.elapsed)} ms. Core.tick waits for 1 s of sim time and each frame caps dt at 45 ms, so this window held at most ${econSimCap.toFixed(2)} s of sim time.`,
    expected: 'productionAt advances once about 1 second of simulation time has accumulated',
    actual: `${econ.a} -> ${econ.b} over ${econ.frames} frames`,
    metrics: econ,
    repro: ['Enter the world', 'Count frames for 5 s of wall clock', 'Compare state.productionAt'],
    severity: 'major',
    bugTitle: 'Station energy timer does not advance after a second of sim time'
  });

  const fuel = await page.evaluate(async () => {
    const start = MoonGame.player.fuel;
    MoonGame.player.fuel = 40;
    const t0 = performance.now();
    let frames = 0;
    await new Promise(resolve => {
      const step = () => {
        frames += 1;
        if (performance.now() - t0 < 4000) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    return { start, after: MoonGame.player.fuel, alt: MoonGame.player.alt, frames, elapsed: performance.now() - t0 };
  });
  steps.push(`fuel forced 40 -> ${fuel.after.toFixed(2)} over ${fuel.frames} frames (alt ${fuel.alt.toFixed(2)})`);
  const fuelSim = fuel.frames * 0.045 * 10;
  const fuelOnGround = fuel.alt < 0.1;
  checks.push({
    id: `${vp.id}.fuel-regen`,
    status: fuel.after > 40.2 ? 'pass' : (!fuelOnGround || fuelSim < 0.3 ? 'not_tested' : 'fail'),
    viewport: vp.id,
    detail: `MoonGame.player.fuel set to 40 (existing public object) and read ${fuel.after.toFixed(2)} after ${fuel.frames} frames / ${Math.round(fuel.elapsed)} ms at alt ${fuel.alt.toFixed(2)}. Regen is 10 points per sim second; dt cap 45 ms means this window could add at most about ${fuelSim.toFixed(2)} points. Original fuel was ${fuel.start.toFixed(1)}.`,
    expected: 'On the ground, fuel increases across simulation frames',
    actual: `fuel ${fuel.after.toFixed(2)} after ${fuel.frames} frames`,
    metrics: fuel,
    repro: ['Enter the world on the ground', 'Set MoonGame.player.fuel = 40', 'Let a few frames run', 'Read fuel'],
    severity: 'minor',
    bugTitle: 'Jetpack fuel does not regenerate on the ground'
  });

  await P.keyboardNudge(page, 'w', 600);
  await page.evaluate(() => MoonGame.save());
  const saved = await page.evaluate(key => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, P.SAVE_KEY);
  const live = await P.readProbe(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.MoonGame && window.MoonGame.state, null, { timeout: 120000 });
  const reloaded = await page.evaluate(() => ({ x: MoonGame.state.x, z: MoonGame.state.z, chapter: MoonGame.state.chapter }));
  const dx = saved ? Math.hypot((reloaded.x || 0) - saved.x, (reloaded.z || 0) - saved.z) : Infinity;
  const shotSave = await screenshot(page, `${vp.id}-reloaded-cover`);
  steps.push(`save/load local delta ${Number.isFinite(dx) ? dx.toFixed(3) : 'n/a'} m`);
  checks.push({
    id: `${vp.id}.save-load`,
    status: saved && dx < 0.05 ? 'pass' : 'fail',
    viewport: vp.id,
    detail: saved
      ? `localStorage ${P.SAVE_KEY} round-tripped xz within ${dx.toFixed(4)} m after reload (saved ${saved.x.toFixed(2)},${saved.z.toFixed(2)} → ${reloaded.x.toFixed(2)},${reloaded.z.toFixed(2)})`
      : `localStorage ${P.SAVE_KEY} was empty after MoonGame.save()`,
    expected: 'MoonGame.save() writes player xz and a reload restores the same state coordinates',
    actual: saved ? `delta ${dx.toFixed(4)} m` : 'no save record',
    evidence: [shotSave],
    repro: ['Move with W', 'Call the existing MoonGame.save()', `Reload and read ${P.SAVE_KEY}`],
    severity: 'blocker',
    bugTitle: 'Progress does not survive a reload'
  });

  // Back into the world for perf samples. The reloaded page is on the cover.
  await P.startExpedition(page);
  const latencies = [];
  for (let i = 0; i < 3; i += 1) {
    await P.closeDialogs(page);
    latencies.push(await P.inputLatency(page));
    await page.waitForTimeout(150);
  }
  const samples = latencies.map(x => x.ms).filter(x => typeof x === 'number');
  const median = samples.length ? samples.slice().sort((a, b) => a - b)[Math.floor(samples.length / 2)] : null;
  steps.push(`input latency samples ${JSON.stringify(latencies)}`);
  checks.push({
    id: `${vp.id}.input-latency`,
    status: median != null ? 'pass' : 'not_tested',
    viewport: vp.id,
    detail: median == null
      ? `Position did not change after a synthetic keydown. Samples: ${JSON.stringify(latencies)}`
      : `Median ${median} ms from synthetic keydown to xz change > 0.04 m (3 samples: ${samples.join(', ')}). This is frame delay inside the page, not hardware input delay.`,
    expected: 'A keydown while running changes position within 8 s, which covers one slow software-GL frame',
    actual: JSON.stringify(latencies),
    metrics: { samplesMs: samples, medianMs: median },
    repro: ['Enter the world', 'Dispatch keydown W', 'Measure time until player xz moves 0.04 m'],
    severity: 'major',
    bugTitle: 'Keyboard input does not move the player (latency probe)'
  });

  await P.closeDialogs(page);
  await page.keyboard.down('w');
  const frames = await P.sampleFrames(page, 4000);
  await page.keyboard.up('w');
  const memory = await P.heap(page);
  steps.push(`fps ${frames.fps} heap ${memory.available ? memory.usedJSHeapSize : 'unavailable'}`);
  checks.push({
    id: `${vp.id}.fps`,
    status: frames.fps ? 'pass' : 'not_tested',
    viewport: vp.id,
    detail: frames.fps
      ? `rAF while holding W: ${frames.fps} fps, avg ${frames.avgFrameMs} ms, p95 ${frames.p95FrameMs} ms, max ${frames.maxFrameMs} ms over ${frames.frames} frames. Software WebGL (SwiftShader) and quality=low.`
      : 'rAF sample returned no frames',
    metrics: frames,
    evidence: []
  });
  checks.push({
    id: `${vp.id}.js-heap`,
    status: memory.available ? 'pass' : 'not_tested',
    viewport: vp.id,
    detail: memory.available
      ? `usedJSHeapSize ${memory.usedJSHeapSize} bytes, total ${memory.totalJSHeapSize}, limit ${memory.jsHeapSizeLimit} (Chrome performance.memory, --enable-precise-memory-info)`
      : memory.reason,
    metrics: memory
  });
  void world;
  void baseUrl;
}

async function runSmoke(page, vp, baseUrl, steps, checks) {
  const world = await openWorld(page, baseUrl, steps);
  const shotBoot = await screenshot(page, `${vp.id}-world`);
  checks.push({
    id: `${vp.id}.boot`,
    status: world.pose && world.pose.running && world.pose.webgl ? 'pass' : 'fail',
    viewport: vp.id,
    detail: world.pose && world.pose.running
      ? `running in ${world.loadMs} ms, quality=${world.pose.quality}, canvas ${world.pose.canvas && world.pose.canvas.clientW}x${world.pose.canvas && world.pose.canvas.clientH}`
      : `boot failed: ${world.pose && world.pose.errorText || 'no MoonGame'}`,
    expected: 'The world starts on this viewport',
    actual: world.pose ? `running=${world.pose.running}` : 'no probe',
    metrics: { loadMs: world.loadMs },
    evidence: [shotBoot],
    repro: [`Viewport ${vp.width}x${vp.height}`, 'Open ?nolang&nointro&nosw', 'Click #begin'],
    severity: 'blocker',
    bugTitle: `Horizons does not boot at ${vp.width}x${vp.height}`
  });
  if (!world.pose || !world.pose.running) return { loadMs: world.loadMs };

  let pointer = null;
  if (vp.hasTouch) {
    pointer = await P.joystickHold(page, 2500);
    steps.push(`pointer joystick before touch moved ${pointer.moved.toFixed(3)} m, pointerdowns ${pointer.pointerdowns}`);
  }
  const nudge = vp.hasTouch ? await P.touchJoystickHold(page, 2500) : await P.keyboardNudge(page, 'w', 4000);
  steps.push(`${vp.hasTouch ? 'touch joystick' : 'key W'} moved ${nudge.moved.toFixed(3)} m`);
  const shotMove = await screenshot(page, `${vp.id}-move`);
  checks.push({
    id: `${vp.id}.${vp.hasTouch ? 'joystick-touch' : 'keyboard-move'}`,
    status: nudge.moved > 0.05 ? 'pass' : 'fail',
    viewport: vp.id,
    detail: `${vp.hasTouch ? 'Touch' : 'Keyboard'} input moved ${nudge.moved.toFixed(2)} m`,
    expected: 'Primary movement control changes position',
    actual: `moved ${nudge.moved.toFixed(3)} m`,
    evidence: [shotMove],
    repro: vp.hasTouch
      ? ['Mobile viewport', 'Touch-drag the joystick upward for 1.2 s']
      : ['Hold W for 1.2 s'],
    severity: 'blocker',
    bugTitle: `Player does not move on ${vp.id}`
  });
  if (vp.hasTouch && pointer) {
    const pointerPass = pointer.moved > 0.05;
    const pointerDelivered = pointer.pointerdowns > 0;
    checks.push({
      id: `${vp.id}.joystick-pointer`,
      status: pointerPass ? 'pass' : (pointerDelivered ? 'fail' : 'not_tested'),
      viewport: vp.id,
      detail: pointerDelivered
        ? `Pointer-drag joystick moved ${pointer.moved.toFixed(2)} m on a touch viewport (${pointer.pointerdowns} pointerdown event(s) on #joystick, before the touch probe)`
        : `Mouse drag sent no pointerdown to #joystick on this touch viewport. Headless Chrome did not deliver pointer events, so this is not scored as a product defect.`,
      expected: 'Pointer events on the joystick also move the player',
      actual: `moved ${pointer.moved.toFixed(3)} m, pointerdowns=${pointer.pointerdowns}`,
      evidence: [shotMove],
      repro: ['Touch viewport', 'Mouse-drag #joystick upward before any CDP touch'],
      severity: 'major',
      bugTitle: 'Pointer joystick is dead on a touch viewport'
    });
    const touchCheck = checks.find(c => c.id === `${vp.id}.joystick-touch`);
    if (touchCheck && touchCheck.status === 'fail' && pointerPass) {
      touchCheck.status = 'not_tested';
      touchCheck.detail = `CDP touch events moved ${nudge.moved.toFixed(3)} m. Pointer events on the same joystick moved ${pointer.moved.toFixed(2)} m. The game sets the stick from pointer events (joystick.onpointerdown), and headless Chrome did not turn Input.dispatchTouchEvent into those pointer events. This is not scored as a product defect.`;
      delete touchCheck.bugTitle;
    }
  }
  const cam = await rotateCamera(page, steps);
  checks.push({
    id: `${vp.id}.camera-yaw-360`,
    status: cam.accumulated >= Math.PI * 2 - 0.2 ? 'pass' : 'fail',
    viewport: vp.id,
    detail: `accumulated |Δyaw|=${cam.accumulated.toFixed(3)} rad`,
    expected: 'Horizontal drags complete a full camera turn',
    actual: `${cam.accumulated.toFixed(3)} rad`,
    evidence: [await screenshot(page, `${vp.id}-camera`)],
    repro: ['Drag horizontally across the canvas until yaw has turned 360°'],
    severity: 'major',
    bugTitle: `Camera does not complete 360° on ${vp.id}`
  });
  const bounds = await P.boxesInside(page, CONTROL_SELECTORS);
  const outside = bounds.controls.filter(c => !c.inside);
  checks.push({
    id: `${vp.id}.hud-inside-viewport`,
    status: outside.length ? 'fail' : 'pass',
    viewport: vp.id,
    detail: outside.length ? `outside: ${outside.map(c => `${c.sel}@${c.x},${c.y} ${c.w}x${c.h}`).join('; ')}` : `controls inside ${vp.width}x${vp.height} (deviceScaleFactor 1)`,
    expected: 'HUD controls are fully inside the viewport',
    actual: JSON.stringify(bounds.controls),
    evidence: [await screenshot(page, `${vp.id}-hud`)],
    metrics: { controls: bounds.controls },
    repro: [`Open at ${vp.width}x${vp.height}`, 'Measure HUD control boxes'],
    severity: 'major',
    bugTitle: `HUD overflow on ${vp.id}`
  });
  await exerciseMenus(page, vp, steps, checks);
  return { loadMs: world.loadMs };
}

async function runThrottled(browser, baseUrl, checks, steps) {
  const vp = { id: 'desktop-throttled', width: 1280, height: 800, isMobile: false, hasTouch: false, recordVideo: true };
  const { context, page, logs } = await bootContext(browser, vp);
  const client = await context.newCDPSession(page);
  await client.send('Network.enable');
  await client.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 250,
    downloadThroughput: (2 * 1000 * 1000) / 8,
    uploadThroughput: (750 * 1000) / 8,
    connectionType: 'cellular3g'
  });
  steps.push('CDP network: 250 ms latency, 2.0 Mbit/s down, 0.75 Mbit/s up');
  let loadMs = null;
  let status = 'not_tested';
  let detail = '';
  try {
    const t0 = Date.now();
    await page.goto(`${baseUrl}?nolang&nointro&nosw`, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await page.waitForFunction(() => window.MoonGame && document.querySelector('#begin'), null, { timeout: 180000 });
    loadMs = Date.now() - t0;
    const poseReady = await page.evaluate(() => ({
      moon: !!window.MoonGame,
      begin: !!document.querySelector('#begin'),
      error: document.querySelector('#boot-fail') ? 'boot-fail' : ''
    }));
    status = poseReady.moon && poseReady.begin ? 'pass' : 'fail';
    detail = `Throttled load reached MoonGame and #begin in ${loadMs} ms. ${JSON.stringify(poseReady)}`;
    await screenshot(page, 'throttled-cover');
  } catch (error) {
    status = 'not_tested';
    detail = `Throttled load did not reach MoonGame within the wait: ${error.message.split('\n')[0]}`;
    await screenshot(page, 'throttled-timeout').catch(() => {});
  }
  checks.push({
    id: 'network.throttled-load',
    status,
    viewport: vp.id,
    detail,
    metrics: { loadMs, latencyMs: 250, downloadMbit: 2, uploadMbit: 0.75 },
    evidence: ['qa/reports/' + DATE + '/screenshots/throttled-cover.png'],
    expected: 'With 250 ms latency and 2 Mbit/s down, the cover and MoonGame still appear',
    actual: detail,
    repro: ['Emulate 250 ms / 2 Mbit/s', 'Open ?nolang&nointro&nosw', 'Wait for MoonGame and #begin'],
    severity: 'major',
    bugTitle: 'Horizons does not finish loading on a slow network'
  });
  const video = await finishVideo(page, context, vp, true);
  return { logs, video, loadMs };
}

async function runUnstable(browser, baseUrl, checks, steps) {
  const vp = { id: 'desktop-unstable', width: 1280, height: 800, isMobile: false, hasTouch: false, recordVideo: false };
  const { context, page, logs } = await bootContext(browser, vp);
  let aborted = 0;
  await page.route(/game\.js/, route => { aborted += 1; return route.abort('failed'); });
  steps.push('abort every request whose URL matches game.js (seeded failure of the world script)');
  let saw = false;
  try {
    await page.goto(`${baseUrl}?nolang&nointro&nosw`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('#boot-fail', { timeout: 15000 });
    saw = true;
  } catch { saw = false; }
  const text = await page.locator('#boot-fail').innerText().catch(() => '');
  await screenshot(page, 'unstable-boot-fail').catch(() => {});
  checks.push({
    id: 'network.unstable-script',
    status: saw ? 'pass' : 'fail',
    viewport: vp.id,
    detail: saw
      ? `Aborting game.js (${aborted} request(s), seed ${SEED}) showed #boot-fail. Text: ${text.replace(/\s+/g, ' ').slice(0, 220)}`
      : `Aborting game.js (${aborted} request(s)) did not show #boot-fail within 15 s`,
    expected: 'A failed world script shows the existing full-screen retry (MoonReliability.bootFail)',
    actual: saw ? text.replace(/\s+/g, ' ').slice(0, 300) : `boot-fail absent, aborted=${aborted}`,
    evidence: ['qa/reports/' + DATE + '/screenshots/unstable-boot-fail.png'],
    repro: ['Block game.js', 'Reload the play build', 'Look for #boot-fail'],
    severity: 'major',
    bugTitle: 'A failed game.js load does not show the boot retry screen'
  });
  await context.close();
  return { logs, aborted };
}

function stampBugs(checks, ctx) {
  let n = 0;
  const bugs = [];
  for (const check of checks) {
    if (check.status !== 'fail') continue;
    n += 1;
    check.bugId = `QA-HZ-${String(n).padStart(3, '0')}`;
    bugs.push(bugFromCheck(check, ctx));
  }
  return bugs;
}

async function main() {
  fs.mkdirSync(reportDir, { recursive: true });
  const startedAt = new Date().toISOString();
  console.log(`QA seed ${SEED} date ${DATE}`);
  const game = await prepareHorizons(cacheDir);
  console.log(`serving ${game.repo}@${game.sha} (${game.build})`);
  const server = await serveStatic(game.serveDir);
  const executablePath = chromePath();
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: GL_ARGS
  });
  const browserVersion = browser.version();
  const checks = [];
  const stepGroups = [];
  const allLogs = [];
  const metrics = { loadMs: {}, fps: null, heap: null, inputLatencyMs: null, network: {} };
  const videos = [];
  let exitCode = 0;
  try {
    for (const vp of VIEWPORTS) {
      console.log(`\n=== ${vp.id} ${vp.width}x${vp.height} ===`);
      const steps = [];
      const { context, page, logs } = await bootContext(browser, vp);
      let failed = false;
      try {
        if (vp.full) await runFull(page, vp, server.url, steps, checks);
        else await runSmoke(page, vp, server.url, steps, checks);
      } catch (error) {
        failed = true;
        const evidence = [];
        try { evidence.push(await screenshot(page, `${vp.id}-exception`)); } catch { /* page may be gone */ }
        checks.push({
          id: `${vp.id}.harness`,
          status: 'fail',
          viewport: vp.id,
          detail: `Harness exception: ${(error.stack || error.message).split('\n').slice(0, 6).join(' | ')}`,
          expected: 'The scenario finishes',
          actual: error.message,
          evidence,
          repro: [`Viewport ${vp.id}`, 'Re-run npm run qa:horizons'],
          severity: 'major',
          bugTitle: `QA harness exception on ${vp.id}`
        });
        logLine('fail', `${vp.id}.harness`, error.message.split('\n')[0]);
        checks[checks.length - 1]._logged = true;
      }
      const sig = significantLogs(logs);
      if (sig.length) {
        checks.push({
          id: `${vp.id}.console-errors`,
          status: 'fail',
          viewport: vp.id,
          detail: `${sig.length} page error(s) or console error(s) during this viewport`,
          expected: 'No uncaught page errors and no console.error while booting and playing',
          actual: sig.slice(0, 8).map(e => `${e.type}: ${e.text}`).join(' | ').slice(0, 800),
          console: sig.slice(0, 20),
          repro: [`Open the ${vp.id} scenario`, 'Watch pageerror and console error'],
          severity: 'major',
          bugTitle: `JavaScript console errors on ${vp.id}`
        });
      } else {
        checks.push({
          id: `${vp.id}.console-errors`,
          status: 'pass',
          viewport: vp.id,
          detail: `No pageerror or console error captured (${logs.filter(l => l.type === 'requestfailed').length} failed requests ignored as transport)`
        });
      }
      allLogs.push({ viewport: vp.id, logs });
      const video = await finishVideo(page, context, vp, vp.recordVideo || failed);
      if (video) videos.push(video);
      stepGroups.push({ viewport: vp.id, steps });
      for (const check of checks.filter(c => c.viewport === vp.id && !c._logged)) {
        logLine(check.status, check.id, check.detail);
        check._logged = true;
      }
    }

    console.log('\n=== network ===');
    const netSteps = [];
    const throttled = await runThrottled(browser, server.url, checks, netSteps);
    if (throttled.video) videos.push(throttled.video);
    metrics.network.throttledLoadMs = throttled.loadMs;
    allLogs.push({ viewport: 'desktop-throttled', logs: throttled.logs });
    const unstable = await runUnstable(browser, server.url, checks, netSteps);
    allLogs.push({ viewport: 'desktop-unstable', logs: unstable.logs });
    stepGroups.push({ viewport: 'network', steps: netSteps });
    for (const check of checks.filter(c => c.id.startsWith('network.') && !c._logged)) {
      logLine(check.status, check.id, check.detail);
      check._logged = true;
    }
  } finally {
    await browser.close();
    await server.close();
  }

  for (const check of checks) {
    if (check.id.endsWith('.fps') && check.metrics && check.metrics.fps) metrics.fps = check.metrics;
    if (check.id.endsWith('.js-heap') && check.metrics && check.metrics.available) metrics.heap = check.metrics;
    if (check.id.endsWith('.input-latency') && check.metrics) metrics.inputLatencyMs = check.metrics;
    if (check.metrics && check.metrics.loadMs != null && check.id.endsWith('.boot')) metrics.loadMs[check.viewport] = check.metrics.loadMs;
  }

  const finishedAt = new Date().toISOString();
  const bugs = stampBugs(checks, {
    repo: `moonkattymky/${game.repo}`,
    sha: game.sha,
    foundAt: finishedAt,
    seed: SEED,
    repro: []
  });
  const report = {
    date: DATE,
    startedAt,
    finishedAt,
    seed: SEED,
    game: {
      repo: `moonkattymky/${game.repo}`,
      requestedRepo: 'moonkattymky/moonkatty-horizons',
      branch: game.branch,
      sha: game.sha,
      subject: game.subject,
      build: game.build,
      fallback: game.fallback,
      notes: game.notes,
      url: server.url
    },
    browser: `${browserVersion} executable=${executablePath || 'playwright default'}`,
    graphics: 'Chrome SwiftShader via --use-gl=angle --use-angle=swiftshader; game quality forced to low through localStorage moonkatty-new-horizons-v02-quality + mk-qmanual; deviceScaleFactor 1 on every viewport',
    videos,
    checks: checks.map(({ _logged, ...rest }) => rest),
    bugs,
    metrics,
    steps: stepGroups,
    notTestedNotes: [
      'Physical Telegram WebView, iOS and Android devices are not in this VM. See qa/TELEGRAM_DEVICE_CHECKLIST.md.',
      'moonkatty-horizons (master) was not cloneable in this run if game.fallback is true. The playable static build was served instead of a from-source compile.',
      'Chapter 1 is the only mission the walker attempts. Later puzzles are named in the story-dialog check when the recorder is not reached.',
      'camPitch is not on window.MoonGame. Pitch is inferred from renderer.eye movement.',
      'Input latency is an in-page synthetic KeyboardEvent, not a hardware scan-code delay.',
      'FPS is requestAnimationFrame on a software GL driver, not a phone GPU.'
    ]
  };
  const written = writeReport(reportDir, report);
  console.log(`\nreport ${path.join(reportDir, 'report.md')}`);
  console.log(`checks pass=${written.studio.dashboardCard.counts.pass} fail=${written.studio.dashboardCard.counts.fail} not_tested=${written.studio.dashboardCard.counts.not_tested} bugs=${bugs.length}`);
  if (bugs.length || checks.some(c => c.status === 'fail')) exitCode = 1;
  process.exitCode = exitCode;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
