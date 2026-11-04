/**
 * 探针：首页（`/`）最下面的**「每日最高连板折线图 + 日期范围滑块」**区块 —— 用户 2026-09-20 要求。
 *
 * 需求原文：「我是要把最高连板折线图展示在首页，**包含折线图下面的日期选择滑块**，
 *           而不是现在这样加个跳转按钮」。
 *
 * 因此本探针要证明的**不是「代码接上了」**，而是用户能看到的四件事：
 *   A. 图真的画在首页最下面（卡片是 `.space-y-6` 容器的**最后一个**子元素）；
 *   B. 折线本体存在且**点数 = 可见窗口交易日数**（默认 90），Y 轴刻度在 SVG 内可见，
 *      并且遵守首页既有硬口径「不画旋转轴标题」；
 *   C. 滑块就在**图的下面**（几何判据：slider.top > chart.bottom），
 *      且**真的能拖动**（真实鼠标按住右端手柄左拖 ⇒ 可见点数变少、区间徽标日期变化）；
 *   D. 夜间可读性：卡片标题 / 副标题 / 区间徽标 / 滑块文字对比度 ≥ 4.5（本仓既有水平），
 *      折线（图形对象）对卡片底 ≥ 3；日间档位与旧实现逐值相同（`#ea580c` 等）。
 *
 * 🔴 两个必须踩住的方法论坑（本轮真踩到才补进来的）：
 *   1. **切换主题必须走 localStorage + reload，不能只摘 `<html>.dark` 类**。
 *      本区块的网格/刻度/折线取色来自 `useTheme()`（React 状态），只摘 class 会让
 *      「CSS 令牌已是亮色、图表仍是暗色调色板」⇒ 亮色基线断言被假数据打红。
 *   2. 折线 `type="monotone"` 的 `d` 是 `C`（三次贝塞尔）而不是 `L`，**不能靠数 `d` 里的顶点**
 *      判断可见点数；改数 `.recharts-line-dots circle`（每个可见点一颗圆点）。
 *
 * 用法（项目根执行，端口只认启动日志）：
 *   node docs/evidence/_probe_homepage_sentiment_chart.mjs [BASE_URL] [BROWSER_EXE]
 *
 * ⚠️ 输出**必须同步落盘**（同名 `.out.txt`），被 SIGTERM 杀掉时未 flush 的 console 会全丢。
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const HERE = import.meta.dirname;
const OUT = path.join(HERE, '_probe_homepage_sentiment_chart.out.txt');
const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const EXPECTED_DAYS = 90; // `DEFAULT_VISIBLE_TRADING_DAYS`

const CANDIDATE_BROWSERS = [
  process.argv[3],
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
    const p = 21000 + Math.floor(Math.random() * 9000);
    if (await isPortFree(p)) return p;
  }
  return null;
}
const PORT = await pickPort();
if (!PORT) { console.error('未找到空闲调试端口'); process.exit(1); }
const UDD = path.join(os.tmpdir(), 'homechart-' + Date.now());
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
  '--window-size=1440,1200', 'about:blank'], { stdio: 'ignore' });
child.on('error', (e) => { logErr('spawn error:', e.message); cleanup(); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** WCAG 对比度：文字色 vs **真实合成背景**（令牌是 oklch()/color-mix()，必须 canvas 反解）。 */
const MEASURE = `(function(){
  var cv = document.createElement('canvas'); cv.width = 1; cv.height = 1;
  var cx = cv.getContext('2d', { willReadFrequently: true });
  function px(str){
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = str;
    if (/^(transparent|rgba\\(0,\\s*0,\\s*0,\\s*0\\))$/.test(String(str))) return { r: 0, g: 0, b: 0, a: 0 };
    cx.fillRect(0, 0, 1, 1);
    var d = cx.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: Number((d[3] / 255).toFixed(4)) };
  }
  function effBg(el){
    var chain = [], node = el, from = null;
    while (node && node.nodeType === 1) {
      var raw = getComputedStyle(node).backgroundColor, c = px(raw);
      if (c.a > 0.001) {
        chain.push({ c: c, raw: raw });
        if (!from) from = node.tagName.toLowerCase() + (node.getAttribute('data-slot') ? '[' + node.getAttribute('data-slot') + ']' : '');
        if (c.a >= 0.999) break;
      }
      node = node.parentElement;
    }
    var out = { r: 255, g: 255, b: 255, a: 1 };
    for (var i = chain.length - 1; i >= 0; i--) {
      var L = chain[i].c;
      out = { r: L.r * L.a + out.r * (1 - L.a), g: L.g * L.a + out.g * (1 - L.a), b: L.b * L.a + out.b * (1 - L.a), a: 1 };
    }
    return { rgba: { r: Math.round(out.r), g: Math.round(out.g), b: Math.round(out.b), a: 1 }, from: from };
  }
  function rel(c){ var f = function(v){ v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); }
  function contrast(fg, bg){ var a = rel(fg), b = rel(bg), hi = Math.max(a, b), lo = Math.min(a, b); return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2)); }
  function hex(c){ return '#' + [c.r, c.g, c.b].map(function(v){ return ('0' + v.toString(16)).slice(-2); }).join(''); }
  function snap(el){
    if (!el) return null;
    var cs = getComputedStyle(el), bd = effBg(el), fg = px(cs.color);
    return { text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40), color: cs.color, colorHex: hex(fg),
             effBg: hex(bd.rgba), backdropFrom: bd.from, fontSize: cs.fontSize, contrast: contrast(fg, bd.rgba) };
  }
  var block = document.querySelector('[data-homepage-sentiment-chart]');
  if (!block) return JSON.stringify({ found: false, htmlClass: document.documentElement.className, bodyHasSkeleton: !!document.querySelector('[data-slot=skeleton]') });
  var parent = block.parentElement;
  var kids = Array.from(parent.children);
  var card = block.querySelector('[data-slot=card]') || block;
  var chartBox = block.querySelector('.recharts-wrapper') || block.querySelector('.recharts-responsive-container');
  var slider = block.querySelector('[aria-label="历史交易日范围选择器"]');
  var curve = block.querySelector('.recharts-line-curve');
  var dots = block.querySelectorAll('.recharts-line-dots circle');
  var bh = block.getBoundingClientRect();
  var ch = chartBox ? chartBox.getBoundingClientRect() : null;
  var sh = slider ? slider.getBoundingClientRect() : null;
  var endHandle = block.querySelector('[aria-label="调整结束日期"]');
  var handleRect = endHandle ? endHandle.getBoundingClientRect() : null;
  // 滑块内的「N 个交易日」标签：选区中央那段文字
  var sliderLabel = null, sliderLabelNode = null;
  if (slider) {
    var spans = slider.querySelectorAll('span');
    for (var i = 0; i < spans.length; i++) {
      if (/个交易日/.test(spans[i].textContent || '')) { sliderLabelNode = spans[i]; break; }
    }
    sliderLabel = sliderLabelNode ? (sliderLabelNode.textContent || '').trim() : null;
  }
  var badge = block.querySelector('[data-slot=badge]') || block.querySelector('.rounded-md.border.px-2');
  var yAxisLabels = block.querySelectorAll('.recharts-yAxis .recharts-label');
  var yTicks = block.querySelectorAll('.recharts-yAxis .recharts-cartesian-axis-tick-value tspan');
  var yTicksOutside = 0;
  var svg = block.querySelector('.recharts-surface');
  if (svg) {
    var sb = svg.getBoundingClientRect();
    Array.prototype.forEach.call(yTicks, function (t) {
      var r = t.getBoundingClientRect();
      if (r.left < sb.left - 1 || r.right > sb.right + 1 || r.top < sb.top - 1 || r.bottom > sb.bottom + 1) yTicksOutside++;
    });
  }
  return JSON.stringify({
    found: true,
    htmlClass: document.documentElement.className,
    storedTheme: (function(){ try { return localStorage.getItem('theme'); } catch(e){ return 'n/a'; } })(),
    isLastChild: kids[kids.length - 1] === block,
    childCount: kids.length,
    siblingTags: kids.map(function(k){ return k.tagName.toLowerCase() + (k.getAttribute('data-slot') ? '[' + k.getAttribute('data-slot') + ']' : ''); }),
    blockText: (block.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 90),
    title: snap(block.querySelector('[data-slot=card-title]')),
    desc: snap(block.querySelector('[data-slot=card-description]')),
    badge: badge ? { text: (badge.textContent || '').trim(), ...snap(badge) } : null,
    ticketLink: (function(){ var a = block.querySelector('[data-homepage-sentiment-entry]'); return a ? { tag: a.tagName.toLowerCase(), href: a.getAttribute('href') } : null; })(),
    card: { effBg: hex(effBg(card).rgba), from: effBg(card).from },
    dotCount: dots.length,
    curve: curve ? { stroke: getComputedStyle(curve).stroke, strokeWidth: getComputedStyle(curve).strokeWidth,
                     contrast: contrast(px(getComputedStyle(curve).stroke), effBg(card).rgba) } : null,
    yAxisRotatedLabels: yAxisLabels.length,
    yTickCount: yTicks.length,
    yTicksOutsideSvg: yTicksOutside,
    chartRect: ch ? { top: Math.round(ch.top), bottom: Math.round(ch.bottom), h: Math.round(ch.height) } : null,
    slider: slider ? {
      label: sliderLabel, labelSnap: snap(sliderLabelNode),
      surface: hex(effBg(slider).rgba), surfaceFrom: effBg(slider).from,
      top: Math.round(sh.top), bottom: Math.round(sh.bottom),
      width: Math.round(sh.width),
      left: Math.round(sh.left),
      handle: handleRect ? { cx: Math.round(handleRect.left + handleRect.width / 2), cy: Math.round(handleRect.top + handleRect.height / 2) } : null,
      belowChart: ch ? Math.round(sh.top) > Math.round(ch.bottom) : null
    } : null,
    clip: { x: Math.max(0, Math.round(bh.left - 8)), y: Math.max(0, Math.round(bh.top + window.scrollY - 8)),
            w: Math.round(Math.min(bh.width + 16, window.innerWidth)), h: Math.round(bh.height + 16) }
  });
})()`;

