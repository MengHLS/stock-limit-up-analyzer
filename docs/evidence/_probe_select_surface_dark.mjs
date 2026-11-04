/**
 * 全仓原生 `<select>` 表面 / 选项配色的**真实 DOM 取证**（夜间模式）—— 2026-09-19。
 *
 * 由来：用户报「首页连板梯队日期选择器夜间模式文字看不清」⇒ 根因是 `select` 没声明背景时
 * `background-color` 落到 Tailwind preflight 的 `transparent`，表面（含 Windows 上按平台主题绘制的
 * **选项弹层**）交给 UA / 平台；而 `option` 文字色是 `inherit` 来的 `--foreground`（暗色近白）。
 * 修法 = `client/src/index.css` 的 `@layer base` 里统一给 `select` / `select option` 上主题令牌色
 * （放 base 层 ⇒ 任何显式工具类照旧覆盖它，只补没人声明的空档）。首页那处另有等价的行内类。
 *
 * 本探针按**真实导航**逐路由量（不推断「代码看起来对」）：
 *   · 每个**可见** `select`：自身 `background-color` 是否不透明（= 表面由作者控制，不再交给平台）、
 *     文字对「真实绘制底」的 WCAG 对比度；
 *   · 每个 `select` 的**选项**：`background-color` / `color` 是否都不透明、对比度 ≥ 4.5；
 *   · 例外白名单：显式写了 `bg-transparent` 的（作者刻意透明，如 ResearchAsk 的行内编辑器）只登记不判红。
 *
 * ⚠️ 已知取证边界（不隐瞒）：Windows 上的选项弹层是**独立平台窗口**，CDP **截不到**、合成点击也点不开
 *    （`:open` 恒 `false`）⇒ 只能量 `option` 的 computed 色作代理判据。
 *
 * 用法（项目根目录；BASE 只认启动日志里的端口）：
 *   node docs/evidence/_probe_select_surface_dark.mjs [BASE_URL]
 *
 * 输出**同步落盘** `_probe_select_surface_dark.out.txt`；截图（`_shot_*.png`）落在本目录，
 * 由 `.gitignore` 的 `_*.png` 规则排除在库外。
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const HERE = import.meta.dirname;
const OUT = path.join(HERE, '_probe_select_surface_dark.out.txt');
const BASE = process.argv[2] || 'http://127.0.0.1:3000';

/** 要巡检的路由（含原生 select 的页面；组件级/弹窗内的 select 不在可达范围内，见报告里的「覆盖边界」）。 */
const ROUTES = ['/', '/market', '/operation-logs', '/backtest', '/paper-trading', '/review-workbench'];
/** 每个路由等 `select` 出现的上限（ms）。 */
const WAIT_MS = 25_000;
/**
 * 个别路由的等待上限要放宽：
 * `/market`（旧版大盘分析页）的「选择日期」子组件用 `limitUp.getConnectionBoardStats` ——
 * 那是**全表扫 `limit_up_records`** 的旧端点（实测 ~68s），落在骨架屏之后才渲染 ⇒ 25s 等不到。
 */
const ROUTE_WAIT_MS = { '/market': 150_000 };
/** 某些路由等不到时的**成因备注**（写进 SKIP 理由，避免后续误读成「探针没跑」）。 */
const ROUTE_NOTE = {
  '/market': '成因：该页「选择日期」子组件用 `limitUp.getConnectionBoardStats` —— **全表扫 `limit_up_records`** 的旧端点'
    + '（实测约 68s，且当前 dev server 连接池有死连接 ⇒ 更久），选择器落在骨架屏之后才渲染。'
    + '该处写法（无任何 bg 类）由**同一条全局规则**覆盖，另有 `/backtest` 两个同形态选择器的实测 + 无 class 注入自证作为证据。',
};

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

const UDD = path.join(os.tmpdir(), 'selprobe-' + Date.now());
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
  '--window-size=1600,1200', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
