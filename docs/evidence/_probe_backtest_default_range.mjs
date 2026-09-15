/**
 * 组合回测页（/backtest）默认回测区间验收（无头 Edge + CDP，零依赖）。
 * 断言：
 *   1) 页面渲染出「回测开始日期 / 回测结束日期」两个 date 输入；
 *   2) 开始日期默认值 == 2025-09-01；
 *   3) 结束日期非空且 >= 开始日期。
 * 只读、零写入（不点击、不触发回测）。
 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const CDP_PORT = Number(process.env.CDP_PORT ?? 9334);
const PAGE_URL = process.env.PAGE_URL ?? "http://127.0.0.1:3000/backtest";
const EXPECTED_START = "2025-09-01";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const EXPR = `(() => {
  const start = document.querySelector('input[aria-label="\\u56de\\u6d4b\\u5f00\\u59cb\\u65e5\\u671f"]');
  const end = document.querySelector('input[aria-label="\\u56de\\u6d4b\\u7ed3\\u675f\\u65e5\\u671f"]');
  const txt = document.body.innerText;
  return {
    startValue: start ? start.value : null,
    endValue: end ? end.value : null,
    hasPageTitle: txt.includes('\\u7ec4\\u5408\\u56de\\u6d4b'),
    hasRangeLabel: txt.includes('\\u56de\\u6d4b\\u533a\\u95f4'),
    bodyLen: txt.length,
  };
})()`;

async function main() {
  const profile = mkdtempSync(join(tmpdir(), "edge-cdp-"));
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
  for (let i = 0; i < 60; i++) {
    stats = await evaluate(EXPR);
    if (stats.startValue !== null && stats.endValue !== null) break;
    await sleep(1000);
  }

  const failures = [];
  const assert = (ok, label) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
    if (!ok) failures.push(label);
  };

  console.log("--- 默认区间 ---");
  console.log(JSON.stringify(stats, null, 2));

  assert(stats.hasPageTitle === true, "页面标题「组合回测」存在");
  assert(stats.hasRangeLabel === true, "「回测区间」标签存在");
  assert(stats.startValue !== null && stats.endValue !== null, "两个日期输入均已渲染");
  assert(stats.startValue === EXPECTED_START, `开始日期默认值 ${stats.startValue} == ${EXPECTED_START}`);
  assert(
    typeof stats.endValue === "string" && /^\d{4}-\d{2}-\d{2}$/.test(stats.endValue),
    `结束日期默认值合法（${stats.endValue}）`,
  );
  assert(stats.endValue >= stats.startValue, `结束日期 ${stats.endValue} >= 开始日期 ${stats.startValue}`);

  ws.close();
  try {
    child.kill();
  } catch {
    /* ignore */
  }
  console.log(`\n${failures.length === 0 ? "ALL PASS" : `FAILURES(${failures.length}): ${failures.join(" | ")}`}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("探针异常：", err);
  process.exit(2);
});
