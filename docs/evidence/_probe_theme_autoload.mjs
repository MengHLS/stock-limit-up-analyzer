/**
 * 主题自动加载探针 —— `ThemeContext.tsx` + `client/index.html` 内联防闪白脚本
 *
 * 需求（用户原话）：「每次打开要判断本地设备黑暗模式状态然后加载对应模式」。
 * 设计语义（见 ThemeContext.tsx 头注释）：
 *   1. localStorage["theme"] = "light" | "dark"  → 用户显式选择，**优先**；
 *   2. localStorage 无记录（或为 "system"）      → **跟随设备** prefers-color-scheme；
 *   3. matchMedia 不可用                          → 兜底 defaultTheme。
 *
 * 本探针用 CDP `Emulation.setEmulatedMedia` 伪造系统配色，覆盖四种组合 + 一次「运行时切换
 * 系统配色」的实时响应，并同时读**两处**结果：
 *   - DOM 侧：`documentElement.classList.contains("dark")`（内联脚本 + applyThemeClass 的产物）
 *   - React 侧：切换按钮 `[data-theme-toggle]` 的 `data-theme`（ThemeProvider 解析出的 theme）
 *
 * 用法（项目根执行）：node docs/evidence/_probe_theme_autoload.mjs [BASE_URL]
 * ⚠️ 输出同步落盘（同名 .out.txt）—— console.log 走异步 pipe，被 SIGTERM 杀掉会丢结果。
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HERE = import.meta.dirname;
const OUT = path.join(HERE, '_probe_theme_autoload.out.txt');
const BASE = process.argv[2] || 'http://127.0.0.1:3000';

const BROWSER = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => { try { return fs.existsSync(p); } catch { return false; } });

const PORT = 20000 + Math.floor(Math.random() * 20000);
const UDD = path.join(os.tmpdir(), 'themehl-' + Date.now());
fs.mkdirSync(UDD, { recursive: true });
fs.writeFileSync(OUT, '');

const log = (...a) => { const s = a.join(' '); fs.appendFileSync(OUT, s + '\n'); console.log(s); };
const logErr = (...a) => { const s = '! ' + a.join(' '); fs.appendFileSync(OUT, s + '\n'); console.log(s); };

let child = null;
function cleanup() {
  try { if (child) execSync('taskkill /F /T /PID ' + child.pid, { stdio: 'ignore' }); } catch { }
  try { fs.rmSync(UDD, { recursive: true, force: true }); } catch { }
  setTimeout(() => process.exit(0), 300);
}
process.on('uncaughtException', e => { logErr('uncaughtException:', (e && e.stack) || String(e)); cleanup(); });
process.on('unhandledRejection', e => { logErr('unhandledRejection:', (e && e.stack) || String(e)); cleanup(); });

/**
 * 用例：[名称, 预置 localStorage["theme"]（null = 清空）, 伪造系统配色, 期望生效主题]
 */
const CASES = [
  ['无记忆 + 设备暗色  => 期望 dark', null, 'dark', 'dark'],
  ['无记忆 + 设备亮色  => 期望 light', null, 'light', 'light'],
  ['记忆=system + 设备暗色 => 期望 dark', 'system', 'dark', 'dark'],
  ['记忆=light + 设备暗色 => 期望 light（显式优先）', 'light', 'dark', 'light'],
  ['记忆=dark + 设备亮色 => 期望 dark（显式优先）', 'dark', 'light', 'dark'],
];

child = spawn(BROWSER, ['--headless=new', '--disable-gpu', '--no-proxy-server', '--no-first-run',
  '--disable-extensions', '--user-data-dir=' + UDD, '--remote-debugging-port=' + PORT,
  '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' });
child.on('error', e => { logErr('spawn error:', e.message); cleanup(); });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJson = async u => (await fetch(u)).json();

/** 一次读全：DOM 类 / colorScheme / React 解析出的 theme / matchMedia 实况 */
const STATE = `JSON.stringify({
  htmlDark: document.documentElement.classList.contains('dark'),
  colorScheme: document.documentElement.style.colorScheme,
  mqlDark: window.matchMedia('(prefers-color-scheme: dark)').matches,
  lsTheme: localStorage.getItem('theme'),
  btnTheme: (document.querySelector('[data-theme-toggle]')||{}).dataset ? document.querySelector('[data-theme-toggle]').dataset.theme : null,
  btnTitle: (document.querySelector('[data-theme-toggle]')||{}).getAttribute ? document.querySelector('[data-theme-toggle]').getAttribute('title') : null
})`;