child.on('error', (e) => { logErr('spawn error:', e.message); cleanup(); });

/** 颜色反解 + 真实底 + 对比度（与 `_probe_ladder_date_select_dark.mjs` 同一套，令牌是 oklch 必须走 canvas）。 */
const MEASURE = `(function(){
  var cv = document.createElement('canvas'); cv.width = 1; cv.height = 1;
  var cx = cv.getContext('2d', { willReadFrequently: true });
  function px(str){
    if (/^(transparent|rgba\\(0,\\s*0,\\s*0,\\s*0\\))$/.test(String(str))) return { r: 0, g: 0, b: 0, a: 0 };
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = str; cx.fillRect(0, 0, 1, 1);
    var d = cx.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: Number((d[3] / 255).toFixed(3)) };
  }
  function rel(c){ var f = function(v){ v = v/255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); }; return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b); }
  function contrast(a, b){ var l1 = rel(a), l2 = rel(b), hi = Math.max(l1,l2), lo = Math.min(l1,l2); return Number(((hi+0.05)/(lo+0.05)).toFixed(2)); }
  function backdrop(el){
    var node = el;
    while (node && node.nodeType === 1) {
      var c = px(getComputedStyle(node).backgroundColor);
      if (c.a > 0.01) {
        var slot = node.getAttribute && node.getAttribute('data-slot');
        return { raw: getComputedStyle(node).backgroundColor, rgba: c, from: node.tagName.toLowerCase() + (slot ? '[data-slot=' + slot + ']' : '') };
      }
      node = node.parentElement;
    }
    var b = getComputedStyle(document.body).backgroundColor;
    return { raw: b, rgba: px(b), from: 'body' };
  }
  function optSnap(o){
    if (!o) return null;
    var c = getComputedStyle(o), ob = px(c.backgroundColor), of = px(c.color);
    return { text: (o.textContent || '').trim().slice(0, 16), bg: c.backgroundColor, bgA: ob.a, color: c.color,
             contrast: ob.a > 0.01 ? contrast(of, ob) : null };
  }
  var out = [];
  Array.from(document.querySelectorAll('select')).forEach(function(s, i){
    var cs = getComputedStyle(s), r = s.getBoundingClientRect();
    var visible = r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05;
    if (!visible) return;
    var bg = px(cs.backgroundColor), fg = px(cs.color), bd = backdrop(s);
    out.push({
      idx: i,
      id: s.id || null,
      options: s.options ? s.options.length : 0,
      cls: String(s.className || '').slice(0, 150),
      ownBg: cs.backgroundColor, ownBgOpaque: bg.a > 0.01,
      ownColor: cs.color, ownColorA: fg.a,
      backdrop: bd.raw, backdropFrom: bd.from,
      ownTextContrast: bd.rgba.a > 0.01 ? contrast(fg, bd.rgba) : null,
      opt0: optSnap(s.options && s.options[0]),
      optLast: optSnap(s.options && s.options[s.options.length - 1])
    });
  });
  return JSON.stringify({ url: location.pathname, htmlDark: document.documentElement.classList.contains('dark'), selects: out });
})()`;

