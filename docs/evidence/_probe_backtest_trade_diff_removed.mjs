/**
 * 组合回测页「逐笔交易差异对比」删除验收（零依赖）。
 * 阶段 A（真机取模块）：dev server 上 /src/pages/Backtest.tsx 的转换产物不含该块；仍含全周期对比与订单表。
 * 阶段 B（真机渲染，无头 Edge + CDP）：等「全周期五策略收益对比」渲染出来后，
 *   断言 [data-trade-difference-table] 元素数 == 0 且正文不含「逐笔交易差异对比」/「仅看有差异订单」。
 * 只读、零写入。
 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const CDP_PORT = Number(process.env.CDP_PORT ?? 9335);
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const PAGE_URL = `${BASE}/backtest`;
const MODULE_URL = `${BASE}/src/pages/Backtest.tsx`;
const WAIT_SECONDS = Number(process.env.WAIT_SECONDS ?? 300);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures.push(label);
};

const EXPR = `(() => {
  const txt = document.body.innerText;
  return {
    diffTables: document.querySelectorAll('[data-trade-difference-table]').length,
    hasDiffTitle: txt.includes('\u9010\u7b14\u4ea4\u6613\u5dee\u5f02\u5bf9\u6bd4'),
    hasDiffOnlyToggle: txt.includes('\u4ec5\u770b\u6709\u5dee\u5f02\u8ba2\u5355'),
    hasFullCycleTitle: txt.includes('\u5168\u5468\u671f\u4e94\u7b56\u7565\u6536\u76ca\u5bf9\u6bd4'),
    hasOrdersBlock: txt.includes('\u5168\u90e8\u6a21\u62df\u8ba2\u5355'),
    hasBoardHeightCard: txt.includes('\u9ad8\u4f4d\u8fde\u677f\u98ce\u63a7\u751f\u6548\u60c5\u51b5'),
    bodyLen: txt.length,
  };
})()`;

async function phaseA() {
  console.log("--- 阶段 A：真机 dev server 取模块 ---");
  const res = await fetch(MODULE_URL);
  const text = await res.text();
  check(res.status === 200, `取模块 HTTP ${res.status}（${MODULE_URL}）`);
  check(!text.includes("data-trade-difference-table"), "模块产物不含 data-trade-difference-table");
  check(!text.includes("\u9010\u7b14\u4ea4\u6613\u5dee\u5f02\u5bf9\u6bd4"), "模块产物不含「逐笔交易差异对比」");
  check(!text.includes("TradeDiffCell"), "模块产物不含 TradeDiffCell");
  check(text.includes("fullCycleTradeDifferences"), "模块产物仍含 fullCycleTradeDifferences（订单表补全逻辑）");
  check(text.includes("ReturnLineChart"), "模块产物仍含 ReturnLineChart（全周期曲线）");
  return text.length;
}

async function phaseB() {
  console.log("--- 阶段 B：真机渲染（无头 Edge + CDP）---");
  const profile = mkdtempSync(join(tmpdir(), "edge-cdp-"));
  const child = spawn(
    EDGE,
    [
      "--headless=new", "--disable-gpu", "--no-proxy-server", "--no-first-run", "--disable-extensions",
      "--disable-features=Translate,MediaRouter",
      `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP_PORT}`, "--window-size=1600,1000", PAGE_URL,
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

  let stats = null;
  let ready = false;
  for (let i = 0; i < WAIT_SECONDS; i++) {
    stats = await evaluate(EXPR);
    if (stats.hasFullCycleTitle || stats.hasBoardHeightCard) {
      ready = true;
      break;
    }
    await sleep(1000);
  }
  console.log("--- DOM 快照 ---");
  console.log(JSON.stringify(stats, null, 2));

  check(stats.diffTables === 0, `[data-trade-difference-table] 元素数 ${stats.diffTables} == 0`);
  check(stats.hasDiffTitle === false, "正文不含「逐笔交易差异对比」");
  check(stats.hasDiffOnlyToggle === false, "正文不含「仅看有差异订单」");

  ws.close();
  try {
    child.kill();
  } catch {
    /* ignore */
  }
  if (!ready) {
    console.log(`\nWARN 等待 ${WAIT_SECONDS}s 后「全周期五策略收益对比」仍未渲染（数据未就绪）⇒ DOM 层仅完成「不存在」断言，未完成「同屏共存」取证`);
    return false;
  }
  check(stats.hasFullCycleTitle === true, "同屏仍渲染「全周期五策略收益对比」");
  return true;
}

async function main() {
  await phaseA();
  const domReady = await phaseB();
  console.log(`\n${failures.length === 0 ? "ALL PASS" : `FAILURES(${failures.length}): ${failures.join(" | ")}`}${domReady ? "" : "（DOM 同屏取证未完成）"}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("探针异常：", err);
  process.exit(2);
});