(async () => {
  if (!BROWSER) { logErr('未找到 Chrome / Edge'); return cleanup(); }
  log('== 主题自动加载探针 ==', new Date().toISOString());
  log('BASE=' + BASE, 'BROWSER=' + BROWSER.split('\\\\').pop());

  let list = null;
  for (let i = 0; i < 80; i++) {
    try { list = await getJson('http://127.0.0.1:' + PORT + '/json/list'); if (list.some(t => t.type === 'page')) break; } catch { }
    await sleep(250);
  }
  if (!list) { logErr('devtools 不可达'); return cleanup(); }

  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (m, p = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
  await new Promise(r => { ws.onopen = r; });
  await send('Runtime.enable');
  await send('Page.enable');

  const evalJs = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r && r.exceptionDetails) return undefined;
    return r && r.result ? r.result.value : undefined;
  };
  const setMedia = async value => {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] });
  };
  const snap = async () => { try { return JSON.parse(await evalJs(STATE)); } catch { return null; } };
  const waitBtn = async () => {
    for (let i = 0; i < 80; i++) {
      if (await evalJs(`!!document.querySelector('[data-theme-toggle]')`)) return true;
      await sleep(250);
    }
    return false;
  };

  // 先落一次到目标 origin，才能写 localStorage
  await setMedia('light');
  await send('Page.navigate', { url: BASE + '/' });
  await waitBtn();
  log('页面就绪，origin =', await evalJs('location.origin'));

  let pass = 0, fail = 0;

  for (const [name, seed, media, expect] of CASES) {
    await evalJs(seed === null
      ? `localStorage.removeItem('theme')`
      : `localStorage.setItem('theme', ${JSON.stringify(seed)})`);
    await setMedia(media);
    await send('Page.reload', { ignoreCache: false });
    const ok = await waitBtn();
    await sleep(400);
    const s = await snap();
    if (!s || !ok) { fail++; log('  FAIL  ' + name + '  (页面未就绪)'); continue; }
    const actual = s.htmlDark ? 'dark' : 'light';
    const reactOk = s.btnTheme === expect;
    const good = actual === expect && reactOk;
    good ? pass++ : fail++;
    log('  ' + (good ? 'PASS' : 'FAIL') + '  ' + name);
    log('        期望生效=' + expect + ' | DOM html.dark=' + s.htmlDark + '（实际 ' + actual + '）'
      + ' | 按钮 data-theme=' + s.btnTheme + (reactOk ? '' : ' ← React 侧与期望不符')
      + ' | colorScheme=' + s.colorScheme + ' | matchMedia.dark=' + s.mqlDark + ' | localStorage="' + s.lsTheme + '"');
  }

  // 运行时切换系统配色：无记忆（跟随系统）时必须**实时**跟随，无需刷新
  log('');
  log('--- 运行时切换设备配色（无记忆 + 跟随系统，应实时生效）---');
  await evalJs(`localStorage.removeItem('theme')`);
  await setMedia('light');
  await send('Page.reload', { ignoreCache: false });
  await waitBtn();
  await sleep(400);
  const before = await snap();
  await setMedia('dark');
  await sleep(800);
  const afterDark = await snap();
  await setMedia('light');
  await sleep(800);
  const afterLight = await snap();
  const liveOk = before && afterDark && afterLight
    && before.htmlDark === false && afterDark.htmlDark === true && afterLight.htmlDark === false;
  liveOk ? pass++ : fail++;
  log('  ' + (liveOk ? 'PASS' : 'FAIL') + '  light=' + (before && before.htmlDark) + ' -> 切暗色=' + (afterDark && afterDark.htmlDark)
    + ' -> 切回亮色=' + (afterLight && afterLight.htmlDark) + '（期望 false -> true -> false）');
  if (afterDark && afterDark.btnTheme !== 'dark') log('        ⚠️ 按钮 data-theme 未跟随：' + afterDark.btnTheme);

  log('');
  log('=== 汇总：PASS ' + pass + ' / FAIL ' + fail + (fail === 0 ? ' ⇒ ALL PASS' : ' ⇒ HAS FAILURE') + ' ===');
  log('结果留档：' + OUT);
  ws.close(); cleanup();
})().catch(e => { logErr('ERR', (e && e.stack) || String(e)); cleanup(); });
