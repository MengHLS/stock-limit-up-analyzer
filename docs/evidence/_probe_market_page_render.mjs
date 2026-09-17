/**
 * 大盘分析页真机渲染验收（无头 Edge + CDP，零依赖，只读）。
 *
 * 断言四件事：
 *   1) 页面渲染出「大盘分析」页头与「大盘综合分析」图表（不是白屏 / Failed to fetch）；
 *   2) 状态文案如实显示最新数据日 2026-09-14，且**不再**出现旧文案「今日数据已就绪」；
 *   3) 图表渲染 3 条线（涨停数 / 成交额 / 两融余额），且右侧轴刻度上界 >= 25000
 *      —— 若缺口被画成 0（旧行为），右轴 domain=[7500,auto] 会退化成 ~7500，此断言必然失败；
 *   4) 图例同时含「成交额」与「两融余额」。
 *
 * 用法：node docs/evidence/_probe_market_page_render.mjs [pageUrl]
 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const CDP_PORT = 9400 + Math.floor(Math.random() * 400);
const PAGE_URL = process.argv[2] ?? process.env.PAGE_URL ?? "http://127.0.0.1:3000/market";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const EXPR = `(() => {
  const txt = document.body.innerText;
  const tickTexts = [...document.querySelectorAll('.recharts-cartesian-axis-tick-value')]
    .map((t) => Number((t.textContent || '').replace(/[^0-9.-]/g, '')))
    .filter((n) => Number.isFinite(n));
  const lines = [...document.querySelectorAll('.recharts-line-curve')];
  return {
    hasHeader: txt.includes('大盘分析'),
    hasChartTitle: txt.includes('大盘综合分析'),
    hasTodayReadyText: txt.includes('今日数据已就绪'),
    latestText: (txt.match(/市场数据[^\\n]*/) ?? [null])[0],
    lineCount: lines.length,
    linesWithPath: lines.filter((l) => (l.getAttribute('d') || '').length > 0).length,
    maxAxisTick: tickTexts.length ? Math.max(...tickTexts) : null,
    hasTurnoverLegend: txt.includes('成交额'),
    hasMarginLegend: txt.includes('两融余额'),
    hasFetchError: /Failed to fetch|白屏|Unexpected Application Error/i.test(txt),
    bodyLen: txt.length,
  };
})()`;

async function main() {
  const profile = mkdtempSync(join(tmpdir(), "edge-cdp-market-"));
  const child = spawn(
    EDGE,
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

  const killTree = () => {
    try {
      spawn("taskkill", ["/F", "/T", "/PID", String(child.pid)], { stdio: "ignore" });
    } catch {
      /* ignore */
    }
  };

  try {
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
      if (res.result?.exceptionDetails) {
        throw new Error(`evaluate 异常：${JSON.stringify(res.result.exceptionDetails)}`);
      }
      return res.result?.result?.value;
    };

    await send("Runtime.enable");

    let stats = null;
    for (let i = 0; i < 90; i++) {
      stats = await evaluate(EXPR);
      if (stats.hasChartTitle && stats.lineCount >= 3) break;
      await sleep(1000);
    }

    console.log("--- 渲染态 ---");
    console.log(JSON.stringify(stats, null, 2));

    const failures = [];
    const assert = (ok, label) => {
      console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
      if (!ok) failures.push(label);
    };

    assert(stats.hasHeader === true, "页头「大盘分析」已渲染");
    assert(stats.hasFetchError === false, "无 Failed to fetch / 白屏");
    assert(stats.hasChartTitle === true, "「大盘综合分析」图表卡片存在");
    assert(stats.hasTodayReadyText === false, "旧文案「今日数据已就绪」已移除");
    assert(
      typeof stats.latestText === "string" && stats.latestText.includes("2026-09-14"),
      `状态文案显示最新数据日 2026-09-14（实际：${stats.latestText}）`,
    );
    assert(stats.lineCount === 3, `图表 3 条线（实际 ${stats.lineCount}）`);
    assert(stats.linesWithPath === 3, `3 条线都有路径 d（实际 ${stats.linesWithPath}）`);
    assert(
      typeof stats.maxAxisTick === "number" && stats.maxAxisTick >= 25000,
      `右轴刻度上界 >= 25000（实际 ${stats.maxAxisTick}）—— 缺口画成 0 时这里会退化`,
    );
    assert(stats.hasTurnoverLegend === true, "图例含「成交额」");
    assert(stats.hasMarginLegend === true, "图例含「两融余额」");

    ws.close();
    console.log(`\n${failures.length === 0 ? "ALL PASS" : `FAILURES(${failures.length}): ${failures.join(" | ")}`}`);
    process.exitCode = failures.length === 0 ? 0 : 1;
  } finally {
    killTree();
  }
}

main().catch((err) => {
  console.error("探针异常：", err);
  process.exit(2);
});
