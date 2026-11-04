/**
 * 首页（`/`）连板梯队 —— **每个高度组内的行序**取证探针（2026-09-19）。
 *
 * 用户要求（原话两段）：
 *   ① 「首页连板梯队里每个高度内排序，把“其他”题材放到最后」；
 *   ② 「每个高度内排序不是按格子高度内题材热度排序，而是按当日所有涨停题材热度排序」。
 *
 * ⇒ 组内行序 = **当日全市场题材热度**（`limitUp.getSectorDistribution` 当日切片的 `count`，
 *   即当日该题材涨停家数）降序，**不是**「本组内该题材出现几次」；且兜底桶「其他」不参与热度名次、
 *   固定压到组内最后（`@shared/sectorHeatOrder` 的 `TAIL_SECTORS`）。
 *
 * 本探针不做「代码看起来对」的推断，用无头 Chrome + CDP 直连**真实页面**：
 *   ① 从 tRPC 取当日题材分布（参考口径）+ 可选多看几天；
 *   ② 按**正常导航**打开 `/`，用真实的 `change` 事件切换梯队「选择日期」；
 *   ③ 展开每个高度组（否则折叠态只渲染前 N 行，尾部的「其他」根本不在 DOM 里），
 *      按 DOM 顺序抽出每格的「代码 / 名称 / 题材 / 是否断板」；
 *   ④ 逐组断言：
 *      · A 压尾：所有「其他」格都排在非「其他」格之后（且不丢格）；
 *      · B 热度降序：非「其他」段的热度序列**单调不增**（同热度靠次键，不判）；
 *      · C 口径是**当日全市场**：存在某题材 `当日热度 > 本组内出现次数`（若是组内计数就恒等）；
 *   ⑤ 打印每组的「题材(当日热度)」串，附**视口截图**供肉眼复核。
 *
 * ⚠️ 已规避的本机坑：`about:blank` 上读写 localStorage 抛 SecurityError（本探针不切主题，用默认主题）；
 *    长页面整页截图会让 CDP 卡死 ⇒ 只做**视口**截图；输出**同步落盘**（被 SIGTERM 时 console 会丢）。
 *
 * 用法（项目根执行；BASE 只认启动日志里的端口）：
 *   node docs/evidence/_probe_ladder_tail_sector.mjs [BASE_URL] [额外日期数=2]
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const HERE = import.meta.dirname;
// 输出落点可被环境变量覆盖 —— A/B 对照（临时停用压尾规则重跑）时把「改前」那次写到旁路文件，
// 避免覆盖「改后」的证据（本项目已有教训：A/B 时用同一落点会让两次结果互相盖掉）。
const OUT = process.env.LADDER_PROBE_OUT || path.join(HERE, '_probe_ladder_tail_sector.out.txt');
const SHOT = process.env.LADDER_PROBE_SHOT || path.join(HERE, '_shot_ladder_tail_sector.png');
/** 「压尾边界」特写：把**第一个「其他」格**滚到视口中央后截图 —— 让「其他 都在行末」肉眼可判。 */
const SHOT_TAIL = process.env.LADDER_PROBE_SHOT_TAIL || path.join(HERE, '_shot_ladder_tail_sector.tail.png');
const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const EXTRA_DATES = Number(process.argv[3] ?? 2);

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
const UDD = path.join(os.tmpdir(), 'laddertail-' + Date.now());
fs.mkdirSync(UDD, { recursive: true });
fs.writeFileSync(OUT, '');

let pass = 0;
let fail = 0;
const log = (...a) => { const s = a.join(' '); fs.appendFileSync(OUT, s + '\n'); console.log(s); };
const ok = (m) => { pass += 1; log('  PASS  ' + m); };
const bad = (m) => { fail += 1; log('  FAIL  ' + m); };

