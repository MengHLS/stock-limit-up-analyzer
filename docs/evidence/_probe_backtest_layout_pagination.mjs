/**
 * /backtest（组合回测）页签归属 + 「全部模拟订单」分页探针 —— 需求 2026-09-18「优化组合回测页面」
 *
 * 需求（用户原话）：
 *   ① 回测总览页面展示「全周期五策略收益对比」+「交易明细页面中的当前持仓与下一交易日准备买入」+「全部模拟订单」；
 *   ② 全部模拟订单加入分页；
 *   ③ 把「高位连板风控生效情况」「统一策略评价」「资金与仓位审计」放到剩下合适的模块。
 *
 * 本探针用**真实浏览器渲染 + 真实鼠标事件**（CDP Input）量 DOM：
 *   A. 页签导航（6 项、标签序列）
 *   B. 回测总览 = 全周期五策略收益对比 + 当前持仓与下一交易日准备买入 + 全部模拟订单，
 *      且**不得**再出现被迁出的三块（统一策略评价 / 高位连板风控生效情况 / 资金与仓位审计）
 *   C. 全部模拟订单分页：每页切片、下一页、最后一页、每页条数切换、筛选后回到第 1 页
 *   D. 策略对比 → 统一策略评价（+ 既有样本外曲线）
 *   E. 风险归因 → 高位连板风控生效情况
 *   F. 交易明细 → 资金与仓位审计（+ 迁移提示，+ 不得再出现订单表）
 *   G. 参数配置 / 历史记录 页签零回归
 *
 * ⚠️ 该页数据来自 `sentiment.getLeaderCandidateResearch`（研究-legacy 全周期模拟，冷算很慢）。
 *    本探针默认最多等 40 分钟；数据未就绪时数据相关项一律记 SKIP（**不谎报 PASS**）。
 *
 * 用法（项目根执行，端口只认启动日志）：
 *   node docs/evidence/_probe_backtest_layout_pagination.mjs [BASE_URL] [BROWSER_EXE] [DATA_WAIT_MS]
 *
 * ⚠️ 输出**必须同步落盘**：探针若被超时 SIGTERM 杀掉，未 flush 的 console 输出会全部丢失。
 *    同名 `.out.txt` 即本探针的留档结果。
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const HERE = import.meta.dirname;
const OUT = path.join(HERE, '_probe_backtest_layout_pagination.out.txt');
const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const DATA_WAIT_MS = Number(process.argv[4] || 40 * 60 * 1000);

const CANDIDATE_BROWSERS = [
  process.argv[3],
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const BROWSER = CANDIDATE_BROWSERS.find((p) => { try { return fs.existsSync(p); } catch { return false; } });

const isPortFree = (p) => new Promise((res) => {
  const s = net.createServer();
  s.once('error', () => res(false));
  s.listen(p, '127.0.0.1', () => s.close(() => res(true)));
});
/** 端口必须实测空闲：上一轮探针残留的 Chrome 会占住 30000/30001 之类的高位端口。 */
async function pickPort() {
  for (let i = 0; i < 60; i++) {
    const p = 21000 + Math.floor(Math.random() * 8000);
    if (await isPortFree(p)) return p;
  }
  return null;
}
const PORT = await pickPort();
if (!PORT) { console.error('未找到空闲调试端口'); process.exit(1); }
const UDD = path.join(os.tmpdir(), 'btprobe-' + Date.now());
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

const TAB_NAV = 'nav[aria-label="回测页签导航"]';
const EXPECTED_TABS = ['回测总览', '参数配置', '策略对比', '风险归因', '交易明细', '历史记录'];

