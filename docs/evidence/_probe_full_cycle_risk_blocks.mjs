/**
 * /backtest（组合回测）→ 回测总览「全周期五策略收益对比」折线图**下方**新增区块的探针。
 *
 * 需求（事项 rZPX8O 原文）：
 *   在回测总览全周期五策略收益对比的区域中，折线图下面加入几个区块，
 *   用来展示每种策略的「最大回撤 / 回撤持续时间 / 收复回撤所用时间 / 最大收益百分比 / 当前收益百分比」。
 *
 * 本探针用**真实浏览器渲染**量 DOM（不靠源码字符串自查），断言五组：
 *   A. 区块存在且在**同一张卡片**内、紧贴折线图下方（`[data-full-cycle-risk-blocks]` 属于 `[data-full-cycle-comparison]` 卡片）
 *   B. 恰好 5 个策略卡片，key 顺序 = baseline / riskPenalty / hardFilter / qualityBlend / qualityGate，标题与折线图一致
 *   C. 每张卡**五项指标都在**，且格式合法（百分比 / N 个交易日 / 样本不足），不得出现空值或 NaN
 *   D. **口径交叉核对**：最大回撤 / 回撤持续时间 / 收复回撤所用时间 三项必须与「策略对比 → 六层评价」里
 *      同一个策略的 Max Drawdown / 最大回撤持续时间 / 最大回撤恢复时间**数值一致**（证明没有偷偷另立一套口径）；
 *      当前收益必须与六层评价的 Total Return 一致。
 *      🔴 两项时长的口径（`9bh` 起）= 锁定**最大回撤那一次**回撤区间：持续＝峰值日→谷底日、
 *         收复＝谷底日回到前高（未收复计至期末）。与六层评价同源，故此段**仍然成立**。
 *   E. 几何一致性：5 张卡片同排等宽、且左边缘与折线图对齐（不允许出现「风格乱了」那类错位）
 *
 * ⚠️ 该页数据来自 `sentiment.getLeaderCandidateResearch`（研究-legacy 全周期模拟，冷算很慢）。
 *    数据未就绪时一律记 SKIP（**不谎报 PASS**）。
 *
 * 用法（项目根执行，端口只认启动日志）：
 *   node docs/evidence/_probe_full_cycle_risk_blocks.mjs [BASE_URL] [BROWSER_EXE] [DATA_WAIT_MS]
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
const OUT = path.join(HERE, '_probe_full_cycle_risk_blocks.out.txt');
const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const DATA_WAIT_MS = Number(process.argv[4] || 20 * 60 * 1000);

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
const UDD = path.join(os.tmpdir(), 'rbprobe-' + Date.now());
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
// ⚠️ 标题取服务端实验自带 label（与折线图 Legend 同源），首项是「原始策略」而非订单页签用的「原始评分基准」。
const STRATEGY_LABELS = ['原始策略', '风险扣分策略', '高风险硬过滤', '质量复合评分', '质量门控策略'];
const STRATEGY_KEYS = ['baseline', 'riskPenalty', 'hardFilter', 'qualityBlend', 'qualityGate'];
const METRIC_LABELS = ['最大回撤', '回撤持续时间', '收复回撤所用时间', '最大收益', '当前收益'];

const Q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
const HAS = (sel) => `!!${Q(sel)}`;
const TEXT_HAS = (t) => `document.body.innerText.includes(${JSON.stringify(t)})`;

/** 从形如 "+21.5%" / "-10.00%" / "21 个交易日" / "样本不足" 的文案里取数值。 */
const toNumber = (text) => {
  if (typeof text !== 'string') return null;
  const m = /-?\d+(\.\d+)?/.exec(text.replace(/,/g, ''));
  return m ? Number(m[0]) : null;
};

