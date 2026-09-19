/**
 * 重复导航探针：量化 ResearchDetail 页面在浏览器里的「稳定渲染率」。
 *
 * 背景：单次探针在 22:02 / 22:16 两次落到「只有外壳 + 登录按钮」的未登录态，
 * 而 22:06 的 diag 与 22:07 的探针又是正常的。怀疑与当时 TiDB 连接抖动有关
 * （服务端日志大量 Connection lost / ETIMEDOUT），需要先量化再下结论。
 *
 * 每次都是**全新导航**（Page.navigate），等待 content 区出现或超时后记录：
 *   - 是否出现「查看研究报告」入口
 *   - body 文本长度 / 是否出现用户菜单（本地开发）
 *   - 控制台异常、失败请求
 *
 * 用法：node docs/evidence/_probe_frontend_repeat.mjs --runs 5 --port 3000
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function argOf(name, fallback) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 && process.argv[idx + 1] !== undefined ? process.argv[idx + 1] : fallback;
}

const PORT = Number(argOf("port", "3000"));
const EXPERIMENT_ID = Number(argOf("experimentId", "480003"));
const RUNS = Number(argOf("runs", "5"));
const CDP_PORT = Number(argOf("cdpPort", "9335"));
const BASE = `http://localhost:${PORT}`;
const OUT_DIR = resolve("docs/evidence/_report_frontend_repeat");

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

function findChrome() {
  for (const c of CHROME_CANDIDATES) if (existsSync(c)) return c;
  throw new Error("未找到 Chrome / Edge");
}

async function waitForCdp() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === "page" && typeof t.webSocketDebuggerUrl === "string");
      if (page) return page;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("CDP 未就绪");
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve: res, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else res(msg.result);
        return;
      }
      if (msg.method) this.events.push(msg);
    });
  }
  send(method, params = {}) {
    this.id += 1;
    const id = this.id;
    return new Promise((res, reject) => {
      this.pending.set(id, { resolve: res, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) return { __error: result.exceptionDetails.text };
    return result.result.value;
  }
  async waitFor(expression, { timeoutMs = 30_000, label = expression } = {}) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
      try {
        last = await this.evaluate(expression);
        if (last) return last;
      } catch (e) {
        last = String(e.message ?? e);
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error(`等待超时：${label}（最后取值 ${JSON.stringify(last)}）`);
  }
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.addEventListener("open", () => resolve(new Cdp(ws)));
    ws.addEventListener("error", () => reject(new Error("WS 连接失败")));
  });
}

const PROBE = `(() => {
  const anchor = [...document.querySelectorAll('a')].find(a => (a.textContent || '').includes('查看研究报告'));
  const text = document.body ? document.body.innerText : '';
  const inset = document.querySelector('[data-slot="sidebar-inset"]');
  return {
    anchor: !!anchor,
    anchorHref: anchor ? anchor.getAttribute('href') : null,
    textLength: text.length,
    hasUserMenu: text.includes('本地开发'),
    hasLoginBtn: /(^|\\n)登录\\s*$/.test(text),
    insetTextLength: inset ? inset.innerText.length : -1,
    insetPresent: !!inset,
    text: text.slice(0, 220),
  };
})()`;

const results = [];

try {
  mkdirSync(OUT_DIR, { recursive: true });
  const chromePath = findChrome();
  const profile = mkdtempSync(join(tmpdir(), "repeat-cdp-"));
  const chrome = spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profile}`,
      "--window-size=1440,1200",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  const target = await waitForCdp();
  const cdp = await connect(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");

  for (let i = 1; i <= RUNS; i++) {
    // 记录本次导航期间的服务端 API 响应
    const apiBefore = [];
    const onMsg = (ev) => {
      try {
        const m = JSON.parse(ev.data);
        if (m.method === "Network.responseReceived" && m.params.response.url.includes("/api/trpc/")) {
          apiBefore.push({ url: m.params.response.url.slice(0, 140), status: m.params.response.status });
        }
      } catch {
        /* ignore */
      }
    };
    cdp.ws.addEventListener("message", onMsg);

    await cdp.send("Page.navigate", { url: `${BASE}/research/${EXPERIMENT_ID}` });
    await cdp.waitFor(`document.readyState === 'complete'`, { label: "readyState", timeoutMs: 20_000 }).catch(() => {});

    // 最多等 25s 出现入口；否则记录超时时的状态
    const t0 = Date.now();
    let snap = null;
    while (Date.now() - t0 < 25_000) {
      snap = await cdp.evaluate(PROBE);
      if (snap && snap.anchor) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    cdp.ws.removeEventListener("message", onMsg);
    if (!snap || snap.__error) snap = { error: snap && snap.__error };

    const entry = { run: i, waitedMs: Date.now() - t0, snap, api: apiBefore };
    results.push(entry);
    console.log(`[run ${i}] ` + JSON.stringify({ ...snap, api: apiBefore.map((a) => a.status).join(",") }));
  }

  writeFileSync(join(OUT_DIR, "repeat.json"), JSON.stringify(results, null, 2), "utf8");
  const okCount = results.filter((r) => r.snap && r.snap.anchor).length;
  console.log(`\n稳定渲染率：${okCount}/${RUNS}`);
  chrome.kill();
} catch (e) {
  console.error("探针失败：", e);
  process.exitCode = 1;
}
