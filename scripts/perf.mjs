// Headless performance run. Usage: node scripts/perf.mjs [seconds] [width] [height]
// Serves game/, opens ?bench=1 (autopilot drive with a 3-star chase) in software-GL Chrome and prints the stats the page collects.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('/home/hatch/workspace/tools/shot/');
const { chromium } = require('playwright-core');
const root = fileURLToPath(new URL('..', import.meta.url));
const seconds = Number(process.argv[2] ?? 30);
const width = Number(process.argv[3] ?? 1280);
const height = Number(process.argv[4] ?? 720);
const port = 8600 + Math.floor(Math.random() * 300);

const server = spawn('node', [join(root, 'serve.ts'), '--port', String(port)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 900));
const browser = await chromium.launch({
  executablePath: '/home/hatch/workspace/tools/chrome-x/opt/google/chrome/chrome',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`http://localhost:${port}/?bench=1&secs=${seconds}`);
  await page.waitForFunction('window.__benchDone === true', null, { timeout: (seconds + 120) * 1000 });
  const result = await page.evaluate('window.__bench');
  console.log(`viewport ${width}x${height}`);
  console.log(JSON.stringify(result, (k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v), 2));
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) {
  console.log('errors:', errors);
  process.exit(1);
}
