// Bounded browser harness: one Chrome instance, closed in finally, hard timeout.
import { chromium } from 'playwright-core';
import { pathToFileURL } from 'node:url';

export const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const FILE = process.env.PA_FILE || new URL('../index.html', import.meta.url).pathname;

export async function withPage(fn, { width = 1440, height = 900, dpr = 1, mobile = false, reducedMotion = 'no-preference', timeout = 180000, query = '?no-intro', url = null } = {}) {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const killer = setTimeout(() => { console.error('HARD TIMEOUT'); browser.close().catch(() => {}); }, timeout);
  const log = { console: [], errors: [], requests: [] };
  try {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, isMobile: mobile, hasTouch: mobile, reducedMotion, acceptDownloads: true, offline: !url });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) log.console.push(`${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => log.errors.push(String(e)));
    page.on('request', (r) => log.requests.push(r.url().slice(0, 80)));
    await page.goto((url ?? pathToFileURL(FILE).href) + query);
    await page.waitForFunction(() => window.__atelier?.stage?.pill, null, { timeout: 60000 });
    return await fn(page, log);
  } catch (error) {
    console.error("Browser diagnostics", JSON.stringify(log));
    throw error;
  } finally {
    clearTimeout(killer);
    await browser.close();
  }
}

// Wait until the progressive renderer has converged (GPU idle).
export async function settle(page, ms = 45000) {
  await page.waitForFunction(() => { const s = window.__atelier.stage; return s && !s.running && s.pipe.converged; }, null, { timeout: ms, polling: 200 });
}
