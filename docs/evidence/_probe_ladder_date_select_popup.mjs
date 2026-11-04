/**
 * 连板梯队「选择日期」下拉 —— **展开弹层** 的夜间可读性取证。
 *
 * 背景：闭合态用 computed style 量出来是「浅字 + 深卡片底」（对比度 12.8），肉眼截图也正常；
 * 但原生 `<select>` 的**选项弹层**在 Chromium 里由浏览器进程按 `color-scheme` / 平台主题绘制，
 * 与页面 CSS 可能不一致 —— 这正是「闭合看得见、一展开就白底白字」的经典成因。
 *
 * 本探针做两件事：
 *   ① 用**真实鼠标事件**（`Input.dispatchMouseEvent`）点开下拉，再整页截图，看弹层实际画成什么样；
 *   ② 量 `option` 自身的 computed background-color / color —— 这是页面**唯一能控制弹层配色**的抓手
 *      （显式给 option 设色时 Chromium 会照办）。
 *
 * 用法：`node docs/evidence/_probe_ladder_date_select_popup.mjs [BASE_URL]`
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const HERE = import.meta.dirname;
const OUT = path.join(HERE, '_probe_ladder_date_select_popup.out.txt');
/** 截图落点：沿用本仓既有约定 —— `_shot_*.png` 是目视附件，由 `.gitignore` 的 `_*.png` 规则排除在库外。 */
const SHOT_DIR = process.env.LADDER_SELECT_SHOT_DIR || HERE;
const BASE = process.argv[2] || 'http://127.0.0.1:3000';

const CANDIDATE_BROWSERS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const BROWSER = CANDIDATE_BROWSERS.find((p) => { try { return fs.existsSync(p); } catch { return false; } });

const isPortFree = (p) => new Promise((res) => {
  const s = net.createServer();
  s.once('error', () => res(false));
  s.listen(p, '127.0.0.1', () => s.close(() => res(true)));
});
async function pickPort() { for (let i = 0; i < 60; i++) { const p = 21000 + Math.floor(Math.random() * 8000); if (await isPortFree(p)) return p; } return null; }
const PORT = await pickPort();
if (!PORT) { console.error('未找到空闲调试端口'); process.exit(1); }