const TOOLTIP = `(function(){
  var cv = document.createElement('canvas'); cv.width = 1; cv.height = 1;
  var cx = cv.getContext('2d', { willReadFrequently: true });
  function px(str){ cx.clearRect(0,0,1,1); cx.fillStyle='#000'; cx.fillStyle=str; cx.fillRect(0,0,1,1);
    var d = cx.getImageData(0,0,1,1).data; return { r:d[0], g:d[1], b:d[2], a:Number((d[3]/255).toFixed(4)) }; }
  function rel(c){ var f=function(v){ v=v/255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4); }; return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b); }
  function contrast(fg,bg){ var a=rel(fg), b=rel(bg), hi=Math.max(a,b), lo=Math.min(a,b); return Number(((hi+0.05)/(lo+0.05)).toFixed(2)); }
  var block = document.querySelector('[data-homepage-sentiment-chart]');
  if (!block) return JSON.stringify({ found: false });
  var w = block.querySelector('.recharts-tooltip-wrapper');
  if (!w) return JSON.stringify({ found: false, reason: 'no wrapper' });
  var vis = getComputedStyle(w).visibility;
  var inner = w.firstElementChild;
  if (!inner) return JSON.stringify({ found: false, reason: 'no inner', visibility: vis });
  var ics = getComputedStyle(inner);
  var bg = px(ics.backgroundColor);
  var firstP = inner.querySelector('p');
  var fg = firstP ? px(getComputedStyle(firstP).color) : null;
  return JSON.stringify({
    found: true, visibility: vis,
    text: (inner.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80),
    bg: ics.backgroundColor, opacity: ics.opacity,
    bgOpaque: bg.a >= 0.999,
    contrast: fg ? contrast(fg, bg.a >= 0.999 ? bg : { r:255,g:255,b:255,a:1 }) : null
  });
})()`;

