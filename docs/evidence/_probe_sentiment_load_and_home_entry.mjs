/**
 * 探针：① `/sentiment-analysis` 的**真实加载耗时与渲染**；② 首页最下面新增的
 * 「情绪分析」入口条目（用户 2026-09-20 要求）是否真的渲染、可点、夜间可读。
 *
 * 为什么必须用真实浏览器量：本轮改的是「服务端结果缓存 + 单飞 + 热点重写」，
 * 判据是**用户看到的时间**（骨架屏/转圈何时消失、内容何时出现），而不是服务端自报的耗时；
 * 首页入口则是「接线完成 ≠ 用户够得到」的典型 —— 必须量 DOM + 真鼠标点击后 URL 是否跳转。
 *
 * 判据：
 *   A. /sentiment-analysis：点开后 30s 内出图（`[data-sentiment-chart]`），且四张统计卡
 *      「当前最高连板 / 历史最高连板 / 统计交易日 / 当前市场周期」齐全，页面无错。
 *   B. 服务端两次挂载的耗时差：第二次（同 nonce）必须**显著更快**（结果缓存生效）。
 *   C. 首页底部区块（`[data-homepage-sentiment-chart]`）：存在、是所在容器**最后一个**子元素、
 *      区块内**确实有折线**（`.recharts-line-curve`）与**日期范围滑块**
 *      （`[aria-label="历史交易日范围选择器"]`），并保留通往 `/sentiment-analysis` 的文本链接
 *      （`[data-homepage-sentiment-entry]`）。
 *      ⚠️ 2026-09-20 第二轮修订：用户澄清要的是「折线图本体 + 图下的日期滑块」，不是跳转按钮 ⇒
 *      原来量「窄条是最后一个子元素」的判据已作废，改成量图表区块；图/滑块的深挖断言
 *      （点数=90、滑块在图下面、真拖动联动、夜间对比度）在 `_probe_homepage_sentiment_chart.mjs`。
 *   D. 夜间可读性：卡片标题 / 副标题对比度 ≥ 4.5（本仓暗色 `--muted-foreground` 的既有水平）；
 *      亮色基线不得低于 4.5。**亮色必须走 `localStorage + reload`** —— 本区块的图表配色由
 *      `useTheme()`（React 状态）决定，只摘 `<html>.dark` 会出现「CSS 已亮、图表仍暗」的假数据。
 *   E. 真鼠标点击区块内的链接 ⇒ 路由跳到 /sentiment-analysis（完整情绪周期 / 龙头列表入口仍可达）。
 *
 * 用法（项目根执行，端口只认启动日志）：
 *   node docs/evidence/_probe_sentiment_load_and_home_entry.mjs [BASE_URL] [BROWSER_EXE]
 *
 * ⚠️ 输出**必须同步落盘**（被 SIGTERM 杀掉时未 flush 的 console 会全丢），同名 `.out.txt` 即留档。
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const HERE = import.meta.dirname;
const OUT = path.join(HERE, '_probe_sentiment_load_and_home_entry.out.txt');
const BASE = process.argv[2] || 'http://127.0.0.1:3000';

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
/** 端口必须实测空闲：上一轮探针残留的 Chrome 会占住高位端口。 */
async function pickPort() {
  for (let i = 0; i < 60; i++) {
    const p = 21000 + Math.floor(Math.random() * 9000);
    if (await isPortFree(p)) return p;
  }
  return null;
}
const PORT = await pickPort();
if (!PORT) { console.error('未找到空闲调试端口'); process.exit(1); }
const UDD = path.join(os.tmpdir(), 'sentload-' + Date.now());
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