(async () => {
  if (!BROWSER) { logErr('未找到 Chrome / Edge 可执行文件'); return cleanup(); }
  log('== /backtest 总览「各策略回撤与收益特征」区块 探针 ==', new Date().toISOString());
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
  const evalJson = async (expr) => { const raw = await evalJs(expr); if (typeof raw !== 'string') return null; try { return JSON.parse(raw); } catch { return null; } };

  const tabsOf = async () => evalJs(`Array.from(document.querySelectorAll(${JSON.stringify(TAB_NAV + ' button')})).map(b=>(b.textContent||'').trim())`);
  const clickTab = async (label) => evalJs(`(()=>{const b=Array.from(document.querySelectorAll(${JSON.stringify(TAB_NAV + ' button')})).find(x=>(x.textContent||'').trim()===${JSON.stringify(label)}); if(!b) return 'not-found'; b.click(); return 'clicked';})()`);

  /** 总览新区块：每张卡的 key / 标题 / 五项指标 / 脚注。 */
  const readBlocks = () => evalJson(`(()=>{
    const cards=Array.from(document.querySelectorAll('[data-full-cycle-risk-card]'));
    return JSON.stringify(cards.map((c)=>({
      key:c.getAttribute('data-full-cycle-risk-card'),
      label:((c.querySelector('p')||{}).textContent||'').trim(),
      metrics:Object.fromEntries(Array.from(c.querySelectorAll('dl > div')).map((row)=>{
        const dt=row.querySelector('dt'), dd=row.querySelector('dd');
        return [(dt?dt.textContent:'').trim(),(dd?dd.textContent:'').trim()];
      })),
      note:String((Array.from(c.querySelectorAll('p')).pop()||{}).textContent||'').trim()
    })));
  })()`);

  /** 「策略对比」六层评价：返回 { 指标名 -> 该策略列文案 }。表头第三列起为策略列。 */
  const readSixLayer = (strategyLabel) => evalJson(`(()=>{
    const root=document.querySelector('[data-strategy-evaluation]');
    if(!root) return null;
    const out={};
    for(const t of root.querySelectorAll('table')){
      const heads=Array.from(t.querySelectorAll('thead th')).map(h=>(h.textContent||'').trim());
      const col=heads.indexOf(${JSON.stringify(strategyLabel)});
      if(col<0) continue;
      for(const tr of t.querySelectorAll('tbody tr')){
        const tds=Array.from(tr.querySelectorAll('td'));
        if(tds.length<=col) continue;
        out[(tds[0].textContent||'').trim()]=(tds[col].textContent||'').trim();
      }
    }
    return JSON.stringify(out);
  })()`);

  const rects = () => evalJson(`(()=>{
    const out=[];
    for(const c of document.querySelectorAll('[data-full-cycle-risk-card]')){
      const r=c.getBoundingClientRect();
      out.push([Math.round(r.left),Math.round(r.top),Math.round(r.width)]);
    }
    return JSON.stringify(out);
  })()`);
  const cardRect = (sel) => evalJson(`(()=>{const e=document.querySelector(${JSON.stringify(sel)}); if(!e) return null; const r=e.getBoundingClientRect(); return JSON.stringify([Math.round(r.left),Math.round(r.top),Math.round(r.width)]);})()`);

  let pass = 0, fail = 0, skip = 0;
  const check = (name, ok, detail) => { ok ? pass++ : fail++; log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + name + (detail === undefined ? '' : '  → ' + detail)); };
  const skipCheck = (name, why) => { skip++; log('  SKIP  ' + name + '  → ' + why); };

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
    for (const n of ['A 区块位置', 'B 五策略卡片', 'C 五项指标', 'D 口径交叉核对', 'E 几何一致性']) skipCheck(n, '研究数据未就绪（' + Math.round(DATA_WAIT_MS / 60000) + 'min 内未出结果）');
    log('');
    log('=== 汇总：PASS ' + pass + ' / FAIL ' + fail + ' / SKIP ' + skip + ' ⇒ DATA NOT READY（未验证，不谎报通过）===');
    log('结果留档：' + OUT);
    ws.close(); return cleanup();
  }

  await clickTab('回测总览'); await sleep(800);

  // ---------- A. 区块存在且在同一张卡片内 ----------
  log('');
  log('--- A. 区块位置（折线图下方、同一张卡片内）---');
  check('总览含折线图区块 [data-full-cycle-comparison]', await evalJs(HAS('[data-full-cycle-comparison]')));
  check('总览含新区块 [data-full-cycle-risk-blocks]', await evalJs(HAS('[data-full-cycle-risk-blocks]')));
  check('新区块含标题「各策略回撤与收益特征」', await evalJs(TEXT_HAS('各策略回撤与收益特征')));
  check('新区块是折线图区块的后代（同一张卡片内）', await evalJs(`!!document.querySelector('[data-full-cycle-comparison] [data-full-cycle-risk-blocks]')`));

  // ---------- B. 五策略卡片 ----------
  log('');
  log('--- B. 五策略卡片 ---');
  const blocks = (await readBlocks()) ?? [];
  check('恰好 5 张策略卡片', blocks.length === 5, 'count=' + blocks.length);
  check('卡片 key 顺序正确', JSON.stringify(blocks.map((b) => b.key)) === JSON.stringify(STRATEGY_KEYS), JSON.stringify(blocks.map((b) => b.key)));
  check('卡片标题顺序正确', JSON.stringify(blocks.map((b) => b.label)) === JSON.stringify(STRATEGY_LABELS), JSON.stringify(blocks.map((b) => b.label)));

  // ---------- C. 五项指标 ----------
  log('');
  log('--- C. 五项指标齐全且格式合法 ---');
  // 收益文案带正号（红涨绿跌），回撤文案恒为正值。
  const PCT = /^[+-]?\d+(\.\d+)?%$/;
  const DAYS = /^\d+\s*个交易日$/;
  const UNAVAILABLE = '样本不足';
  let missingMetric = [];
  let badFormat = [];
  let allUnavailable = [];
  for (const block of blocks) {
    const keys = Object.keys(block.metrics);
    for (const label of METRIC_LABELS) {
      if (!keys.includes(label)) missingMetric.push(block.key + '/' + label);
    }
    const dd = block.metrics['最大回撤'];
    if (!PCT.test(String(dd))) badFormat.push(block.key + ' 最大回撤=' + JSON.stringify(dd));
    for (const label of ['回撤持续时间', '收复回撤所用时间']) {
      const v = String(block.metrics[label]);
      if (v !== UNAVAILABLE && !DAYS.test(v)) badFormat.push(block.key + ' ' + label + '=' + JSON.stringify(v));
    }
    for (const label of ['最大收益', '当前收益']) {
      const v = String(block.metrics[label]);
      if (v !== UNAVAILABLE && !PCT.test(v)) badFormat.push(block.key + ' ' + label + '=' + JSON.stringify(v));
      if (v === UNAVAILABLE) allUnavailable.push(block.key + '/' + label);
    }
    if (!/最大收益日.*期末日/.test(block.note)) badFormat.push(block.key + ' 脚注=' + JSON.stringify(block.note));
  }
  check('每张卡都含全部 5 项指标', missingMetric.length === 0, missingMetric.length ? JSON.stringify(missingMetric) : '5 × 5 项齐全');
  check('指标文案格式合法（百分比 / N 个交易日 / 样本不足）', badFormat.length === 0, badFormat.length ? JSON.stringify(badFormat) : '全部合法');
  check('最大收益 / 当前收益 均为可用数值（不得整列样本不足）', allUnavailable.length === 0, allUnavailable.length ? JSON.stringify(allUnavailable) : '5 × 2 项均有值');
  log('  样本（baseline）→ ' + JSON.stringify(blocks[0] ? blocks[0].metrics : null));

  // ---------- D. 口径交叉核对（对「策略对比 → 六层评价」）----------
  log('');
  log('--- D. 口径交叉核对（六层评价同一策略的对应指标）---');
  await clickTab('策略对比'); await sleep(1200);
  if (!(await evalJs(HAS('[data-strategy-evaluation]')))) {
    skipCheck('D 口径交叉核对', '策略对比页的六层评价未渲染');
  } else {
    const CROSS = [
      ['最大回撤', 'Max Drawdown'],
      ['回撤持续时间', '最大回撤持续时间'],
      ['收复回撤所用时间', '最大回撤恢复时间'],
      ['当前收益', 'Total Return'],
    ];
    for (const block of blocks) {
      const six = (await readSixLayer(block.label)) ?? {};
      for (const [mine, theirs] of CROSS) {
        const left = toNumber(block.metrics[mine]);
        const right = toNumber(six[theirs]);
        check(block.label + ' · ' + mine + ' = 六层「' + theirs + '」',
          left !== null && right !== null && Math.abs(left - right) < 1e-9,
          '区块=' + JSON.stringify(block.metrics[mine]) + ' 六层=' + JSON.stringify(six[theirs] ?? null));
      }
    }
  }

  // ---------- E. 几何一致性 ----------
  log('');
  log('--- E. 几何一致性（同排等宽 / 与折线图对齐）---');
  await clickTab('回测总览'); await sleep(1000);
  const shell = await cardRect('[data-full-cycle-comparison]');
  const chart = await cardRect('[data-full-cycle-comparison] .recharts-wrapper');
  const cards = (await rects()) ?? [];
  check('区块在切回总览后仍在（页签归属）', cards.length === 5, 'count=' + cards.length);
  const ref = cards[0];
  if (!shell || !chart || cards.length < 5) {
    skipCheck('E 几何一致性', 'shell=' + JSON.stringify(shell) + ' chart=' + JSON.stringify(chart) + ' cards=' + cards.length);
  } else {
    const widthMismatch = cards.filter((c) => Math.abs(c[2] - ref[2]) > 1);
    const topMismatch = cards.filter((c) => Math.abs(c[1] - ref[1]) > 1);
    check('5 张卡片同排等宽（±1px）', widthMismatch.length === 0, '基准宽=' + ref[2] + ' 全部=' + JSON.stringify(cards.map((c) => c[2])));
    check('5 张卡片同一行（top 一致 ±1px）', topMismatch.length === 0, '基准 top=' + ref[1] + ' 全部=' + JSON.stringify(cards.map((c) => c[1])));
    const rowLeft = Math.min(...cards.map((c) => c[0]));
    const rowRight = Math.max(...cards.map((c) => c[0] + c[2]));
    check('卡片行左边缘与折线图对齐（±1px）', Math.abs(rowLeft - chart[0]) <= 1, '卡片左=' + rowLeft + ' 折线图左=' + chart[0]);
    check('卡片行宽度与折线图一致（±1px）', Math.abs((rowRight - rowLeft) - chart[2]) <= 1, '卡片行宽=' + (rowRight - rowLeft) + ' 折线图宽=' + chart[2]);
    check('卡片行不越出所属卡片（不铺满整屏）', rowLeft >= shell[0] && rowRight <= shell[0] + shell[2], '卡片=[' + shell[0] + ',' + (shell[0] + shell[2]) + '] 行=[' + rowLeft + ',' + rowRight + ']');
    check('区块位于折线图下方（间距 250~520px）', ref[1] - chart[1] >= 250 && ref[1] - chart[1] <= 520, '区块 top=' + ref[1] + ' 折线图 top=' + chart[1] + ' 间距=' + (ref[1] - chart[1]));
  }

  log('');
  const verdict = fail === 0 && skip === 0 ? 'ALL PASS' : fail === 0 ? 'PASS（含 SKIP）' : 'HAS FAILURE';
  log('=== 汇总：PASS ' + pass + ' / FAIL ' + fail + ' / SKIP ' + skip + ' ⇒ ' + verdict + ' ===');
  log('结果留档：' + OUT);
  ws.close(); cleanup();
})().catch((e) => { logErr('ERR', (e && e.stack) || String(e)); cleanup(); });
