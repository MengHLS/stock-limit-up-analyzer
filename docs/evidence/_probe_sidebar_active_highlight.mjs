/**
 * 侧栏高亮回归探针 —— `AppShell.tsx#isPathActive`
 *
 * 背景（2026-09-15 用户报障）：
 *   旧实现 `location.startsWith(item.path)` 是**纯字符串前缀匹配**，把「前缀相同但完全
 *   不同的板块」一起点亮 —— `/backtest-runs`（回测历史）命中 `/backtest`（组合回测）。
 *   现实现 = 「剥 query/hash/尾斜杠 → 分段精确匹配（相等 或 target + `/`）→ 全局取最长命中」。
 *
 * 本探针用**真实浏览器渲染**断言「任何时刻侧栏恰好只有 1 项高亮，且是正确的那一项」，
 * 覆盖 22 条导航路由 + 5 条详情路由（应点亮父项）+ 2 条反向断言（同前缀板块不得互亮）
 * + 4 条点击流（用户实际点击路径）。
 *
 * ⚠️ HOMEPAGE-005（2026-09-19）：首页（`/`）入口由左上角网站标题承担，侧栏「复盘分析」组
 *    不再单列「首页」项 ⇒ `/` 的期望高亮从 `[首页]` 改为 **`[]`（无任何高亮）**；
 *    同时新增第 5/6、6/6 两段：侧栏确无「首页」项、标题按钮形态正确、点题回首页。
 *    旧断言 `['/', '涨停复盘']` 早已过期（HOMEPAGE-001 起 `/` 就不再是涨停复盘明细页），一并纠正。
 *    顺带补齐漏登记的 `/limit-up`（涨停复盘）与 `/research/ask`（提问研究）两条路由。
 *
 * ⚠️ 2026-09-15 远端提交 `8bbe8b3` 已删除「录入大盘数据」页（其路由 `/market-` + `data-input`），
 *    故该前缀的导航项 / 反向断言 / 点击流用例一并移除；同前缀碰撞对只剩 `/backtest-runs` ↔ `/backtest`。
 *
 * 用法（项目根执行）：
 *   node docs/evidence/_probe_sidebar_active_highlight.mjs [BASE_URL] [BROWSER_EXE]
 * 默认 BASE_URL = http://127.0.0.1:3000；默认浏览器 Chrome，缺失则回落 Edge。
 *
 * ⚠️ 输出**必须同步落盘**（fs.writeFileSync/appendFileSync）。`console.log` 走异步 pipe，
 *    探针若被超时 SIGTERM 杀掉，未 flush 的输出会全部丢失（症状：空 stdout + Exit 1）。
 *    同名 `.out.txt` 即本探针的留档结果。
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HERE = import.meta.dirname;
const OUT = path.join(HERE, '_probe_sidebar_active_highlight.out.txt');
const BASE = process.argv[2] || 'http://127.0.0.1:3000';

const CANDIDATE_BROWSERS = [
  process.argv[3],
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const BROWSER = CANDIDATE_BROWSERS.find(p => { try { return fs.existsSync(p); } catch { return false; } });

const PORT = 20000 + Math.floor(Math.random() * 20000);
const UDD = path.join(os.tmpdir(), 'navhl-' + Date.now());
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

/** 应高亮的导航项（path → 唯一期望高亮文案）—— 与 AppShell.tsx#navGroups 一一对应 */
const ROUTES = [
  ['/limit-up', '涨停复盘'],
  ['/market', '大盘分析'],
  ['/sentiment-analysis', '情绪分析'],
  ['/leader-candidates', '龙头候选'],
  ['/backtest', '组合回测'],
  ['/backtest-runs', '回测历史'],
  ['/paper-trading', '前向纸面交易'],
  ['/upload', '上传图片'],
  ['/data-health', '数据域健康'],
  ['/historical-state', '历史状态查询'],
  ['/datasets', '数据集构建'],
  ['/research/ask', '提问研究'],
  ['/research', '研究实验'],
  ['/strategies', '策略'],
  ['/performance', '绩效仪表盘'],
  ['/parameter-search', '参数搜索'],
  ['/walk-forward', 'WFO/OOS 分析'],
  ['/regime-report', 'Regime/报告'],
  ['/review-workbench', '复盘工作台'],
  ['/stock-sync', '行情同步'],
  ['/sentiment-alerts', '情绪预警'],
  ['/operation-logs', '操作日志'],
];