(async () => {
  if (!BROWSER) { logErr('未找到 Chrome / Edge 可执行文件'); return cleanup(); }
  log('== 首页底部「最高连板折线图 + 日期范围滑块」· 真实浏览器探针 ==', new Date().toISOString());
  log('BASE=' + BASE, 'BROWSER=' + path.basename(BROWSER), 'PORT=' + PORT);

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
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.error ? { __cdpError: m.error } : m.result); pending.delete(m.id); }
  };
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
  const HAS = (sel) => `!!document.querySelector(${JSON.stringify(sel)})`;
  const COUNT = (sel) => `document.querySelectorAll(${JSON.stringify(sel)}).length`;

  /** 截图：`clip` 是 **document 坐标**，字段名必须是 `width` / `height`。 */
  const shot = async (tag, clip) => {
    try {
      if (!clip) { logErr('截图失败:' + tag + ' → 无 clip'); return null; }
      const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h, scale: 1 } });
      if (!r || !r.data) { logErr('截图失败:' + tag + ' → ' + JSON.stringify(r ?? null).slice(0, 300)); return null; }
      const p = path.join(HERE, `_shot_home_sentiment_chart.${tag}.png`);
      fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
      log('  截图落盘：' + p + '  clip=' + JSON.stringify({ x: clip.x, y: clip.y, w: clip.w, h: clip.h }));
      return p;
    } catch (e) { logErr('截图异常(' + tag + ')：' + ((e && e.stack) || String(e))); return null; }
  };

  let pass = 0, fail = 0, skip = 0;
  const check = (name, ok, detail) => { ok ? pass++ : fail++; log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + name + (detail === undefined ? '' : '  → ' + detail)); };
  const info = (name, detail) => { log('  INFO  ' + name + '  → ' + detail); };

  /** 等某个选择器出现，返回耗时。 */
  const waitFor = async (sel, timeoutMs) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      await sleep(200);
      if (await evalJs(HAS(sel))) return Date.now() - t0;
    }
    return null;
  };

  /**
   * 把元素滚进视口中央，并**迭代收敛**后再用。
   *
   * 🔴 为什么不能只用一次 `scrollIntoView({block:'center'})`（本轮真踩）：
   *   首页各区块是**逐块**补齐的（骨架屏 → 真内容），页面高度在滚动动画期间还在变长 ⇒
   *   动画按旧的滚动位置停下，目标元素反而被推到视口外（实测命中点 `elementFromPoint` 返回 `null`、
   *   坐标 1296 > 视口高 1200）。改为「量文档坐标 → `behavior:'instant'` 直滚 → 复核是否落在视口内」，
   *   最多 6 轮收敛；`behavior:'instant'` 是为了绕开全局 `scroll-behavior: smooth`
   *   （`'auto'` 会继承 CSS 的平滑滚动，又变回动画）。
   */
  const centerOn = async (sel, label) => {
    for (let i = 1; i <= 6; i++) {
      const r = await jsonEval(`(function(){
        var e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null;
        var b = e.getBoundingClientRect();
        return JSON.stringify({ docTop: b.top + window.scrollY, h: b.height, vh: window.innerHeight });
      })()`);
      if (!r) return null;
      await evalJs(`window.scrollTo({ top: ${Math.round(r.docTop - (r.vh - r.h) / 2)}, behavior: 'instant' })`);
      await sleep(400);
      const after = await jsonEval(`(function(){
        var e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null;
        var b = e.getBoundingClientRect();
        return JSON.stringify({ top: Math.round(b.top), bottom: Math.round(b.bottom), vh: window.innerHeight });
      })()`);
      if (after && after.top >= 0 && after.bottom <= after.vh) {
        info('已把 ' + label + ' 稳定滚入视口', JSON.stringify(after) + ' 迭代=' + i);
        return after;
      }
    }
    logErr('无法把 ' + label + ' 稳定滚入视口（页面高度仍在变化？）');
    return null;
  };

  /**
   * 等**首页布局稳定**（连续 4 次采样：页面高度 / 骨架屏数 / 区块文档位置都不变，且骨架屏归零）。
   *
   * 🔴 本轮量 tooltip 失败的**真正原因**（不是「CDP 输入不可信」，这个假设已被对照实验否掉）：
   *   首页各区块是**逐块**补齐的，底部区块的文档位置在出图之后还会继续下移。
   *   实测采样：`h=3485, 区块 top=2871` 稳定了 1.2s 之后突然变成 `h=3978, top=3364`（**+493px**）。
   *   `centerOn` 当时复核过「区块在视口内」，可几百毫秒后图表已经移出鼠标所在位置 ⇒
   *   命中元素变成 `null` ⇒ recharts 收到 `mouseleave` ⇒ tooltip 不弹
   *   （`.recharts-tooltip-wrapper` 只剩空壳 + `visibility: hidden`，`activeDots=0`）。
   *   对照实验（同一坐标、同一组件、布局稳定的 `/sentiment-analysis` 且 `scrollY=0`）：
   *   **真实 CDP 移动一次就弹** ⇒ CDP 鼠标输入本身没有问题。
   * ⚠️ 只等「高度连续几次不变」不够（本次 1.2s 后照样跳），必须**连骨架屏一起看**。
   */
  const waitForStableLayout = async (sel, timeoutMs = 60_000) => {
    let prev = null, stable = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const s = await jsonEval(`(function(){
        var e = document.querySelector(${JSON.stringify(sel)});
        return JSON.stringify({ h: document.body.scrollHeight,
          skeletons: document.querySelectorAll('[data-slot=skeleton]').length,
          top: e ? Math.round(e.getBoundingClientRect().top + window.scrollY) : null });
      })()`);
      if (s && s.skeletons === 0 && s.top !== null) {
        const key = JSON.stringify(s);
        stable = key === prev ? stable + 1 : 0;
        prev = key;
        if (stable >= 3) { info('布局已稳定（连续 4 次采样一致）', key); return true; }
      } else { stable = 0; prev = null; }
      await sleep(400);
    }
    logErr('等首页布局稳定超时：' + sel);
    return false;
  };

  /**
   * 截图前**先把目标滚进视口**。
   *
   * 🔴 本轮真踩：`Page.captureScreenshot` 的 `clip` 虽是**文档坐标**，但实际只截「当前视口内」那部分；
   *   目标在视口外时 **不报错**，直接给一张纯色图（第一版 `_shot_home_sentiment_chart.dark.png` 就是全黑）。
   *   ⇒ 截图流程固定为「收敛滚动 → 重新量 clip → 截」。
   */
  const shotCentered = async (tag, sel) => {
    await waitForStableLayout(sel);
    await centerOn(sel, tag);
    const m = await jsonEval(MEASURE);
    return shot(tag, m && m.clip ? m.clip : null);
  };

  // ---------- 落地 origin 并写入主题（🔴 必须 reload 才能让 React 的 useTheme 也切档） ----------
  await send('Page.navigate', { url: BASE + '/' });
  for (let i = 0; i < 60; i++) { await sleep(300); if (await evalJs('!!document.body && document.body.children.length > 0')) break; }
  const initialTheme = await evalJs(`(function(){ try { return localStorage.getItem('theme'); } catch(e){ return null; } })()`);
  log('');
  log('--- 0. 主题准备 ---');
  info('进入页面时 localStorage.theme', String(initialTheme));
  await evalJs(`localStorage.setItem('theme', 'dark')`);

  // ---------- 夜间：首页冷启 + 出图 ----------
  log('');
  log('--- A/B/C. 夜间：首页出图、图表结构、滑块位置 ---');
  const t0 = Date.now();
  await send('Page.reload', { ignoreCache: false });
  // 「首页不被这一块堵住」：先看别的区块是否在短时间内已经在 DOM（骨架屏也算）
  let othersMs = null;
  while (Date.now() - t0 < 90_000) {
    await sleep(150);
    if (await evalJs(HAS('[data-homepage-index-card]'))) { othersMs = Date.now() - t0; break; }
  }
  const chartMs = await waitFor('[data-homepage-sentiment-chart] .recharts-line-curve', 90_000);
  info('首页首个区块（指数卡）出现耗时', othersMs + 'ms');
  info('底部折线图**画出折线**耗时（含服务端取数+计算，冷/热见下）', chartMs + 'ms');
  check('首页底部折线图真的渲染出折线', chartMs !== null, 'ms=' + chartMs);
  check('折线图不是首屏的堵点（指数卡更早出现）', othersMs !== null && chartMs !== null && othersMs < chartMs, `指数=${othersMs}ms 折线=${chartMs}ms`);

  const dark = await jsonEval(MEASURE);
  if (!dark || !dark.found) { logErr('夜间量取失败：' + JSON.stringify(dark)); return cleanup(); }
  log('  夜间量据：' + JSON.stringify({
    isLastChild: dark.isLastChild, childCount: dark.childCount, dots: dark.dotCount,
    curve: dark.curve, slider: dark.slider && { label: dark.slider.label, belowChart: dark.slider.belowChart, surface: dark.slider.surface },
    badge: dark.badge && dark.badge.text, rotated: dark.yAxisRotatedLabels,
  }));

  check('区块存在于首页', dark.found === true);
  check('区块是首页内容容器的**最后一个**子元素（= 最下面）', dark.isLastChild === true, 'siblings=' + JSON.stringify(dark.siblingTags));
  check('卡片标题 = 「每日最高连板折线图」', !!dark.title && dark.title.text.includes('每日最高连板折线图'), dark.title && dark.title.text);
  check('折线本体存在（.recharts-line-curve）', !!dark.curve, dark.curve && dark.curve.stroke);
  check(
    '默认窗口 = 最近 90 个交易日（可见点数 = 90）',
    dark.dotCount === EXPECTED_DAYS,
    'dots=' + dark.dotCount,
  );
  check('不画旋转的 Y 轴标题（首页硬口径）', dark.yAxisRotatedLabels === 0, 'count=' + dark.yAxisRotatedLabels);
  check('Y 轴刻度文字都在 SVG 内（不越界被裁）', dark.yTickCount > 0 && dark.yTicksOutsideSvg === 0, `ticks=${dark.yTickCount} outside=${dark.yTicksOutsideSvg}`);
  check('区间徽标显示日期范围', !!dark.badge && /\d{4}年\d{2}月\d{2}日 至 \d{4}年\d{2}月\d{2}日/.test(dark.badge.text), dark.badge && dark.badge.text);
  check('卡片头右侧仍有通往完整分析的文本链接', !!dark.ticketLink && dark.ticketLink.href === '/sentiment-analysis', JSON.stringify(dark.ticketLink));

  // 滑块几何：必须在图的下面
  check('日期范围滑块存在', !!dark.slider);
  if (dark.slider && dark.chartRect) {
    check(
      '滑块在折线图**下面**（几何判据：slider.top > chart.bottom）',
      dark.slider.belowChart === true,
      `chart.bottom=${dark.chartRect.bottom} slider.top=${dark.slider.top}`,
    );
    check('滑块有可见表面（不是透明）', dark.slider.surface !== '#000000' && !!dark.slider.surfaceFrom, 'surface=' + dark.slider.surface + ' from=' + dark.slider.surfaceFrom);
    check('滑块显示可见交易日数', !!dark.slider.label && /^\d+ 个交易日$/.test(dark.slider.label), dark.slider.label);
    check(
      '滑块显示的交易日数 = 主图可见点数（两处联动一致）',
      !!dark.slider.label && Number.parseInt(dark.slider.label, 10) === dark.dotCount,
      `slider=${dark.slider.label} dots=${dark.dotCount}`,
    );
  }

  // 夜间可读性
  log('');
  log('--- D. 夜间可读性（对比度 = 文字色 vs 真实合成背景）---');
  check('夜间：卡片标题对比度 ≥ 4.5', dark.title && dark.title.contrast >= 4.5, `contrast=${dark.title && dark.title.contrast} bg=${dark.card.effBg}`);
  check('夜间：卡片副标题对比度 ≥ 4.5', dark.desc && dark.desc.contrast >= 4.5, `contrast=${dark.desc && dark.desc.contrast}`);
  check('夜间：区间徽标文字对比度 ≥ 4.5', dark.badge && dark.badge.contrast >= 4.5, `contrast=${dark.badge && dark.badge.contrast} bg=${dark.badge && dark.badge.effBg}`);
  check('夜间：滑块文字对比度 ≥ 4.5', dark.slider && dark.slider.labelSnap && dark.slider.labelSnap.contrast >= 4.5, `contrast=${dark.slider && dark.slider.labelSnap && dark.slider.labelSnap.contrast}`);
  check('夜间：折线（图形对象）对卡片底对比度 ≥ 3', dark.curve && dark.curve.contrast >= 3, `stroke=${dark.curve && dark.curve.stroke} contrast=${dark.curve && dark.curve.contrast}`);

  await shotCentered('dark', '[data-homepage-sentiment-chart]');

  // ---------- 悬浮 tooltip（夜间）----------
  log('');
  log('--- D2. 悬浮数据点 ⇒ tooltip（夜间）---');
  if (dark.chartRect) {
    // ⚠️ 悬停前必须**先等布局稳定、再滚到位、最后立刻量坐标**：
    //    首页各区块是逐块补齐的，页面会在出图之后继续长高（实测 +493px），
    //    滚动完不等稳就悬停 ⇒ 命中元素漂走 ⇒ recharts 收 mouseleave ⇒ tooltip 不弹。
    await waitForStableLayout('[data-homepage-sentiment-chart]');
    await centerOn('[data-homepage-sentiment-chart]', '首页图表区块');
    // 悬停点取**真实数据点**（正中那颗圆点）而不是容器几何中点：中点可能落在轴/标签区，
    // 那种位置 recharts 不触发 tooltip（本轮先是这么写，量到 `visibility: hidden`）。
    const hoverPoint = await jsonEval(`(function(){
      var dots = document.querySelectorAll('[data-homepage-sentiment-chart] .recharts-line-dots circle');
      if (!dots.length) return null;
      var d = dots[Math.floor(dots.length / 2)].getBoundingClientRect();
      var x = Math.round(d.left + d.width / 2), y = Math.round(d.top + d.height / 2);
      var el = document.elementFromPoint(x, y);
      return JSON.stringify({ x: x, y: y, hit: el ? el.tagName.toLowerCase() : null,
        inChart: !!(el && el.closest && el.closest('.recharts-wrapper')) });
    })()`);
    if (hoverPoint) {
      info('悬浮点与命中元素', JSON.stringify(hoverPoint));
      check('悬浮点落在图表绘制区内（否则 recharts 不会弹 tooltip）', hoverPoint.inChart === true, JSON.stringify(hoverPoint));
      // 先落到旁边再落到目标点：保证确实产生一次「位移」的 mousemove
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hoverPoint.x - 4, y: hoverPoint.y });
      await sleep(150);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hoverPoint.x, y: hoverPoint.y });
      await sleep(800);
      let tip = await jsonEval(TOOLTIP);
      let tipTrigger = 'CDP 真实鼠标移动';
      if (!tip || tip.visibility === 'hidden' || tip.reason === 'no inner') {
        /**
         * 兜底：退化为**页内合成的 MouseEvent**，并把「为什么不是真鼠标」写进留档，
         * 否则这份量据看起来像是真鼠标测出来的。
         *
         * 触发条件应当**不会**发生（本轮已用 `waitForStableLayout` 消掉真正的病根：布局还在长），
         * 保留它只是为了不因偶发漂移丢掉整段量据。合成事件下被量的 DOM / CSS / 对比度
         * **仍是真实渲染结果**，只是「谁把 tooltip 叫出来」这一步不是真鼠标。
         */
        tipTrigger = '页内合成 MouseEvent（真实悬停未激活 tooltip 时的兜底；原因是布局漂移，见 waitForStableLayout 注释）';
        await evalJs(`(function(){
          var dots = document.querySelectorAll('[data-homepage-sentiment-chart] .recharts-line-dots circle');
          if (!dots.length) return false;
          var d = dots[Math.floor(dots.length / 2)];
          var r = d.getBoundingClientRect();
          d.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window,
            clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2) }));
          return true;
        })()`);
        await sleep(600);
        tip = await jsonEval(TOOLTIP);
      }
      info('tooltip 触发方式', tipTrigger);
      log('  tooltip：' + JSON.stringify(tip));
      check('悬浮后 tooltip 可见且带当日最高连板文案', !!tip && tip.found && tip.visibility !== 'hidden' && /最高连板：\d+板/.test(tip.text || ''), tip && tip.text);
      check('夜间：tooltip 表面不透明（不依赖页面底色）', !!tip && tip.bgOpaque === true, tip && tip.bg);
      check('夜间：tooltip 文字对比度 ≥ 4.5', !!tip && tip.contrast >= 4.5, 'contrast=' + (tip && tip.contrast));
    } else { skip++; log('  SKIP  tooltip 悬浮 —— 取不到图表矩形'); }
  }

  // ---------- C2. 真实鼠标拖动滑块右端手柄 ----------
  log('');
  log('--- C2. 真实鼠标拖动右端手柄（用户点名的「日期选择滑块」）---');
  // 🔴 坐标必须在**滚动到位之后**重新量一次：上面 D2 节为了悬浮已经把视口搬动过，
  //    沿用更早那份 `dark.slider.handle`（视口坐标）会按到别的位置 —— 本轮就是这样「拖了但没动」。
  await waitForStableLayout('[data-homepage-sentiment-chart]');
  await centerOn('[data-homepage-sentiment-chart] [aria-label="历史交易日范围选择器"]', '日期范围滑块');
  const pre = await jsonEval(MEASURE);
  if (pre && pre.slider && pre.slider.handle) {
    const before = { dots: pre.dotCount, label: pre.slider.label, badge: pre.badge && pre.badge.text };
    const handle = pre.slider.handle;
    const hit = await jsonEval(`(function(){
      var el = document.elementFromPoint(${handle.cx}, ${handle.cy});
      return el ? JSON.stringify({ tag: el.tagName.toLowerCase(), aria: el.getAttribute('aria-label') }) : null;
    })()`);
    info('按点命中元素', JSON.stringify(hit));
    check('按点确实落在右端手柄上（不是拖了个空）', !!hit && hit.aria === '调整结束日期', JSON.stringify(hit));
    // 左拖**滑块宽度的 3%**：滑块横跨全部交易日（约 1873 天），3% ≈ 56 个交易日
    // ⇒ 期望窗口从 90 缩到 ~34 天（不要拖太多：拖过起点会被 `resizeContinuousRange` 夹成 1 天，
    //   那样虽然也算「联动」，但展示不出「部分窗口」这个真实用法）。
    const dragTo = Math.round(handle.cx - pre.slider.width * 0.03);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handle.cx, y: handle.cy });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: handle.cx, y: handle.cy, button: 'left', buttons: 1, clickCount: 1 });
    await sleep(60);
    const steps = 6;
    for (let i = 1; i <= steps; i++) {
      const x = Math.round(handle.cx + ((dragTo - handle.cx) * i) / steps);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: handle.cy, button: 'left', buttons: 1 });
      await sleep(40);
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dragTo, y: handle.cy, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(600);
    const after = await jsonEval(MEASURE);
    const afterDots = after && after.dotCount;
    log('  拖动前：' + JSON.stringify(before));
    log('  拖动后：' + JSON.stringify({ dots: afterDots, label: after && after.slider && after.slider.label, badge: after && after.badge && after.badge.text }));
    check('拖动右端手柄后主图可见点数变少（真的联动）', typeof afterDots === 'number' && afterDots < before.dots && afterDots >= 2, `before=${before.dots} after=${afterDots}`);
    check(
      '拖动后滑块交易日数 = 新的可见点数',
      after && after.slider && Number.parseInt(after.slider.label, 10) === afterDots,
      `slider=${after && after.slider && after.slider.label} dots=${afterDots}`,
    );
    check('拖动后区间徽标右端日期左移（区间确实变了）', after && after.badge && after.badge.text !== before.badge, `before=${before.badge} after=${after && after.badge && after.badge.text}`);
    await shotCentered('dark.dragged', '[data-homepage-sentiment-chart]');
  } else {
    skip++; log('  SKIP  拖动 —— 未取到右端手柄');
  }

  // ---------- 亮色基线（🔴 必须走 localStorage + reload）----------
  log('');
  log('--- E. 亮色基线（localStorage=light + reload；不能只摘 <html>.dark）---');
  await evalJs(`localStorage.setItem('theme', 'light')`);
  await send('Page.reload', { ignoreCache: false });
  const lightMs = await waitFor('[data-homepage-sentiment-chart] .recharts-line-curve', 90_000);
  info('亮色下再次出图耗时（服务端结果缓存应命中）', lightMs + 'ms');
  const light = await jsonEval(MEASURE);
  if (light && light.found) {
    log('  亮色量据：' + JSON.stringify({ theme: light.storedTheme, curve: light.curve, title: light.title, slider: light.slider && light.slider.label }));
    const isDayOrange = !!light.curve && light.curve.stroke.replace(/\s+/g, "") === "rgb(234,88,12)";
    check(
      '亮色主题真的生效（html 无 .dark 且折线回到日间档 #ea580c = rgb(234,88,12)）',
      !String(light.htmlClass).includes('dark') && isDayOrange,
      `class=${JSON.stringify(light.htmlClass)} stroke=${light.curve && light.curve.stroke}`,
    );
    check('亮色：卡片标题对比度 ≥ 4.5', light.title && light.title.contrast >= 4.5, 'contrast=' + (light.title && light.title.contrast));
    check('亮色：卡片副标题对比度 ≥ 4.5', light.desc && light.desc.contrast >= 4.5, 'contrast=' + (light.desc && light.desc.contrast));
    check('亮色：滑块文字对比度 ≥ 4.5', light.slider && light.slider.labelSnap && light.slider.labelSnap.contrast >= 4.5, 'contrast=' + (light.slider && light.slider.labelSnap && light.slider.labelSnap.contrast));
    check('亮色：折线（图形对象）对卡片底对比度 ≥ 3', light.curve && light.curve.contrast >= 3, 'contrast=' + (light.curve && light.curve.contrast));
    check('亮色下可见点数仍是默认窗口 90', light.dotCount === EXPECTED_DAYS, 'dots=' + light.dotCount);
    await shotCentered('light', '[data-homepage-sentiment-chart]');
  } else {
    logErr('亮色量取失败：' + JSON.stringify(light));
  }

  // 还原为夜间（避免污染后续人工查看）
  await evalJs(`localStorage.setItem('theme', 'dark')`);

  log('');
  log(`=== 汇总：PASS ${pass} / FAIL ${fail} / SKIP ${skip} ===`);
  cleanup();
})();