/** 量「文字色 vs 真实绘制背景」的 WCAG 对比度 —— 主题令牌是 oklch()/color-mix()，必须 canvas 反解。 */
const MEASURE = `(function(){
  var cv = document.createElement('canvas'); cv.width = 1; cv.height = 1;
  var cx = cv.getContext('2d', { willReadFrequently: true });
  function px(str){
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = str;
    if (/^(transparent|rgba\(0,\s*0,\s*0,\s*0\))$/.test(String(str))) return { r: 0, g: 0, b: 0, a: 0 };
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
        if (!from) from = node.tagName.toLowerCase() + (node.getAttribute('data-slot') ? '[data-slot=' + node.getAttribute('data-slot') + ']' : '');
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
    return { text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40), color: cs.color, colorHex: hex(fg),
             effBg: hex(bd.rgba), backdropFrom: bd.from, fontSize: cs.fontSize, contrast: contrast(fg, bd.rgba) };
  }
  var block = document.querySelector('[data-homepage-sentiment-chart]');
  if (!block) return JSON.stringify({ found: false, htmlClass: document.documentElement.className });
  var container = block.parentElement;
  var kids = Array.from(container.children);
  var link = block.querySelector('[data-homepage-sentiment-entry]');
  var slider = block.querySelector('[aria-label="历史交易日范围选择器"]');
  var r = block.getBoundingClientRect();
  return JSON.stringify({
    found: true,
    htmlClass: document.documentElement.className,
    storedTheme: (function(){ try { return localStorage.getItem('theme'); } catch(e){ return 'n/a'; } })(),
    isLastChild: kids[kids.length - 1] === block,
    childCount: kids.length,
    siblingTags: kids.map(function(k){ return k.tagName.toLowerCase() + (k.getAttribute('data-slot') ? '[' + k.getAttribute('data-slot') + ']' : ''); }),
    hasChart: !!block.querySelector('.recharts-line-curve'),
    dotCount: block.querySelectorAll('.recharts-line-dots circle').length,
    hasSlider: !!slider,
    sliderLabel: slider ? (slider.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 20) : null,
    link: link ? { tag: link.tagName.toLowerCase(), href: link.getAttribute('href'), text: (link.textContent || '').trim() } : null,
    text: (block.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90),
    title: snap(block.querySelector('[data-slot=card-title]')),
    desc: snap(block.querySelector('[data-slot=card-description]')),
    block: { effBg: hex(effBg(block).rgba), from: effBg(block).from },
    rect: { w: Math.round(r.width), h: Math.round(r.height) },
    clip: { x: Math.max(0, Math.round(r.left - 6)), y: Math.max(0, Math.round(r.top + window.scrollY - 6)),
            w: Math.round(Math.min(r.width + 12, window.innerWidth)), h: Math.round(Math.min(r.height + 12, 1100)) }
  });
})()`;

