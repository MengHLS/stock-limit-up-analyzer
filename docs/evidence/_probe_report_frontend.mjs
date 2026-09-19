/**
 * PHASE-A-001 前端验收探针（**真实浏览器 + CDP**，不是 API 断言）。
 *
 * 任务书 A-4 明确要求：
 *   > 通过正常导航进入 ResearchDetail。再进入「查看研究报告」必须成功。
 *   > 禁止只使用 API 请求证明前端完成。需要使用浏览器/CDP 检查实际 DOM 和页面状态。
 *
 * 本脚本因此：
 *   1. 用本机已安装的 Chrome（`--headless=new --remote-debugging-port`）打开真实页面；
 *   2. 在 `/research/<experimentId>` 上**在 DOM 里找「查看研究报告」这个可点元素**，
 *      用 `element.click()` 触发真实导航（不直接改 location）；
 *   3. 断言导航后的 `location.pathname` 与 DOM 里是否真的渲染出报告正文；
 *   4. 落一张截图作为视觉证据。
 *
 * 只用 Node 内置能力（fetch + 全局 WebSocket + child_process），**不引入任何依赖**。
 *
 * 用法：
 *   node docs/evidence/_probe_report_frontend.mjs --experimentId 480003 --runId 750003 --port 3000
 */

import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function argOf(name, fallback) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 && process.argv[idx + 1] !== undefined ? process.argv[idx + 1] : fallback;
}

const EXPERIMENT_ID = Number(argOf("experimentId", "480003"));
const RUN_ID = Number(argOf("runId", "750003"));
const PORT = Number(argOf("port", "3000"));
const CDP_PORT = Number(argOf("cdpPort", "9333"));
const BASE = `http://localhost:${PORT}`;
const OUT_DIR = resolve("docs/evidence/_report_frontend");

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
];

const evidence = { generatedAt: new Date().toISOString(), steps: [], assertions: {}, ok: false };
let chrome = null;

function record(step, detail) {
  evidence.steps.push({ step, ...detail });
  console.log(`[step] ${step} ${JSON.stringify(detail)}`);
}

async function findChrome() {
  const { existsSync } = await import("node:fs");
  for (const candidate of CHROME_CANDIDATES) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("未找到 Chrome / Edge 可执行文件");
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
      // 还没起来，继续等
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("CDP 在 30s 内没有就绪");
}

