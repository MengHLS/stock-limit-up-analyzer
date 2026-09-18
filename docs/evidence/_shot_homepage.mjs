/**
 * 首页整页截图（无头 Chrome + CDP `Page.captureScreenshot`）—— 供人工目视核对版式。
 *
 * 用法：node docs/evidence/_shot_homepage.mjs [BASE_URL] [OUT_PNG]
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const HERE = import.meta.dirname;
const BASE = process.argv[2] || 'http://127.0.0.1:4002';
const OUT = process.argv[3] || path.join(HERE, '_shot_homepage.png');

const BROWSER = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find((p) => { try { return fs.existsSync(p); } catch { return false; } });

const isPortFree = (p) => new Promise((res) => {
  const s = net.createServer();
  s.once('error', () => res(false));
  s.listen(p, '127.0.0.1', () => s.close(() => res(true)));
});
let PORT = null;
for (let i = 0; i < 60 && !PORT; i += 1) {
  const p = 21000 + Math.floor(Math.random() * 8000);
  if (await isPortFree(p)) PORT = p;
}
const UDD = path.join(os.tmpdir(), 'homeshot-' + Date.now());
fs.mkdirSync(UDD, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(BROWSER, ['--headless=new', '--disable-gpu', '--no-proxy-server', '--no-first-run',
  '--disable-extensions', '--user-data-dir=' + UDD, '--remote-debugging-port=' + PORT,
  '--window-size=1600,1200', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });

const cleanup = () => {
  try { execSync('taskkill /F /T /PID ' + child.pid, { stdio: 'ignore' }); } catch { }
  try { fs.rmSync(UDD, { recursive: true, force: true }); } catch { }
  setTimeout(() => process.exit(0), 200);
};

(async () => {
  if (!BROWSER) { console.error('未找到浏览器'); return cleanup(); }
  let list = null;
  for (let i = 0; i < 80; i++) {
    try { list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json(); if (list.some((t) => t.type === 'page')) break; } catch { }
    await sleep(250);
  }
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
  await new Promise((r) => { ws.onopen = r; });
  await send('Runtime.enable');
  await send('Page.enable');

  await send('Page.navigate', { url: BASE + '/' });
  // 等数据补齐（无骨架屏 + 梯队行已出）
  for (let i = 0; i < 200; i += 1) {
    await sleep(400);
    const r = await send('Runtime.evaluate', {
      expression: `document.querySelectorAll('[data-slot="skeleton"]').length === 0 && document.querySelectorAll('[data-ladder-group]').length > 0`,
      returnByValue: true,
    });
    if (r && r.result && r.result.value === true) break;
  }
  await sleep(1200);

  // 可选：第 5 个参数传 CSS 选择器时，先点击它再截图（例：展开梯队的折叠按钮）。
  const CLICK = process.argv[5] || '';
  if (CLICK) {
    const clicked = await send('Runtime.evaluate', {
      expression: `(function(){var e=document.querySelector(${JSON.stringify(CLICK)}); if(!e) return false; e.click(); return true;})()`,
      returnByValue: true,
    });
    console.log('click', CLICK, '=>', clicked && clicked.result ? clicked.result.value : '?');
    await sleep(800);
  }

  // 可选：第 4 个参数传 CSS 选择器时，只截该元素（用于局部目视核对）。
  const SEL = process.argv[4] || '';
  const metrics = await send('Page.getLayoutMetrics');
  const h = Math.ceil(metrics.cssContentSize.height);
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: Math.min(h, 12000), deviceScaleFactor: 1, mobile: false });
  await sleep(600);

  let clip;
  if (SEL) {
    const r = await send('Runtime.evaluate', {
      expression: `(function(){var e=document.querySelector(${JSON.stringify(SEL)}); if(!e) return ''; var b=e.getBoundingClientRect(); return JSON.stringify({x:b.left+window.scrollX,y:b.top+window.scrollY,width:b.width,height:b.height});})()`,
      returnByValue: true,
    });
    if (r && r.result && r.result.value) clip = { ...JSON.parse(r.result.value), scale: 1 };
  }
  const shot = await send('Page.captureScreenshot', clip
    ? { format: 'png', captureBeyondViewport: true, clip }
    : { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  console.log('saved', OUT, fs.statSync(OUT).size, 'bytes, contentHeight=', h, clip ? 'clip=' + JSON.stringify(clip) : '');
  cleanup();
})();