/** 详情页：应点亮**父级**菜单项（分段匹配 target + '/' 的用途） */
const DETAIL_ROUTES = [
  ['/strategies/__probe__', '策略'],
  ['/research/__probe__', '研究实验'],
  ['/research/candidates/__probe__', '研究实验'],
  ['/datasets/__probe__', '数据集构建'],
  ['/datasets/__probe__/versions', '数据集构建'],
];

/** 反向断言：同前缀板块**不得**被点亮（旧前缀匹配正是栽在这里） */
const MUST_NOT_HIGHLIGHT = [
  ['/backtest-runs', '组合回测'],
  ['/backtest', '回测历史'],
];

/** 点击流：用户真实操作（先到 from，再点 label，落点与高亮均须正确） */
const CLICK_FLOWS = [
  ['/backtest', '回测历史', '回测历史', '/backtest-runs'],
  ['/backtest-runs', '组合回测', '组合回测', '/backtest'],
  ['/', '策略', '策略', '/strategies'],
  ['/strategies', '研究实验', '研究实验', '/research'],
];

child = spawn(BROWSER, ['--headless=new', '--disable-gpu', '--no-proxy-server', '--no-first-run',
  '--disable-extensions', '--user-data-dir=' + UDD, '--remote-debugging-port=' + PORT,
  '--window-size=1600,1000', 'about:blank'], { stdio: 'ignore' });
child.on('error', e => { logErr('spawn error:', e.message); cleanup(); });

const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJson = async u => (await fetch(u)).json();

const SNAPSHOT = `JSON.stringify({n:document.querySelectorAll('[data-slot="sidebar-menu-button"]').length,act:Array.from(document.querySelectorAll('[data-slot="sidebar-menu-button"][data-active="true"]')).map(b=>(b.innerText||"").trim()),path:location.pathname})`;
const CLICK = label => `(()=>{const b=Array.from(document.querySelectorAll('[data-slot="sidebar-menu-button"]')).find(x=>(x.innerText||'').trim()===${JSON.stringify(label)});if(!b)return 'btn-not-found';b.click();return 'clicked';})()`;