// ---------------------------------------------------------------------------
// 极简 CDP 客户端（Node 22 内置 WebSocket）
// ---------------------------------------------------------------------------

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
        if (msg.error) reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error)})`));
        else res(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
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

  /** 在页面里求值（返回 JSON 可序列化的值）。 */
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(`页面求值异常：${result.exceptionDetails.text ?? ""} ${JSON.stringify(result.exceptionDetails.exception ?? {})}`);
    }
    return result.result.value;
  }

  /** 轮询直到表达式返回真值，或超时。 */
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
      await new Promise((r) => setTimeout(r, 400));
    }
    throw new Error(`等待超时：${label}（最后一次取值：${JSON.stringify(last)}）`);
  }
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.addEventListener("open", () => resolve(new Cdp(ws)));
    ws.addEventListener("error", (e) => reject(new Error(`WebSocket 连接失败：${e.message ?? "unknown"}`)));
  });
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

try {
  mkdirSync(OUT_DIR, { recursive: true });
  const chromePath = await findChrome();
  record("chrome", { path: chromePath });

  const profile = mkdtempSync(join(tmpdir(), "phasea-cdp-"));
  chrome = spawn(
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
    { stdio: "ignore", detached: false },
  );

  const target = await waitForCdp();
  record("cdp-ready", { targetId: target.id, url: target.url });

  const cdp = await connect(target.webSocketDebuggerUrl);
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");

  // ---- 1) 正常导航进入 ResearchDetail ----
  // ⚠️ 曾经的假失败教训（2026-09-19）：
  //   外壳（侧边导航）会**先**渲染出来，此时 `useAuth()` 尚未拿到用户，于是 AppShell 会
  //   先渲染「登录」按钮，等 `auth.me` 回来后（本地 ~百毫秒）才换成用户菜单。
  //   早期版本一见到「登录」就立刻判定未登录并抛错 ⇒ 在 Vite 冷启动/机器繁忙（当时并行跑
  //   `tsc`）时，外壳渲染远早于内容区，于是把「还没加载」误报成「被登录门拦住」。
  //
  //   修法：**只等「查看研究报告」入口出现**（给足 120s，覆盖 Vite 冷编译 + 慢查询）；
  //   超时后才做一次分类诊断（是否登录门 / 是否仍在加载），把「为什么没出来」讲清楚。
  await cdp.send("Page.navigate", { url: `${BASE}/research/${EXPERIMENT_ID}` });
  await cdp.waitFor(`document.readyState === 'complete'`, { label: "文档就绪" });

  let detailState;
  const detailT0 = Date.now();
  try {
    detailState = await cdp.waitFor(
      `(() => {
         const anchor = [...document.querySelectorAll('a')].find(a => (a.textContent || '').includes('查看研究报告'));
         if (!anchor) return null;
         return { state: 'ready', href: location.pathname, hasAnchor: true, anchorHref: anchor.getAttribute('href'), textLength: document.body.innerText.length };
       })()`,
      { label: `ResearchDetail 渲染出「查看研究报告」入口（${BASE}/research/${EXPERIMENT_ID}）`, timeoutMs: 120_000 },
    );
  } catch (err) {
    // 超时：做一次事后分类，给出可解释的失败原因（而不是笼统报「未登录」）
    const diag = await cdp.evaluate(
      `(() => {
         const text = document.body ? document.body.innerText : '';
         const inset = document.querySelector('[data-slot="sidebar-inset"]');
         return {
           path: location.pathname,
           textLength: text.length,
           hasLoginBtn: /(^|\\n)登录\\s*$/.test(text) || text.includes('请先登录'),
           hasUserMenu: text.includes('本地开发'),
           insetPresent: !!inset,
           insetTextLength: inset ? inset.innerText.length : -1,
           textPreview: text.slice(0, 300),
         };
       })()`,
    );
    throw new Error(
      `ResearchDetail 在 120s 内未渲染出「查看研究报告」入口。诊断：${JSON.stringify(diag)}（原始错误：${err.message}）`,
    );
  }
  detailState.waitedMs = Date.now() - detailT0;
  evidence.assertions.detailPath = detailState.href;
  evidence.assertions.detailHasReportEntry = detailState.hasAnchor;
  evidence.assertions.detailAnchorHref = detailState.anchorHref;
  evidence.assertions.detailState = detailState.state;
  record("research-detail", detailState);

  const detailText = await cdp.evaluate("document.body.innerText.slice(0, 1500)");
  writeFileSync(join(OUT_DIR, "01-research-detail.txt"), String(detailText), "utf8");
  const detailShot = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT_DIR, "01-research-detail.png"), Buffer.from(detailShot.data, "base64"));

  // ---- 2) 点击「查看研究报告」触发**真实导航** ----
  const clicked = await cdp.evaluate(
    `(() => {
       const anchor = [...document.querySelectorAll('a')].find(a => (a.textContent || '').includes('查看研究报告'));
       if (!anchor) return false;
       anchor.click();
       return true;
     })()`,
  );
  if (!clicked) throw new Error("未能点击「查看研究报告」入口");

  await cdp.waitFor(`location.pathname === '/research/report/${RUN_ID}'`, {
    label: `点击后路由切到 /research/report/${RUN_ID}`,
  });
  const reportState = await cdp.waitFor(
    `(() => {
       const node = document.querySelector('[data-testid="report-body"]');
       const raw = document.querySelector('[data-testid="report-body-raw"]');
       const inner = (node && node.innerText) || (raw && raw.innerText) || '';
       if (inner.length < 500) return null;
       const text = document.body.innerText;
       return {
         path: location.pathname,
         runId: document.querySelector('[data-testid="report-view"]') ? document.querySelector('[data-testid="report-view"]').getAttribute('data-run-id') : null,
         bodyLength: inner.length,
         hasBasicInfo: inner.includes('基本信息'),
         hasAnalysis: inner.includes('Research Analysis 清单'),
         hasResult: inner.includes('Research Result'),
         hasFinding: inner.includes('Finding'),
         hasConclusion: inner.includes('Conclusion'),
         hasLimitations: inner.includes('Limitations'),
         createdAtShown: /报告生成时间/.test(text),
         datasetShown: /Dataset Version/.test(text),
       };
     })()`,
    { label: "ReportView 渲染出报告正文（>500 字符）" },
  );
  evidence.assertions.reportPath = reportState.path;
  evidence.assertions.reportBodyLength = reportState.bodyLength;
  record("report-view", reportState);
  Object.assign(evidence.assertions, {
    reportHasBasicInfo: reportState.hasBasicInfo,
    reportHasAnalysis: reportState.hasAnalysis,
    reportHasResult: reportState.hasResult,
    reportHasFinding: reportState.hasFinding,
    reportHasConclusion: reportState.hasConclusion,
    reportHasLimitations: reportState.hasLimitations,
    reportShowsGeneratedAt: reportState.createdAtShown,
    reportShowsDataset: reportState.datasetShown,
  });

  const reportText = await cdp.evaluate("document.body.innerText");
  // 证据文本只留前 60k 字符：真实报告可达 24 万字符（Run 750003），全量落盘既无必要也难以评审。
  writeFileSync(join(OUT_DIR, "02-report-view.txt"), String(reportText).slice(0, 60_000), "utf8");
  // ⚠️ 不要用 captureBeyondViewport:true —— 报告正文极长（24 万字符），整页截图会让 CDP 卡死数分钟。
  // 视口截图（默认）已足够证明「报告真的渲染在页面上」。
  const reportShot = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT_DIR, "02-report-view.png"), Buffer.from(reportShot.data, "base64"));

  // ---- 3) 「原文视图」开关：证明能拿到完整 markdown 文本 ----
  const toggled = await cdp.evaluate(
    `(() => {
       const btn = [...document.querySelectorAll('button')].find(b => (b.textContent || '').includes('原文视图'));
       if (!btn) return false;
       btn.click();
       return true;
     })()`,
  );
  if (toggled) {
    const raw = await cdp.waitFor(
      `(() => { const n = document.querySelector('[data-testid="report-body-raw"]'); return n && n.innerText.length > 500 ? n.innerText.length : null; })()`,
      { label: "原文视图渲染出完整 markdown" },
    );
    evidence.assertions.rawViewLength = raw;
    record("raw-view", { length: raw });
    const rawText = await cdp.evaluate(`document.querySelector('[data-testid="report-body-raw"]').innerText`);
    writeFileSync(join(OUT_DIR, "03-report-raw.txt"), String(rawText).slice(0, 60_000), "utf8");
    const rawShot = await cdp.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(OUT_DIR, "03-report-raw.png"), Buffer.from(rawShot.data, "base64"));
  } else {
    evidence.assertions.rawViewLength = null;
    record("raw-view", { skipped: "未找到「原文视图」按钮" });
  }

  // ---- 4) 反例：未生成报告的 Run 必须给出明确错误态，而不是空白页 ----
  // 注意：这里必须等「明确的错误文案出现」，不能只等 body 有文字 ——
  // 外壳（侧边导航）一渲染 body 就有 100+ 字符，会把「还没加载」误判成「错误态」。
  await cdp.send("Page.navigate", { url: `${BASE}/research/report/1` });
  const notFound = await cdp.waitFor(
    `(() => {
       const t = document.body ? document.body.innerText : '';
       const hasReportBody = !!document.querySelector('[data-testid="report-body"]');
       const errorish = /研究报告加载失败|尚未生成研究报告|未找到 Research Run|不存在|NOT_FOUND/.test(t);
       if (!errorish) return null;
       return { text: t.slice(0, 500), mentionsMissing: true, hasReportBody };
     })()`,
    { label: "不存在报告的 Run 给出明确错误态", timeoutMs: 60_000 },
  );
  evidence.assertions.missingReportExplicit = notFound.mentionsMissing;
  evidence.assertions.missingReportHasNoBody = notFound.hasReportBody === false;
  record("negative-case", {
    mentionsMissing: notFound.mentionsMissing,
    hasReportBody: notFound.hasReportBody,
    preview: notFound.text.slice(0, 200),
  });

  evidence.ok =
    evidence.assertions.detailHasReportEntry === true &&
    evidence.assertions.detailAnchorHref === `/research/report/${RUN_ID}` &&
    evidence.assertions.reportPath === `/research/report/${RUN_ID}` &&
    evidence.assertions.reportBodyLength > 500 &&
    evidence.assertions.reportShowsGeneratedAt === true &&
    evidence.assertions.reportShowsDataset === true &&
    evidence.assertions.missingReportExplicit === true &&
    evidence.assertions.missingReportHasNoBody === true;

  writeFileSync(join(OUT_DIR, "evidence.json"), JSON.stringify(evidence, null, 2), "utf8");
  console.log(JSON.stringify({ ok: evidence.ok, assertions: evidence.assertions }, null, 2));
  process.exitCode = evidence.ok ? 0 : 1;
} catch (e) {
  evidence.error = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
  try {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, "evidence.json"), JSON.stringify(evidence, null, 2), "utf8");
  } catch {
    // 忽略
  }
  console.error("[probe-frontend] 失败：", evidence.error);
  process.exitCode = 1;
} finally {
  if (chrome && !chrome.killed) {
    try {
      chrome.kill();
    } catch {
      // 忽略
    }
  }
}
