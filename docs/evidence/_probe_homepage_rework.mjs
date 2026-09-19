/**
 * 首页（`/`，HOMEPAGE-001）第二轮改造的**真实渲染**验收探针 —— 事项 `rKRNzQ`。
 *
 * 需求（用户原话，5 条）：
 *   ① 需要展示数据库中四条指数；展示的区域过大、日期太少 ⇒ 更小的区块展示更多日期、四只指数并列展示；
 *   ② 成交量/两融/涨停数「右侧坐标有两个」⇒ 解决；若两融与成交额共轴则两融变化不明显；
 *   ③ 连板梯队与题材热力图交换位置；
 *   ④ 连板梯队改成附件 `QQ20260918-230855.png` 的形式；
 *   ⑤ 首页加载过慢，优化加载形式。
 *
 * 本探针用**无头 Chrome + CDP 直连量 DOM**（项目既有范式），不做任何「代码看起来对」的推断：
 *   A. 四指数并列（4 张卡、code 集合、同一行、各自有图、窗口 ≥ 100 个交易日）
 *   B. 大盘三图结构（2026-09-19 第四轮改版后**重写**断言）：
 *      · 图 1 = 涨停家数**柱状图独立成图**（有柱、无折线）；
 *      · 图 2 = 成交额 + 两融余额**两条折线合并到一图**（左轴 = 成交额、右轴 = 两融余额，两轴各自定域）；
 *      · 两图绘图区左右边界与宽度一致（柱与折线竖直方向对齐）；
 *      · **0 个旋转轴标题**（`.recharts-yAxis .recharts-label`）—— 旧版 `angle: ±90` 的轴标题与刻度数字重叠，
 *        用户反馈「根本看不见」⇒ 单位改由**每图小标题**与**图例名称**承载（本节一并断言）。
 *   C. 连板梯队**在**题材热力日历**之上**（位置交换）
 *   D. 梯队版式 = 「高度 × 网格」：左列高度标签、格内三行、断板格有删除线 + 涨跌幅、存在「一字板」标
 *   E. 首屏不被单一 spinner 堵住：导航后短时限内两个重卡片容器已在 DOM（骨架屏占位），且数据随后补齐
 *
 * 第三轮追加（2026-09-19，同一事项）：
 *   F. 梯队**组内**默认折叠：**每个高度组各自判断** —— 该组网格行数 > 3 ⇒ 该组出现按钮、
 *      `aria-expanded=false`、只渲染 3 行（= 3 × 实测列数 格）；点按钮后**仅该组**全量渲染、文案转「收起」；
 *      行数 ≤ 3 的组不出现按钮；**整个梯队的高度行不再整体收起**（「2 板」「首板」行默认即在 DOM）。
 *      ⚠️ 上一版按「整个梯队的高度行数 > 3 ⇒ 只留最高 3 行」属口径错读，用户 2026-09-19 澄清后作废。
 *   G. 排序口径 = 题材**当日**热力（**非**窗口合计、**非**断板优先）：
 *      · 梯队每个高度行内，题材当日涨停家数**非递增**；且断板格与涨停格**交错**（不再统一排前/排尾）；
 *      · 热力日历行顺序按**第一数据列（当日）**非递增，且该列显示值 = 服务端当日真实值。
 *   H. 「首板未续」并入 2 板行（+1 口径）：2 板行内必须同时存在涨停格与断板格
 *
 * 第四轮追加（2026-09-19，用户口述四条 + 一条）：
 *   I. 柱色随主题：亮色 = 红-500（#ef4444，**用户 2026-09-19 明确「只改夜间」后恢复原值**）、
 *      暗色 = 灰调砖红 #a04e4e（`hsl(0,34%,47%)`，饱和度 74%→34% 且压暗）——
 *      以 `[data-theme-toggle]` 所在的真实主题切换（写 localStorage + reload）后量 `getComputedStyle(fill)`，
 *      并比较感知亮度，证明「夜间不刺眼」不是靠肉眼声称。
 *   J. 梯队折叠按钮旁**不再有**「已折叠本组 x 行（默认只显示前 3 行）」冗余说明文字。
 * 第六轮追加（2026-09-19，用户口述：「只改夜间模式」+「折叠按钮居中 + 好看一点」+「折叠后向上回滚带动画」）：
 *   I（修订）. 亮色柱色**恢复红-500 原值**（此前一轮曾连带改淡，已被用户驳回）；
 *   L. 折叠按钮**居中**（`btn.parentElement` 的 `justify-center`，且该容器仍只含按钮一个子元素）；
 *   M. 展开 → **收起**后：`window.scrollY` 向上变化、过程中存在严格介于首尾的采样（证明是平滑动画而非瞬跳）、
 *      落点 = 本组网格顶部距视口顶 88px（±6px，常量 `LADDER_COLLAPSE_SCROLL_TOP`）；已在舒适线以下时**不**回滚。
 *      ⚠️ 采样必须在 **Node 侧**做 —— 本探针的 `evalJs` 是 `awaitPromise:false`，页内 Promise 收不到值。
 *   N. 🔴 **断板格 vs 连板格的「双通道」+ 夜间可读性硬门槛**：断板格必须带**虚线描边**（形状通道，
 *      两主题下全部断板格都有、连板格一个都没有），且**描边合成色 vs 卡片底色的 WCAG 对比度两种主题都 ≥ 3:1**；
 *      文字通道不得退化（夜间 ≥ 1.7:1 且 ≥ 日间 × 0.6）。
 *      依据：暗色 `--foreground`/`--muted-foreground` 只差 0.205 ⇒ 文本对比仅 **2.00:1**（亮色 3.03:1），
 *      且再压暗断板名会伤其自身可读性 ⇒ 必须由形状通道承担主要区分。用户原话：「夜间模式下断板划线展示
 *      和连板个股区分度太低，换一种更明显的，**后续 UI 设计都要考虑夜间模式的可读性**」。
 *      ⚠️ 取色必须经 **canvas 合成**成真实 sRGB —— Chrome 把计算颜色报成 `oklch()/oklab()`，按 `rgb()` 正则解析会全 null。

 * 第五轮追加（2026-09-19，用户口述：「首页最下面有四个大的跳转按钮没用 去掉」）：
 *   K. 首页底部四张「快捷入口」卡片（涨停复盘明细 / 大盘分析 / 情绪分析 / 上传图片）**整体移除**
 *      ⇒ 反证断言：`a[href]` 命中这四个路由的条数 = 0、卡片容器内含这些文案的条数 = 0。
 *      注意只断言「首页不再有这四张卡」，**不断言这四个路由本身可达**（侧栏入口仍在）。
 *
 * ⚠️ 顺序纪律：F（折叠态断言 + 逐组展开）**必须先于** D/G 的全量版式断言，
 *    否则被折叠的组会少渲染格数 ⇒ 全量断言静默变成假 SKIP/假失败。
 *
 * 用法（项目根执行；BASE 只认启动日志里的端口）：
 *   node docs/evidence/_probe_homepage_rework.mjs [BASE_URL]
 *
 * ⚠️ 输出**同步落盘**：进程被 SIGTERM 时未 flush 的 console 输出会全丢；同名 `.out.txt` 即留档结果。
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const HERE = import.meta.dirname;
const OUT = path.join(HERE, '_probe_homepage_rework.out.txt');
const BASE = process.argv[2] || 'http://127.0.0.1:4002';

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
/** 端口必须**实测空闲**：残留的无头 Chrome 会占住高位端口（TCP 通但 fetch 失败）。 */
async function pickPort() {
  for (let i = 0; i < 60; i++) {
    const p = 21000 + Math.floor(Math.random() * 8000);
    if (await isPortFree(p)) return p;
  }
  return null;
}
const PORT = await pickPort();
if (!PORT) { console.error('未找到空闲调试端口'); process.exit(1); }

