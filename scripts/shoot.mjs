// Headless screenshot driver. Usage: node scripts/shoot.mjs [shots.json] [outDir]
// Serves game/ with serve.ts on a free port, renders each ?shot= query at 1280x720 and fails on any page error or external request.
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('/home/hatch/workspace/tools/shot/');
const { chromium } = require('playwright-core');
const root = fileURLToPath(new URL('..', import.meta.url));
const shotsFile = process.argv[2] ?? join(root, 'shots.json');
const outDir = process.argv[3] ?? join(root, 'screenshots');
const port = 8100 + Math.floor(Math.random() * 500);
mkdirSync(outDir, { recursive: true });

const server = spawn('node', [join(root, 'serve.ts'), '--port', String(port)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 900));
const browser = await chromium.launch({
  executablePath: '/home/hatch/workspace/tools/chrome-x/opt/google/chrome/chrome',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
const external = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('request', (r) => {
    const url = r.url();
    if (!url.startsWith(`http://localhost:${port}/`) && !url.startsWith('data:') && !url.startsWith('blob:')) external.push(url);
  });
  for (const s of JSON.parse(readFileSync(shotsFile, 'utf8'))) {
    const t0 = Date.now();
    await page.goto(`http://localhost:${port}/${s.query}`);
    await page.waitForFunction('window.__ready === true', null, { timeout: 90000 });
    await page.screenshot({ path: join(outDir, s.name), type: s.name.endsWith('.png') ? 'png' : 'jpeg', quality: 84 });
    console.log('shot', s.name, `${Date.now() - t0}ms`);
  }
} finally {
  await browser.close();
  server.kill();
}
console.log('errors:', errors, 'external requests:', external);
if (errors.length || external.length) process.exit(1);