const UDD = path.join(os.tmpdir(), 'selpop-' + Date.now());
fs.mkdirSync(UDD, { recursive: true });
fs.writeFileSync(OUT, '');
const log = (...a) => { const s = a.join(' '); fs.appendFileSync(OUT, s + '\n'); console.log(s); };
const logErr = (...a) => { const s = '! ' + a.join(' '); fs.appendFileSync(OUT, s + '\n'); console.log(s); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let child = null;
function cleanup() {
  try { if (child) execSync('taskkill /F /T /PID ' + child.pid, { stdio: 'ignore' }); } catch { }
  try { fs.rmSync(UDD, { recursive: true, force: true }); } catch { }
  setTimeout(() => process.exit(0), 300);
}
process.on('uncaughtException', (e) => { logErr('uncaughtException:', (e && e.stack) || String(e)); cleanup(); });
process.on('unhandledRejection', (e) => { logErr('unhandledRejection:', (e && e.stack) || String(e)); cleanup(); });

child = spawn(BROWSER, ['--headless=new', '--disable-gpu', '--no-proxy-server', '--no-first-run',
  '--disable-extensions', '--user-data-dir=' + UDD, '--remote-debugging-port=' + PORT,
  '--window-size=1600,1200', 'about:blank'], { stdio: 'ignore' });
child.on('error', (e) => { logErr('spawn error:', e.message); cleanup(); });

(async () => {
  if (!BROWSER) { logErr('未找到 Chrome / Edge'); return cleanup(); }
  log('== 下拉弹层夜间可读性取证 ==', new Date().toISOString(), 'BASE=' + BASE);

  let list = null;
  for (let i = 0; i < 80; i++) {
    try { list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json(); if (list.some((t) => t.type === 'page')) break; } catch { }
    await sleep(250);
  }
  if (!list) { logErr('devtools 不可达'); return cleanup(); }
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
  await new Promise((r) => { ws.onopen = r; });
  await send('Runtime.enable'); await send('Page.enable');
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: false });
    if (r && r.exceptionDetails) { logErr('eval 异常:', (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text); return undefined; }
    return r && r.result ? r.result.value : undefined;
  };
  const jsonEval = async (expr) => { const v = await evalJs(expr); try { return JSON.parse(v); } catch { return null; } };
  const shot = async (tag, clip) => {
    const p = { format: 'png' };
    if (clip) { p.clip = { ...clip, scale: 1 }; p.captureBeyondViewport = true; }
    const r = await send('Page.captureScreenshot', p);
    if (!r || !r.data) { logErr('截图失败:' + tag); return; }
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    const f = path.join(SHOT_DIR, `_shot_ladder_date_select_popup.${tag}.png`);
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    log('  截图：' + f);
  };

  await send('Page.navigate', { url: BASE + '/' });
  await sleep(1500);

  for (const theme of ['light', 'dark']) {
    log('');
    log('--- 主题 = ' + theme + ' ---');
    await evalJs(`localStorage.setItem('theme', ${JSON.stringify(theme)})`);
    await send('Page.reload', { ignoreCache: false });
    let ready = false;
    for (let i = 0; i < 240; i += 1) {
      await sleep(250);
      ready = await evalJs(`(function(){var s=document.querySelector('[data-homepage-ladder] select');return !!s && s.options.length>0;})()`);
      if (ready) break;
    }
    if (!ready) { logErr(theme + '：选项未就绪'); continue; }
    await sleep(600);

    // option 的 computed 色（页面唯一能控制弹层配色的抓手）
    const optStyle = await jsonEval(`(function(){
      var s = document.querySelector('[data-homepage-ladder] select');
      var o0 = s.options[0], o1 = s.options[1];
      function st(o){ var cs = getComputedStyle(o); return { color: cs.color, background: cs.backgroundColor, cs: cs.colorScheme }; }
      return JSON.stringify({ optionCount: s.options.length, o0: st(o0), o1: st(o1), selectColor: getComputedStyle(s).color, selectBg: getComputedStyle(s).backgroundColor });
    })()`);
    log('  option 计算样式：' + JSON.stringify(optStyle));

    // 视口内定位：滚动到选择器，再用真实鼠标点开
    const geo = await jsonEval(`(function(){
      var s = document.querySelector('[data-homepage-ladder] select');
      s.scrollIntoView({ block: 'center' });
      var r = s.getBoundingClientRect();
      return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) });
    })()`);
    await sleep(500);
    const geo2 = await jsonEval(`(function(){
      var s = document.querySelector('[data-homepage-ladder] select');
      var r = s.getBoundingClientRect();
      return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) });
    })()`);
    log('  选择器视口位置：' + JSON.stringify(geo2) + '（滚动前 ' + JSON.stringify(geo) + '）');

    // 闭合态：整卡片截图
    const cardClip = await jsonEval(`(function(){
      var c = document.querySelector('[data-homepage-ladder]');
      var r = c.getBoundingClientRect();
      return JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top + window.scrollY), width: Math.round(r.width), height: Math.min(420, Math.round(r.height)) });
    })()`);
    if (cardClip) await shot(theme + '.closed', cardClip);

    // 真实鼠标点开下拉
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, x: geo2.x, y: geo2.y, button: 'left', clickCount: 1, buttons: 1 });
    }
    await sleep(1000);
    const openState = await jsonEval(`(function(){ var s = document.querySelector('[data-homepage-ladder] select'); return JSON.stringify({ matchesOpen: s.matches(':open'), activeTag: document.activeElement ? document.activeElement.tagName : null }); })()`);
    log('  点开后：' + JSON.stringify(openState));
    await shot(theme + '.open');
    // 关掉弹层（Esc），避免影响下一个主题
    await send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 27, key: 'Escape' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 27, key: 'Escape' });
    await sleep(400);
  }

  await evalJs(`localStorage.removeItem('theme')`);
  log('');
  log('完成。');
  cleanup();
})();
