// Minimal Chrome DevTools Protocol driver for end-to-end checks (no Puppeteer).
//   nix shell nixpkgs#chromium -c node tools/cdp.ts offline   # service worker offline test
//   nix shell nixpkgs#chromium -c node tools/cdp.ts console /?v=3d   # console output of a page
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE ?? 'http://127.0.0.1:8080';
const OUT = process.env.OUT ?? tmpdir();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function launch(extra: string[] = []) {
  const port = 9300 + Math.floor(Math.random() * 500);
  const dir = mkdtempSync(path.join(tmpdir(), 'cdp-'));
  process.env.FONTCONFIG_FILE ??= path.resolve(import.meta.dirname, '../.cache/fonts.conf');
  const proc = spawn('chromium', ['--headless=new', '--no-sandbox', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--window-size=1280,900', ...extra, 'about:blank'], { stdio: 'ignore' });
  let ws = '';
  for (let i = 0; i < 50 && !ws; i++) {
    await sleep(200);
    try { ws = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t: any) => t.type === 'page')?.webSocketDebuggerUrl; } catch { /* starting */ }
  }
  const sock = new WebSocket(ws);
  await new Promise((r) => sock.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map<number, (v: any) => void>();
  const events: any[] = [];
  sock.addEventListener('message', (m) => {
    const msg = JSON.parse(String(m.data));
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)!(msg.error ? Promise.reject(new Error(msg.error.message)) : msg.result); pending.delete(msg.id); }
    else events.push(msg);
  });
  const send = (method: string, params: object = {}) => new Promise<any>((res) => { pending.set(++id, res); sock.send(JSON.stringify({ id, method, params })); });
  const evalJs = async (expr: string) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.value;
  const shot = async (file: string) => writeFileSync(file, Buffer.from((await send('Page.captureScreenshot')).data, 'base64'));
  const close = () => { sock.close(); proc.kill(); };
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable');
  // SIZE=390x844 (a phone: touch, DPR 2), DARK=1
  const [w, h] = (process.env.SIZE ?? '1280x800').split('x').map(Number) as [number, number];
  const phone = w < 600;
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: phone ? 2 : 1, mobile: phone });
  if (phone) await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: process.env.DARK ? 'dark' : 'light' }] });
  const go = async (url: string, wait = 2500) => { await send('Page.navigate', { url }); await sleep(wait); };
  return { send, evalJs, shot, close, go, events };
}

const [mode, arg] = process.argv.slice(2);
const b = await launch(mode === 'console' ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader'] : []);
try {
  if (mode === 'offline') {
    await b.go(`${BASE}/`, 3000);
    const ready = await b.evalJs('navigator.serviceWorker.ready.then(r => !!r.active)');
    console.log('service worker active:', ready);
    await b.go(`${BASE}/`, 1500); // now controlled
    await b.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      await b.go(`${BASE}/works/mosimo`, 1200);
      seen.add(await b.evalJs('document.documentElement.dataset.v + " hue " + document.documentElement.style.getPropertyValue("--h")'));
    }
    console.log('offline /works/mosimo:', [...seen].join(', '));
    await b.go(`${BASE}/blog.md`, 1200);
    console.log('offline /blog.md:', JSON.stringify((await b.evalJs('document.body.innerText')).slice(0, 40)));
    await b.shot(path.join(OUT, 'offline.png'));
  } else if (mode === 'console') {
    await b.go(`${BASE}${arg ?? '/'}`, Number(process.env.WAIT ?? 6000));
    for (const e of b.events) {
      if (e.method === 'Runtime.consoleAPICalled') console.log(`console.${e.params.type}:`, e.params.args.map((a: any) => a.value ?? a.description).join(' '));
      if (e.method === 'Runtime.exceptionThrown') console.log('exception:', e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text);
      if (e.method === 'Log.entryAdded') console.log(`log.${e.params.entry.level}:`, e.params.entry.text);
    }
    if (process.env.EVAL) console.log('eval:', JSON.stringify(await b.evalJs(process.env.EVAL)));
    const snap = await b.evalJs('new Promise(r => { const t = () => typeof window.__snap === "string" && window.__snap.startsWith("data:") ? r(window.__snap) : setTimeout(t, 200); setTimeout(() => r(null), 5000); t(); })');
    if (snap) writeFileSync(path.join(OUT, 'snap.png'), Buffer.from(snap.split(',')[1], 'base64'));
    await b.shot(path.join(OUT, 'console.png'));
  }
} finally {
  b.close();
}