(async () => {
  if (!BROWSER) { logErr('未找到 Chrome / Edge 可执行文件'); return cleanup(); }
  log('== 侧栏高亮回归探针 ==', new Date().toISOString());
  log('BASE=' + BASE, 'BROWSER=' + BROWSER, 'PORT=' + PORT);

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
  log('CDP 已连接');

  const evalJs = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r && r.exceptionDetails) return undefined;
    return r && r.result ? r.result.value : undefined;
  };
  const waitNav = async () => {
    for (let i = 0; i < 80; i++) {
      const n = await evalJs(`document.querySelectorAll('[data-slot="sidebar-menu-button"]').length`);
      if (typeof n === 'number' && n >= 20) return true;
      await sleep(250);
    }
    return false;
  };
  const snap = async () => { try { return JSON.parse(await evalJs(SNAPSHOT)); } catch { return null; } };

  let pass = 0, fail = 0, skip = 0;

  // dev 首访偶发抖动（Vite 二次 transform / 页面 API 阻塞）会让侧栏晚于 20s 出现 ⇒ 重试 2 次
  const gotoAndWait = async (p) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      await send('Page.navigate', { url: BASE + p });
      if (await waitNav()) return true;
      log('  ... 第 ' + (attempt + 1) + ' 次侧栏未渲染，重试 ' + p);
    }
    return false;
  };

  const runRoute = async (p, expect, mode) => {
    if (!await gotoAndWait(p)) { skip++; log('  SKIP  ' + p + '  (侧栏未渲染)'); return; }
    await sleep(300);
    const s = await snap();
    const act = s ? s.act : ['<snapshot 失败>'];
    if (mode === 'must-not') {
      const ok = Array.isArray(act) && act.length === 1 && act[0] !== expect;
      ok ? pass++ : fail++;
      log('  ' + (ok ? 'PASS' : 'FAIL') + '  [反向] ' + p.padEnd(32) + ' 不得点亮[' + expect + ']  实际高亮=' + JSON.stringify(act));
    } else {
      const ok = Array.isArray(act) && act.length === 1 && act[0] === expect;
      ok ? pass++ : fail++;
      log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + p.padEnd(36) + ' 期望唯一高亮=[' + expect + ']  实际=' + JSON.stringify(act));
    }
  };

  log('');
  log('--- 1/6 导航路由（22 条）---');
  for (const [p, e] of ROUTES) await runRoute(p, e);

  log('');
  log('--- 2/6 详情路由（5 条，应点亮父项）---');
  for (const [p, e] of DETAIL_ROUTES) await runRoute(p, e);

  log('');
  log('--- 3/6 反向断言（2 条，同前缀板块不得互亮）---');
  for (const [p, e] of MUST_NOT_HIGHLIGHT) await runRoute(p, e, 'must-not');

  log('');
  log('--- 4/6 点击流（4 条）---');
  for (const [from, label, expectLabel, expectPath] of CLICK_FLOWS) {
    await gotoAndWait(from);
    await sleep(350);
    const clicked = await evalJs(CLICK(label));
    await sleep(1000);
    const s = await snap();
    const act = s ? s.act : [];
    const loc = s ? s.path : '?';
    const ok = clicked === 'clicked' && Array.isArray(act) && act.length === 1 && act[0] === expectLabel && loc === expectPath;
    ok ? pass++ : fail++;
    log('  ' + (ok ? 'PASS' : 'FAIL') + '  从 ' + from + ' 点[' + label + '] -> path=' + loc + '（期望 ' + expectPath + '）高亮=' + JSON.stringify(act) + '（期望唯一 [' + expectLabel + ']）clicked=' + clicked);
  }

  // HOMEPAGE-005：首页入口 = 左上角网站标题；侧栏不再单列「首页」⇒ `/` 无任何高亮
  log('');
  log('--- 5/6 首页入口（HOMEPAGE-005）---');
  if (await gotoAndWait('/')) {
    await sleep(300);
    const s = await snap();
    const act = s ? s.act : ['<snapshot 失败>'];
    const okNone = Array.isArray(act) && act.length === 0;
    okNone ? pass++ : fail++;
    log('  ' + (okNone ? 'PASS' : 'FAIL') + '  / 首页侧栏无高亮项  实际=' + JSON.stringify(act));

    const hasHomeItem = await evalJs(`Array.from(document.querySelectorAll('[data-slot="sidebar-menu-button"]')).some(b=>(b.innerText||'').trim()==='首页')`);
    hasHomeItem === false ? pass++ : fail++;
    log('  ' + (hasHomeItem === false ? 'PASS' : 'FAIL') + '  侧栏不含「首页」导航项  实际=' + JSON.stringify(hasHomeItem));

    const home = await evalJs(`(()=>{const b=document.querySelector('[data-slot="sidebar-home-link"]');if(!b)return 'missing';return JSON.stringify({text:(b.innerText||'').trim(),title:b.getAttribute('title'),aria:b.getAttribute('aria-label'),cursor:getComputedStyle(b).cursor,display:getComputedStyle(b).display});})()`);
    let homeOk = false;
    try {
      const h = JSON.parse(home);
      homeOk = h.text === '涨停复盘助手' && h.title === '返回首页' && h.aria === '返回首页' && h.cursor === 'pointer';
    } catch { }
    homeOk ? pass++ : fail++;
    log('  ' + (homeOk ? 'PASS' : 'FAIL') + '  左上角标题按钮 = 首页入口（文案/提示/手型光标）  ' + home);
  } else { skip++; log('  SKIP  /  (侧栏未渲染)'); }

  log('');
  log('--- 6/6 首页入口点击流（1 条）---');
  if (await gotoAndWait('/strategies')) {
    await sleep(350);
    const clicked = await evalJs(`(()=>{const b=document.querySelector('[data-slot="sidebar-home-link"]');if(!b)return 'btn-not-found';b.click();return 'clicked';})()`);
    await sleep(1000);
    const s = await snap();
    const act = s ? s.act : [];
    const loc = s ? s.path : '?';
    const ok = clicked === 'clicked' && loc === '/' && Array.isArray(act) && act.length === 0;
    ok ? pass++ : fail++;
    log('  ' + (ok ? 'PASS' : 'FAIL') + '  从 /strategies 点左上角标题 -> path=' + loc + '（期望 /）高亮=' + JSON.stringify(act) + '（期望 []）clicked=' + clicked);
  } else { skip++; log('  SKIP  点击流(左上角标题)'); }

  log('');
  const verdict = fail === 0 && skip === 0 ? 'ALL PASS' : 'HAS FAILURE';
  log('=== 汇总：PASS ' + pass + ' / FAIL ' + fail + ' / SKIP ' + skip + ' ⇒ ' + verdict + ' ===');
  log('结果留档：' + OUT);
  ws.close(); cleanup();
})().catch(e => { logErr('ERR', (e && e.stack) || String(e)); cleanup(); });
