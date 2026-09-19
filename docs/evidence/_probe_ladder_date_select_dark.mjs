/**
 * 首页（`/`）连板梯队「选择日期」下拉在**夜间模式**下的可读性取证探针。
 *
 * 用户反馈原话：「首页连板梯队日期选择器夜间模式文字看不清，调整一下」。
 *
 * 本探针不做「代码看起来对」的推断，用无头 Chrome + CDP 直连量真实 DOM 与**真实绘制色**：
 *   ① 亮 / 暗两套主题下，量 `[data-homepage-ladder] select` 的 computed
 *      color / backgroundColor / colorScheme / appearance / fontSize / fontWeight；
 *   ② 量 `<label>选择日期：</label>` 与 `<option>` 的同名字段；
 *   ③ **算「文字色 vs 实际绘制背景」的 WCAG 对比度**：背景取「从元素自身向上找第一个非透明
 *      background-color」；颜色字符串用 canvas 反解（本仓主题令牌是 `oklch(...)`，正则解不了）；
 *   ④ 落盘**局部截图**到 `SHOT_DIR`（**不在仓内**：`docs/evidence/` 只准 `.mts/.mjs/.log/.json/.md/.txt`，
 *      截图属二进制，故写一次性产物目录），肉眼可复核。
 *
 * ⚠️ 两个本机踩过的坑，已在代码里规避：
 *   · `about:blank` 上读 `localStorage` 会抛 SecurityError（不透明源）⇒ **必须先导航到站点再写主题**；
 *   · 只等 `select` 出现不够（选项由 query 异步补齐）⇒ 必须等 `select.options.length > 0`。
 *
 * 用法（项目根执行；BASE 只认启动日志里的端口）：
 *   node docs/evidence/_probe_ladder_date_select_dark.mjs [BASE_URL]
 *
 * ⚠️ 输出**同步落盘**到同名 `.out.txt`（进程被 SIGTERM 时未 flush 的 console 会全丢）。
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const HERE = import.meta.dirname;
const OUT = path.join(HERE, '_probe_ladder_date_select_dark.out.txt');
/**
 * 截图落点：沿用本仓既有约定 —— 目录内 `_shot_*.png` 是**目视附件**（`.gitignore` 的 `_*.png`
 * 规则已把这类验收截图排除在库外，只登记在 `docs/evidence/README.md`）。
 * 可用 `LADDER_SELECT_SHOT_DIR` 覆盖到仓外。
 */
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
async function pickPort() {
  for (let i = 0; i < 60; i++) {
    const p = 21000 + Math.floor(Math.random() * 8000);
    if (await isPortFree(p)) return p;
  }
  return null;
}
const PORT = await pickPort();
if (!PORT) { console.error('未找到空闲调试端口'); process.exit(1); }

const UDD = path.join(os.tmpdir(), 'seldark-' + Date.now());
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
process.on('uncaughtException', (e) => { logErr('uncaughtException:', (e && e.stack) || String(e)); cleanup(); });
process.on('unhandledRejection', (e) => { logErr('unhandledRejection:', (e && e.stack) || String(e)); cleanup(); });

child = spawn(BROWSER, ['--headless=new', '--disable-gpu', '--no-proxy-server', '--no-first-run',
  '--disable-extensions', '--user-data-dir=' + UDD, '--remote-debugging-port=' + PORT,
  '--window-size=1600,1200', 'about:blank'], { stdio: 'ignore' });