const UDD = path.join(os.tmpdir(), 'homeprobe-' + Date.now());
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
const EXPECTED_INDEX_CODES = ['000001.SH', '399001.SZ', '000300.SH', '000905.SH'];

(async () => {
  if (!BROWSER) { logErr('未找到 Chrome / Edge 可执行文件'); return cleanup(); }
  log('== 首页（/）第二轮改造验收探针（事项 rKRNzQ）==', new Date().toISOString());
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
  const HAS = (sel) => `!!document.querySelector(${JSON.stringify(sel)})`;
  const jsonEval = async (expr) => { const v = await evalJs(expr); try { return JSON.parse(v); } catch { return null; } };

  let pass = 0, fail = 0, skip = 0;
  const check = (name, ok, detail) => { ok ? pass++ : fail++; log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + name + (detail === undefined ? '' : '  → ' + detail)); };
  const skipCheck = (name, why) => { skip++; log('  SKIP  ' + name + '  → ' + why); };

  // ---------- 导航并测量「首屏骨架先出」 ----------
  log('');
  log('--- E. 首屏加载形式（重卡片容器必须先于数据出现）---');
  const navAt = Date.now();
  await send('Page.navigate', { url: BASE + '/' });

  let tIndexCard = -1, tFirstChart = -1, tLadderTable = -1, tHeatTable = -1, tBothContainers = -1;
  for (let i = 0; i < 400; i += 1) {
    await sleep(100);
    const snap = await jsonEval(`JSON.stringify({
      idx: !!document.querySelector('[data-homepage-index-card]'),
      surf: !!document.querySelector('.recharts-surface'),
      ladder: !!document.querySelector('[data-homepage-ladder]'),
      heat: !!document.querySelector('[data-homepage-heatmap]'),
      ladderRows: document.querySelectorAll('[data-ladder-group]').length,
      skeleton: document.querySelectorAll('[data-slot="skeleton"]').length
    })`);
    if (!snap) continue;
    const t = Date.now() - navAt;
    if (tIndexCard < 0 && snap.idx) tIndexCard = t;
    if (tFirstChart < 0 && snap.surf) tFirstChart = t;
    if (tLadderTable < 0 && snap.ladderRows > 0) tLadderTable = t;
    if (tHeatTable < 0 && snap.heat && snap.skeleton === 0) tHeatTable = t;
    if (tBothContainers < 0 && snap.ladder && snap.heat) tBothContainers = t;
    if (tIndexCard > 0 && tLadderTable > 0 && tHeatTable > 0) break;
  }
  log('  首屏时间线：指数卡 ' + tIndexCard + 'ms · 首个图表 ' + tFirstChart + 'ms · 两重卡片容器同存 ' + tBothContainers + 'ms · 梯队表 ' + tLadderTable + 'ms · 热力表 ' + tHeatTable + 'ms');
  check('两个重区块的卡片容器在 1.5s 内同存（不再是「等全部数据」的全页 spinner）', tBothContainers >= 0 && tBothContainers < 1500, tBothContainers + 'ms');
  check('指数卡在 1.5s 内出现', tIndexCard >= 0 && tIndexCard < 1500, tIndexCard + 'ms');
  check('指数图表先于连板梯队表就绪（分块渲染，非串行阻塞）', tFirstChart > 0 && tLadderTable > 0 && tFirstChart <= tLadderTable, 'chart=' + tFirstChart + ' ladder=' + tLadderTable);

  // 等全部数据补齐
  for (let i = 0; i < 300; i += 1) {
    const ok = await evalJs(`document.querySelectorAll('[data-slot="skeleton"]').length === 0 && document.querySelectorAll('[data-ladder-group]').length > 0`);
    if (ok) break;
    await sleep(300);
  }
  await sleep(800);

  // ---------- A. 四指数并列 ----------
  log('');
  log('--- A. 大盘日线走势图：四指数并列 ---');
  const cards = await jsonEval(`JSON.stringify(Array.from(document.querySelectorAll('[data-homepage-index-card]')).map(function(c){
    var r = c.getBoundingClientRect();
    var svg = c.querySelector('.recharts-surface');
    var texts = Array.from(c.querySelectorAll('text')).map(function(t){return (t.textContent||'').trim()});
    return { code: c.getAttribute('data-homepage-index-card'), top: Math.round(r.top+window.scrollY), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height), hasSvg: !!svg, daysText: (c.innerText||'').replace(/\\n/g,' '), dates: texts.filter(function(t){return /^\\d{2}-\\d{2}$/.test(t)}).length };
  }))`);
  if (!Array.isArray(cards) || cards.length === 0) {
    skipCheck('A 四指数并列', '指数卡未渲染');
  } else {
    check('指数卡数量 = 4', cards.length === 4, 'got ' + cards.length);
    const codes = cards.map((c) => c.code).sort();
    check('指数代码集合 = 库中四条指数', JSON.stringify(codes) === JSON.stringify([...EXPECTED_INDEX_CODES].sort()), JSON.stringify(codes));
    const tops = new Set(cards.map((c) => c.top));
    check('四张卡在同一行（top 相同）⇒ 并列展示', tops.size === 1, 'tops=' + JSON.stringify([...tops]));
    check('每张卡各自有独立图表', cards.every((c) => c.hasSvg), JSON.stringify(cards.map((c) => c.hasSvg)));
    const widths = cards.map((c) => c.w);
    check('单卡宽度明显小于整页（区块变小）', widths.every((w) => w > 180 && w < 420), JSON.stringify(widths));
    const dayCounts = cards.map((c) => Number((String(c.daysText).match(/(\d+)\s*个交易日/) || [])[1] || 0));
    check('四条指数窗口均为 120 个交易日（更多日期）', dayCounts.every((n) => n === 120), JSON.stringify(dayCounts));
    const tickCounts = cards.map((c) => c.dates);
    check('每张图有日期刻度', tickCounts.every((n) => n >= 2), JSON.stringify(tickCounts));
  }

  // ---------- B. 大盘三图结构（第四轮：柱独立 + 双折线合一图 + 无旋转轴标题） ----------
  log('');
  log('--- B. 涨停家数（柱，独立图）｜成交额 + 两融余额（两条折线，一图两轴）---');
  const market = await jsonEval(`(function(){
    var card = document.querySelector('[data-homepage-market-chart]');
    if (!card) return null;
    var blocks = Array.from(card.querySelectorAll('[data-homepage-chart]')).map(function(b){
      var svg = b.querySelector('svg.recharts-surface');
      var grid = b.querySelector('.recharts-cartesian-grid');
      var gb = grid ? grid.getBoundingClientRect() : null;
      var sb = svg ? svg.getBoundingClientRect() : null;
      var isNum = function(t){ return /^-?\\d+(\\.\\d+)?$/.test((t.textContent || '').trim()); };
      var yAxes = Array.from(b.querySelectorAll('.recharts-yAxis')).map(function(g){
        var texts = Array.from(g.querySelectorAll('text')).filter(isNum);
        var rects = texts.map(function(t){ return t.getBoundingClientRect(); });
        var xs = rects.map(function(r){ return r.left + r.width / 2; });
        return {
          side: (rects.length && sb && Math.min.apply(null, xs) > sb.left + sb.width / 2) ? 'right' : 'left',
          numeric: rects.length,
          ticks: texts.map(function(t){ return (t.textContent || '').trim(); }),
          // 刻度文字是否完整落在 SVG 内（越界即被裁 ⇒ 用户「看不见」）
          insideSvg: !sb || rects.every(function(r){ return r.left >= sb.left - 0.5 && r.right <= sb.right + 0.5; }),
          // 左侧轴刻度必须整段落在**绘图区左边界**之外（否则与绘图区/曲线重叠）
          clearOfPlot: !gb || rects.every(function(r){ return r.right <= gb.left + 0.5; })
        };
      });
      var barPath = b.querySelector('.recharts-bar-rectangle path');
      var cap = b.querySelector('div');
      return {
        kind: b.getAttribute('data-homepage-chart'),
        bars: b.querySelectorAll('.recharts-bar-rectangle').length,
        lines: b.querySelectorAll('.recharts-line-curve').length,
        barFill: barPath ? getComputedStyle(barPath).fill : null,
        yAxes: yAxes,
        rotatedTitles: b.querySelectorAll('.recharts-yAxis .recharts-label').length,
        caption: cap ? (cap.textContent || '').trim() : '',
        legend: Array.from(b.querySelectorAll('.recharts-legend-item-text')).map(function(t){ return (t.textContent || '').trim(); }),
        plotLeft: gb ? Math.round(gb.left) : null,
        plotWidth: gb ? Math.round(gb.width) : null
      };
    });
    return JSON.stringify({ blocks: blocks });
  })()`);
  if (!market || !Array.isArray(market.blocks) || market.blocks.length !== 2) {
    skipCheck('B 大盘三图结构', '区块未渲染或不是「一柱图 + 一折线图」两张图');
  } else {
    const [barBlock, lineBlock] = market.blocks;
    check(
      '图 1 = 涨停家数**柱状图独立成图**（有柱、无折线）',
      barBlock.kind === 'limit-up-bar' && barBlock.bars > 0 && barBlock.lines === 0,
      JSON.stringify({ kind: barBlock.kind, bars: barBlock.bars, lines: barBlock.lines }),
    );
    check(
      '柱状图左轴刻度 = 整数家数（≥2 个数字刻度）',
      barBlock.yAxes.filter((a) => a.side === 'left' && a.numeric >= 2).length === 1,
      JSON.stringify(barBlock.yAxes.map((a) => a.side + ':' + a.ticks.join('/'))),
    );
    check(
      '图 2 = **两条折线合到一图**（成交额 + 两融余额），且无柱',
      lineBlock.kind === 'market-lines' && lineBlock.lines === 2 && lineBlock.bars === 0,
      JSON.stringify({ kind: lineBlock.kind, bars: lineBlock.bars, lines: lineBlock.lines }),
    );
    const lineLeft = lineBlock.yAxes.filter((a) => a.side === 'left' && a.numeric >= 2);
    const lineRight = lineBlock.yAxes.filter((a) => a.side === 'right' && a.numeric >= 2);
    check(
      '图 2 左右各一条带刻度的纵轴（成交额 / 两融余额，各自定域）',
      lineLeft.length === 1 && lineRight.length === 1,
      JSON.stringify(lineBlock.yAxes.map((a) => a.side + ':' + a.ticks.join('/'))),
    );
    check(
      '两图绘图区左右边界与宽度一致（柱与折线竖直对齐）',
      barBlock.plotLeft !== null &&
        barBlock.plotLeft === lineBlock.plotLeft &&
        barBlock.plotWidth === lineBlock.plotWidth,
      JSON.stringify({ bar: [barBlock.plotLeft, barBlock.plotWidth], line: [lineBlock.plotLeft, lineBlock.plotWidth] }),
    );
    check(
      '两图都不再画旋转的轴标题（0 个 .recharts-yAxis .recharts-label）',
      barBlock.rotatedTitles === 0 && lineBlock.rotatedTitles === 0,
      JSON.stringify({ bar: barBlock.rotatedTitles, line: lineBlock.rotatedTitles }),
    );
    check(
      '所有纵轴刻度文字完整可见（不越出 SVG、不与绘图区/曲线重叠）',
      barBlock.yAxes.every((a) => a.insideSvg) &&
        lineBlock.yAxes.every((a) => a.insideSvg && (a.side !== 'left' || a.clearOfPlot)),
      JSON.stringify({
        bar: barBlock.yAxes.map((a) => ({ side: a.side, ticks: a.ticks, insideSvg: a.insideSvg, clearOfPlot: a.clearOfPlot })),
        line: lineBlock.yAxes.map((a) => ({ side: a.side, ticks: a.ticks, insideSvg: a.insideSvg, clearOfPlot: a.clearOfPlot })),
      }),
    );
    check(
      '单位由**每图小标题**承载（柱=家 / 折线=左轴亿·右轴亿）',
      /涨停家数（柱，左轴：家）/.test(barBlock.caption) &&
        /成交额（左轴：亿）/.test(lineBlock.caption) &&
        /两融余额（右轴：亿）/.test(lineBlock.caption),
      JSON.stringify({ bar: barBlock.caption, line: lineBlock.caption }),
    );
    check(
      '图例名称带单位（成交额(亿) / 两融余额(亿)）',
      lineBlock.legend.join('|') === '成交额(亿)|两融余额(亿)',
      JSON.stringify(lineBlock.legend),
    );
  }

  // ---------- C. 位置交换 ----------
  log('');
  log('--- C. 连板梯队 与 题材热力日历 位置交换 ---');
  const order = await jsonEval(`(function(){
    var ladder = document.querySelector('[data-homepage-ladder]');
    var heat = document.querySelector('[data-homepage-heatmap]');
    if (!ladder || !heat) return null;
    return JSON.stringify({ ladderTop: Math.round(ladder.getBoundingClientRect().top + window.scrollY), heatTop: Math.round(heat.getBoundingClientRect().top + window.scrollY) });
  })()`);
  if (!order) {
    skipCheck('C 位置交换', '两个区块未同时渲染');
  } else {
    check('连板梯队排在题材热力日历之前', order.ladderTop < order.heatTop, JSON.stringify(order));
  }

  // ---------- F. 组内默认折叠 ----------
  log('');
  log('--- F. 梯队「**组内**网格行 > 3 ⇒ 该组默认折叠到 3 行」（非整个梯队整体收起）---');
  const readLadderShape = () => jsonEval(`(function(){
    var grids = Array.from(document.querySelectorAll('[data-homepage-ladder] [data-ladder-grid]'));
    return JSON.stringify(grids.map(function(g){
      var raw = (getComputedStyle(g).gridTemplateColumns || '').trim();
      var cols = raw ? raw.split(/\\s+/).filter(Boolean).length : 0;
      var row = g.closest('[data-ladder-group]');
      var heightCell = row && row.querySelector('td') ? (row.querySelector('td').textContent || '').trim() : '';
      var btn = row ? row.querySelector('[data-homepage-ladder-group-toggle]') : null;
      return {
        key: g.getAttribute('data-ladder-grid'),
        label: heightCell,
        cols: cols,
        rowsTotal: Number(g.getAttribute('data-ladder-grid-rows-total') || -1),
        rowsVisible: Number(g.getAttribute('data-ladder-grid-rows-visible') || -1),
        cells: g.querySelectorAll('[data-ladder-stock]').length,
        toggle: !!btn,
        expanded: btn ? btn.getAttribute('aria-expanded') : null,
        buttonLabel: btn ? (btn.textContent || '').trim() : ''
      };
    }));
  })()`);
  const collapsedGrids = await readLadderShape();
  if (!Array.isArray(collapsedGrids) || collapsedGrids.length === 0) {
    skipCheck('F 梯队组内折叠', '梯队网格未渲染');
  } else {
    log('  默认态：');
    collapsedGrids.forEach((g) =>
      log('    ' + g.label.padEnd(14) + g.cols + ' 列 ' + g.rowsTotal + ' 行 → 可见 ' + g.rowsVisible + ' 行 / 渲染 ' + g.cells + ' 格 · 按钮=' + g.toggle + ' aria=' + g.expanded),
    );

    const over = collapsedGrids.filter((g) => g.rowsTotal > 3);
    const within = collapsedGrids.filter((g) => g.rowsTotal <= 3);
    check(
      '存在「网格行数 > 3」的高度组（否则本节折叠断言形同虚设）',
      over.length > 0,
      JSON.stringify(collapsedGrids.map((g) => g.label + '=' + g.rowsTotal + '行')),
    );
    check(
      '行数 > 3 的组出现**本组**折叠按钮、默认折叠、且恰好收成 3 行（= 3 × 实测列数 格）',
      over.length > 0 && over.every((g) => g.toggle && g.expanded === 'false' && g.rowsVisible === 3 && g.cells === 3 * g.cols),
      JSON.stringify(over.map((g) => g.label + ' ' + g.rowsTotal + '行→' + g.rowsVisible + '行/' + g.cells + '格(列' + g.cols + ')')),
    );
    check(
      '行数 ≤ 3 的组不出现按钮、行数也不被裁',
      within.length > 0 && within.every((g) => !g.toggle && g.rowsVisible === g.rowsTotal),
      JSON.stringify(within.map((g) => g.label + ' ' + g.rowsTotal + '行 按钮=' + g.toggle)),
    );

    // 第四轮诉求：折叠按钮旁**不再有**冗余说明文字（只留按钮本身）。
    const toggleBleed = await jsonEval(`(function(){
      var btn = document.querySelector('[data-homepage-ladder] [data-homepage-ladder-group-toggle]');
      if (!btn) return JSON.stringify({ found: false });
      var box = btn.parentElement;
      var others = Array.from(box.children).filter(function(c){ return c !== btn; });
      return JSON.stringify({
        found: true,
        siblings: others.map(function(c){ return (c.textContent || '').trim(); }),
        boxText: (box.textContent || '').trim(),
        btnText: (btn.textContent || '').trim()
      });
    })()`);
    check(
      '折叠按钮旁不再有「已折叠本组 x 行（默认只显示前 3 行）」这类说明文字',
      !!toggleBleed &&
        toggleBleed.found === true &&
        toggleBleed.siblings.length === 0 &&
        !/已折叠|已展开本组|默认只显示前/.test(toggleBleed.boxText),
      toggleBleed ? JSON.stringify({ siblings: toggleBleed.siblings, box: toggleBleed.boxText }) : 'n/a',
    );

    // ---------- L. 折叠按钮**居中**（用户 2026-09-19：「折叠按钮改到居中显示」） ----------
    // 判据取**几何**而不是类名：按钮中心 x 与本组网格中心 x 对齐（±2px）⇒ 真的居中，
    // 而不是"写了 justify-center 但被宽度/外边距带偏"。
    const toggleCentering = await jsonEval(`(function(){
      var btn = document.querySelector('[data-homepage-ladder] [data-homepage-ladder-group-toggle]');
      if (!btn) return JSON.stringify({ found: false });
      var grid = btn.closest('[data-ladder-group]').querySelector('[data-ladder-grid]');
      var b = btn.getBoundingClientRect();
      var g = grid.getBoundingClientRect();
      var pc = getComputedStyle(btn.parentElement).justifyContent;
      return JSON.stringify({
        found: true,
        btnCenter: Math.round(b.left + b.width / 2),
        gridCenter: Math.round(g.left + g.width / 2),
        delta: Math.round(Math.abs((b.left + b.width / 2) - (g.left + g.width / 2))),
        justifyContent: pc
      });
    })()`);
    check(
      '折叠按钮居中（按钮中心 ↔ 本组网格中心 对齐 ±2px，且父容器 justify-content=center）',
      !!toggleCentering &&
        toggleCentering.found === true &&
        toggleCentering.delta <= 2 &&
        toggleCentering.justifyContent === 'center',
      toggleCentering ? JSON.stringify(toggleCentering) : 'n/a',
    );

    // 关键回归：折叠**不再**发生在整个梯队的高度行上（旧实现会默认藏掉「2 板」「首板」两行）。
    const tableShape = await jsonEval(`(function(){
      var table = document.querySelector('[data-homepage-ladder] table');
      if (!table) return null;
      var rows = Array.from(table.querySelectorAll('[data-ladder-group]'));
      return JSON.stringify({
        renderedRows: rows.length,
        grids: table.querySelectorAll('[data-ladder-grid]').length,
        labels: rows.map(function(tr){ var td = tr.querySelector('td'); return td ? (td.textContent || '').trim() : ''; })
      });
    })()`);
    check(
      '整个梯队的高度行不再整体收起（默认态即可见全部高度行，「2 板」「首板」都在）',
      !!tableShape &&
        tableShape.renderedRows === tableShape.grids &&
        tableShape.labels.some((l) => /^2\s*板/.test(l)) &&
        tableShape.labels.some((l) => /^首板/.test(l)),
      tableShape ? JSON.stringify(tableShape) : 'n/a',
    );

    // 只点第 1 个可折叠组（按钮与可折叠组同序）⇒ 证明是**组内**开关，不是全局开关。
    const firstKey = over.length > 0 ? over[0].key : null;
    await evalJs(
      `(function(){ var bs = document.querySelectorAll('[data-homepage-ladder] [data-homepage-ladder-group-toggle]'); if (bs.length) bs[0].click(); return bs.length; })()`,
    );
    await sleep(500);
    const afterOne = await readLadderShape();
    const touched = afterOne.filter((g) => g.key === firstKey);
    const untouched = afterOne.filter((g) => g.key !== firstKey && g.rowsTotal > 3);
    check(
      '点击某组按钮后**只有该组**展开，其余可折叠组保持折叠（组内开关，非全局）',
      touched.length === 1 &&
        touched[0].rowsVisible === touched[0].rowsTotal &&
        touched[0].expanded === 'true' &&
        untouched.length > 0 &&
        untouched.every((g) => g.rowsVisible === 3 && g.expanded === 'false'),
      JSON.stringify(afterOne.map((g) => g.label + ':' + g.rowsVisible + '/' + g.rowsTotal + '@' + g.expanded)),
    );
    check('展开态按钮文案 = 「收起」', touched.length === 1 && touched[0].buttonLabel === '收起', touched.length ? touched[0].buttonLabel : 'n/a');

    // 把剩下的可折叠组也全部展开 ⇒ 后续 D/G 的全量版式断言才成立（否则会静默少算格数）。
    await evalJs(
      `(function(){ var bs = Array.from(document.querySelectorAll('[data-homepage-ladder] [data-homepage-ladder-group-toggle]')); bs.forEach(function(b){ if (b.getAttribute('aria-expanded') === 'false') b.click(); }); return bs.length; })()`,
    );
    await sleep(700);
    const allExpanded = await readLadderShape();
    check(
      '逐组展开后每组的可见行 = 总行数（后续全量版式断言的前提）',
      Array.isArray(allExpanded) &&
        allExpanded.length === collapsedGrids.length &&
        allExpanded.every((g) => g.rowsVisible === g.rowsTotal && (!g.toggle || g.expanded === 'true')),
      JSON.stringify((allExpanded || []).map((g) => g.label + ':' + g.rowsVisible + '/' + g.rowsTotal)),
    );
  }

  // ---------- D. 梯队版式 ----------
  log('');
  log('--- D. 连板梯队 = 附件图片的「高度 × 网格」版式（已展开全量行）---');
  const ladder = await jsonEval(`(function(){
    var card = document.querySelector('[data-homepage-ladder]');
    if (!card) return null;
    var table = card.querySelector('table');
    if (!table) return null;
    var groupRows = Array.from(table.querySelectorAll('[data-ladder-group]')).map(function(tr){
      var tds = tr.querySelectorAll('td');
      var heightCell = tds[0] ? (tds[0].textContent || '').trim() : '';
      var grid = tds[1] ? tds[1].querySelector('div') : null;
      var cells = tr.querySelectorAll('[data-ladder-stock]');
      var cols = 0;
      if (grid) {
        var gs = (getComputedStyle(grid).gridTemplateColumns || '').trim();
        cols = gs ? gs.split(/\\s+/).length : 0;
      }
      var items = Array.from(cells).map(function(c){
        var nameEl = c.children[1];
        var story = null;
        if (nameEl) { try { story = getComputedStyle(nameEl).textDecorationLine; } catch(e) { story = 'n/a'; } }
        var lines = Array.from(c.children).map(function(x){ return (x.textContent||'').trim(); });
        var oneWord = !!Array.from(c.querySelectorAll('*')).find(function(x){ return (x.textContent||'').trim() === '一字板' && x.children.length === 0; });
        return { text: lines.join(' / '), decoration: story, oneWord: oneWord };
      });
      return { label: heightCell, cellCount: cells.length, columns: cols, codes: Array.from(cells).map(function(c){ return c.getAttribute('data-ladder-stock'); }), items: items };
    });
    return JSON.stringify(groupRows);
  })()`);
  if (!Array.isArray(ladder) || ladder.length === 0) {
    skipCheck('D 梯队版式', '梯队表未渲染或未分组');
  } else {
    log('  分组：' + JSON.stringify(ladder.map((g) => g.label + '(' + g.cellCount + '格×' + g.columns + '列)')));
    const labels = ladder.map((g) => g.label);
    check('左列是「高度」列（`N 板` / `首板(N)`）', labels.every((l) => /^\d+\s*板$/.test(l) || /^首板/.test(l)), JSON.stringify(labels));
    check('存在「首板(N)」行', labels.some((l) => /^首板\(\d+\)/.test(l)), JSON.stringify(labels.filter((l) => /^首板/.test(l))));
    check('高度按降序排列、首板在最后', (function () { const nums = labels.filter((l) => /^\d+/.test(l)).map((l) => Number(l.match(/^\d+/)[0])); for (let i = 1; i < nums.length; i += 1) { if (nums[i] > nums[i - 1]) return false; } return labels[labels.length - 1].indexOf('首板') === 0; })(), JSON.stringify(labels));
    check('右侧是网格（≥3 列）而非单列列表', ladder.every((g) => g.columns >= 3), JSON.stringify(ladder.map((g) => g.columns)));
    check('每组至少 1 格', ladder.every((g) => g.cellCount >= 1), JSON.stringify(ladder.map((g) => g.cellCount)));
    const allItems = ladder.flatMap((g) => g.items);
    const broken = allItems.filter((i) => /line-through/.test(String(i.decoration)));
    const oneWord = allItems.filter((i) => i.oneWord);
    check('存在断板高亮（删除线）', broken.length > 0, broken.length + ' / ' + allItems.length + ' 格');
    // 断板格首行 = 当日涨跌幅；行情缺失时按「—」呈现（不推算），因此允许「—」。
    check('断板格首行是涨跌幅（% 或行情缺失的「—」）', broken.length > 0 && broken.every((i) => /^[+\-]?\d+(\.\d+)?%/.test(i.text) || i.text.indexOf('—') === 0), JSON.stringify(broken.slice(0, 3)));
    check('存在「一字板」标', oneWord.length > 0, JSON.stringify(oneWord.slice(0, 3).map((i) => i.text)));
    const normalCells = allItems.filter((i) => !/line-through/.test(String(i.decoration)));
    check('非断板格首行是 HH:MM 封板时间或一字板标', normalCells.length > 0 && normalCells.every((i) => /^\d{2}:\d{2}/.test(i.text) || i.oneWord), JSON.stringify(normalCells.slice(0, 3).map((i) => i.text)));
    check('每格都是三行（时间/标 + 名称 + 题材）', allItems.every((i) => i.text.split(' / ').length === 3), JSON.stringify(allItems.slice(0, 2).map((i) => i.text)));

    // 「高度」口径回归：断板股 ⇒ 上一记录交易日连板数 + 1；当日涨停股 ⇒ 本日连板数（+0）。
    // 期望值来自 2026-09-18 与附件图 `QQ20260918-230855.png` 的逐格对拍（`_probe_ladder_height_caliber`）。
    // 数据日不是 2026-09-18 时跳过，避免探针随数据累积变成假失败。
    const dataDate = String(
      (await evalJs(`(function(){var s=document.querySelector('[data-homepage-ladder] select'); return s ? s.value : '';})()`)) ?? '',
    );
    const groupOf = (code) => {
      const hit = ladder.find((g) => (g.codes || []).indexOf(code) >= 0);
      return hit ? hit.label : null;
    };
    if (dataDate !== '2026-09-18') {
      skipCheck('D 高度口径（断板 +1）', '数据日为 ' + dataDate + '，非已对拍的 2026-09-18');
    } else {
      const expect = [
        ['605058.SH', '澳弘电子', '6 板'],
        ['003026.SZ', '中晶科技', '4 板'],
        ['002655.SZ', '共达电声', '3 板'],
        ['003001.SZ', '中岩大地', '3 板'],
        ['600371.SH', '万向德农', '3 板'],
        ['001216.SZ', '华瓷股份', '4 板'],
        ['603248.SH', '锡华科技', '4 板'],
        ['002285.SZ', '世联行', '3 板'],
        ['603230.SH', '内蒙新华', '3 板'],
      ];
      const wrong = expect.filter((row) => groupOf(row[0]) !== row[2]);
      check(
        '断板股上行一位（+1）、当日涨停股原地（本日板数）',
        wrong.length === 0,
        wrong.length > 0
          ? JSON.stringify(wrong.map((row) => row[1] + ' 期望 ' + row[2] + ' 实际 ' + groupOf(row[0])))
          : expect.map((row) => row[1] + '→' + row[2]).join(' · '),
      );
    }

    // H. 「首板未续」+1 并入 2 板行（用户 2026-09-19 裁定）—— 与「是否 09-18」无关，每次都查。
    const twoBoard = ladder.find((g) => g.label === '2 板');
    const twoBoardBroken = twoBoard ? twoBoard.items.filter((i) => /line-through/.test(String(i.decoration))).length : 0;
    check(
      '2 板行同时含涨停格与断板格（首板未续已按 +1 并入）',
      !!twoBoard && twoBoardBroken > 0 && twoBoardBroken < twoBoard.cellCount,
      twoBoard ? twoBoard.cellCount + ' 格（其中断板 ' + twoBoardBroken + ' 格）' : '无 2 板行',
    );
    const firstRow = ladder.find((g) => /^首板/.test(g.label));
    check(
      '首板行只剩当日首板（断板格已全部上移到 2 板行）',
      !!firstRow && firstRow.items.every((i) => !/line-through/.test(String(i.decoration))),
      firstRow ? firstRow.cellCount + ' 格' : '无首板行',
    );
  }

  // ---------- G. 排序口径 = 题材「当日」热力 ----------
  log('');
  log('--- G. 排序口径：题材「当日」热力（非合计、非断板优先）---');
  let heatDays = null;
  try {
    const res = await fetch(BASE + '/api/trpc/limitUp.getSectorDistribution');
    const body = await res.json();
    heatDays = body && body.result && body.result.data ? body.result.data.json : null;
  } catch (e) {
    logErr('取题材分布失败：', e.message);
  }
  log('  题材分布接口：' + (heatDays ? heatDays.length + ' 个交易日，最新 ' + heatDays[0].date : '不可用'));
  /** date → (sector → 当日涨停家数)。注意：当日为 0 家的题材**不在**该日切片里，取值时要按「缺 = -1」区分。 */
  const heatMapOf = (date) => {
    const day = (heatDays || []).find((d) => d.date === date);
    const map = new Map();
    for (const s of (day && day.sectors) || []) map.set(s.sector, s.count);
    return map;
  };

  if (!Array.isArray(ladder) || ladder.length === 0 || !heatDays) {
    skipCheck('G 梯队行内按当日题材热力排序', '梯队未渲染或取不到题材分布');
  } else {
    const ladderDate = String((await evalJs(`(function(){var s=document.querySelector('[data-homepage-ladder] select'); return s ? s.value : '';})()`)) ?? '');
    const heat = heatMapOf(ladderDate);
    if (heat.size === 0) {
      skipCheck('G 梯队行内按当日题材热力排序', '所选日期 ' + ladderDate + ' 不在题材分布窗口内');
    } else {
      const heatOf = (sector) => (heat.has(sector) ? heat.get(sector) : -1);
      const rows = ladder
        .filter((g) => g.items.length >= 2)
        .map((g) => {
          const heats = g.items.map((i) => heatOf(String(i.text).split(' / ').slice(-1)[0]));
          const kinds = g.items.map((i) => (/line-through/.test(String(i.decoration)) ? 'broken' : 'up'));
          let monotonic = true;
          for (let i = 1; i < heats.length; i += 1) if (heats[i] > heats[i - 1]) monotonic = false;
          // 旧实现是「涨停格全部在前 + 断板格全部在后」⇒ firstBroken > lastUp；
          // 出现 firstBroken < lastUp 就直接反证「不再按断板分组」。
          return { label: g.label, monotonic, interleaved: kinds.indexOf('broken') >= 0 && kinds.lastIndexOf('up') > kinds.indexOf('broken'), heats };
        });
      const bad = rows.filter((r) => !r.monotonic);
      check(
        '每个高度行内「题材当日涨停家数」非递增（' + ladderDate + ' 的热度）',
        rows.length > 0 && bad.length === 0,
        bad.length ? JSON.stringify(bad.map((r) => r.label + ':' + r.heats.join('>'))) : rows.length + ' 行，样例 ' + rows[0].label + ' = ' + rows[0].heats.join(', '),
      );
      check(
        '断板格与涨停格交错（不再统一排前/排尾）',
        rows.some((r) => r.interleaved),
        '交错行：' + JSON.stringify(rows.filter((r) => r.interleaved).map((r) => r.label)),
      );
    }
  }

  // G3：热力日历按「当日」（第一数据列）排序，而不是窗口合计
  const heatShape = await jsonEval(`(function(){
    var card = document.querySelector('[data-homepage-heatmap]');
    if (!card) return null;
    var table = card.querySelector('table');
    if (!table) return null;
    var headCells = Array.from(table.querySelectorAll('thead th')).map(function(t){ return (t.textContent||'').trim(); });
    var rows = Array.from(table.querySelectorAll('tbody tr')).map(function(tr){
      var tds = Array.from(tr.querySelectorAll('td')).map(function(td){ return (td.textContent||'').trim(); });
      return { sector: tds[0], dayText: tds[1], total: Number(tds[tds.length - 1]) };
    });
    return JSON.stringify({ headCells: headCells, rows: rows });
  })()`);
  if (!heatShape || !heatDays || !Array.isArray(heatShape.rows) || heatShape.rows.length === 0) {
    skipCheck('G3 热力日历按当日排序', '热力表未渲染或取不到题材分布');
  } else {
    const today = heatDays[0].date;
    const todayHeat = heatMapOf(today);
    log('  热力表：' + heatShape.rows.length + ' 行 × ' + (heatShape.headCells.length - 2) + ' 日；当日列 = ' + heatShape.headCells[1]);
    check('第一数据列就是接口的最新日 ' + today, heatShape.headCells[1] === today.slice(5), heatShape.headCells.slice(0, 3).join(' | '));
    const dayValues = heatShape.rows.map((r) => (r.dayText === '-' ? 0 : Number(r.dayText)));
    const mismatched = heatShape.rows
      .map((r, i) => ({ sector: r.sector, shown: dayValues[i], expected: todayHeat.get(r.sector) || 0 }))
      .filter((r) => r.shown !== r.expected);
    check(
      '当日列的显示值 = 服务端当日真实家数',
      mismatched.length === 0,
      mismatched.length ? JSON.stringify(mismatched.slice(0, 5)) : today + ' 共 ' + heatShape.rows.length + ' 行逐行一致',
    );
    let monotonic = true;
    for (let i = 1; i < dayValues.length; i += 1) if (dayValues[i] > dayValues[i - 1]) monotonic = false;
    check('行顺序按当日家数非递增（不是按窗口合计）', monotonic, dayValues.join(' > '));
    const totals = heatShape.rows.map((r) => r.total);
    let totalMonotonic = true;
    for (let i = 1; i < totals.length; i += 1) if (totals[i] > totals[i - 1]) totalMonotonic = false;
    log('  证据：合计列' + (totalMonotonic ? '**恰好也非递增**（此数据不构成反证，但排序键已由当日列单调性证明）' : '**非递增不成立** ⇒ 直接反证「不是按合计排序」') + '：' + totals.slice(0, 8).join(','));

    // 顺带留档：当日列若与合计列顺序不同，说明两者确实不是一个键
    const byDay = heatShape.rows.map((r) => r.sector).join('|');
    const byTotal = [...heatShape.rows].sort((a, b) => b.total - a.total || a.sector.localeCompare(b.sector)).map((r) => r.sector).join('|');
    log('  当日序与合计序' + (byDay === byTotal ? '**一致**（本日数据恰好同序）' : '**不同** ⇒ 排序键确为当日数据') + '：' + heatShape.rows.slice(0, 5).map((r) => r.sector).join(','));
  }

  // ---------- 其它区块零回归 ----------
  log('');
  log('--- 零回归检查 ---');
  const misc = await jsonEval(`JSON.stringify({
    heatTable: !!document.querySelector('[data-homepage-heatmap] table'),
    heatHeader: !!Array.from(document.querySelectorAll('[data-homepage-heatmap] th')).find(function(t){return (t.textContent||'').trim() === '合计'}),
    shortcuts: Array.from(document.querySelectorAll('a')).filter(function(a){return /\\/(limit-up|market|sentiment-analysis|upload)$/.test(a.getAttribute('href')||'')}).length,
    shortcutCards: Array.from(document.querySelectorAll('[data-slot="card"]')).filter(function(c){return /涨停复盘明细|录入当日涨停复盘图|情绪周期与龙头候选/.test(c.textContent||'')}).length,
    disclaimer: /免责声明/.test(document.body.innerText),
    h1: (document.querySelector('h1')||{}).textContent || '',
    skeletonLeft: document.querySelectorAll('[data-slot="skeleton"]').length,
    indexCards: document.querySelectorAll('[data-homepage-index-card]').length
  })`);
  check('题材热力日历表格保留（含「合计」列）', misc.heatTable && misc.heatHeader, JSON.stringify({ t: misc.heatTable, h: misc.heatHeader }));
  // 第五轮（2026-09-19，用户口述）：「首页最下面有四个大的跳转按钮没用，去掉」
  //   ⇒ 反证断言：底部 0 张快捷入口卡片、0 条指向这四个页面的跳转链（改回即红）。
  check('首页底部四个快捷入口卡片已移除', misc.shortcuts === 0 && misc.shortcutCards === 0, JSON.stringify({ links: misc.shortcuts, cards: misc.shortcutCards }));
  check('免责声明保留', misc.disclaimer === true, String(misc.disclaimer));
  check('页面标题为「行情总览」', String(misc.h1).indexOf('行情总览') >= 0, String(misc.h1));
  check('数据补齐后无残留骨架屏', misc.skeletonLeft === 0, String(misc.skeletonLeft));


  // ---------- 零回归检查跑完再验主题相关项（本段含两次 reload，会重置其它区块的加载态） ----------
  // ---------- I. 柱色随主题（第四轮：「柱状图的红色在夜间模式太刺眼」） ----------
  log('');
  log('--- I. 涨停家数柱色：亮色红-500（不变）/ 暗夜灰调砖红 #a04e4e（降饱和 + 压暗）---');
  const readBarFill = async () => jsonEval(`(function(){
    var p = document.querySelector('[data-homepage-chart="limit-up-bar"] .recharts-bar-rectangle path');
    if (!p) return null;
    var c = getComputedStyle(p).fill;
    var m = /rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/.exec(c) || [];
    var lin = function(v){ return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    var lum = 0;
    if (m.length) {
      var r = Number(m[1]) / 255, g = Number(m[2]) / 255, b = Number(m[3]) / 255;
      lum = Number((0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)).toFixed(4));
    }
    var t = document.querySelector('[data-theme-toggle]');
    return JSON.stringify({
      fill: c,
      luminance: lum,
      htmlDark: document.documentElement.classList.contains('dark'),
      btnTheme: t && t.dataset ? t.dataset.theme : null
    });
  })()`);
  const switchTheme = async (theme) => {
    await evalJs(`localStorage.setItem('theme', ${JSON.stringify(theme)})`);
    await send('Page.reload', { ignoreCache: false });
    for (let i = 0; i < 80; i += 1) {
      await sleep(250);
      const ok = await evalJs(`!!document.querySelector('[data-homepage-chart="limit-up-bar"] .recharts-bar-rectangle path')`);
      if (ok) { await sleep(400); return true; }
    }
    return false;
  };
  const lightOk = await switchTheme('light');
  const lightFill = lightOk ? await readBarFill() : null;
  const darkOk = await switchTheme('dark');
  const darkFill = darkOk ? await readBarFill() : null;
  log('  亮色：' + JSON.stringify(lightFill));
  log('  暗夜：' + JSON.stringify(darkFill));
  if (!lightFill || !darkFill) {
    skipCheck('I 柱色随主题', '切换主题后柱未渲染');
  } else {
    check('亮色主题下柱色 = 红-500（rgb(239, 68, 68)）', lightFill.fill === 'rgb(239, 68, 68)' && lightFill.htmlDark === false, lightFill.fill + ' / htmlDark=' + lightFill.htmlDark);
    check('暗夜主题下柱色 = 灰调砖红 #a04e4e（rgb(160, 78, 78)，降饱和后仍守住压暗口径）', darkFill.fill === 'rgb(160, 78, 78)' && darkFill.htmlDark === true, darkFill.fill + ' / htmlDark=' + darkFill.htmlDark);
    check(
      '暗夜柱色感知亮度显著低于亮色（「不刺眼」的量化判据）',
      darkFill.luminance > 0 && darkFill.luminance < lightFill.luminance * 0.7,
      'dark=' + darkFill.luminance + ' vs light=' + lightFill.luminance,
    );
  }
  // 复位成跟随系统，避免给后续手工查看留下「显式 light/dark」的残留偏好
  await evalJs(`localStorage.removeItem('theme')`);
  await send('Page.reload', { ignoreCache: false });
  await sleep(1500);

  // ---------- J. 收起后的回滚（用户 2026-09-19：「点击折叠后页面向上回滚至合适位置，带滚动动画」） ----------
  log('');
  log('--- J. 组内「展开 → 收起」后向上回滚 88px 落点 + 平滑动画 ---');
  // 用**最后一个**可折叠组（首板组，展开态最高）做样本：收起造成的落差最大，动画最容易采到中间帧。
  // 先轮询等折叠按钮出现 —— 本节紧跟在「切回跟随系统 + reload」之后，页面可能还在首屏加载。
  let toggleReady = false;
  for (let i = 0; i < 40 && !toggleReady; i += 1) {
    toggleReady = (await jsonEval(`JSON.stringify({ n: document.querySelectorAll('[data-homepage-ladder] [data-homepage-ladder-group-toggle]').length })`))?.n > 0;
    if (!toggleReady) await sleep(250);
  }
  const prepCollapse = await jsonEval(`(function(){
    var bs = Array.from(document.querySelectorAll('[data-homepage-ladder] [data-homepage-ladder-group-toggle]'));
    if (!bs.length) return null;
    var btn = bs[bs.length - 1];
    if (btn.getAttribute('aria-expanded') === 'false') btn.click();
    return JSON.stringify({ count: bs.length });
  })()`);
  await sleep(800);
  // 把本组网格顶部顶到舒适线（88px）以上 200px ⇒ 收起后必然需要向上回滚约 288px（动画足够长，能采到中间帧）。
  const scrollState = await jsonEval(`(function(){
    var bs = Array.from(document.querySelectorAll('[data-homepage-ladder] [data-homepage-ladder-group-toggle]'));
    var btn = bs[bs.length - 1];
    var grid = btn.closest('[data-ladder-group]').querySelector('[data-ladder-grid]');
    window.scrollBy(0, grid.getBoundingClientRect().top + 200);
    return JSON.stringify({ expanded: btn.getAttribute('aria-expanded'), rowsTotal: grid.getAttribute('data-ladder-grid-rows-total') });
  })()`);
  await sleep(400);
  const beforeCollapse = await jsonEval(`(function(){
    var bs = Array.from(document.querySelectorAll('[data-homepage-ladder] [data-homepage-ladder-group-toggle]'));
    var btn = bs[bs.length - 1];
    var grid = btn.closest('[data-ladder-group]').querySelector('[data-ladder-grid]');
    return JSON.stringify({ scrollY: Math.round(window.scrollY), gridTop: Math.round(grid.getBoundingClientRect().top) });
  })()`);
  if (!prepCollapse || !beforeCollapse || beforeCollapse.gridTop >= 88) {
    skipCheck('J 收起后回滚', '前置条件未成立：' + JSON.stringify({ prepCollapse, beforeCollapse }));
  } else {
    log('  收起前：' + JSON.stringify(beforeCollapse) + ' / 组行数=' + (scrollState ? scrollState.rowsTotal : 'n/a'));
    // 点「收起」（触发平滑滚动），随后由 Node 侧高频采样 window.scrollY —— 探针的 evalJs 是
    // `awaitPromise:false`，所以采样必须在页面外做，不能靠页内 Promise 收集。
    await evalJs(`(function(){
      var bs = Array.from(document.querySelectorAll('[data-homepage-ladder] [data-homepage-ladder-group-toggle]'));
      bs[bs.length - 1].click();
      return true;
    })()`);
    const series = [];
    for (let i = 0; i < 30; i += 1) {
      series.push(await jsonEval(`JSON.stringify({ y: Math.round(window.scrollY) })`));
      await sleep(30);
    }
    const ys = series.filter(Boolean).map((s) => s.y);
    const startY = beforeCollapse.scrollY;
    const endY = ys.length ? ys[ys.length - 1] : null;
    const afterCollapse = await jsonEval(`(function(){
      var bs = Array.from(document.querySelectorAll('[data-homepage-ladder] [data-homepage-ladder-group-toggle]'));
      var btn = bs[bs.length - 1];
      var grid = btn.closest('[data-ladder-group]').querySelector('[data-ladder-grid]');
      return JSON.stringify({
        scrollY: Math.round(window.scrollY),
        gridTop: Math.round(grid.getBoundingClientRect().top),
        rowsVisible: Number(grid.getAttribute('data-ladder-grid-rows-visible')),
        rowsTotal: Number(grid.getAttribute('data-ladder-grid-rows-total')),
        expanded: btn.getAttribute('aria-expanded')
      });
    })()`);
    log('  采样 scrollY：' + JSON.stringify(ys));
    log('  收起后：' + JSON.stringify(afterCollapse));
    check('收起后确实**向上**滚动', endY !== null && endY < startY, 'start=' + startY + ' end=' + endY);
    check(
      '是**渐进动画**而非瞬跳（存在严格介于首尾之间的采样）',
      ys.some((y) => y < startY && y > endY),
      JSON.stringify(ys),
    );
    check(
      '落点 = 本组网格顶部距视口顶 88px（±6px）',
      !!afterCollapse && Math.abs(afterCollapse.gridTop - 88) <= 6,
      afterCollapse ? 'gridTop=' + afterCollapse.gridTop : 'n/a',
    );
    check(
      '该组同时收成 3 行（滚动与折叠是同一动作的两面）',
      !!afterCollapse && afterCollapse.rowsVisible === 3 && afterCollapse.rowsTotal > 3 && afterCollapse.expanded === 'false',
      JSON.stringify(afterCollapse),
    );
  }

  // ---------- N. 断板 vs 连板：双通道 + **夜间可读性硬门槛**（用户 2026-09-19） ----------
  // 「夜间模式下断板划线展示和连板个股区分度太低，换一种更明显的，后续 UI 设计都要考虑夜间模式的可读性」
  // 量化根因：暗色 --foreground oklch(0.92) / --muted-foreground oklch(0.715) 只差 0.205 ⇒ 文本对比 2.00:1，
  // 而亮色是 3.03:1（夜间仅为日间的 66%）；且再压暗断板名会伤它自己的可读性 ⇒ 文字通道已到顶。
  // 故新增**形状通道**（断板格虚线描边，layout-neutral 的 outline），并在此设硬门槛。
  log('');
  log('--- N. 断板格 vs 连板格：形状通道（虚线描边）+ 两主题可读性门槛 ---');
  const LADDER_CHANNEL_READ = `(function(){
    var cv = document.createElement('canvas'); cv.width = cv.height = 1;
    var ctx = cv.getContext('2d', { willReadFrequently: true });
    var lin = function(v){ v/=255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); };
    // ⚠️ Chrome 现在把颜色算成 oklch()/oklab()，正则匹配 rgb 会全 null ⇒ 一律经 canvas 合成成真实 sRGB 像素。
    var over = function(color, base){
      ctx.clearRect(0,0,1,1);
      ctx.fillStyle = base; ctx.fillRect(0,0,1,1);
      ctx.fillStyle = color; ctx.fillRect(0,0,1,1);
      var d = ctx.getImageData(0,0,1,1).data;
      return Number((0.2126*lin(d[0])+0.7152*lin(d[1])+0.0722*lin(d[2])).toFixed(4));
    };
    var ratio = function(a,b){ var hi=Math.max(a,b), lo=Math.min(a,b); return Number(((hi+0.05)/(lo+0.05)).toFixed(2)); };
    var cells = Array.from(document.querySelectorAll('[data-homepage-ladder] [data-ladder-stock]'));
    var cardEl = document.querySelector('[data-homepage-ladder]');
    if (!cells.length || !cardEl) return null;
    var cardBg = getComputedStyle(cardEl).backgroundColor;
    var cardLum = over(cardBg, 'rgb(255,255,255)');
    var items = cells.map(function(c){
      var nameEl = c.children[1]; if (!nameEl) return null;
      var cs = getComputedStyle(nameEl), ccs = getComputedStyle(c);
      var hasOutline = ccs.outlineStyle !== 'none' && parseFloat(ccs.outlineWidth) > 0;
      return {
        broken: cs.textDecorationLine.indexOf('line-through') >= 0,
        nameLum: over(cs.color, cardBg),
        outline: hasOutline,
        outlineStyle: ccs.outlineStyle,
        outlineVsCard: hasOutline ? ratio(over(ccs.outlineColor, cardBg), cardLum) : null
      };
    }).filter(Boolean);
    var bset = items.filter(function(x){ return x.broken; });
    var nset = items.filter(function(x){ return !x.broken; });
    var mean = function(a){ return a.length ? Number((a.reduce(function(s,x){return s+x;},0)/a.length).toFixed(4)) : null; };
    var bLum = mean(bset.map(function(x){ return x.nameLum; }));
    var nLum = mean(nset.map(function(x){ return x.nameLum; }));
    var outlineRatios = bset.filter(function(x){ return x.outlineVsCard !== null; }).map(function(x){ return x.outlineVsCard; });
    return JSON.stringify({
      dark: document.documentElement.classList.contains('dark'),
      counts: { broken: bset.length, normal: nset.length },
      brokenWithOutline: bset.filter(function(x){ return x.outline; }).length,
      normalWithOutline: nset.filter(function(x){ return x.outline; }).length,
      brokenOutlineStyle: bset.length ? bset[0].outlineStyle : null,
      brokenOutlineMinVsCard: outlineRatios.length ? Math.min.apply(null, outlineRatios) : null,
      textSep: (bLum !== null && nLum !== null) ? ratio(bLum, nLum) : null,
      brokenMeanLum: bLum, normalMeanLum: nLum
    });
  })()`;
  const expandAllLadderGroups = () =>
    evalJs(`(function(){ var bs = Array.from(document.querySelectorAll('[data-homepage-ladder] [data-homepage-ladder-group-toggle]')); bs.forEach(function(b){ if (b.getAttribute('aria-expanded') === 'false') b.click(); }); return bs.length; })()`);
  const ladderByTheme = {};
  for (const theme of ['light', 'dark']) {
    const ok = await switchTheme(theme);
    if (!ok) { ladderByTheme[theme] = null; continue; }
    await expandAllLadderGroups();
    await sleep(900);
    ladderByTheme[theme] = await jsonEval(LADDER_CHANNEL_READ);
    log('  ' + theme + '：' + JSON.stringify(ladderByTheme[theme]));
  }
  const lightL = ladderByTheme.light, darkL = ladderByTheme.dark;
  if (!lightL || !darkL) {
    skipCheck('N 断板/连板双通道', '切主题后梯队未渲染：' + JSON.stringify(ladderByTheme));
  } else {
    check(
      '形状通道：**两种主题**下断板格全部带虚线描边，且连板格一个都没有',
      lightL.brokenWithOutline === lightL.counts.broken && lightL.normalWithOutline === 0 &&
        darkL.brokenWithOutline === darkL.counts.broken && darkL.normalWithOutline === 0 &&
        lightL.brokenOutlineStyle === 'dashed' && darkL.brokenOutlineStyle === 'dashed',
      JSON.stringify({ light: [lightL.brokenWithOutline + '/' + lightL.counts.broken, lightL.normalWithOutline + '/' + lightL.counts.normal, lightL.brokenOutlineStyle],
        dark: [darkL.brokenWithOutline + '/' + darkL.counts.broken, darkL.normalWithOutline + '/' + darkL.counts.normal, darkL.brokenOutlineStyle] }),
    );
    check(
      '🔴 **夜间可读性门槛**：描边合成色 vs 卡片底色的对比度 **两主题都 ≥ 3:1**',
      lightL.brokenOutlineMinVsCard >= 3 && darkL.brokenOutlineMinVsCard >= 3,
      'light=' + lightL.brokenOutlineMinVsCard + ':1 / dark=' + darkL.brokenOutlineMinVsCard + ':1',
    );
    check(
      '既有文字通道不退化：夜间文本分离度 ≥ 1.7:1 且不低于日间的 60%',
      darkL.textSep >= 1.7 && darkL.textSep >= lightL.textSep * 0.6,
      'light=' + lightL.textSep + ':1 / dark=' + darkL.textSep + ':1（比值 ' + Number((darkL.textSep / lightL.textSep).toFixed(2)) + '）',
    );
  }

  log('');
  log('=== 汇总：PASS=' + pass + ' FAIL=' + fail + ' SKIP=' + skip + ' ===');
  cleanup();
})();
