#!/usr/bin/env node
/** Capture deterministic 1440x900 screenshots and 1200 px, 12 fps GIFs. */
import { readFile, mkdir, stat, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';

const STATE = join(homedir(), '.cache/maestro-device-farm-demo/state.json');
const WIDTH = 1440, HEIGHT = 900, GIF_WIDTH = 1200, GIF_FPS = 12, GIF_LIMIT = 6_000_000;
const isVerify = process.argv.includes('--verify-live');
const shotlist = process.argv[2] && !process.argv[2].startsWith('--')
  ? resolve(process.argv[2]) : resolve('tools/demo/shotlist.example.json');
const output = process.argv[3] ? resolve(process.argv[3]) : resolve('tools/demo/output');
const batch = process.env.DEMO_CAPTURE_BATCH;
const names = process.env.DEMO_CAPTURE_NAMES ? new Set(process.env.DEMO_CAPTURE_NAMES.split(',')) : null;
const language = process.env.DEMO_LANG === 'ko' ? 'ko' : 'en';
const state = JSON.parse(await readFile(STATE, 'utf8'));
const baseUrl = process.env.DEMO_WEB_URL || state.web_url;
const chrome = process.env.DEMO_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) });
const en = JSON.parse(await readFile(new URL('../../web/src/lib/locales/en.json', import.meta.url)));
const ko = JSON.parse(await readFile(new URL('../../web/src/lib/locales/ko.json', import.meta.url)));
const translations = new Map();
for (const [key, value] of Object.entries(en)) {
  if (typeof value === 'string' && ko[key] && !translations.has(value)) translations.set(value, ko[key]);
}

function interpolate(value) {
  if (typeof value !== 'string') return value;
  return value.replaceAll('{passedRun}', state.passed_run || '')
    .replaceAll('{failedRun}', state.failed_run || '')
    .replaceAll('{workspace}', 'example-app');
}
function expand(value) {
  const result = interpolate(value);
  if (language !== 'ko' || typeof result !== 'string') return result;
  if (result.startsWith('text=')) return `text=${translations.get(result.slice(5)) || result.slice(5)}`;
  return result.replace(/(['"])(.*?)\1/g, (match, quote, content) =>
    `${quote}${translations.get(content) || content}${quote}`);
}
function url(path) { return new URL(interpolate(path), baseUrl).toString(); }
async function context(options = {}) {
  const created = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT },
    colorScheme: 'light', locale: language === 'ko' ? 'ko-KR' : 'en-US', deviceScaleFactor: 1, ...options });
  await created.addInitScript((lang) => localStorage.setItem('farm.language', lang), language);
  return created;
}