child.on('error', (e) => { logErr('spawn error:', e.message); cleanup(); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (!BROWSER) { logErr('未找到 Chrome / Edge 可执行文件'); return cleanup(); }
  log('== 连板梯队「选择日期」夜间可读性取证 ==', new Date().toISOString());
  log('BASE=' + BASE, 'BROWSER=' + BROWSER, 'PORT=' + PORT);

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
  await send('Runtime.enable');
  await send('Page.enable');
  log('CDP 已连接');

  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: false });
    if (r && r.exceptionDetails) { logErr('eval 异常:', (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text); return undefined; }
    return r && r.result ? r.result.value : undefined;
  };
  const jsonEval = async (expr) => { const v = await evalJs(expr); try { return JSON.parse(v); } catch { return null; } };

  /** 主题写进 localStorage 后整页 reload，并等到**选项已补齐**（否则量到的是空 select）。 */
  const loadWithTheme = async (theme) => {
    await evalJs(`localStorage.setItem('theme', ${JSON.stringify(theme)})`);
    await send('Page.reload', { ignoreCache: false });
    for (let i = 0; i < 240; i += 1) {
      await sleep(250);
      const ok = await evalJs(`(function(){ var s = document.querySelector('[data-homepage-ladder] select'); return !!s && s.options.length > 0; })()`);
      if (ok) { await sleep(800); return true; }
    }
    return false;
  };

  /**
   * 量「文字色 vs 真正绘制背景」的对比度。
   *  · 原生 select 背景由 UA 侧绘制，computed 常为 `rgba(0,0,0,0)` ⇒ 从元素自身向上找第一个非透明背景色当底色；
   *  · 本仓主题令牌是 `oklch(...)`、`rgb(...)`、`rgba(...)` 混用 ⇒ 用 canvas 反解成真实 sRGB 字节。
   */
  const MEASURE = `(function(){
    var cv = document.createElement('canvas'); cv.width = 1; cv.height = 1;
    var cx = cv.getContext('2d', { willReadFrequently: true });
    function px(str){
      cx.clearRect(0, 0, 1, 1);
      cx.fillStyle = '#000';
      cx.fillStyle = str;
      if (/^(transparent|rgba\\(0,\\s*0,\\s*0,\\s*0\\))$/.test(String(str))) return { r: 0, g: 0, b: 0, a: 0 };
      cx.fillRect(0, 0, 1, 1);
      var d = cx.getImageData(0, 0, 1, 1).data;
      return { r: d[0], g: d[1], b: d[2], a: Number((d[3] / 255).toFixed(3)) };
    }
    function backdrop(el){
      var node = el;
      while (node && node.nodeType === 1) {
        var raw = getComputedStyle(node).backgroundColor;
        var c = px(raw);
        if (c && c.a > 0.01) {
          var slot = node.getAttribute && node.getAttribute('data-slot');
          return { raw: raw, rgba: c, from: node.tagName.toLowerCase() + (slot ? '[data-slot=' + slot + ']' : '') };
        }
        node = node.parentElement;
      }
      return { raw: getComputedStyle(document.body).backgroundColor, rgba: px(getComputedStyle(document.body).backgroundColor), from: 'body' };
    }
    function rel(c){ var f = function(v){ v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); }
    function contrast(fg, bg){
      var l1 = rel(fg), l2 = rel(bg), hi = Math.max(l1, l2), lo = Math.min(l1, l2);
      return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2));
    }
    function snap(el){
      if (!el) return null;
      var cs = getComputedStyle(el);
      var bd = backdrop(el);
      var fg = px(cs.color);
      return {
        text: (el.textContent || '').trim().slice(0, 20),
        tag: el.tagName,
        color: cs.color, colorRgba: fg,
        backgroundColor: cs.backgroundColor,
        colorScheme: cs.colorScheme,
        appearance: cs.appearance,
        fontSize: cs.fontSize, fontWeight: cs.fontWeight, opacity: cs.opacity,
        borderColor: cs.borderTopColor,
        backdrop: bd.raw, backdropRgba: bd.rgba, backdropFrom: bd.from,
        contrast: bd.rgba.a > 0.01 ? contrast(fg, bd.rgba) : null
      };
    }
    var sel = document.querySelector('[data-homepage-ladder] select');
    if (!sel) return null;
    var label = sel.parentElement ? sel.parentElement.querySelector('label') : null;
    var box = sel.getBoundingClientRect();
    var labBox = label ? label.getBoundingClientRect() : null;
    var opts = Array.from(sel.querySelectorAll('option'));
    return JSON.stringify({
      htmlClass: document.documentElement.className,
      htmlColorScheme: getComputedStyle(document.documentElement).colorScheme,
      htmlInlineColorScheme: document.documentElement.style.colorScheme,
      storedTheme: (function(){ try { return localStorage.getItem('theme'); } catch(e){ return 'n/a'; } })(),
      optionCount: opts.length,
      select: snap(sel),
      label: snap(label),
      option0: snap(opts[0]), option1: snap(opts[1]),
      selectText: sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : '',
      clip: {
        x: Math.max(0, Math.round((labBox ? labBox.left : box.left) - 12)),
        y: Math.max(0, Math.round((labBox ? labBox.top : box.top) + window.scrollY - 18)),
        w: Math.round(box.right - (labBox ? labBox.left : box.left) + 48),
        h: Math.round(Math.max(box.height, labBox ? labBox.height : 0) + 40)
      }
    });
  })()`;

  const shot = async (tag, clip) => {
    const r = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 2 }, captureBeyondViewport: true });
    if (!r || !r.data) { logErr('截图失败:' + tag); return null; }
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    const p = path.join(SHOT_DIR, `_shot_ladder_date_select.${tag}.png`);
    fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
    log('  截图落盘：' + p + '  clip=' + JSON.stringify(clip));
    return p;
  };

  let pass = 0, fail = 0;
  const check = (name, ok, detail) => { ok ? pass++ : fail++; log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + name + (detail === undefined ? '' : '  → ' + detail)); };

  /** 文字色对「纯白弹层」的 WCAG 对比度 —— 用于量化「平台浅色弹层」下的可读性风险。 */
  const relLum = (c) => {
    const f = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const contrastVsWhite = (fg) => {
    if (!fg) return null;
    const l = relLum(fg);
    return Number(((1.05) / (l + 0.05)).toFixed(2));
  };

  // 先落地到站点（about:blank 上 localStorage 被拒），主题由 visit 决定
  await send('Page.navigate', { url: BASE + '/' });
  await sleep(1200);

  for (const theme of ['light', 'dark']) {
    log('');
    log('--- 主题 = ' + theme + ' ---');
    const ok = await loadWithTheme(theme);
    if (!ok) { logErr(theme + ' 下选择器选项未就绪'); continue; }
    const m = await jsonEval(MEASURE);
    log('  ' + JSON.stringify(m, null, 2).replace(/\n/g, '\n  '));
    if (!m) continue;
    await shot(theme, { x: m.clip.x, y: m.clip.y, width: m.clip.w, height: m.clip.h });
    log('  [判定] ' + theme + ' 选择器文字 ' + m.select.color + ' / 实际底 ' + m.select.backdrop + '（' + m.select.backdropFrom + '） ⇒ 对比度 ' + m.select.contrast);
    /**
     * 🔴 本轮缺陷的**判据**（不是「看起来还行」）：
     * 修复前 select / option 的 background-color 都是 `rgba(0,0,0,0)`（Tailwind preflight 的透明）
     * ⇒ **表面由 UA / 平台决定**：闭合控件靠 Blink 按 color-scheme 画（所以 headless 里看着正常），
     * 而 Windows 上展开的选项弹层是浏览器进程按平台主题画的独立窗口 ⇒ 一旦平台表面是浅色，
     * 而选项文字色是页面给的浅色（暗色主题下 `inherit` 到 --foreground）⇒ **浅字浅底、看不见**。
     * 让表面**不透明且由主题令牌给定**，弹层/控件就不再依赖平台默认色 —— 这才是可断言的修复点。
     */
    if (theme === 'light') {
      check('亮色下 <html> 无 .dark、color-scheme: light', !m.htmlClass.includes('dark') && /light/.test(m.htmlColorScheme), JSON.stringify({ cls: m.htmlClass, cs: m.htmlColorScheme }));
      check('亮色基线：选择器文字对比度 ≥ 4.5', (m.select.contrast || 0) >= 4.5, 'contrast=' + m.select.contrast);
    } else {
      check('暗色下 <html> 带 .dark、color-scheme: dark', m.htmlClass.includes('dark') && /dark/.test(m.htmlColorScheme), JSON.stringify({ cls: m.htmlClass, cs: m.htmlColorScheme }));
      check(
        '暗色：选择器文字对比度 ≥ 4.5（WCAG AA 正文）',
        (m.select.contrast || 0) >= 4.5,
        'contrast=' + m.select.contrast + ' · fg=' + m.select.color + ' · 底=' + m.select.backdrop + '（' + m.select.backdropFrom + '）',
      );
      check(
        '暗色：选择器**自身**有由主题令牌给的不透明底色（表面不再交给 UA / 平台决定）',
        m.select.backgroundColor !== 'rgba(0, 0, 0, 0)',
        'backgroundColor=' + m.select.backgroundColor,
      );
      if (m.option0) {
        check(
          '暗色：选项文字对比度 ≥ 4.5',
          (m.option0.contrast || 0) >= 4.5,
          'contrast=' + m.option0.contrast + ' · fg=' + m.option0.color + ' · 底=' + m.option0.backdrop + '（' + m.option0.backdropFrom + '）',
        );
        check(
          '暗色：`option` 自带不透明底 + 浅字（展开弹层不依赖平台默认色）',
          m.option0.backgroundColor !== 'rgba(0, 0, 0, 0)' && m.option0.contrast >= 4.5,
          'optionBg=' + m.option0.backgroundColor + ' · optionColor=' + m.option0.color + ' · 对比度=' + m.option0.contrast,
        );
      }
      // 反证：若选项表面透明，则「浅字 + 平台浅色弹层」时对比度只有 ~1.1 ⇒ 这正是用户报的「看不清」
      if (m.option0 && m.option0.backgroundColor === 'rgba(0, 0, 0, 0)') {
        log('  ⚠️ 缺陷证据：option 表面透明 ⇒ 若平台弹层为浅色（White #fff），文字 ' + m.option0.color + ' 的对比度仅 ' + contrastVsWhite(m.option0.colorRgba) + '（WCAG 需 ≥ 4.5）');
      }
    }
  }

  await evalJs(`localStorage.removeItem('theme')`);
  log('');
  log('=== 汇总：PASS=' + pass + ' FAIL=' + fail + ' ===');
  cleanup();
})();
