/**
 * 应用启动整体渲染验收（无头 Chrome + CDP，零依赖，只读）。
 * 目的：确认 dev server 起来后**页面真的渲染出内容**（不是 200 但白屏 / Failed to fetch）。
 * 手法：单浏览器实例，逐路由 Page.navigate → 轮询 DOM 直到有内容或超时 →
 *       量 innerText 长度 / 标题 / 侧栏项 / 控制台错误 / fetch 失败痕迹。
 * 输出：控制台 + 同步落盘 JSON（探针被中断时日志仍在）。
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CDP_PORT = 9377;
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const OUT = "docs/evidence/_probe_app_boot_render.json";

const ROUTES = (process.env.ROUTES ? process.env.ROUTES.split(",") : [
  "/",
  "/datasets",
  "/strategies",
  "/leader-candidates",
  "/market",
  "/paper-trading",
  "/stock-sync",
  "/data-health",
  "/research",
  "/sentiment-analysis",
  "/backtest-runs",
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const COLLECT = `(() => {
  const txt = document.body ? document.body.innerText : "";
  const heads = [...document.querySelectorAll("h1,h2")].map((h) => (h.innerText || "").trim()).filter(Boolean);
  const navLinks = [...document.querySelectorAll('a[href^="/"]')].map((a) => a.getAttribute("href"));
  return {
    textLen: txt.length,
    head: heads.slice(0, 3),
    navCount: new Set(navLinks).size,
    fetchFail: /Failed to fetch|ECONNREFUSED|NetworkError/.test(txt),
    loadFail: /加载失败|请求失败|出错了/.test(txt),
    errs: (window.__errs || []).slice(0, 5),
    excerpt: txt.replace(/\\s+/g, " ").slice(0, 160),
  };
})()`;

const HOOK = `(() => {
  window.__errs = [];
  const push = (s) => { try { window.__errs.push(String(s).slice(0, 200)); } catch {} };
  window.addEventListener("error", (e) => push(e.message));
  window.addEventListener("unhandledrejection", (e) => push("unhandled: " + (e.reason && e.reason.message ? e.reason.message : e.reason)));
  const oe = console.error;
  console.error = (...a) => { push(a.map((x) => (x && x.message) ? x.message : x).join(" ")); return oe.apply(console, a); };
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
      "about:blank",
    ],
    { stdio: "ignore", detached: false },
  );

  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      target = list.find((t) => t.type === "page");
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
  await send("Page.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: HOOK });

  const results = [];
  const failures = [];
  const flush = () => writeFileSync(OUT, JSON.stringify({ base: BASE, results }, null, 2));

  for (const route of ROUTES) {
    await send("Page.navigate", { url: BASE + route });
    let stats = null;
    for (let i = 0; i < (Number(process.env.WAIT_SEC) || 25); i++) {
      await sleep(1000);
      try {
        stats = await evaluate(COLLECT);
      } catch {
        stats = null;
      }
      if (stats && stats.textLen > 150 && stats.navCount > 5) break;
    }
    const row = { route, ...(stats ?? { textLen: 0, head: [], navCount: 0, errs: ["COLLECT_FAILED"], excerpt: "" }) };
    results.push(row);
    flush();
    const ok = row.textLen > 150 && !row.fetchFail;
    if (!ok) failures.push(route);
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${route.padEnd(22)} textLen=${String(row.textLen).padStart(5)} nav=${String(row.navCount).padStart(2)} ` +
        `head=${JSON.stringify(row.head)} fetchFail=${row.fetchFail} errs=${row.errs.length}`,
    );
    if (row.errs.length) console.log(`      errs: ${JSON.stringify(row.errs)}`);
  }

  ws.close();
  try {
    child.kill();
  } catch {
    /* ignore */
  }
  console.log(`\n${failures.length === 0 ? "ALL PASS" : `FAILURES(${failures.length}): ${failures.join(" | ")}`}`);
  console.log(`证据：${OUT}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("探针异常：", err);
  process.exit(2);
});