const Q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const HAS = (sel) => `!!${Q(sel)}`;
const TEXT_HAS = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`;

(async () => {
  if (!BROWSER) { logErr('未找到 Chrome / Edge 可执行文件'); return cleanup(); }
  log('== /backtest 页签归属 + 模拟订单分页 探针 ==', new Date().toISOString());
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
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
  await new Promise((r) => { ws.onopen = r; });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('DOM.enable');
  log('CDP 已连接');

  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: false });
    if (r && r.exceptionDetails) return undefined;
    return r && r.result ? r.result.value : undefined;
  };
  /** 真实鼠标点击（Radix Select 只认 pointerdown ⇒ 纯 JS .click() 不可靠）。 */
  const realClick = async (sel) => {
    const raw = await evalJs(`(()=>{const e=${Q(sel)}; if(!e) return null; e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});})()`);
    if (!raw) return false;
    await sleep(150);
    const { x, y } = JSON.parse(raw);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await sleep(250);
    return true;
  };
  /** React 受控 input 赋值：走原生 setter + input 事件，否则 React 读不到新值。 */
  const typeInto = async (sel, value) => evalJs(`(()=>{const e=${Q(sel)}; if(!e) return 'not-found'; const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; setter.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event('input',{bubbles:true})); return 'typed';})()`);

  const tabsOf = async () => evalJs(`Array.from(document.querySelectorAll(${JSON.stringify(TAB_NAV + ' button')})).map(b=>(b.textContent||'').trim())`);
  const activeTab = async () => evalJs(`(()=>{const b=document.querySelector(${JSON.stringify(TAB_NAV + ' button[aria-selected="true"]')}); return b?(b.textContent||'').trim():'';})()`);
  const clickTab = async (label) => evalJs(`(()=>{const b=Array.from(document.querySelectorAll(${JSON.stringify(TAB_NAV + ' button')})).find(x=>(x.textContent||'').trim()===${JSON.stringify(label)}); if(!b) return 'not-found'; b.click(); return 'clicked';})()`);
  const rowCount = async () => evalJs(`document.querySelectorAll('[data-all-simulated-orders] tbody tr').length`);
  const firstRow = async () => evalJs(`(()=>{const r=document.querySelector('[data-all-simulated-orders] tbody tr'); return r?(r.textContent||'').slice(0,48):'';})()`);
  const rangeText = async () => evalJs(`(()=>{const e=document.querySelector('[data-orders-range]'); return e?(e.textContent||'').trim():'';})()`);
  const pageIndicator = async () => evalJs(`(()=>{const p=document.querySelector('[data-orders-pagination]'); if(!p) return ''; const m=(p.textContent||'').match(/第\\s*(\\d+)\\s*\\/\\s*(\\d+)\\s*页/); return m?m[1]+' / '+m[2]:'';})()`);
  /** 当前「每页条数」= Select 触发器上的文案（如「20 条」）；读不到时按组件默认 20 计。 */
  const currentPageSize = async () => {
    const t = await evalJs(`(()=>{const e=document.querySelector('[data-orders-pagination] [data-slot="select-trigger"]'); return e?(e.textContent||'').trim():'';})()`);
    const n = Number(String(t).replace(/[^\d]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : 20;
  };

  let pass = 0, fail = 0, skip = 0;
  const check = (name, ok, detail) => { ok ? pass++ : fail++; log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + name + (detail === undefined ? '' : '  → ' + detail)); };
  const skipCheck = (name, why) => { skip++; log('  SKIP  ' + name + '  → ' + why); };
  const mustNot = async (sel, label) => check(label, !(await evalJs(HAS(sel))), 'selector=' + sel);

  // ---------- 打开页面 ----------
  let tabs = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    await send('Page.navigate', { url: BASE + '/backtest' });
    for (let i = 0; i < 120; i++) {
      await sleep(500);
      const t = await tabsOf();
      if (Array.isArray(t) && t.length >= 6) { tabs = t; break; }
    }
    if (tabs) break;
    log('  ... 第 ' + (attempt + 1) + ' 次页签未渲染，重试');
  }
  if (!tabs) { logErr('页签导航始终未渲染（dev 服务器或前端未就绪）'); log('=== 汇总：探针中止 ==='); return cleanup(); }

  log('');
  log('--- A. 页签导航 ---');
  check('页签数量 = 6', tabs.length === 6, JSON.stringify(tabs));
  check('页签标签与顺序正确', JSON.stringify(tabs) === JSON.stringify(EXPECTED_TABS), JSON.stringify(tabs));
  check('默认页签 = 回测总览', (await activeTab()) === '回测总览', await activeTab());

  // ---------- 等待数据（冷算很慢） ----------
  log('');
  log('--- 等待 /backtest 研究数据（冷算可能数十分钟） ---');
  const t0 = Date.now();
  let dataReady = false;
  while (Date.now() - t0 < DATA_WAIT_MS) {
    if (await evalJs(HAS('[data-full-cycle-comparison]'))) { dataReady = true; break; }
    const secs = Math.round((Date.now() - t0) / 1000);
    if (secs % 60 < 15) log('  ... 已等待 ' + secs + 's（仍无 [data-full-cycle-comparison]）');
    await sleep(15000);
  }
  log('  数据就绪=' + dataReady + '，等待 ' + Math.round((Date.now() - t0) / 1000) + 's');

  if (!dataReady) {
    log('');
    log('--- B~G. 数据相关断言 ---');
    for (const n of ['B 回测总览三块同屏', 'C 全部模拟订单分页', 'D 策略对比=统一策略评价', 'E 风险归因=高位连板风控生效情况', 'F 交易明细=资金与仓位审计', 'G 参数配置/历史记录']) skipCheck(n, '研究数据未就绪（' + Math.round(DATA_WAIT_MS / 60000) + 'min 内未出结果）');
    log('');
    log('=== 汇总：PASS ' + pass + ' / FAIL ' + fail + ' / SKIP ' + skip + ' ⇒ DATA NOT READY（未验证，不谎报通过）===');
    log('结果留档：' + OUT);
    ws.close(); return cleanup();
  }

  // ---------- B. 回测总览 ----------
  log('');
  log('--- B. 回测总览（默认页签）---');
  await clickTab('回测总览'); await sleep(600);
  check('总览含 全周期五策略收益对比', await evalJs(HAS('[data-full-cycle-comparison]')));
  check('总览含文字「全周期五策略收益对比」', await evalJs(TEXT_HAS('全周期五策略收益对比')));
  check('总览含 当前持仓与下一交易日准备买入', await evalJs(HAS('[data-strategy-portfolio-snapshot]')));
  check('总览含文字「当前持仓与下一交易日准备买入」', await evalJs(TEXT_HAS('当前持仓与下一交易日准备买入')));
  check('总览含 全部模拟订单', await evalJs(HAS('[data-all-simulated-orders]')));
  await mustNot('[data-strategy-evaluation]', '总览不得再出现 统一策略评价');
  await mustNot('[data-board-height-impact]', '总览不得再出现 高位连板风控生效情况');
  await mustNot('[data-capital-position-audit]', '总览不得再出现 资金与仓位审计');

  // ---------- C. 分页 ----------
  log('');
  log('--- C. 全部模拟订单分页（真实鼠标事件）---');
  const range = await rangeText();
  const parsed = /^本页第 (\d+)–(\d+) 笔（当前筛选共 (\d+) 笔 \/ 全部 (\d+) 笔）$/.exec(range);
  check('[data-orders-range] 文案格式正确', parsed !== null, JSON.stringify(range));
  check('存在 [data-orders-pagination]', await evalJs(HAS('[data-orders-pagination]')));
  const total = parsed ? Number(parsed[3]) : null;
  const rows1 = await rowCount();
  check('第 1 页行数 = min(20, 筛选后笔数)', rows1 === Math.min(20, total ?? 0), 'rows=' + rows1 + ' total=' + total);
  const ind1 = await pageIndicator();
  check('页指示 = 1 / ceil(N/20)', ind1 === '1 / ' + Math.ceil((total ?? 0) / 20), 'indicator=' + ind1);

  if ((total ?? 0) > 20) {
    const first1 = await firstRow();
    await realClick('[data-orders-pagination] button[title="下一页"]'); await sleep(500);
    const ind2 = await pageIndicator();
    const rows2 = await rowCount();
    const first2 = await firstRow();
    check('点「下一页」→ 第 2 页', ind2.startsWith('2 /'), 'indicator=' + ind2);
    check('第 2 页行数正确', rows2 === Math.min(20, total - 20), 'rows=' + rows2);
    check('第 2 页首行与第 1 页不同（确有切片）', first2 !== first1, JSON.stringify(first1) + ' vs ' + JSON.stringify(first2));

    await realClick('[data-orders-pagination] button[title="最后一页"]'); await sleep(500);
    const pages = Math.ceil(total / 20);
    const indLast = await pageIndicator();
    const rowsLast = await rowCount();
    check('点「最后一页」→ 末页', indLast.startsWith(pages + ' /'), 'indicator=' + indLast);
    check('末页行数 = N - (pages-1)*20', rowsLast === total - (pages - 1) * 20, 'rows=' + rowsLast + ' expected=' + (total - (pages - 1) * 20));

    // 每页条数：Radix Select（真实鼠标）
    const opened = await realClick('[data-orders-pagination] [data-slot="select-trigger"]');
    await sleep(400);
    const optionClicked = (await realClick('[data-slot="select-item"][data-value="50"]'))
      || (await realClick('[data-slot="select-item"]:not([data-disabled])'));
    await sleep(400);
    const sizeText = await evalJs(`(()=>{const e=document.querySelector('[data-orders-pagination] [data-slot="select-trigger"]'); return e?(e.textContent||'').trim():'';})()`);
    if (!opened || sizeText === '20 条') {
      skipCheck('每页条数切换（Radix Select 未在无头环境打开）', 'opened=' + opened + ' sizeText=' + JSON.stringify(sizeText) + ' optionClicked=' + optionClicked);
    } else {
      const rowsAfterSize = await rowCount();
      const indAfterSize = await pageIndicator();
      const sizeNow = await currentPageSize();
      check('切换每页条数后回到第 1 页', indAfterSize.startsWith('1 /'), 'indicator=' + indAfterSize + ' size=' + sizeText);
      check('切换每页条数后行数 = min(新条数, N)', rowsAfterSize === Math.min(sizeNow, total), 'rows=' + rowsAfterSize + ' size=' + sizeNow + ' N=' + total);
    }
  } else {
    skipCheck('下一页 / 最后一页 / 每页条数', '筛选后仅 ' + total + ' 笔，不足一页');
  }

  // 筛选后回到第 1 页
  await evalJs(`(()=>{const b=document.querySelector('[data-orders-pagination] button[title="最后一页"]'); if(b && !b.disabled) b.click();})()`);
  await sleep(400);
  const typed = await typeInto('[data-all-simulated-orders] input[placeholder="代码或名称"]', '6');
  await sleep(700);
  const indAfterFilter = await pageIndicator();
  const rangeAfterFilter = await rangeText();
  const parsedAfter = /^本页第 (\d+)–(\d+) 笔（当前筛选共 (\d+) 笔 \/ 全部 (\d+) 笔）$/.exec(rangeAfterFilter);
  check('筛选输入可用', typed === 'typed', String(typed));
  check('筛选后页码回到第 1 页', indAfterFilter.startsWith('1 /'), 'indicator=' + indAfterFilter);
  check('筛选后 range 文案重新解析', parsedAfter !== null, JSON.stringify(rangeAfterFilter));
  if (parsedAfter) {
    const filteredTotal = Number(parsedAfter[3]);
    const expectedRows = Number(parsedAfter[2]) - Number(parsedAfter[1]) + 1;
    const rowsFiltered = await rowCount();
    const pageSizeNow = await currentPageSize();
    check('筛选后行数 = 页内区间长度（第 a–b 笔 ⇒ b-a+1 行）', rowsFiltered === expectedRows, 'rows=' + rowsFiltered + ' range=' + parsedAfter[1] + '–' + parsedAfter[2] + ' pageSize=' + pageSizeNow);
    check('筛选后行数 = min(每页条数, 筛选后笔数)', rowsFiltered === Math.min(pageSizeNow, filteredTotal), 'rows=' + rowsFiltered + ' pageSize=' + pageSizeNow + ' filteredTotal=' + filteredTotal);
    check('筛选确实收窄了笔数', filteredTotal <= total, filteredTotal + ' <= ' + total);
  }
  await typeInto('[data-all-simulated-orders] input[placeholder="代码或名称"]', '');
  await sleep(400);

  // ---------- D. 策略对比 ----------
  log('');
  log('--- D. 策略对比 ---');
  await clickTab('策略对比'); await sleep(700);
  check('策略对比含 统一策略评价（data-strategy-evaluation）', await evalJs(HAS('[data-strategy-evaluation]')));
  check('策略对比含文字「统一策略评价」', await evalJs(TEXT_HAS('统一策略评价')));
  check('策略对比含 样本外累计拼接曲线', await evalJs(HAS('[data-walk-forward]')));
  await mustNot('[data-all-simulated-orders]', '策略对比不得出现 全部模拟订单');
  await mustNot('[data-strategy-portfolio-snapshot]', '策略对比不得出现 持仓快照');

  // ---------- E. 风险归因 ----------
  log('');
  log('--- E. 风险归因 ---');
  await clickTab('风险归因'); await sleep(700);
  check('风险归因含 高位连板风控生效情况（data-board-height-impact）', await evalJs(HAS('[data-board-height-impact]')));
  check('风险归因含文字「高位连板风控生效情况」', await evalJs(TEXT_HAS('高位连板风控生效情况')));
  await mustNot('[data-all-simulated-orders]', '风险归因不得出现 全部模拟订单');
  await mustNot('[data-capital-position-audit]', '风险归因不得出现 资金与仓位审计');

  // ---------- F. 交易明细 ----------
  log('');
  log('--- F. 交易明细 ---');
  await clickTab('交易明细'); await sleep(700);
  check('交易明细含 资金与仓位审计（data-capital-position-audit）', await evalJs(HAS('[data-capital-position-audit]')));
  check('交易明细含文字「资金与仓位审计」', await evalJs(TEXT_HAS('资金与仓位审计')));
  check('交易明细含迁移提示（data-trades-relocated-note）', await evalJs(HAS('[data-trades-relocated-note]')));
  await mustNot('[data-all-simulated-orders]', '交易明细不得出现 全部模拟订单');
  await mustNot('[data-strategy-portfolio-snapshot]', '交易明细不得出现 持仓快照');

  // ---------- G. 零回归 ----------
  log('');
  log('--- G. 参数配置 / 历史记录（零回归）---');
  await clickTab('参数配置'); await sleep(700);
  check('参数配置含 高位连板风控参数卡', await evalJs(HAS('[data-board-height-risk-params]')));
  check('参数配置含 次日开盘预期三档卡', await evalJs(HAS('[data-open-expectation-params]')));
  check('参数配置含文字「回测参数」', await evalJs(TEXT_HAS('回测参数')));
  await clickTab('历史记录'); await sleep(900);
  check('历史记录含「历史回测记录」', await evalJs(TEXT_HAS('历史回测记录')));

  // ---------- H. 卡片几何一致性 ----------
  // 触发背景（2026-09-18 用户实报）：迁入「策略对比」的「统一策略评价」当时**没有套容器类**
  // （`mx-auto max-w-7xl px-4 pt-5 sm:px-6` 写在本页其余卡片的 `<section>` 上），因此它铺满整屏、
  // 宽度与左边距都跟邻卡不一致。本组断言把「同屏卡片的左边距 / 宽度必须一致」变成常驻护栏。
  log('');
  log('--- H. 卡片几何一致性（左边距 / 宽度）---');
  // 🔴 必须量**卡片本体**而不是锚点元素：本页有两种写法 —— ① 部分区块把容器类
  // `mx-auto max-w-7xl px-4 pt-5 sm:px-6` 写在自己的 `<section>` 上，锚点 = 带内边距的外框，
  // 卡片是它的第一个 `rounded-2xl` 子元素；② 另一部分锚点本身就是卡片。
  // 直接量锚点会得到 280/1255 vs 304/1207 的**假差异**（差的正是 24px 内边距）。
  const cardRect = async (sel) => {
    const raw = await evalJs(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; const c=e.querySelector(':scope > .rounded-2xl') || e; const r=c.getBoundingClientRect(); return JSON.stringify([Math.round(r.left), Math.round(r.width)]);})()`);
    return raw ? JSON.parse(raw) : null;
  };
  const GEOMETRY = {
    回测总览: ['[data-full-cycle-comparison]', '[data-strategy-portfolio-snapshot]', '[data-all-simulated-orders]'],
    策略对比: ['[data-strategy-evaluation]', '[data-walk-forward]', '[data-ten-window-stability]', '[data-risk-penalty-attribution]'],
    风险归因: ['[data-board-height-impact]', '[data-factor-ablation]'],
  };
  for (const [tab, sels] of Object.entries(GEOMETRY)) {
    await clickTab(tab); await sleep(700);
    const rows = [];
    for (const s of sels) { const r = await cardRect(s); if (r) rows.push([s, r[0], r[1]]); }
    if (rows.length < 2) { skipCheck(tab + ' 卡片几何一致性', '同屏可见卡片不足 2 个（实测 ' + rows.length + ' 个）'); continue; }
    const base = rows[0];
    const mismatch = rows.filter((r) => Math.abs(r[1] - base[1]) > 1 || Math.abs(r[2] - base[2]) > 1);
    check(tab + ' 同屏卡片 左边距/宽度 一致（±1px）', mismatch.length === 0, '基准=' + JSON.stringify(base) + (mismatch.length ? ' 异常=' + JSON.stringify(mismatch) : ' 全部=' + JSON.stringify(rows.map((r) => r[1] + '/' + r[2]))));
  }

  // 反事实对照：把容器类当场剥掉 ⇒ 卡片应立刻变宽（= 用户实报「样式乱了」的原始形态）。
  // 这证明该容器类是**承重件**（不是可有可无的装饰），从而证明本轮修复真的消除了现象。
  log('');
  log('--- H2. 反事实对照（剥掉容器类，验证修复是承重的）---');
  await clickTab('策略对比'); await sleep(700); // H 段最后一轮停在「风险归因」，此处必须先切回
  const normal = await cardRect('[data-strategy-evaluation]');
  const strippedRaw = await evalJs(`(()=>{const c=document.querySelector('[data-strategy-evaluation]'); if(!c) return null; const p=c.parentElement; const keep=p.getAttribute('class'); p.removeAttribute('class'); const r=c.getBoundingClientRect(); if(keep===null){p.removeAttribute('class');}else{p.setAttribute('class', keep);} return JSON.stringify([Math.round(r.left), Math.round(r.width)]);})()`);
  const stripped = strippedRaw ? JSON.parse(strippedRaw) : null;
  check('剥掉容器类后卡片显著变宽（还原用户报告的形态）', !!stripped && !!normal && stripped[1] > normal[1] + 10, '套容器=' + JSON.stringify(normal) + ' 剥容器=' + JSON.stringify(stripped));

  log('');
  const verdict = fail === 0 && skip === 0 ? 'ALL PASS' : fail === 0 ? 'PASS（含 SKIP）' : 'HAS FAILURE';
  log('=== 汇总：PASS ' + pass + ' / FAIL ' + fail + ' / SKIP ' + skip + ' ⇒ ' + verdict + ' ===');
  log('结果留档：' + OUT);
  ws.close(); cleanup();
})().catch((e) => { logErr('ERR', (e && e.stack) || String(e)); cleanup(); });