let child = null;
function cleanup() {
  try { if (child) execSync('taskkill /F /T /PID ' + child.pid, { stdio: 'ignore' }); } catch { }
  try { fs.rmSync(UDD, { recursive: true, force: true }); } catch { }
  setTimeout(() => process.exit(fail > 0 ? 1 : 0), 300);
}
process.on('uncaughtException', (e) => { bad('uncaughtException: ' + ((e && e.stack) || String(e))); cleanup(); });
process.on('unhandledRejection', (e) => { bad('unhandledRejection: ' + ((e && e.stack) || String(e))); cleanup(); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 从 tRPC GET 取 `result.data`（superjson 包装形态两种都容错）。 */
async function trpc(query, input) {
  const url = BASE + '/api/trpc/' + query + '?input=' + encodeURIComponent(input ?? '{}');
  const r = await fetch(url);
  const j = await r.json();
  return j?.result?.data?.json ?? j?.result?.data ?? j;
}

const IS_TAIL = (sector) => sector === '其他';

(async () => {
  if (!BROWSER) { bad('未找到 Chrome / Edge 可执行文件'); return cleanup(); }
  log('== 连板梯队组内行序取证（当日全市场题材热度降序 + 「其他」压尾）==', new Date().toISOString());
  log('BASE=' + BASE, 'BROWSER=' + BROWSER, 'PORT=' + PORT);

  // ---- 参考口径：当日全市场题材分布 ----
  const dates = await trpc('limitUp.getDates');
  const dist = await trpc('limitUp.getSectorDistribution');
  log('可用日期 ' + dates.length + ' 个（最新 ' + dates[0] + '）；题材分布覆盖 ' + dist.length + ' 天');
  const heatByDate = new Map(dist.map((d) => [d.date, new Map(d.sectors.map((s) => [s.sector, s.count]))]));
  /** 窗口内合计（热力图「合计」列与同热度次键的来源；与前端 `buildSectorHeatLookup` 同一算法）。 */
  const totalBySector = new Map();
  for (const d of dist) for (const s of d.sectors) totalBySector.set(s.sector, (totalBySector.get(s.sector) || 0) + s.count);

  /**
   * 选样：默认那一天（用户打开页面看到的就是它）+ 若干「其他」家数最多的历史日。
   * 选「其他」家数大的日子是**刻意**的 —— 那些日子「其他」热度高于多数真实题材，
   * 压尾规则若失效会立刻暴露（而不是靠一个本来就排最后的巧合通过）。
   */
  const chosen = [dates[0]];
  const ranked = dist
    .map((d) => ({ date: d.date, other: d.sectors.find((s) => s.sector === '其他')?.count ?? 0 }))
    .sort((a, b) => b.other - a.other);
  for (const r of ranked) {
    if (chosen.length >= 1 + EXTRA_DATES) break;
    if (!chosen.includes(r.date) && dates.includes(r.date)) chosen.push(r.date);
  }
  log('取样日期：' + chosen.map((d) => d + '（其他=' + (heatByDate.get(d)?.get('其他') ?? 0) + '）').join('  '));

  // ---- 起浏览器 ----
  child = spawn(BROWSER, ['--headless=new', '--disable-gpu', '--no-proxy-server', '--no-first-run',
    '--disable-extensions', '--user-data-dir=' + UDD, '--remote-debugging-port=' + PORT,
    '--window-size=1600,1400', 'about:blank'], { stdio: 'ignore' });
  child.on('error', (e) => { bad('spawn error: ' + e.message); cleanup(); });

  let list = null;
  for (let i = 0; i < 80; i++) {
    try { list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json(); if (list.some((t) => t.type === 'page')) break; } catch { }
    await sleep(250);
  }
  if (!list) { bad('devtools 不可达'); return cleanup(); }
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
  await new Promise((r) => { ws.onopen = r; });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  log('CDP 已连接');

  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: false });
    if (r && r.exceptionDetails) {
      bad('eval 异常: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
      return undefined;
    }
    return r && r.result ? r.result.value : undefined;
  };
  const jsonEval = async (expr) => { const v = await evalJs(expr); try { return JSON.parse(v); } catch { return null; } };

  await send('Page.navigate', { url: BASE + '/' });
  // ⚠️ 只等目标元素（梯队 + 日期选项已补齐）；不拿「登录按钮」当判据（外壳先于内容区渲染）。
  let ready = false;
  for (let i = 0; i < 480; i += 1) {
    await sleep(250);
    const okNow = await evalJs(`(function(){
      var card = document.querySelector('[data-homepage-ladder]');
      if (!card) return false;
      var sel = card.querySelector('select');
      return !!sel && sel.options.length > 0 && card.querySelectorAll('[data-ladder-grid]').length > 0;
    })()`);
    if (okNow) { ready = true; break; }
  }
  if (!ready) { bad('等不到梯队渲染（120s）'); return cleanup(); }
  log('梯队已渲染（含日期选项）');

  /** 热力图当前行序（DOM 顺序 = 渲染顺序；它只按最新一列算，不随梯队日期变化）。 */
  const heatmapRows = await jsonEval(`(function(){
    var card = document.querySelector('[data-homepage-heatmap]');
    if (!card) return JSON.stringify(null);
    var rows = [];
    card.querySelectorAll('table tbody tr').forEach(function(tr){
      var first = tr.querySelector('td');
      rows.push(first ? first.textContent.trim() : '');
    });
    return JSON.stringify(rows);
  })()`);
  const heatmapOrder = Array.isArray(heatmapRows) ? heatmapRows.filter((s) => s) : [];
  log('热力图行序（前 12）：' + heatmapOrder.slice(0, 12).join(' → ') + '（共 ' + heatmapOrder.length + ' 行）');
  const heatmapIndex = new Map(heatmapOrder.map((s, i) => [s, i]));
  /** 热力图恒按最新一列（`dist[0]`）排 ⇒ 只有梯队也选它时，两处主键才可比。 */
  const heatmapDate = dist[0]?.date ?? null;

  const setDate = async (date) => evalJs(`(function(){
    var sel = document.querySelector('[data-homepage-ladder] select');
    if (!sel) return 'NO_SELECT';
    var setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(sel, ${JSON.stringify(date)});
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return sel.value;
  })()`);

  const waitDateLoaded = async (date) => {
    for (let i = 0; i < 240; i += 1) {
      await sleep(250);
      // ⚠️ 判据必须绑到「板数窗口」那段文字：`card.innerText` 里本来就含 select 的选项文本
      //    （其中就有目标日期），拿它当就绪信号会**立刻通过**、量到上一个日期的旧 DOM。
      const done = await evalJs(`(function(){
        var card = document.querySelector('[data-homepage-ladder]');
        if (!card) return false;
        var spans = Array.prototype.slice.call(card.querySelectorAll('span'));
        var win = null;
        for (var i = 0; i < spans.length; i += 1) {
          if (spans[i].textContent.indexOf('板数窗口：') >= 0) { win = spans[i]; break; }
        }
        if (!win || win.textContent.indexOf(${JSON.stringify(date)}) < 0) return false;
        return card.querySelectorAll('[data-ladder-grid]').length > 0;
      })()`);
      if (done) { await sleep(600); return true; }
    }
    return false;
  };

  const expandAll = async () => {
    const n = await evalJs(`(function(){
      var btns = Array.prototype.slice.call(document.querySelectorAll('[data-homepage-ladder] [data-homepage-ladder-group-toggle]'));
      var n = 0;
      btns.forEach(function(b){ if (b.getAttribute('aria-expanded') === 'false') { b.click(); n++; } });
      return n;
    })()`);
    await sleep(900);
    return n;
  };

  const extract = () => jsonEval(`(function(){
    var out = [];
    document.querySelectorAll('[data-homepage-ladder] tr[data-ladder-group]').forEach(function(tr){
      var grid = tr.querySelector('[data-ladder-grid]');
      var items = [];
      if (grid) {
        grid.querySelectorAll(':scope > [data-ladder-stock]').forEach(function(cell){
          var d = cell.children;
          items.push({
            code: cell.getAttribute('data-ladder-stock'),
            name: d[1] ? d[1].textContent : '',
            sector: d[2] ? d[2].textContent : '',
            broken: d[1] ? /line-through/.test(d[1].className) : false
          });
        });
      }
      out.push({ label: tr.getAttribute('data-ladder-group'), items: items });
    });
    return JSON.stringify(out);
  })()`);

  for (const date of chosen) {
    log('');
    log('---- 日期 ' + date + ' ----');
    const heat = heatByDate.get(date) ?? new Map();
    const set = await setDate(date);
    if (set === 'NO_SELECT') { bad('找不到梯队日期选择器'); continue; }
    if (!(await waitDateLoaded(date))) { bad(date + '：切换后等不到数据加载完成'); continue; }
    const expanded = await expandAll();
    log('  已展开折叠组 ' + expanded + ' 个（否则尾部格子不在 DOM 里）');
    const groups = await extract();
    if (!groups || groups.length === 0) { bad(date + '：梯队组为 0'); continue; }
    log('  高度组 ' + groups.length + ' 个：' + groups.map((g) => g.label + '(' + g.items.length + ')').join(' '));

    let otherTotal = 0;
    let groupWithOther = 0;
    let dayWideProof = null;

    for (const group of groups) {
      const sectors = group.items.map((i) => i.sector);
      const heatSeq = group.items.map((i) => heat.get(i.sector) ?? -1);
      const nonTail = group.items.filter((i) => !IS_TAIL(i.sector));
      const tail = group.items.filter((i) => IS_TAIL(i.sector));
      const tailIdx = sectors.map((s, i) => (IS_TAIL(s) ? i : -1)).filter((i) => i >= 0);
      if (tail.length > 0) { otherTotal += tail.length; groupWithOther += 1; }

      // C 口径取证：当日全市场热度 > 本组出现次数 ⇒ 排序键不是组内计数
      const occ = new Map();
      for (const s of sectors) occ.set(s, (occ.get(s) ?? 0) + 1);
      for (const [s, n] of occ) {
        const h = heat.get(s) ?? -1;
        if (h > n && !dayWideProof) dayWideProof = group.label + ' 的「' + s + '」：当日热度 ' + h + ' > 本组出现 ' + n + ' 次';
      }

      const dump = group.items.map((i, k) => i.sector + '(' + heatSeq[k] + (i.broken ? ',断板' : '') + ')').join(' → ');

      if (tailIdx.length > 0) {
        const first = tailIdx[0];
        if (first >= nonTail.length && tailIdx.length === tail.length) {
          if (tail.length > 1) {
            // 「其他」内部仍是热度/次键序，这里只报事实，不判（可能多只同热度）。
          }
          ok(date + ' · ' + group.label + ' · 压尾：' + tail.length + ' 个「其他」全部在末尾（首个位于 #' + (first + 1) + '/' + group.items.length + '）');
        } else {
          bad(date + ' · ' + group.label + ' · 压尾失败：「其他」下标 ' + JSON.stringify(tailIdx) + ' 出现于非末尾（共 ' + group.items.length + ' 格）');
        }
      }
      const badPairs = [];
      for (let i = 0; i + 1 < nonTail.length; i += 1) {
        const a = heat.get(nonTail[i].sector) ?? -1;
        const b = heat.get(nonTail[i + 1].sector) ?? -1;
        if (a < b) badPairs.push(nonTail[i].sector + '(' + a + ') < ' + nonTail[i + 1].sector + '(' + b + ')');
      }
      if (badPairs.length === 0) {
        ok(date + ' · ' + group.label + ' · 热度降序成立（非「其他」段单调不增）');
      } else {
        bad(date + ' · ' + group.label + ' · 热度降序被破坏：' + badPairs.slice(0, 3).join('；'));
      }
      log('        行序：' + dump);
    }

    // ---- 与下方「题材热力日历」的次序一致性（用户 2026-09-19 报的「对不上」）----
    // ⚠️ 只有「梯队所选日期 == 热力图最新那一列」时两处的**主键**才可比（热力图恒按最新一列排）。
    //    日期不同 ⇒ 主键不同、次序**按设计**就该不同，硬比会产出假 FAIL（本轮实测：09-16 报 3 条，
    //    复核后确认是「比较对象错了」而非产品缺陷）⇒ 那种情况只做「同热度次键」这半条断言。
    {
      const violations = [];
      const tieNotes = [];
      let checkedSectors = 0;
      let tiePairs = 0;
      const comparable = heatmapDate != null && date === heatmapDate;
      for (const group of groups) {
        const seq = [];
        for (const it of group.items) {
          if (!IS_TAIL(it.sector) && !seq.includes(it.sector)) seq.push(it.sector);
        }
        if (comparable && heatmapOrder.length > 0) {
          const present = seq.filter((s) => heatmapIndex.has(s));
          checkedSectors += present.length;
          for (let i = 0; i + 1 < present.length; i += 1) {
            if (heatmapIndex.get(present[i]) >= heatmapIndex.get(present[i + 1])) {
              violations.push(group.label + '：' + present[i] + '(热力图#' + heatmapIndex.get(present[i]) + ') 排在 ' +
                present[i + 1] + '(热力图#' + heatmapIndex.get(present[i + 1]) + ') 之前');
            }
          }
        }
        for (let i = 0; i + 1 < seq.length; i += 1) {
          const ha = heat.get(seq[i]) ?? -1;
          const hb = heat.get(seq[i + 1]) ?? -1;
          if (ha !== hb) continue;
          tiePairs += 1;
          const ta = totalBySector.get(seq[i]) ?? -1;
          const tb = totalBySector.get(seq[i + 1]) ?? -1;
          if (ta < tb) {
            violations.push(group.label + ' 同热度(' + ha + ')次键：' + seq[i] + '(合计' + ta + ') 却在 ' +
              seq[i + 1] + '(合计' + tb + ') 之前');
          } else {
            tieNotes.push(group.label + '：' + seq[i] + '(合计' + ta + ') ≥ ' + seq[i + 1] + '(合计' + tb + ')');
          }
        }
      }
      if (violations.length === 0) {
        ok(date + ' · 同热度次键（窗口合计降序）成立：' + tiePairs + ' 处相邻等热度对全部合规' +
          (comparable && heatmapOrder.length > 0 ? '；且与热力图行序一致（' + checkedSectors + ' 个题材序号严格递增）' : ''));
      } else {
        bad(date + ' · 题材次序分叉：' + violations.slice(0, 3).join('；'));
      }
      if (tiePairs === 0) log('        ⚠️ 本日无「同当日热度」的相邻题材对 ⇒ 次键断言在本日空转（不作为通过证据）');
      else log('        等热度相邻对样例：' + tieNotes.slice(0, 3).join(' ｜ '));
      if (comparable && heatmapOrder.length > 0) {
        log('        与热力图同序已核对 ' + checkedSectors + ' 个题材（热力图共 ' + heatmapOrder.length + ' 行）');
      }
      if (!comparable) {
        log('        （本日 ' + date + ' ≠ 热力图最新列 ' + heatmapDate + ' ⇒ 主键日期不同，**按设计**不比较行序，只比较次键）');
      }
    }

    if (otherTotal === 0) {
      log('  ⚠️ 本日梯队里没有「其他」格 ⇒ 压尾断言在本日**空转**（不作为通过证据，也不判失败）');
    }
    if (groupWithOther > 0) log('  本日「其他」格合计 ' + otherTotal + ' 个，分布在 ' + groupWithOther + ' 个高度组');
    if (dayWideProof) ok('口径取证（当日全市场热度，非组内计数）：' + dayWideProof);
    else bad('口径取证失败：没有任何题材的「当日热度 > 本组出现次数」⇒ 无法区分是当日全市场口径还是组内计数口径');

    // 视口截图（**不**用 captureBeyondViewport：长页整页截图会让 CDP 卡死）
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    if (shot && shot.data) { fs.writeFileSync(SHOT, Buffer.from(shot.data, 'base64')); log('  视口截图 -> ' + SHOT); }

    // 「压尾边界」特写：滚动到第一个「其他」格居中，再截视口 —— 肉眼即可看到「其他」段落在行末。
    if (otherTotal > 0) {
      const scrolled = await evalJs(`(function(){
        var cells = Array.prototype.slice.call(document.querySelectorAll('[data-homepage-ladder] [data-ladder-stock]'));
        for (var i = 0; i < cells.length; i += 1) {
          var s = cells[i].children[2] ? cells[i].children[2].textContent : '';
          if (s === '其他') { cells[i].scrollIntoView({ block: 'center' }); return i; }
        }
        return -1;
      })()`);
      await sleep(500);
      const shot2 = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      if (shot2 && shot2.data) {
        fs.writeFileSync(SHOT_TAIL, Buffer.from(shot2.data, 'base64'));
        log('  压尾边界特写（第一个「其他」格 idx=' + scrolled + ' 已居中）-> ' + SHOT_TAIL);
      }
    }
  }

  log('');
  log('== 汇总：PASS ' + pass + ' / FAIL ' + fail + ' ==');
  cleanup();
})();
