/**
 * 「组合回测 → 交易明细」快照面板验收：**仓位比例在表格里，不在段落里**
 * （无头 Chrome + CDP，零依赖，只读；不点任何写操作按钮）。
 *
 * 断言：
 *   1) 面板出现，且**不再存在**独立段落钩子 [data-planned-position-sizing] 与胶囊容器
 *      [data-planned-position-chips]（要求把比例搬进表格）；
 *   2) 当前持仓表：表头含「持仓市值 / 占总权益」；每行同时给出「市值 ¥金额」与「占比 x.xx%」；
 *      合计行给出 成本 / 浮动 / 市值 / 占总权益 / 现金 / 总权益，且**资金恒等式**成立：
 *        现金 + 持仓市值 ≈ 总权益（这是「占比」分母正确的硬证据）；
 *   3) 准备买入表：表头含「计划仓位 / 预算上限」并回显当前分仓口径；
 *      每行 [data-planned-position] 同时含 x.xx% 与 ¥金额；合计行给出合计比例与预算上限，
 *      且 Σ(逐只比例) ≈ 合计比例；
 *   4) 口径来源徽标 [data-portfolio-provenance] 存在（说明该快照由研究-legacy 模拟器产出）；
 *   5) 逐个切换五策略复查（风险类策略可能带「降仓」/「超参与上限」标记）。
 *
 * ⚠️ /backtest 走 getLeaderCandidateResearch（仅内存缓存，进程重启即冷）⇒ 冷算可能数分钟到 20 分钟，
 * 本探针按 WAIT_SEC（默认 1800s）耐心等待，并把中间结果**同步落盘**，被中断时日志仍在。
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CDP_PORT = Number(process.env.CDP_PORT ?? 9381);
const PAGE_URL = process.env.PAGE_URL ?? "http://127.0.0.1:3000/backtest";
const WAIT_SEC = Number(process.env.WAIT_SEC ?? 1800);
const OUT = "docs/evidence/_probe_planned_position_render.json";

const STRATEGY_LABELS = ["原始评分基准", "风险扣分策略", "高风险硬过滤", "质量复合评分", "质量门控策略"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const COLLECT = `(() => {
  const txt = document.body ? document.body.innerText : "";
  const section = document.querySelector('[data-strategy-portfolio-snapshot]');
  const tables = [...document.querySelectorAll('[data-strategy-portfolio-snapshot] table')];
  const rowsOf = (table) => table ? [...table.querySelectorAll('tbody tr')].map((r) => (r.innerText || '').replace(/\\s+/g, ' ').trim()) : [];
  const footOf = (table) => { const f = table ? table.querySelector('tfoot') : null; return f ? (f.innerText || '').replace(/\\s+/g, ' ').trim() : null; };
  const headOf = (table) => { const h = table ? table.querySelector('thead') : null; return h ? (h.innerText || '').replace(/\\s+/g, ' ').trim() : null; };
  const holdingsTable = tables.find((t) => (t.innerText || '').includes('占总权益')) || null;
  const planTable = tables.find((t) => (t.innerText || '').includes('计划仓位')) || null;
  const moneyOf = (text) => { const m = (text || '').match(/¥([0-9,]+(?:\\.[0-9]+)?)/); return m ? Number(m[1].replace(/,/g, '')) : null; };
  const percentOf = (text) => { const m = (text || '').match(/([0-9]+\\.[0-9]{2})%/); return m ? Number(m[1]) : null; };
  const planCells = [...document.querySelectorAll('[data-planned-position]')];
  const planPercents = planCells.map((c) => percentOf(c.innerText));
  const planAmounts = planCells.map((c) => moneyOf(c.innerText));
  const planScales = planCells.map((c) => {
    const t = c.innerText || '';
    if (t.includes('超参与上限')) return 0;
    const m = t.match(/降仓 ×([0-9.]+)/);
    return m ? Number(m[1]) : 1;
  });
  const holdingsFoot = footOf(holdingsTable);
  const planFoot = footOf(planTable);
  // 合计行解析：现金 / 市值 / 总权益 / 占总权益
  const cash = (holdingsFoot || '').match(/现金 ¥([0-9,]+(?:\\.[0-9]+)?)/);
  const market = (holdingsFoot || '').match(/市值 ¥([0-9,]+(?:\\.[0-9]+)?)/);
  const equity = (holdingsFoot || '').match(/总权益 ¥([0-9,]+(?:\\.[0-9]+)?)/);
  const holdingsWeight = (holdingsFoot || '').match(/占总权益 ([0-9.]+)%/);
  const planRatio = (planFoot || '').match(/([0-9]+\\.[0-9]{2})%/);
  const planBudget = (planFoot || '').match(/¥([0-9,]+(?:\\.[0-9]+)?)/);
  const num = (m) => (m ? Number(m[1].replace(/,/g, '')) : null);
  return {
    hasSection: !!section,
    hasLegacyBlock: !!document.querySelector('[data-planned-position-sizing]'),
    hasLegacyChips: !!document.querySelector('[data-planned-position-chips]'),
    hasProvenance: !!document.querySelector('[data-portfolio-provenance]'),
    holdingsHead: headOf(holdingsTable),
    holdingsRows: rowsOf(holdingsTable),
    holdingsFoot,
    holdingsCash: num(cash),
    holdingsMarket: num(market),
    holdingsEquity: num(equity),
    holdingsWeightPercent: holdingsWeight ? Number(holdingsWeight[1]) : null,
    planHead: headOf(planTable),
    planRowTexts: rowsOf(planTable),
    planFoot,
    planCells: planCells.length,
    planPercents,
    planAmounts,
    planScales,
    planFootRatio: planRatio ? Number(planRatio[1]) : null,
    planFootBudget: num(planBudget),
    activeStrategy: (() => { const s = document.querySelector('[role="tablist"][aria-label="持仓计划策略切换"]'); return s ? ((s.querySelector('[aria-selected="true"]') || {}).innerText || '').trim() : null; })(),
    mentionsOpenPriceReason: /次日开盘价/.test(txt),
    pageErr: /Failed to fetch|加载失败|请求失败/.test(txt),
    loading: /加载中|回测中|计算中/.test(txt),
  };
})()`;

async function main() {
  const profile = mkdtempSync(join(tmpdir(), "chrome-cdp-"));
  const child = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-proxy-server",
      "--no-first-run",
      "--disable-extensions",
      "--disable-features=Translate,MediaRouter",
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${CDP_PORT}`,
      "--window-size=1600,1000",
      PAGE_URL,
    ],
    { stdio: "ignore", detached: false },
  );

  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      target = list.find((t) => t.type === "page" && t.url.startsWith("http"));
    } catch {
      /* 浏览器还没起来 */
    }
  }
  if (!target?.webSocketDebuggerUrl) throw new Error("CDP 未就绪：拿不到 page target");

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });

  const evaluate = async (expression) => {
    const res = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (res.result?.exceptionDetails) throw new Error(`evaluate 异常：${JSON.stringify(res.result.exceptionDetails)}`);
    return res.result?.result?.value;
  };

  await send("Runtime.enable");

  const log = { url: PAGE_URL, waitSec: WAIT_SEC, stages: [], perStrategy: {} };
  const flush = () => writeFileSync(OUT, JSON.stringify(log, null, 2));

  const clickTab = async (label) => evaluate(`(() => {
    const b = [...document.querySelectorAll('[role="tab"]')].find((x) => (x.innerText || '').trim() === ${JSON.stringify(label)});
    if (!b) return false;
    b.click();
    return true;
  })()`);

  for (let i = 0; i < 120; i++) {
    if (await clickTab("交易明细")) break;
    await sleep(1000);
  }
  log.stages.push({ stage: "click-tab-交易明细", at: new Date().toISOString() });
  flush();
  console.log("已点击「交易明细」页签，等待回测结果（冷算可能很久）…");

  let stats = null;
  const deadline = Date.now() + WAIT_SEC * 1000;
  let waited = 0;
  while (Date.now() < deadline) {
    await sleep(5000);
    waited += 5;
    try {
      stats = await evaluate(COLLECT);
    } catch {
      stats = null;
    }
    if (stats && stats.hasSection && stats.planHead) {
      log.stages.push({ stage: "snapshot-rendered", waitedSec: waited, activeStrategy: stats.activeStrategy });
      flush();
      console.log(`数据到位（等待 ${waited}s），快照面板已渲染，当前策略 = ${stats.activeStrategy}`);
      break;
    }
    if (waited % 60 === 0) {
      console.log(`…已等待 ${waited}s（hasSection=${stats?.hasSection} planHead=${!!stats?.planHead} loading=${stats?.loading} err=${stats?.pageErr}）`);
      log.stages.push({ stage: "waiting", waitedSec: waited, hasSection: stats?.hasSection ?? null, loading: stats?.loading ?? null, pageErr: stats?.pageErr ?? null });
      flush();
    }
  }

  const failures = [];
  const assert = (ok, label) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
    if (!ok) failures.push(label);
  };

  if (!stats || !stats.hasSection || !stats.planHead) {
    console.log(JSON.stringify(stats, null, 2));
    assert(false, `等待 ${WAIT_SEC}s 内未渲染快照面板（hasSection=${stats?.hasSection} err=${stats?.pageErr}）`);
    flush();
    ws.close();
    try { child.kill(); } catch { /* ignore */ }
    console.log(`\n${failures.length === 0 ? "ALL PASS" : `FAILURES(${failures.length}): ${failures.join(" | ")}`}`);
    process.exit(failures.length === 0 ? 0 : 1);
  }

  const verifyStrategy = async (label) => {
    await evaluate(`(() => {
      const b = [...document.querySelectorAll('[role="tablist"][aria-label="持仓计划策略切换"] [role="tab"]')].find((x) => (x.innerText || '').trim() === ${JSON.stringify(label)});
      if (b) b.click();
      return !!b;
    })()`);
    await sleep(700);
    return evaluate(COLLECT);
  };

  for (const label of STRATEGY_LABELS) {
    const row = await verifyStrategy(label);
    log.perStrategy[label] = row;
    flush();
    console.log("---");
    console.log(`策略【${label}】持仓 ${row.holdingsRows.length} 只 / 准备买入 ${row.planCells} 笔`);
    console.log(`    持仓表头 ${row.holdingsHead}`);
    for (const r of row.holdingsRows) console.log(`      持仓行 ${r}`);
    console.log(`    持仓合计 ${row.holdingsFoot}`);
    console.log(`    准备表头 ${row.planHead}`);
    for (let i = 0; i < row.planCells; i += 1) {
      console.log(`      准备行 比例 ${row.planPercents[i]}%  预算 ¥${row.planAmounts[i]}  降仓系数 ${row.planScales[i]}  |  ${row.planRowTexts[i] ?? "(无同序表格行)"}`);
    }
    console.log(`    准备合计 ${row.planFoot}`);
  }

  const baseline = log.perStrategy["原始评分基准"];

  // ① 段落 → 表格
  assert(baseline.hasSection === true, "快照面板已渲染 [data-strategy-portfolio-snapshot]");
  assert(baseline.hasLegacyBlock === false, "独立段落 [data-planned-position-sizing] 已移除");
  assert(baseline.hasLegacyChips === false, "胶囊容器 [data-planned-position-chips] 已移除");
  assert((baseline.holdingsHead ?? "").includes("占总权益"), "当前持仓表头含「持仓市值 / 占总权益」");
  assert((baseline.planHead ?? "").includes("计划仓位"), "准备买入表头含「计划仓位 / 预算上限」");
  assert(baseline.hasProvenance === true, "口径来源徽标 [data-portfolio-provenance] 存在");

  // ② 当前持仓：逐行 市值 + 占比
  const holdingRows = baseline.holdingsRows.filter((r) => /¥/.test(r));
  const holdingPercents = holdingRows.map((r) => {
    const m = r.match(/([0-9]+\.[0-9]{2})%/g);
    return m ? Number(m[m.length - 1].replace("%", "")) : null;
  });
  if (holdingRows.length > 0) {
    assert(holdingRows.every((r) => /市值|¥[0-9,]/.test(r)), "当前持仓每行都有金额");
    assert(holdingPercents.every((p) => typeof p === "number"), "当前持仓每行都有仓位比例（x.xx%）");
  } else {
    console.log("（当前基准无未出清持仓：跳过逐行断言）");
  }

  // ③ 资金恒等式：现金 + 持仓市值 ≈ 总权益（占比分母正确的硬证据）
  if (baseline.holdingsCash !== null && baseline.holdingsMarket !== null && baseline.holdingsEquity !== null) {
    const residual = baseline.holdingsCash + baseline.holdingsMarket - baseline.holdingsEquity;
    const rel = baseline.holdingsEquity > 0 ? Math.abs(residual) / baseline.holdingsEquity : 1;
    assert(
      rel <= 0.01,
      `合计行资金恒等式：现金 ¥${baseline.holdingsCash} + 市值 ¥${baseline.holdingsMarket} = ¥${baseline.holdingsCash + baseline.holdingsMarket} ≈ 总权益 ¥${baseline.holdingsEquity}（偏差 ${(rel * 100).toFixed(3)}%）`,
    );
  } else {
    assert(false, "当前持仓合计行未给出 现金 / 市值 / 总权益 三项");
  }

  // ④ 准备买入：逐行比例 + 合计比例自洽
  if (baseline.planCells > 0) {
    assert(baseline.planPercents.every((p) => typeof p === "number"), "准备买入每行都含 x.xx% 计划仓位比例");
    assert(baseline.planAmounts.every((a) => typeof a === "number"), "准备买入每行都含 ¥ 预算上限");
    const sum = baseline.planPercents.reduce((acc, p) => acc + (p ?? 0), 0);
    assert(
      baseline.planFootRatio !== null && Math.abs(sum - baseline.planFootRatio) <= 0.05 * baseline.planCells,
      `逐只比例合计 ${sum.toFixed(2)}% ≈ 表格合计行 ${baseline.planFootRatio}%`,
    );
    assert((baseline.planFoot ?? "").includes("等权分仓"), "合计行回显分仓口径（原始基准 = 等权分仓）");
    assert(/股数待次日开盘价确定/.test(baseline.planFoot ?? ""), "合计行写明股数待次日开盘价确定（原因可读）");
    assert(baseline.mentionsOpenPriceReason === true, "页面可见「次日开盘价」原因说明");
  } else {
    console.log("（原始基准无准备买入清单：该策略当前无可准备候选，跳过逐只断言）");
  }

  const allRows = STRATEGY_LABELS.map((label) => log.perStrategy[label]).filter(Boolean);
  assert(allRows.every((row) => row.hasLegacyBlock === false), "五策略均无独立段落（比例只在表格）");
  assert(allRows.every((row) => (row.planHead ?? "").includes("计划仓位")), "五策略准备买入表头均含「计划仓位」");
  assert(baseline.pageErr === false, "页面无 Failed to fetch / 加载失败");

  ws.close();
  try { child.kill(); } catch { /* ignore */ }
  console.log(`\n${failures.length === 0 ? "ALL PASS" : `FAILURES(${failures.length}): ${failures.join(" | ")}`}`);
  console.log(`证据：${OUT}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("探针异常：", err);
  process.exit(2);
});
