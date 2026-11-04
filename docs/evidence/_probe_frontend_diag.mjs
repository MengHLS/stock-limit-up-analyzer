/**
 * 诊断脚本：弄清为什么浏览器里 useAuth() 看到的是未登录。
 *
 * 不做任何断言，只收集证据：
 *   - 页面 title / URL / body.innerText / body.innerHTML（截断）
 *   - 浏览器 console 输出
 *   - 页面里失败的 /api 请求
 *   - 在页面上下文里直接 fetch auth.me，看返回什么
 *
 * 用法：node docs/evidence/_probe_frontend_diag.mjs --port 3000 --path /research/480003
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
const PAGE_PATH = argOf("path", "/research/480003");
const CDP_PORT = Number(argOf("cdpPort", "9334"));
const BASE = `http://localhost:${PORT}`;
const OUT_DIR = resolve("docs/evidence/_report_frontend_diag");

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
    this.consoleLogs = [];
    this.network = [];
    this.failed = [];
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { resolve: res, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else res(msg.result);
        return;
      }
      if (msg.method === "Runtime.consoleAPICalled") {
        this.consoleLogs.push({
          type: msg.params.type,
          text: (msg.params.args ?? []).map((a) => a.value ?? a.description ?? a.type).join(" "),
        });
      }
      if (msg.method === "Runtime.exceptionThrown") {
        this.consoleLogs.push({
          type: "exception",
          text: msg.params.exceptionDetails?.text + " " + (msg.params.exceptionDetails?.exception?.description ?? ""),
        });
      }
      if (msg.method === "Network.responseReceived") {
        const { response, type } = msg.params;
        this.network.push({ type, url: response.url, status: response.status, mimeType: response.mimeType });
      }
      if (msg.method === "Network.loadingFailed") {
        this.failed.push({ requestId: msg.params.requestId, errorText: msg.params.errorText });
      }
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
    if (result.exceptionDetails) {
      return { __error: result.exceptionDetails.text + " " + (result.exceptionDetails.exception?.description ?? "") };
    }
    return result.result.value;
  }
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.addEventListener("open", () => resolve(new Cdp(ws)));
    ws.addEventListener("error", () => reject(new Error("WS 连接失败")));
  });
}

const report = { pagePath: PAGE_PATH, base: BASE };

try {
  mkdirSync(OUT_DIR, { recursive: true });
  const chromePath = findChrome();
  const profile = mkdtempSync(join(tmpdir(), "diag-cdp-"));
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

  // 1) 先在 about:blank 所在上下文里直接 fetch 一次 API，确认浏览器能不能拿到用户
  const blank = await cdp.evaluate(`location.href`);
  report.blankHref = blank;

  await cdp.send("Page.navigate", { url: `${BASE}${PAGE_PATH}` });
  await new Promise((r) => setTimeout(r, 8000));

  report.finalUrl = await cdp.evaluate("location.href");
  report.title = await cdp.evaluate("document.title");
  report.textLength = await cdp.evaluate("document.body ? document.body.innerText.length : -1");
  report.bodyText = await cdp.evaluate("document.body ? document.body.innerText.slice(0,2000) : ''");
  report.bodyHtml = await cdp.evaluate("document.body ? document.body.innerHTML.slice(0,4000) : ''");
  report.hasRoot = await cdp.evaluate("!!document.querySelector('#root')");
  report.rootChildren = await cdp.evaluate("document.querySelector('#root') ? document.querySelector('#root').children.length : -1");

  // 2) 在页面上下文里直接打 API
  report.fetchAuthMe = await cdp.evaluate(
    `fetch('/api/trpc/auth.me?input=%7B%7D').then(r => r.text()).then(t => t.slice(0,600)).catch(e => 'FETCH_ERR: ' + e.message)`,
  );
  report.localStorage = await cdp.evaluate(
    `(() => { try { return JSON.stringify({ info: localStorage.getItem('manus-runtime-user-info') }); } catch (e) { return 'ERR ' + e.message; } })()`,
  );

  // 3) 等前端 tRPC 起来后再看一次
  await new Promise((r) => setTimeout(r, 6000));
  report.fetchAuthMe2 = await cdp.evaluate(
    `fetch('/api/trpc/auth.me?input=%7B%7D').then(r => r.text()).then(t => t.slice(0,600)).catch(e => 'FETCH_ERR: ' + e.message)`,
  );
  report.textAfterWait = await cdp.evaluate("document.body ? document.body.innerText.length : -1");
  report.localStorage2 = await cdp.evaluate(
    `(() => { try { return String(localStorage.getItem('manus-runtime-user-info')); } catch (e) { return 'ERR ' + e.message; } })()`,
  );

  report.consoleLogs = cdp.consoleLogs;
  report.networkFailures = cdp.failed;
  report.apiResponses = cdp.network.filter((n) => n.url.includes("/api/"));
  report.jsResponses = cdp.network.filter((n) => n.mimeType && (n.mimeType.includes("javascript") || n.mimeType.includes("html"))).slice(0, 40);

  writeFileSync(join(OUT_DIR, "diag.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));

  chrome.kill();
} catch (e) {
  console.error("诊断失败：", e);
  process.exitCode = 1;
}
