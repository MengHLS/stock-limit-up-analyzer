/**
 * 行情同步页「指数行情同步」新区块验收（无头 Edge + CDP，零依赖）。
 *
 * 断言（只读，绝不点击「同步指数」，避免消耗 tushare 的 5 次/天配额）：
 *   1) 页面标题「行情同步检查」与新区块「指数行情同步」/「交易日历」标记均渲染；
 *   2) 4 只核心指数行全部出现在 DOM 文本中；
 *   3) 「同步指数 / 强制重拉 / 仅补这只」三类操作入口存在；
 *   4) 🔴 口径一致性：落后告警存在时不得出现「跳过（不发请求）」，
 *      齐平提示存在时必须 4 只全为「跳过」—— 即「落后量」与「本次计划」不打架
 *      （这正是 30 天容差曾把「落后 1 个交易日」掩盖成「已齐平」的地方）。
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
// 🔴 端口随机化：上一次探针若残留渲染子进程占住固定端口，新实例会把 URL 交给旧实例，
// 于是 CDP 连到空白页（bodyLen === 0），全部断言假失败。
const CDP_PORT = Number(process.env.CDP_PORT ?? 9330 + (process.pid % 500));
const PAGE_URL = process.env.PAGE_URL ?? "http://127.0.0.1:3000/stock-sync";
const PATH_HINT = new URL(PAGE_URL).pathname;

const INDEX_CODES = ["000001.SH", "399001.SZ", "000300.SH", "000905.SH"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 探针启动的 Edge 主进程；退出时据此杀整棵进程树，避免残留渲染子进程。 */
let edgeChild = null;

/** 杀整棵进程树：只 kill 主进程会留下渲染子进程（本探针首版就因此残留 27 个 msedge）。 */
function killEdgeTree() {
  if (!edgeChild?.pid) return;
  try {
    spawnSync("taskkill", ["/F", "/T", "/PID", String(edgeChild.pid)], { stdio: "ignore" });
  } catch {
    /* ignore */
  }
}

process.on("exit", killEdgeTree);

const EXPR = `(() => {
  const txt = document.body.innerText;
  const codes = ${JSON.stringify(INDEX_CODES)};
  return {
    bodyLen: txt.length,
    hasPageTitle: txt.includes('\\u884c\\u60c5\\u540c\\u6b65\\u68c0\\u67e5'),
    hasIndexBlock: txt.includes('\\u6307\\u6570\\u884c\\u60c5\\u540c\\u6b65'),
    hasCalendarBadge: txt.includes('\\u4ea4\\u6613\\u65e5\\u5386'),
    hasStaleAlert: txt.includes('\\u4ea4\\u6613\\u65e5\\u5386\\u843d\\u540e\\u884c\\u60c5'),
    hasFreshAlert: txt.includes('\\u4ea4\\u6613\\u65e5\\u5386\\u4e0e\\u884c\\u60c5\\u672b\\u7aef\\u9f50\\u5e73'),
    indexRowCount: codes.filter((c) => txt.includes(c)).length,
    hasSyncButton: txt.includes('\\u540c\\u6b65\\u6307\\u6570'),
    hasForceButton: txt.includes('\\u5f3a\\u5236\\u91cd\\u62c9'),
    hasPerRowButton: txt.includes('\\u4ec5\\u8865\\u8fd9\\u53ea'),
    skipCount: (txt.match(/\\u8df3\\u8fc7\\uff08\\u4e0d\\u53d1\\u8bf7\\u6c42\\uff09/g) ?? []).length,
    lagBadgeCount: (txt.match(/\\u843d\\u540e \\d+ \\u5929/g) ?? []).length,
    freshBadgeCount: (txt.match(/\\u5df2\\u9f50\\u5e73/g) ?? []).length,
    hasProviderNote: txt.includes('\\u6570\\u636e\\u6e90') && txt.includes('tushare'),
    windowShown: txt.includes('2019-01-01'),
    tableCount: document.querySelectorAll('table').length,
  };
})()`;

async function main() {
  const profile = mkdtempSync(join(tmpdir(), "edge-cdp-idx-"));
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
      "--window-size=1600,1200",
      PAGE_URL,
    ],
    { stdio: "ignore", detached: false },
  );
  edgeChild = child;

  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      // 🔴 必须命中目标路径：残留实例可能提供别的 page target，连上去只会读到空白页
      target = list.find((t) => t.type === "page" && t.url.includes(PATH_HINT));
    } catch {
      /* 浏览器还没起来 */
    }
  }
  if (!target?.webSocketDebuggerUrl) throw new Error(`CDP 未就绪：拿不到 ${PAGE_URL} 的 page target`);

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
    // 等异步 tRPC 数据落进 DOM：body 非空 + 4 只指数行 + provider 说明都出现才算就绪
    if (stats.bodyLen > 0 && stats.indexRowCount === INDEX_CODES.length && stats.hasProviderNote) break;
    await sleep(1000);
  }

  const failures = [];
  const assert = (ok, label) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
    if (!ok) failures.push(label);
  };

  console.log("--- 指数行情同步区块 ---");
  console.log(JSON.stringify(stats, null, 2));

  assert(stats.hasPageTitle === true, "页面标题「行情同步检查」存在");
  assert(stats.hasIndexBlock === true, "新区块「指数行情同步」渲染");
  assert(stats.hasCalendarBadge === true, "「交易日历」标记渲染");
  assert(
    stats.indexRowCount === INDEX_CODES.length,
    `4 只核心指数行全部渲染（实际 ${stats.indexRowCount}/${INDEX_CODES.length}）`,
  );
  assert(stats.hasSyncButton === true, "「同步指数」按钮存在");
  assert(stats.hasForceButton === true, "「强制重拉」按钮存在");
  assert(stats.hasPerRowButton === true, "逐只「仅补这只」按钮存在");
  assert(stats.hasProviderNote === true, "数据源说明（含默认 tushare）渲染");
  assert(stats.windowShown === true, "请求窗口起点 2019-01-01 渲染");
  assert(stats.hasStaleAlert || stats.hasFreshAlert, "落后/齐平提示二者必居其一");
  assert(
    stats.hasStaleAlert !== stats.hasFreshAlert,
    "落后提示与齐平提示互斥（不同时出现）",
  );
  // 🔴 口径一致性：落后则不应有「跳过」，齐平则应 4 只全「跳过」
  assert(
    stats.hasStaleAlert ? stats.skipCount === 0 : stats.skipCount === INDEX_CODES.length,
    stats.hasStaleAlert
      ? `落后告警下「本次计划」不得为跳过（实际跳过 ${stats.skipCount} 只）`
      : `齐平提示下 4 只应全部跳过（实际 ${stats.skipCount} 只）`,
  );
  // 🔴 「相对行情末端」列：落后徽标与齐平徽标同样互斥且应为全量（逐指数各一个）
  assert(
    stats.hasStaleAlert
      ? stats.lagBadgeCount === INDEX_CODES.length && stats.freshBadgeCount === 0
      : stats.lagBadgeCount === 0 && stats.freshBadgeCount === INDEX_CODES.length,
    `逐指数落后/齐平徽标计数正确（落后 ${stats.lagBadgeCount} / 齐平 ${stats.freshBadgeCount}）`,
  );

  ws.close();
  killEdgeTree();
  console.log(`\n${failures.length === 0 ? "ALL PASS" : `FAILURES(${failures.length}): ${failures.join(" | ")}`}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("探针异常：", err);
  process.exit(2);
});
