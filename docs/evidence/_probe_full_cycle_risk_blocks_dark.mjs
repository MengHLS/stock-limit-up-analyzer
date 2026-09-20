/**
 * /backtest（组合回测）→「回测总览 → 全周期五策略收益对比」折线图下方
 * 「各策略回撤与收益特征」五张策略卡片的**夜间模式可读性**探针。
 *
 * 背景（用户 2026-09-20 报「这里的黑暗模式挂了」）：
 *   五张卡片写的是 `bg-violet-50/40`（亮色未加 alpha 的浅紫底 + 40% 透明度）。
 *   `client/src/theme/darkCompatibility.css` 是**按源码实际出现的类名清单生成**的，
 *   该文件生成时源码里还没有 `/40` 这个组合（只有 `/60`、`/70`）⇒ 夜间下这条类**没有任何规则命中**
 *   ⇒ 卡片保留 `var(--color-violet-50)` 的浅紫，在近黑页面上呈现为一块 **#75747b 的中间灰**，
 *   卡片内的浅色文字（`--dk-t6` 等）随之糊成一片。
 *   修法 = 重跑生成器补齐（**不是手改生成物**）：`node scripts/generateDarkCompatibility.mjs`。
 *
 * 本探针用**真实浏览器渲染**量 DOM，判据全部是「文字色 vs **真实合成底**」的 WCAG 对比度
 * 与「卡片有效底亮度」——不是「看起来还行」。改前/改后在同一页面内 A/B：
 *   1. `dark`          ：现状（改后）
 *   2. `light`（in-page 摘掉 `<html>.dark`，不 reload）：亮色基线未被打坏
 *   3. `dark + revert` ：注入一条把 `bg-violet-50/40` 还原成亮色取值的规则 ⇒ **复现缺陷**
 *      （不 reload、不改文件，避免污染工作区；见 skill 第 9 条「A/B 别动同一份文件」）
 *
 * ⚠️ 该页数据来自 `sentiment.getLeaderCandidateResearch`（研究-legacy 全周期模拟，冷算很慢）。
 *    数据未就绪时一律记 SKIP（**不谎报 PASS**）。
 *
 * 用法（项目根执行，端口只认启动日志）：
 *   node docs/evidence/_probe_full_cycle_risk_blocks_dark.mjs [BASE_URL] [BROWSER_EXE] [DATA_WAIT_MS]
 *
 * ⚠️ 输出**必须同步落盘**：探针被超时 SIGTERM 杀掉时未 flush 的 console 会全丢。同名 `.out.txt` 即留档。
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const HERE = import.meta.dirname;
const OUT = path.join(HERE, '_probe_full_cycle_risk_blocks_dark.out.txt');
const SHOT_DIR = HERE;
const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const DATA_WAIT_MS = Number(process.argv[4] || 15 * 60 * 1000);

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
const UDD = path.join(os.tmpdir(), 'rbdark-' + Date.now());
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
  '--window-size=1600,1400', 'about:blank'], { stdio: 'ignore' });
child.on('error', (e) => { logErr('spawn error:', e.message); cleanup(); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TAB_NAV = 'nav[aria-label="回测页签导航"]';
const CARD = '[data-full-cycle-risk-card]';
const BLOCKS = '[data-full-cycle-risk-blocks]';

const Q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const HAS = (sel) => `!!${Q(sel)}`;
const COUNT = (sel) => `document.querySelectorAll(${JSON.stringify(sel)}).length`;

/**
 * 量「文字色 vs 真实绘制背景」。
 *  · 本仓主题令牌是 `oklch(...)` / `color-mix(...)` ⇒ 正则与 rgb() 都解不出来，必须用 canvas 反解真实 sRGB 字节；
 *  · 卡片自身是 `color-mix(..., 40%, transparent)`（**半透明**）⇒ 不能只看自身 backgroundColor，
 *    必须**自底向上把整条背景链合成**（卡片 40% 叠在所属卡片的 --card 上）才是人眼看到的底。
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
    return { r: d[0], g: d[1], b: d[2], a: Number((d[3] / 255).toFixed(4)) };
  }
  /** 自底向上合成：返回 { rgba, ownRaw, ownAlpha, from } —— from = 第一个非透明层是谁给的。 */
  function effBg(el){
    var chain = [], node = el, from = null;
    while (node && node.nodeType === 1) {
      var raw = getComputedStyle(node).backgroundColor;
      var c = px(raw);
      if (c.a > 0.001) {
        chain.push({ c: c, node: node, raw: raw });
        if (!from) {
          var slot = node.getAttribute && node.getAttribute('data-slot');
          from = node.tagName.toLowerCase() + (slot ? '[data-slot=' + slot + ']' : '') + (node.getAttribute && node.getAttribute('data-full-cycle-risk-card') ? '[data-full-cycle-risk-card=' + node.getAttribute('data-full-cycle-risk-card') + ']' : '');
        }
        if (c.a >= 0.999) break;
      }
      node = node.parentElement;
    }
    var out = { r: 255, g: 255, b: 255, a: 1 };
    for (var i = chain.length - 1; i >= 0; i--) {
      var L = chain[i].c;
      out = { r: L.r * L.a + out.r * (1 - L.a), g: L.g * L.a + out.g * (1 - L.a), b: L.b * L.a + out.b * (1 - L.a), a: 1 };
    }
    out = { r: Math.round(out.r), g: Math.round(out.g), b: Math.round(out.b), a: 1 };
    var own = px(getComputedStyle(el).backgroundColor);
    return { rgba: out, ownRaw: getComputedStyle(el).backgroundColor, ownAlpha: own.a, from: from,
             layers: chain.map(function(x){ return x.raw; }) };
  }
  function rel(c){ var f = function(v){ v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); }
  function contrast(fg, bg){
    var l1 = rel(fg), l2 = rel(bg), hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return Number(((hi + 0.05) / (lo + 0.05)).toFixed(2));
  }
  function snap(el){
    if (!el) return null;
    var cs = getComputedStyle(el);
    var bd = effBg(el);
    var fg = px(cs.color);
    var l = rel(bd.rgba);
    return {
      text: (el.textContent || '').trim().slice(0, 24),
      color: cs.color, colorHex: '#' + [fg.r, fg.g, fg.b].map(function(v){ return ('0' + v.toString(16)).slice(-2); }).join(''),
      backgroundColor: cs.backgroundColor, bgAlpha: bd.ownAlpha,
      effBg: '#' + [bd.rgba.r, bd.rgba.g, bd.rgba.b].map(function(v){ return ('0' + v.toString(16)).slice(-2); }).join(''),
      effBgLum: Number(l.toFixed(4)), backdropFrom: bd.from,
      fontSize: cs.fontSize, fontWeight: cs.fontWeight,
      contrast: contrast(fg, bd.rgba)
    };
  }
  var cards = Array.from(document.querySelectorAll('[data-full-cycle-risk-card]'));
  var blocks = document.querySelector('[data-full-cycle-risk-blocks]');
  var box = blocks ? blocks.getBoundingClientRect() : null;
  return JSON.stringify({
    htmlClass: document.documentElement.className,
    htmlColorScheme: getComputedStyle(document.documentElement).colorScheme,
    storedTheme: (function(){ try { return localStorage.getItem('theme'); } catch(e){ return 'n/a'; } })(),
    cardCount: cards.length,
    section: {
      title: snap(blocks ? blocks.querySelector('h3') : null),
      note: snap(blocks ? blocks.querySelector('h3 + p') : null)
    },
    cards: cards.map(function(c){
      var dds = Array.from(c.querySelectorAll('dl > div > dd'));
      var dts = Array.from(c.querySelectorAll('dl > div > dt'));
      return {
        key: c.getAttribute('data-full-cycle-risk-card'),
        card: snap(c),
        label: snap(c.querySelector('p')),
        dt0: snap(dts[0]), dd0: snap(dds[0]),
        dt1: snap(dts[1]), dd1: snap(dds[1]),
        dd3: snap(dds[3]), dd4: snap(dds[4]),
        note: snap(Array.from(c.querySelectorAll('p')).pop())
      };
    }),
    clip: box ? { x: Math.max(0, Math.round(box.left - 8)), y: Math.max(0, Math.round(box.top + window.scrollY - 10)),
                  w: Math.round(box.width + 16), h: Math.round(Math.min(box.height + 26, 1200)) } : null
  });
})()`;

/** 把 `bg-violet-50/40` 还原成「生成器还没补齐时」的亮色取值 —— 用于复现缺陷（A/B 的 A 侧）。 */
const REVERT_CSS = `
.dark .bg-violet-50\\/40 { background-color: color-mix(in oklab, var(--color-violet-50) 40%, transparent) !important; }
`;

(async () => {
  if (!BROWSER) { logErr('未找到 Chrome / Edge 可执行文件'); return cleanup(); }
  log('== /backtest 总览「各策略回撤与收益特征」五卡片 · 夜间可读性探针 ==', new Date().toISOString());
  log('BASE=' + BASE, 'BROWSER=' + BROWSER, 'PORT=' + PORT, 'DATA_WAIT=' + Math.round(DATA_WAIT_MS / 60000) + 'min');

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
    if (m.id && pending.has(m.id)) {
      // CDP 的失败响应只有 `error` 没有 `result` ⇒ 原样透出，否则调用方只能看到 undefined（本轮真踩：截图失败无从定位）。
      pending.get(m.id)(m.error ? { __cdpError: m.error } : m.result);
      pending.delete(m.id);
    }
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

  /**
   * 截图：先把区块滚进视口，再按**视口坐标**截。
   * 🔴 禁用 `captureBeyondViewport: true` —— /backtest 页面极长（回测明细可达数十万字符），
   *    整页合成实测会让 CDP 卡死数分钟不返回（本探针首版即因此截图全灭）。
   */
  const shot = async (tag) => {
    try {
      // 🔴 `clip` 必须给**页面坐标**（`rect.top + scrollY`）：Chrome 的 `Page.captureScreenshot.clip`
      //    是按 document 坐标解释的（本仓既有探针也是这么用）。给视口坐标 ⇒ 截到的是**文档顶部附近**的另一块
      //    （本轮真踩：五张卡片的截图里出现的是上方的折线图）。
      //    ⚠️ 同时 `scroll-behavior: smooth` 会让 `scrollIntoView` 变成**动画**，量到的 rect 与真正截图时的位置不一致
      //    ⇒ 先临时把 `scroll-behavior` 置为 `auto` 再滚，滚完立刻量。
      await evalJs(`(function(){
        var d = document.documentElement, prev = d.style.scrollBehavior;
        d.style.scrollBehavior = 'auto';
        var e = document.querySelector('[data-full-cycle-risk-blocks]');
        if (e) e.scrollIntoView({ block: 'center' });
        void d.offsetHeight;
        d.style.scrollBehavior = prev || '';
        return true;
      })()`);
      await sleep(600);
      const rect = await jsonEval(`(function(){
        var e = document.querySelector('[data-full-cycle-risk-blocks]'); if(!e) return null;
        var r = e.getBoundingClientRect();
        return JSON.stringify({ x: Math.max(0, Math.round(r.left - 8)), y: Math.max(0, Math.round(r.top + window.scrollY - 10)),
          w: Math.round(Math.min(r.width + 16, window.innerWidth)), h: Math.round(r.height + 26),
          scrollY: Math.round(window.scrollY), viewportH: window.innerHeight });
      })()`);
      if (!rect || rect.w < 10 || rect.h < 10) { logErr('截图失败:' + tag + ' → rect=' + JSON.stringify(rect)); return null; }
      // ⚠️ 字段名是 `width` / `height`（**不是** w/h）—— 写错会被 CDP 以
      // `Failed to deserialize params.clip.height - BINDINGS: mandatory field missing` 拒掉（本轮真踩）。
      // 不传 captureBeyondViewport：目标区已被滚进视口，走视口渲染即可（整页合成会让 CDP 卡死数分钟）。
      const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h, scale: 1 } });
      if (!r || !r.data) { logErr('截图失败:' + tag + ' → ' + JSON.stringify(r ?? null).slice(0, 400)); return null; }
      const p = path.join(SHOT_DIR, `_shot_full_cycle_risk_dark.${tag}.png`);
      fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
      log('  截图落盘：' + p + '  clip=' + JSON.stringify(rect));
      return p;
    } catch (e) {
      // 截图只是**目视附件**，不许它把「量据 + 断言」的主流程打死（本轮真踩：一次截图异常直接中止了后两段）。
      logErr('截图异常(' + tag + ')：' + ((e && e.stack) || String(e)));
      return null;
    }
  };

  let pass = 0, fail = 0, skip = 0;
  const check = (name, ok, detail) => { ok ? pass++ : fail++; log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + name + (detail === undefined ? '' : '  → ' + detail)); };
  const skipCheck = (name, why) => { skip++; log('  SKIP  ' + name + '  → ' + why); };
  /** 记录既有水平（不计入 PASS/FAIL）——用于「本轮不打算改、但要让读者看见」的量。 */
  const info = (name, detail) => { log('  INFO  ' + name + '  → ' + detail); };

  // ---------- 打开页面 ----------
  log('');
  log('--- 打开 /backtest（先落地站点，才能在 localStorage 写主题）---');
  let tabs = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    await send('Page.navigate', { url: BASE + '/backtest' });
    for (let i = 0; i < 120; i++) {
      await sleep(500);
      tabs = await evalJs(COUNT(TAB_NAV + ' button'));
      if (typeof tabs === 'number' && tabs >= 6) break;
    }
    if (tabs >= 6) break;
    log('  ... 第 ' + (attempt + 1) + ' 次页签未渲染，重试');
  }
  if (!(tabs >= 6)) { logErr('页签导航始终未渲染（dev 服务器或前端未就绪）'); log('=== 汇总：探针中止 ==='); return cleanup(); }
  await evalJs(`localStorage.setItem('theme', 'dark')`);
  await send('Page.reload', { ignoreCache: false });

  // ---------- 等数据（冷算很慢） ----------
  log('');
  log('--- 等待 /backtest 研究数据（冷算可能数十分钟）---');
  const t0 = Date.now();
  let dataReady = false;
  while (Date.now() - t0 < DATA_WAIT_MS) {
    if (await evalJs(HAS(CARD))) { dataReady = true; break; }
    const secs = Math.round((Date.now() - t0) / 1000);
    if (secs % 60 < 16) log('  ... 已等待 ' + secs + 's（仍无 ' + CARD + '）');
    await sleep(15000);
  }
  log('  数据就绪=' + dataReady + '，等待 ' + Math.round((Date.now() - t0) / 1000) + 's');
  if (!dataReady) {
    for (const n of ['A 夜间卡片底', 'B 夜间正文对比度', 'C 亮色基线', 'D 缺陷复现（A/B）']) skipCheck(n, '研究数据未就绪（' + Math.round(DATA_WAIT_MS / 60000) + 'min 内未出结果）');
    log('');
    log('=== 汇总：PASS ' + pass + ' / FAIL ' + fail + ' / SKIP ' + skip + ' ⇒ DATA NOT READY（未验证，不谎报通过）===');
    log('结果留档：' + OUT);
    ws.close(); return cleanup();
  }

  /** 断言一组卡片快照（同一套判据，用于 dark / light / dark+revert 三态）。 */
  const assertCards = (m, phase) => {
    const cards = m.cards ?? [];
    // ① 卡片自身必须有「作者给的」不透明底 —— 判据同 select 那条：表面不能交给 UA / 平台
    const transparent = cards.filter((c) => c.card.backgroundColor === 'rgba(0, 0, 0, 0)');
    check(phase + '：5 张卡片自身都有显式底色（非 transparent）', transparent.length === 0,
      transparent.length ? JSON.stringify(transparent.map((c) => c.key)) : 'cardCount=' + cards.length);
    // ② 卡片「真实合成底」必须是暗面
    const bright = cards.filter((c) => c.card.effBgLum > 0.10);
    check(phase + '：5 张卡片真实合成底均为暗面（相对亮度 ≤ 0.10）', bright.length === 0,
      '各卡 ' + JSON.stringify(cards.map((c) => c.key + '=' + c.card.effBg + '/lum' + c.card.effBgLum)));
    // ③ 卡片内灰色标签文字（dt）对比度
    const badDt = cards.filter((c) => !c.dt0 || c.dt0.contrast < 4.5);
    check(phase + '：卡片项名（灰字 dt）对比度 ≥ 4.5', badDt.length === 0,
      badDt.length ? JSON.stringify(badDt.map((c) => c.key + '=' + (c.dt0 ? c.dt0.contrast : null))) : '最低 ' + Math.min(...cards.map((c) => c.dt0.contrast)));
    // ④ 卡片内数值（dd）
    const dds = cards.flatMap((c) => [c.dd0, c.dd1, c.dd3, c.dd4]).filter(Boolean);
    const badDd = dds.filter((d) => d.contrast < 4.5);
    check(phase + '：卡片数值（dd，含最大回撤/时长/收益）对比度 ≥ 4.5', badDd.length === 0,
      badDd.length ? JSON.stringify(badDd.map((d) => d.text + '=' + d.contrast)) : '样本 ' + dds.length + ' 个，最低 ' + Math.min(...dds.map((d) => d.contrast)));
    // ⑤ 策略名（inline style 给色，兼容层管不到）—— 小字加粗，按 3:1 门槛
    const badLabel = cards.filter((c) => c.label.contrast < 3);
    check(phase + '：策略名（inline 色）对比度 ≥ 3', badLabel.length === 0,
      JSON.stringify(cards.map((c) => c.key + '=' + c.label.contrast)));
    // ⑥ 区块标题与说明段
    check(phase + '：区块标题 h3 对比度 ≥ 4.5', (m.section.title?.contrast ?? 0) >= 4.5, 'contrast=' + m.section.title?.contrast);
    check(phase + '：区块说明段对比度 ≥ 4.5', (m.section.note?.contrast ?? 0) >= 4.5, 'contrast=' + m.section.note?.contrast);
  };

  const minContrast = (m) => Math.min(...m.cards.flatMap((c) => [c.dt0?.contrast, c.dd0?.contrast, c.dd1?.contrast, c.dd3?.contrast, c.dd4?.contrast]).filter((v) => typeof v === 'number'));

  // ---------- 1. 夜间 = 现状（改后） ----------
  log('');
  log('--- 1/3 主题 dark（现状 = 生成器已补齐）---');
  const dark = await jsonEval(MEASURE);
  if (!dark) { logErr('量取失败（MEASURE 返回 null）'); log('=== 汇总：探针中止 ==='); ws.close(); return cleanup(); }
  log('  html=' + JSON.stringify({ cls: dark.htmlClass, cs: dark.htmlColorScheme, stored: dark.storedTheme, cards: dark.cardCount }));
  for (const c of dark.cards) {
    log('  [' + c.key + '] 底=' + c.card.effBg + '（lum ' + c.card.effBgLum + '，backdropFrom=' + c.card.backdropFrom + '）'
      + ' · 项名=' + c.dt0.colorHex + '/' + c.dt0.contrast
      + ' · 数值=' + c.dd0.colorHex + '/' + c.dd0.contrast
      + ' · 策略名=' + c.label.colorHex + '/' + c.label.contrast);
  }
  await shot('dark.after');

  check('夜间：<html> 带 .dark 且 color-scheme: dark', dark.htmlClass.includes('dark') && /dark/.test(dark.htmlColorScheme), JSON.stringify({ cls: dark.htmlClass, cs: dark.htmlColorScheme }));
  check('夜间：5 张策略卡片齐备', dark.cards.length === 5, 'count=' + dark.cards.length);
  assertCards(dark, '夜间(改后)');

  // ---------- 2. 亮色基线（in-page 摘掉 .dark，不 reload） ----------
  log('');
  log('--- 2/3 亮色基线（in-page 摘掉 .dark，不 reload）---');
  await evalJs(`document.documentElement.classList.remove('dark')`);
  await sleep(600);
  const light = await jsonEval(MEASURE);
  const stillDark = await evalJs(`document.documentElement.classList.contains('dark')`);
  log('  摘掉后 .dark 仍存在？' + stillDark + '（若为 true 说明应用又把它加回来了，本步结论不可用）');
  if (!light) { logErr('亮色量取失败'); } else {
    await shot('light');
    check('亮色：卡片底为浅面（相对亮度 > 0.6）', light.cards.every((c) => c.card.effBgLum > 0.6), JSON.stringify(light.cards.map((c) => c.key + '=' + c.card.effBg + '/lum' + c.card.effBgLum)));
    /**
     * 亮色侧**不作为本轮判据**：本轮 diff 全部是 `.dark` 作用域选择器（见 out.txt 的「diff 作用域自查」），
     * 非 dark 渲染在数学上不可能被触碰 ⇒ 这里量到的是**既有水平**，不是回归。
     * 记 INFO 而不是 FAIL，避免把既有问题算到本轮头上；数值仍如实落盘供后续跟进。
     */
    for (const c of light.cards) {
      log('  [' + c.key + '] 亮色底=' + c.card.effBg + ' · 项名=' + c.dt0.colorHex + '/' + c.dt0.contrast + ' · 数值=' + c.dd0.colorHex + '/' + c.dd0.contrast + ' · 策略名=' + c.label.colorHex + '/' + c.label.contrast);
    }
    const lightMin = light.cards.flatMap((c) => [c.dt0, c.dd0, c.dd1, c.dd3, c.dd4]).filter(Boolean).sort((a, b) => a.contrast - b.contrast)[0];
    info('亮色基线：卡片内文字最低对比度（既有水平，非本轮回归项）', lightMin.contrast + ' · 最弱元素=' + JSON.stringify(lightMin.text) + ' ' + lightMin.colorHex + ' on ' + lightMin.effBg);
  }
  await evalJs(`document.documentElement.classList.add('dark')`);
  await sleep(500);

  // ---------- 3. 缺陷复现：注入「生成器没补齐」时的亮色取值 ----------
  log('');
  log('--- 3/3 缺陷复现（注入 revert 规则 ⇒ 复现用户截图那一幕）---');
  await evalJs(`(function(){ var s=document.createElement('style'); s.id='revert-dark-violet50-40'; s.textContent=${JSON.stringify(REVERT_CSS)}; document.head.appendChild(s); return true; })()`);
  await sleep(600);
  const before = await jsonEval(MEASURE);
  if (!before) { logErr('复现量取失败'); } else {
    for (const c of before.cards) {
      log('  [' + c.key + '] 底=' + c.card.effBg + '（lum ' + c.card.effBgLum + '）· 项名=' + c.dt0.colorHex + '/' + c.dt0.contrast + ' · 数值=' + c.dd0.colorHex + '/' + c.dd0.contrast + ' · 策略名=' + c.label.colorHex + '/' + c.label.contrast);
    }
    await shot('dark.before');
    const lumBefore = Math.max(...before.cards.map((c) => c.card.effBgLum));
    const lumAfter = Math.max(...dark.cards.map((c) => c.card.effBgLum));
    check('复现成立：未补齐时卡片被冲成中间灰（合成底相对亮度 > 0.15）', lumBefore > 0.15,
      '未补齐 lum=' + lumBefore + '（' + before.cards[0].card.effBg + '） vs 已补齐 lum=' + lumAfter + '（' + dark.cards[0].card.effBg + '）');
    check('复现成立：未补齐时卡片内文字对比度显著低于已补齐', minContrast(before) < minContrast(dark),
      '未补齐最低=' + minContrast(before) + ' vs 已补齐最低=' + minContrast(dark));
    check('复现成立：未补齐时 5 张卡全部落在「亮面」判据之外（≥0.10）', before.cards.every((c) => c.card.effBgLum > 0.10),
      JSON.stringify(before.cards.map((c) => c.card.effBgLum)));
  }
  await evalJs(`(function(){ var s=document.getElementById('revert-dark-violet50-40'); if(s) s.remove(); return true; })()`);

  await evalJs(`localStorage.removeItem('theme')`);
  log('');
  const verdict = fail === 0 && skip === 0 ? 'ALL PASS' : fail === 0 ? 'PASS（含 SKIP）' : 'HAS FAILURE';
  log('=== 汇总：PASS ' + pass + ' / FAIL ' + fail + ' / SKIP ' + skip + ' ⇒ ' + verdict + ' ===');
  log('结果留档：' + OUT);
  ws.close(); cleanup();
})().catch((e) => { logErr('ERR', (e && e.stack) || String(e)); cleanup(); });