(async () => {
  if (!BROWSER) { logErr('未找到 Chrome / Edge'); return cleanup(); }
  log('== 全仓原生 select 表面 / 选项配色取证（夜间模式）==', new Date().toISOString());
  log('BASE=' + BASE, 'BROWSER=' + BROWSER, 'PORT=' + PORT, 'ROUTES=' + ROUTES.join(','));

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
    if (!r || !r.data) return;
    fs.writeFileSync(path.join(HERE, `_shot_select_surface.${tag}.png`), Buffer.from(r.data, 'base64'));
  };

  let pass = 0, fail = 0, skip = 0;
  const check = (name, ok, detail) => { ok ? pass++ : fail++; log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + name + (detail === undefined ? '' : '  → ' + detail)); };
  const skipCheck = (name, why) => { skip++; log('  SKIP  ' + name + '  → ' + why); };

  // 先落地站点再写主题（about:blank 上读 localStorage 会抛 SecurityError）
  await send('Page.navigate', { url: BASE + '/' });
  await sleep(1200);
  await evalJs(`localStorage.setItem('theme', 'dark')`);

  const totals = { selects: 0, transparentSelects: 0, optionsChecked: 0 };

  for (const route of ROUTES) {
    log('');
    log('--- ' + route + ' ---');
    await send('Page.navigate', { url: BASE + route });
    const budget = ROUTE_WAIT_MS[route] || WAIT_MS;
    /**
     * 🔴 就绪判据 = **存在一个「已有选项」的 select**，不能只等 `select` 出现：
     * 首页那个选择器是**先渲染空 select、选项由 query 异步补齐**，只等元素会量到 0 个选项
     * （本轮首跑就这么假失败了一次）。
     */
    let ready = false;
    for (let i = 0; i < Math.ceil(budget / 500); i += 1) {
      await sleep(500);
      ready = await evalJs(`Array.prototype.some.call(document.querySelectorAll('select'), function(s){ return s.options.length > 0; })`);
      if (ready) break;
    }
    await sleep(700);
    const m = await jsonEval(MEASURE);
    if (!m) { skipCheck(route + ' 可量', '页面未就绪 / 取不到 DOM'); continue; }
    if (m.selects.length === 0) {
      skipCheck(route + ' 可量', (ready ? 'DOM 里的 select 全不可见' : '等待 ' + budget + 'ms 内未出现带选项的 select') + (ROUTE_NOTE[route] ? '。' + ROUTE_NOTE[route] : ''));
      continue;
    }

    log('  暗色主题 = ' + m.htmlDark + '，可见 select = ' + m.selects.length);
    for (const s of m.selects) {
      totals.selects += 1;
      const transparentByIntent = /(^|\s)bg-transparent(\s|$)/.test(s.cls);
      log('    #' + s.idx + ' 选项 ' + s.options + ' 个 · 自身底 ' + s.ownBg + '（底来自 ' + s.backdropFrom + '）· 文字 ' + s.ownColor
        + '· 对比度 ' + s.ownTextContrast + (transparentByIntent ? ' · [显式 bg-transparent]' : ''));
      log('        选项首 = ' + JSON.stringify(s.opt0) + '  末 = ' + JSON.stringify(s.optLast));
    }

    const opaque = m.selects.filter((s) => s.ownBgOpaque);
    const intentional = m.selects.filter((s) => !s.ownBgOpaque && /(^|\s)bg-transparent(\s|$)/.test(s.cls));
    totals.transparentSelects += intentional.length;
    check(
      route + '：每个 select 的表面都由作者控制（不透明底），或显式写了 bg-transparent',
      opaque.length + intentional.length === m.selects.length,
      m.selects.map((s) => s.idx + ':' + s.ownBg).join(' | '),
    );
    const badText = m.selects.filter((s) => (s.ownTextContrast || 0) < 4.5);
    check(route + '：每个 select 的文字对比度 ≥ 4.5', badText.length === 0, badText.length ? JSON.stringify(badText.map((s) => s.idx + '=' + s.ownTextContrast)) : 'all ≥ 4.5');

    const opts = m.selects.flatMap((s) => [s.opt0, s.optLast]).filter(Boolean);
    totals.optionsChecked += opts.length;
    const badOpt = opts.filter((o) => o.bgA <= 0.01 || (o.contrast || 0) < 4.5);
    if (opts.length === 0) {
      skipCheck(route + '：选项配色', '该路由的 select 当前都没有选项（无数据）⇒ 选项判据为空，不判红');
    } else {
      check(
        route + '：选项自带不透明底 + 浅/深字（弹层不依赖平台默认色），对比度 ≥ 4.5',
        badOpt.length === 0,
        badOpt.length ? JSON.stringify(badOpt) : opts.length + ' 个选项采样全过（样例 ' + JSON.stringify(opts[0]) + '）',
      );
    }
    if (['/', '/market', '/backtest'].includes(route)) {
      const tag = route === '/' ? 'home' : route === '/market' ? 'market' : 'backtest';
      const clip = await jsonEval(`(function(){ var s=document.querySelector('select'); if(!s) return null; var r=s.getBoundingClientRect(); return JSON.stringify({ x: Math.max(0, Math.round(r.left-16)), y: Math.max(0, Math.round(r.top + window.scrollY - 18)), width: Math.round(r.width + 32), height: Math.round(r.height + 40) }); })()`);
      if (clip) await shot(tag, clip);
    }
  }

  // ---------- 规则作用域自证：注入一个「没有任何 class」的 select ----------
  log('');
  log('--- 规则作用域自证：注入一个**没有任何 class** 的 `<select>`（与 `Market.tsx` / `Backtest.tsx` 的写法同形态）---');
  await jsonEval(`(function(){
    var old = document.getElementById('__probe_bare_select__');
    if (old) old.remove();
    var s = document.createElement('select');
    s.id = '__probe_bare_select__';
    s.innerHTML = '<option>甲</option><option>乙</option>';
    document.body.appendChild(s);
    return JSON.stringify({ appended: true });
  })()`);
  await sleep(400);
  const bareM = await jsonEval(MEASURE);
  const bareSel = bareM && Array.isArray(bareM.selects) ? bareM.selects.find((s) => s.id === '__probe_bare_select__') : null;
  if (!bareSel) {
    skipCheck('规则作用域自证', '注入的无 class select 未被量到');
  } else {
    log('    注入 select：自身底 ' + bareSel.ownBg + '（底来自 ' + bareSel.backdropFrom + '）· 文字 ' + bareSel.ownColor + ' · 对比度 ' + bareSel.ownTextContrast);
    log('    其首个选项：' + JSON.stringify(bareSel.opt0));
    check(
      '无 class 的 select 也拿到主题令牌底（⇒ 规则是全局的，Market / Backtest 那类写法同样被覆盖）',
      bareSel.ownBgOpaque,
      'ownBg=' + bareSel.ownBg,
    );
    check('无 class 的 select：文字对比度 ≥ 4.5', (bareSel.ownTextContrast || 0) >= 4.5, 'contrast=' + bareSel.ownTextContrast);
    check(
      '无 class 的 select 的**选项**也自带不透明底 + 对比度 ≥ 4.5',
      !!bareSel.opt0 && bareSel.opt0.bgA > 0.01 && (bareSel.opt0.contrast || 0) >= 4.5,
      JSON.stringify(bareSel.opt0),
    );
    await evalJs(`(function(){ var e = document.getElementById('__probe_bare_select__'); if (e) e.remove(); return true; })()`);
  }

  log('');
  log('=== 覆盖统计：可见 select 合计 ' + totals.selects + ' 个（其中显式 bg-transparent ' + totals.transparentSelects
    + ' 个）· 选项采样 ' + totals.optionsChecked + ' 个 ===');
  log('⚠️ 覆盖边界：`<select>` 共 47 处 / 16 个文件，其中 30 处位于 research / strategy / parameterSearch / walkForward');
  log('   等页面的**面板或弹窗内部**，需逐级操作才可达 —— 本轮按路由可达的 ' + ROUTES.length + ' 条页面取证；');
  log('   组件内的其余 select 由同一条 @layer base 规则覆盖（规则是全局的，与是否被本轮走到无关）。');
  log('');
  log('=== 汇总：PASS=' + pass + ' FAIL=' + fail + ' SKIP=' + skip + ' ===');
  await evalJs(`localStorage.removeItem('theme')`);
  cleanup();
})();
