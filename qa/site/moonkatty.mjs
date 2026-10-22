/**
 * Read-only checks against the public site.
 *   node qa/site/moonkatty.mjs [--out file.json]
 * GETs only. No forms, no login, no POST.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ORIGIN = 'https://moonkatty.com';
const LANGS = ['en', 'ru', 'uk', 'es', 'pt', 'de', 'fr', 'it', 'tr', 'he', 'ar', 'ko', 'zh'];
const NAV_ABOUT = {
  en: 'About',
  ru: 'О нас',
  uk: 'Про нас',
  es: 'Nosotros',
  pt: 'Sobre nós',
  de: 'Über uns',
  fr: 'À propos',
  it: 'Chi siamo',
  tr: 'Hakkımızda',
  he: 'עלינו',
  ar: 'من نحن',
  ko: '소개',
  zh: '关于'
};
const RTL = new Set(['he', 'ar']);

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

function check(checks, id, result, summary, extra = {}) {
  checks.push({ id, result, summary, ...extra });
}

async function readNav(page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-i="nv_about"]');
    return !!(el && el.textContent.trim());
  }, null, { timeout: 15000 });
  return page.evaluate(() => ({
    text: document.querySelector('[data-i="nv_about"]').textContent.trim(),
    lang: document.documentElement.lang,
    dir: document.documentElement.dir || ''
  }));
}

function watch(page, bucket) {
  page.on('pageerror', error => bucket.pageErrors.push(String(error)));
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (/Failed to load resource|net::ERR_/i.test(text)) return;
    bucket.consoleErrors.push(text);
  });
}

async function main() {
  const checks = [];
  const chrome = process.env.CHROME_PATH || '/usr/bin/google-chrome';
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await desktop.newPage();
  const homeNoise = { pageErrors: [], consoleErrors: [] };
  watch(page, homeNoise);
  const home = await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  check(checks, 'home.status', home && home.status() < 400 ? 'pass' : 'fail', `GET / returned ${home ? home.status() : 'no response'}`);
  const alternates = await page.$$eval('link[rel="alternate"]', nodes => nodes.map(node => ({
    lang: node.getAttribute('hreflang'),
    href: node.getAttribute('href')
  })));
  const codes = new Set(alternates.map(item => item.lang));
  const missing = LANGS.filter(code => !codes.has(code));
  check(
    checks,
    'hreflang',
    missing.length ? 'fail' : 'pass',
    missing.length ? `Missing hreflang: ${missing.join(', ')}` : `Found ${LANGS.length} language alternates`,
    { found: alternates.map(item => item.lang) }
  );

  const hrefs = await page.$$eval('a[href]', nodes => nodes.map(node => node.getAttribute('href')));
  const seen = new Set();
  const links = [];
  for (const href of hrefs) {
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;
    let url;
    try { url = new URL(href, ORIGIN); } catch { continue; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
    url.hash = '';
    const key = url.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(url);
  }
  for (const url of links) {
    const same = url.origin === ORIGIN;
    try {
      const response = await desktop.request.get(url.toString(), { timeout: 20000, maxRedirects: 5 });
      const status = response.status();
      if (status < 400) check(checks, `link ${url.pathname}${url.search}`, 'pass', `${status} ${url}`, { status });
      else if (same) check(checks, `link ${url.pathname}${url.search}`, 'fail', `${status} ${url}`, { status });
      else check(checks, `link ${url.hostname}${url.pathname}`, 'not_tested', `${status} from an external host, left ungraded`, { status });
    } catch (error) {
      const summary = `${url} ${error.message}`;
      check(checks, `link ${url.hostname}${url.pathname}`, same ? 'fail' : 'not_tested', summary);
    }
  }

  for (const code of LANGS) {
    const noise = { pageErrors: [], consoleErrors: [] };
    const langPage = await desktop.newPage();
    watch(langPage, noise);
    try {
      await langPage.goto(`${ORIGIN}/?lang=${code}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const nav = await readNav(langPage);
      const expectedDir = RTL.has(code) ? 'rtl' : 'ltr';
      const textOk = nav.text === NAV_ABOUT[code];
      const langOk = nav.lang === code;
      const dirOk = nav.dir === expectedDir;
      const ok = textOk && langOk && dirOk;
      const bits = [];
      if (!textOk) bits.push(`nv_about is ${JSON.stringify(nav.text)}, dictionary is ${JSON.stringify(NAV_ABOUT[code])}`);
      if (!langOk) bits.push(`html lang is ${JSON.stringify(nav.lang)}`);
      if (!dirOk) bits.push(`dir is ${JSON.stringify(nav.dir)}, expected ${expectedDir}`);
      check(checks, `lang.${code}`, ok ? 'pass' : 'fail', ok
        ? `${code} nv_about is ${nav.text}, lang ${nav.lang}, dir ${nav.dir}`
        : bits.join('; '), {
        lang: nav.lang,
        dir: nav.dir,
        text: nav.text
      });
      const errors = [...noise.pageErrors, ...noise.consoleErrors];
      check(checks, `console.${code}`, errors.length ? 'fail' : 'pass', errors.length ? errors.join(' | ') : `${code} console quiet`);
    } catch (error) {
      check(checks, `lang.${code}`, 'fail', error.message);
    }
    await langPage.close();
  }
  const homeErrors = [...homeNoise.pageErrors, ...homeNoise.consoleErrors];
  check(checks, 'console.home', homeErrors.length ? 'fail' : 'pass', homeErrors.length ? homeErrors.join(' | ') : 'home console quiet');

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true
  });
  const phone = await mobile.newPage();
  const phoneNoise = { pageErrors: [], consoleErrors: [] };
  watch(phone, phoneNoise);
  await phone.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await phone.waitForTimeout(500);
  const box = await phone.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    innerWidth: window.innerWidth
  }));
  const overflow = box.scrollWidth - box.clientWidth;
  check(checks, 'mobile.viewport', overflow > 2 ? 'fail' : 'pass', `390x844 scrollWidth ${box.scrollWidth} clientWidth ${box.clientWidth}`, box);
  const phoneErrors = [...phoneNoise.pageErrors, ...phoneNoise.consoleErrors];
  check(checks, 'console.mobile', phoneErrors.length ? 'fail' : 'pass', phoneErrors.length ? phoneErrors.join(' | ') : 'mobile console quiet');
  const shotDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../reports/stages-C-E/site');
  fs.mkdirSync(shotDir, { recursive: true });
  await phone.screenshot({ path: path.join(shotDir, 'mobile.png'), fullPage: false });
  await browser.close();

  const pass = checks.filter(item => item.result === 'pass').length;
  const fail = checks.filter(item => item.result === 'fail').length;
  const not_tested = checks.filter(item => item.result === 'not_tested').length;
  const report = {
    contract: 'moonkatty.qa.site/1',
    at: new Date().toISOString(),
    origin: ORIGIN,
    mode: 'read-only',
    note: 'GET requests only. Counts are check results, not a score.',
    pass,
    fail,
    not_tested,
    checks
  };
  const text = JSON.stringify(report, null, 2);
  const out = arg('--out') || path.join(shotDir, 'site.json');
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, text + '\n');
  console.log(text);
  process.exit(fail ? 1 : 0);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