async function canvasHasPixels(page, selector) {
  await page.waitForFunction((value) => {
    const canvas = document.querySelector(value);
    return canvas instanceof HTMLCanvasElement && canvas.width > 0 && canvas.height > 0;
  }, selector, { timeout: 45000 });
  return page.locator(selector).evaluate((canvas) => {
    const { width, height } = canvas;
    const pixels = canvas.getContext('2d')?.getImageData(0, 0, width, height).data;
    if (!pixels) return false;
    const sample = new Set();
    for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 12))) {
      for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 12))) {
        const i = (y * width + x) * 4;
        sample.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]},${pixels[i + 3]}`);
      }
    }
    return sample.size > 3;
  });
}

async function ready(page, spec) {
  await page.goto(url(spec.path), { waitUntil: 'domcontentloaded' });
  if (spec.ready) await page.locator(expand(spec.ready)).first().waitFor({ timeout: 45000 });
  if (spec.livePixels) {
    const selector = expand(spec.ready || 'canvas');
    let pixels = false;
    for (let attempt = 0; attempt < 60 && !pixels; attempt++) {
      pixels = await canvasHasPixels(page, selector);
      if (!pixels) await page.waitForTimeout(1000);
    }
    if (!pixels) throw new Error(`Canvas contains no real pixels: ${selector}`);
  }
  if (spec.waitMs) await page.waitForTimeout(spec.waitMs);
}

async function callouts(page, items = []) {
  await page.locator('#demo-callouts').evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
  if (!items.length) return;
  const rects = [];
  for (const item of items) {
    const selector = expand(item.selector);
    const box = await page.locator(selector).nth(item.nth || 0).boundingBox();
    if (!box) throw new Error(`Callout selector missing: ${selector}`);
    rects.push({ ...box, number: item.number });
  }
  await page.evaluate((boxes) => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'demo-callouts';
    svg.setAttribute('viewBox', '0 0 1440 900');
    Object.assign(svg.style, { position: 'fixed', inset: '0', width: '1440px', height: '900px',
      zIndex: '2147483647', pointerEvents: 'none', overflow: 'visible' });
    const add = (tag, attrs) => {
      const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
      svg.append(node); return node;
    };
    const placed = [];
    for (const b of boxes) {
      const x = Math.max(6, b.x - 5), y = Math.max(6, b.y - 5);
      add('rect', { x, y, width: b.width + 10, height: b.height + 10, rx: 8,
        fill: 'none', stroke: '#F59E0B', 'stroke-width': 4 });
      const bubbleX = Math.min(1414, Math.max(26, x - 22));
      let bubbleY = Math.min(874, Math.max(26, y - 22));
      while (placed.some(([px, py]) => Math.hypot(px - bubbleX, py - bubbleY) < 43) && bubbleY < 830)
        bubbleY += 52;
      placed.push([bubbleX, bubbleY]);
      add('line', { x1: bubbleX + 10, y1: bubbleY + 10, x2: x + 9, y2: y + 9,
        stroke: '#F59E0B', 'stroke-width': 4 });
      add('circle', { cx: bubbleX, cy: bubbleY, r: 20, fill: '#F59E0B', stroke: '#111827', 'stroke-width': 2 });
      const label = add('text', { x: bubbleX, y: bubbleY + 7, 'text-anchor': 'middle',
        fill: '#111827', 'font-size': 21, 'font-weight': 800, 'font-family': 'sans-serif' });
      label.textContent = String(b.number);
    }
    document.body.append(svg);
  }, rects);
}

async function actions(page, steps = []) {
  for (const step of steps) {
    if (step.goto) await page.goto(url(step.goto), { waitUntil: 'domcontentloaded' });
    if (step.zoom) await page.evaluate((scale) => { document.body.style.zoom = String(scale); }, step.zoom);
    if (step.scrollY) await page.evaluate((distance) => window.scrollBy(0, distance), step.scrollY);
    if (step.click) await page.locator(expand(step.click)).first().click();
    if (step.clickIfPresent) {
      const target = page.locator(expand(step.clickIfPresent)).first();
      if (await target.isVisible()) await target.click();
    }
    if (step.fill) await page.locator(expand(step.fill)).first().fill(expand(step.value || ''));
    if (step.focus) await page.locator(expand(step.focus)).first().click();
    if (step.press) await page.keyboard.press(step.press);
    if (step.type) await page.keyboard.type(expand(step.type));
    if (step.scroll) await page.locator(expand(step.scroll)).first().scrollIntoViewIfNeeded();
    if (step.waitFor) await page.locator(expand(step.waitFor)).first().waitFor({ timeout: step.timeoutMs || 45000 });
    if (step.waitForReload) {
      const end = Date.now() + (step.timeoutMs || 90000);
      while (!(await page.locator(expand(step.waitForReload)).first().isVisible())) {
        if (Date.now() >= end) throw new Error(`Timed out waiting for ${step.waitForReload}`);
        await page.waitForTimeout(2000);
        await page.reload({ waitUntil: 'domcontentloaded' });
      }
    }
    if (step.waitPixels) {
      let pixels = false;
      for (let attempt = 0; attempt < 60 && !pixels; attempt++) {
        pixels = await canvasHasPixels(page, expand(step.waitPixels));
        if (!pixels) await page.waitForTimeout(1000);
      }
      if (!pixels) throw new Error(`Canvas contains no real pixels: ${step.waitPixels}`);
    }
    if (step.callouts) await callouts(page, step.callouts);
    if (step.waitMs) await page.waitForTimeout(step.waitMs);
  }
}

async function verifyLive() {
  const ctx = await context();
  const page = await ctx.newPage();
  await ready(page, { path: '/live', ready: "article[aria-label*='emulator-5560'] canvas", livePixels: true });
  await page.locator("article[aria-label*='emulator-5560'] button").first().click();
  await page.locator("section[aria-label*='emulator-5560'] canvas").waitFor();
  await page.waitForTimeout(2500);
  if (!(await canvasHasPixels(page, "section[aria-label*='emulator-5560'] canvas")))
    throw new Error('Live screen drawer has no device pixels');
  const recordingUrl = `${state.api_url}/api/v1/devices/emulator-5560/recordings`;
  const started = await page.request.post(recordingUrl, {
    data: { include_launch_app: false, workspace: 'settings-demo', app_package: 'com.android.settings' },
    headers: { 'X-Farm-User': 'Demo' },
  });
  if (started.status() !== 201) throw new Error(`Recording did not start: ${started.status()}`);
  const recording = await started.json();
  await page.waitForTimeout(2500);
  await page.locator("section[aria-label*='emulator-5560'] button[aria-label='홈'], section[aria-label*='emulator-5560'] button[aria-label='Home']").first().click();
  await page.waitForTimeout(3500);
  const stopped = await page.request.post(`${state.api_url}/api/v1/recordings/${recording.id}/stop`, {
    data: { ai_polish: false }, headers: { 'X-Farm-User': 'Demo' },
  });
  if (!stopped.ok()) throw new Error(`Recording did not stop: ${stopped.status()}`);
  const result = await stopped.json();
  if (result.status !== 'done' || !Array.isArray(result.steps) || result.steps.length === 0)
    throw new Error('Recording did not save the safe navigation action');
  await page.close();
  await ctx.close();
  console.log('Live board and live screen rendered device pixels; recording saved a navigation step');
}

try {
  if (isVerify) {
    await verifyLive();
  } else {
    const list = JSON.parse(await readFile(shotlist, 'utf8'));
    await mkdir(output, { recursive: true });
    for (const spec of list.shots || []) {
      if (batch && spec.batch !== batch) continue;
      if (names && !names.has(spec.name)) continue;
      const ctx = await context();
      if (spec.demoAuthor) await ctx.addInitScript(() => localStorage.setItem('farm.settings',
        JSON.stringify({ token: '', authorName: 'Demo', authorEmail: '' })));
      const page = await ctx.newPage();
      let failure;
      try {
        await ready(page, spec);
        await actions(page, spec.actions);
        await callouts(page, spec.callouts);
        await page.screenshot({ path: join(output, spec.name), animations: 'disabled' });
      } catch (error) { failure = error; }
      try { await actions(page, spec.cleanupActions); }
      catch (error) { failure ||= error; }
      await page.close();
      await ctx.close();
      if (failure) throw failure;
      console.log(`Captured ${spec.name}`);
    }
    for (const spec of list.gifs || []) {
      if (batch && spec.batch !== batch) continue;
      if (names && !names.has(spec.name)) continue;
      const ctx = await context({ recordVideo: { dir: output, size: { width: WIDTH, height: HEIGHT } } });
      const page = await ctx.newPage();
      await ready(page, spec);
      await callouts(page, spec.callouts);
      await actions(page, spec.actions);
      await page.waitForTimeout((spec.seconds || 4) * 1000);
      const video = page.video();
      await ctx.close();
      const webm = await video.path();
      const gif = join(output, spec.name);
      const palette = join(output, `.palette-${process.pid}.png`);
      const filter = `fps=${GIF_FPS},scale=${GIF_WIDTH}:-1:flags=lanczos`;
      const trim = String(spec.trimStart ?? 1);
      let result = spawnSync('ffmpeg', ['-y', '-v', 'error', '-ss', trim, '-i', webm,
        '-vf', `${filter},palettegen=max_colors=96`, palette]);
      if (result.status !== 0) throw new Error(result.stderr.toString());
      result = spawnSync('ffmpeg', ['-y', '-v', 'error', '-ss', trim, '-i', webm, '-i', palette, '-lavfi',
        `${filter}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5`, gif]);
      await unlink(palette);
      await unlink(webm);
      if (result.status !== 0) throw new Error(result.stderr.toString());
      if ((await stat(gif)).size >= GIF_LIMIT) throw new Error(`${spec.name} exceeds 6 MB`);
      console.log(`Captured ${spec.name}`);
    }
  }
} finally {
  await browser.close();
}