(async () => {
  if (!BROWSER) { logErr('未找到 Chrome / Edge 可执行文件'); return cleanup(); }
  log('== 情绪分析页加载耗时 + 首页底部入口 · 真实浏览器探针 ==', new Date().toISOString());
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
  await send('Network.enable');
  log('CDP 已连接');

  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: false });
    if (r && r.exceptionDetails) { logErr('eval 异常:', (r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text); return undefined; }
    return r && r.result ? r.result.value : undefined;
  };
  const jsonEval = async (expr) => { const v = await evalJs(expr); try { return JSON.parse(v); } catch { return null; } };
  const COUNT = (sel) => `document.querySelectorAll(${JSON.stringify(sel)}).length`;
  const HAS = (sel) => `!!document.querySelector(${JSON.stringify(sel)})`;

  /**
   * 等首页布局停稳：页面总高 + 骨架屏数 + 目标区块 doc-top **连续 4 次**一致，且骨架屏为 0。
   * 🔴 首页是渐进渲染的（首屏骨架屏 + 多个 query 各自到达）⇒ 不等它，「算 clip / 悬浮」都会落空。
   */
  const waitForStableLayout = async (sel, tries = 60) => {
    let prev = '', same = 0;
    for (let i = 0; i < tries; i++) {
      await sleep(250);
      // 这里要的是**原始字符串**做逐次比较，故用 evalJs 而非 jsonEval（后者会解析成对象）。
      const sig = await evalJs(`(function(){ try {
        var e = document.querySelector(${JSON.stringify(sel)});
        return JSON.stringify({ h: document.documentElement.scrollHeight,
          sk: document.querySelectorAll('[data-slot=skeleton], .animate-pulse').length,
          top: e ? Math.round(e.getBoundingClientRect().top + window.scrollY) : -1 });
      } catch (err) { return JSON.stringify({ err: String(err) }); } })()`);
      let sk = 1;
      try { sk = JSON.parse(sig || '{}').sk; } catch { }
      if (sig === prev && sk === 0) { same++; if (same >= 4) return sig; } else { same = 0; }
      prev = sig;
    }
    return prev;
  };

  /**
   * 把目标区块**稳定滚进视口**后截图。
   * 🔴 clip 是 **document 坐标**，但本仓禁用 `captureBeyondViewport` ⇒ 目标区必须真的在视口内，
   *    否则截到的是「未绘制的视口外区域」—— 表现是**一张纯白/纯黑的空白图**（2026-09-20 实测）。
   *    同时先把 `scroll-behavior` 临时置 `auto`，避免平滑动画让量到的坐标过期。
   */
  const shotCentered = async (tag, sel) => {
    await waitForStableLayout(sel);
    await evalJs(`(function(){ var d = document.documentElement, prev = d.style.scrollBehavior;
      d.style.scrollBehavior = 'auto';
      var e = document.querySelector(${JSON.stringify(sel)}); if (e) e.scrollIntoView({ block: 'center' });
      d.style.scrollBehavior = prev || ''; return true; })()`);
    await sleep(400);
    const clip = await jsonEval(`(function(){
      var e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null;
      var r = e.getBoundingClientRect();
      return JSON.stringify({ x: Math.max(0, Math.round(r.left - 6)), y: Math.max(0, Math.round(r.top + window.scrollY - 6)),
        w: Math.round(Math.min(r.width + 12, window.innerWidth)), h: Math.round(Math.min(r.height + 12, window.innerHeight)) });
    })()`);
    return shot(tag, clip);
  };

  /** 截图：按 **document 坐标** clip（Chrome 的 `Page.captureScreenshot.clip` 就是文档坐标）。 */
  const shot = async (tag, clip) => {
    try {
      if (!clip) { logErr('截图失败:' + tag + ' → 无 clip'); return null; }
      const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h, scale: 1 } });
      if (!r || !r.data) { logErr('截图失败:' + tag + ' → ' + JSON.stringify(r ?? null).slice(0, 300)); return null; }
      const p = path.join(HERE, `_shot_sentiment_load.${tag}.png`);
      fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
      log('  截图落盘：' + p + '  clip=' + JSON.stringify({ x: clip.x, y: clip.y, w: clip.w, h: clip.h }));
      return p;
    } catch (e) { logErr('截图异常(' + tag + ')：' + ((e && e.stack) || String(e))); return null; }
  };

  let pass = 0, fail = 0, skip = 0;
  const check = (name, ok, detail) => { ok ? pass++ : fail++; log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + name + (detail === undefined ? '' : '  → ' + detail)); };
  const info = (name, detail) => { log('  INFO  ' + name + '  → ' + detail); };

  /** 导航并等某个选择器出现；返回「从 navigate 到命中的毫秒数」。 */
  const navAndWait = async (url, sel, timeoutMs) => {
    const t0 = Date.now();
    await send('Page.navigate', { url });
    while (Date.now() - t0 < timeoutMs) {
      await sleep(200);
      if (await evalJs(HAS(sel))) return { ms: Date.now() - t0, ok: true };
    }
    return { ms: Date.now() - t0, ok: false };
  };

  // ---------- 先落地 origin，才能写主题 ----------
  // 🔴 在 about:blank（不透明源）上读写 localStorage 会抛
  //    `SecurityError: Failed to read the 'localStorage' property from 'Window'`；
  //    而首访 Vite 冷编译可能让首页外壳迟迟不出现 ⇒ **一次 18s 的等待是不够的**：
  //    2026-09-20 实测该步静默超时后，后续 A/C 两节全灭（页面仍停在 about:blank），
  //    失败形态却是「区块渲染不出来」这种看着像产品 bug 的样子。
  //    正确写法 = 等到「location.origin 真等于 BASE 且写入能回读成功」，并响亮报告失败。
  await send('Page.navigate', { url: BASE + '/' });
  let themePrepared = false;
  for (let i = 0; i < 200; i++) {
    await sleep(300);
    const landed = await evalJs(`(function(){ try {
      return String(location.origin) === ${JSON.stringify(BASE)} && !!document.body && document.body.children.length > 0;
    } catch (e) { return false; } })()`);
    if (!landed) continue;
    const wrote = await evalJs(`(function(){ try {
      localStorage.setItem('theme', 'dark'); return localStorage.getItem('theme');
    } catch (e) { return 'ERR:' + (e && e.name); } })()`);
    if (wrote === 'dark') { themePrepared = true; break; }
  }
  if (!themePrepared) {
    logErr('主题准备失败：未能在站点 origin 上写入 localStorage（页面可能仍在 about:blank / 服务未响应）⇒ 后续量据不可信，终止');
    log('=== 汇总：探针中止 ===');
    return cleanup();
  }

  // ---------- A/B：/sentiment-analysis 的加载耗时（夜间主题下量） ----------
  log('');
  log('--- A. /sentiment-analysis 首次加载（服务端结果缓存冷/热各一次）---');
  const first = await navAndWait(BASE + '/sentiment-analysis', '[data-sentiment-chart]', 60_000);
  info('第 1 次（可能命中服务端缓存）出图耗时', first.ms + 'ms');
  const chartMs1 = first.ms;

  const cards = await evalJs(COUNT('[data-sentiment-chart]'));
  check('页面渲染出「每日最高连板折线图」区块', cards === 1, 'count=' + cards);
  const bodyText = await evalJs('(document.body.innerText || "")');
  for (const label of ['当前最高连板', '历史最高连板', '统计交易日', '当前市场周期']) {
    check('统计卡片「' + label + '」在 DOM 文本里', typeof bodyText === 'string' && bodyText.includes(label));
  }

  // 第二次挂载（同 nonce ⇒ 服务端结果缓存必须命中）：用 reload 模拟「用户再次打开」
  const t1 = Date.now();
  await send('Page.reload', { ignoreCache: false });
  let chartMs2 = null;
  while (Date.now() - t1 < 60_000) {
    await sleep(150);
    if (await evalJs(HAS('[data-sentiment-chart]'))) { chartMs2 = Date.now() - t1; break; }
  }
  info('第 2 次（reload，应命中结果缓存）出图耗时', chartMs2 + 'ms');
  check('第 2 次挂载也出图', chartMs2 !== null, 'ms=' + chartMs2);
  check('第 2 次不慢于第 1 次（结果缓存生效）', chartMs2 !== null && chartMs2 <= chartMs1, `1st=${chartMs1}ms 2nd=${chartMs2}ms`);

  // 周期区块（第二条 query，较重）
  const t2 = Date.now();
  let cycleMs = null;
  while (Date.now() - t2 < 120_000) {
    await sleep(300);
    if (await evalJs(HAS('[data-sentiment-cycle]'))) { cycleMs = Date.now() - t2; break; }
  }
  check('「情绪周期与周期龙头 / 龙头列表」区块渲染', cycleMs !== null, ' 自进入该轮等待起 ' + cycleMs + 'ms');
  const errCount = await evalJs('(window.__probeErrors || 0)');
  info('页面 console error 计数', String(errCount));

  const shotClip = await jsonEval(`(function(){
    var e = document.querySelector('[data-sentiment-chart]'); if(!e) return null;
    var r = e.getBoundingClientRect();
    return JSON.stringify({ x: Math.max(0, Math.round(r.left - 6)), y: Math.max(0, Math.round(r.top + window.scrollY - 6)),
      w: Math.round(Math.min(r.width + 12, window.innerWidth)), h: Math.round(Math.min(r.height + 12, 900)) });
  })()`);
  await shot('sentiment.chart', shotClip);

  // ---------- C/D. 首页底部的「折线图 + 日期滑块」区块 ----------
  log('');
  log('--- C. 首页最下面的图表区块（图 + 图下的日期滑块）---');
  await send('Page.navigate', { url: BASE + '/' });
  const t3 = Date.now();
  let blockFound = false;
  while (Date.now() - t3 < 90_000) {
    await sleep(300);
    if (await evalJs(HAS('[data-homepage-sentiment-chart] .recharts-line-curve'))) { blockFound = true; break; }
  }
  check('首页底部区块渲染出折线（[data-homepage-sentiment-chart] + .recharts-line-curve）', blockFound);
  if (!blockFound) { log('=== 汇总：探针中止 ==='); return cleanup(); }

  const dark = await jsonEval(MEASURE);
  log('  夜间量据：' + JSON.stringify({ isLastChild: dark.isLastChild, hasChart: dark.hasChart, dots: dark.dotCount,
    hasSlider: dark.hasSlider, sliderLabel: dark.sliderLabel, link: dark.link, title: dark.title, desc: dark.desc }));
  check('区块是所在容器的**最后一个**子元素（= 页面最下面）', dark.isLastChild === true, 'siblings=' + JSON.stringify(dark.siblingTags));
  check('区块内含日期范围滑块（用户点名的「折线图下面的日期选择滑块」）', dark.hasSlider === true, 'slider=' + dark.sliderLabel);
  check('区块内含折线本体（不只是标题/跳转）', dark.hasChart === true && dark.dotCount > 0, 'dots=' + dark.dotCount);
  check('链接仍指向 /sentiment-analysis', !!dark.link && dark.link.tag === 'a' && dark.link.href === '/sentiment-analysis', JSON.stringify(dark.link));
  check('夜间：卡片标题对比度 ≥ 4.5', dark.title && dark.title.contrast >= 4.5, 'contrast=' + (dark.title && dark.title.contrast) + ' fg=' + (dark.title && dark.title.colorHex));
  check('夜间：卡片副标题对比度 ≥ 4.5', dark.desc && dark.desc.contrast >= 4.5, 'contrast=' + (dark.desc && dark.desc.contrast));
  await shotCentered('home.chart.dark', '[data-homepage-sentiment-chart]');

  log('');
  log('--- D. 亮色基线（🔴 localStorage=light + reload；只摘 <html>.dark 会让 React 仍用暗色调色板）---');
  await evalJs(`localStorage.setItem('theme', 'light')`);
  await send('Page.reload', { ignoreCache: false });
  let lightReady = false;
  for (let i = 0; i < 300; i++) { await sleep(300); if (await evalJs(HAS('[data-homepage-sentiment-chart] .recharts-line-curve'))) { lightReady = true; break; } }
  const light = lightReady ? await jsonEval(MEASURE) : null;
  if (light && light.found) {
    log('  亮色量据：' + JSON.stringify({ theme: light.storedTheme, title: light.title, desc: light.desc, dots: light.dotCount }));
    check('亮色：html 无 .dark', !String(light.htmlClass).includes('dark'), 'class=' + light.htmlClass);
    check('亮色：卡片标题对比度 ≥ 4.5', light.title && light.title.contrast >= 4.5, 'contrast=' + (light.title && light.title.contrast));
    check('亮色：卡片副标题对比度 ≥ 4.5', light.desc && light.desc.contrast >= 4.5, 'contrast=' + (light.desc && light.desc.contrast));
    await shotCentered('home.chart.light', '[data-homepage-sentiment-chart]');
  } else {
    logErr('亮色量取失败：' + JSON.stringify(light));
  }
  await evalJs(`localStorage.setItem('theme', 'dark')`);
  await send('Page.reload', { ignoreCache: false });
  for (let i = 0; i < 300; i++) { await sleep(300); if (await evalJs(HAS('[data-homepage-sentiment-chart] .recharts-line-curve'))) break; }

  // ---------- E. 真鼠标点击区块内链接 ----------
  log('');
  log('--- E. 真鼠标点击区块内链接 ⇒ 路由跳转 ---');
  const center = await jsonEval(`(function(){
    var e = document.querySelector('[data-homepage-sentiment-entry]'); if(!e) return null;
    e.scrollIntoView({ block: 'center' });
    var r = e.getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
  })()`);
  await sleep(400);
  if (center) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: center.x, y: center.y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: center.x, y: center.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: center.x, y: center.y, button: 'left', clickCount: 1 });
  }
  let landed = null;
  for (let i = 0; i < 80; i++) {
    await sleep(300);
    const href = await evalJs('location.pathname');
    if (href === '/sentiment-analysis') { landed = href; break; }
  }
  check('点击后路由跳到 /sentiment-analysis', landed === '/sentiment-analysis', 'pathname=' + landed);
  const afterClick = await navAndWait(BASE + '/sentiment-analysis', '[data-sentiment-chart]', 90_000);
  info('跳转后出图耗时', afterClick.ms + 'ms (ok=' + afterClick.ok + ')');
  check('跳转后图表仍能渲染', afterClick.ok, 'ms=' + afterClick.ms);

  log('');
  log(`=== 汇总：PASS ${pass} / FAIL ${fail} / SKIP ${skip} ===`);
  cleanup();
})();
