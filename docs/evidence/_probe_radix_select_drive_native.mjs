/**
 * `_probe_radix_select_drive_native.mjs` —— 用 **CDP 原生输入管道**驱动 Radix Select（只读，不点提交）。
 *
 * 前情：`_probe_radix_select_drive.mjs` 实测了 5 种 **`Runtime.evaluate` 合成事件** 驱动方式，
 * 全部 `✗ 未生效` —— 下拉能打开、`[role="option"]` 能读到、`pointerType` 机制已按
 * `@radix-ui/react-select@2.2` 源码正确模拟，`handleSelect()` 仍不触发。
 *
 * 本探针换一条路：`Input.dispatchMouseEvent` 走的是**浏览器真实输入管线**，
 * Blink 会据此生成 `isTrusted: true` 的 mouse 事件 **并派生 `pointerType: "mouse"` 的 pointer 事件**，
 * 绕过 React/Radix 对不可信合成事件的判定。
 *
 * 判据 = 「触发器 `#ask-version` 文案是否变成 v2」。
 *
 * 用法：node docs/evidence/_probe_radix_select_drive_native.mjs
 */
import { spawn } from "node:child_process";
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];
const CDP_PORT = 9700 + Math.floor(Math.random() * 90);
const PAGE_URL = process.argv[2] ?? "http://127.0.0.1:3000/research/ask";
const WANT = "v2";
const OUT_PATH = "docs/evidence/_probe_radix_select_drive_native.out.txt";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
writeFileSync(OUT_PATH, "", "utf8");
const log = (s = "") => {
  console.log(s);
  appendFileSync(OUT_PATH, `${s}\n`, "utf8");
};

const READY = `(() => {
  if (!document.body) return { __notReady: true };
  const t = (id) => { const e = document.querySelector(id); return e ? (e.textContent || '').trim() : null; };
  return {
    datasetText: t('#ask-dataset'),
    versionText: t('#ask-version'),
    hasQuestionBox: document.querySelector('#ask-question') !== null,
    optionCount: document.querySelectorAll('[role="option"]').length,
    options: [...document.querySelectorAll('[role="option"]')].map((el) => ({
      text: (el.textContent || '').trim(),
      state: el.getAttribute('data-state'),
      selected: el.getAttribute('aria-selected'),
    })),
  };
})()`;

/** 取元素（或按谓词找 option）的视口中心坐标。 */
const rectOf = (sel, want) => `(() => {
  const els = [...document.querySelectorAll(${JSON.stringify(sel)})];
  const el = ${want ? `els.find((e) => (e.textContent || '').includes(${JSON.stringify(want)}))` : "els[0]"};
  if (!el) return { ok: false, why: 'not found', count: els.length };
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return { ok: false, why: 'zero rect' };
  return { ok: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
           text: (el.textContent || '').trim().slice(0, 60) };
})()`;

async function main() {
  const fsMod = await import("node:fs");
  const edge = EDGE_CANDIDATES.find((p) => fsMod.existsSync(p));
  if (!edge) throw new Error("找不到 Edge / Chrome");

  const profile = mkdtempSync(join(tmpdir(), "edge-cdp-radix-native-"));
  const child = spawn(
    edge,
    [
      "--headless=new", "--disable-gpu", "--no-proxy-server", "--no-first-run",
      "--no-default-browser-check", "--disable-extensions",
      "--disable-features=Translate,MediaRouter",
      `--user-data-dir=${profile}`, `--remote-debugging-port=${CDP_PORT}`,
      "--window-size=1600,1000", PAGE_URL,
    ],
    { stdio: "ignore", detached: false },
  );
  const killTree = () => {
    try { spawn("taskkill", ["/F", "/T", "/PID", String(child.pid)], { stdio: "ignore" }); } catch { /* ignore */ }
  };

  try {
    let target = null;
    for (let i = 0; i < 60 && !target; i++) {
      await sleep(500);
      try {
        const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
        target = list.find((t) => t.type === "page" && t.url.startsWith("http"));
      } catch { /* 还没起来 */ }
    }
    if (!target?.webSocketDebuggerUrl) throw new Error("CDP 未就绪");

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener("open", res, { once: true });
      ws.addEventListener("error", rej, { once: true });
    });
    let nextId = 1;
    const pending = new Map();
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    });
    const send = (method, params = {}) =>
      new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
    const evaluate = async (expression) => {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.result?.exceptionDetails) throw new Error(`evaluate 异常：${JSON.stringify(r.result.exceptionDetails)}`);
      return r.result?.result?.value;
    };
    await send("Runtime.enable");

    /** 原生鼠标点击：moved → pressed → released，全走真实输入管线。 */
    const nativeClick = async (x, y, label) => {
      const base = { x, y, button: "left", pointerType: "mouse", modifiers: 0, clickCount: 1 };
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none", pointerType: "mouse" });
      await sleep(80);
      await send("Input.dispatchMouseEvent", { type: "mousePressed", ...base, buttons: 1 });
      await sleep(60);
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...base, buttons: 0 });
      log(`    [native] ${label} @ (${x},${y})`);
    };

    let st = null;
    for (let i = 0; i < 90; i++) {
      try {
        st = await evaluate(READY);
        if (st && st.__notReady !== true && st.datasetText && !/加载中|请选择/.test(st.datasetText) && !/加载/.test(st.versionText ?? "")) break;
      } catch { /* 文档未就绪 */ }
      await sleep(1000);
    }
    log(`起始状态：dataset=${JSON.stringify(st?.datasetText)} version=${JSON.stringify(st?.versionText)}`);

    // ---- 步骤 1：原生点击 Trigger 打开下拉 ----
    log("");
    log("=== 步骤 1：Input.dispatchMouseEvent 点 Trigger 打开下拉 ===");
    const trigRect = await evaluate(rectOf("#ask-version", null));
    log(`  trigger rect=${JSON.stringify(trigRect)}`);
    if (!trigRect?.ok) throw new Error("取不到 trigger 坐标");
    await nativeClick(trigRect.x, trigRect.y, "trigger");
    await sleep(800);
    const opened = await evaluate(READY);
    log(`  打开后 optionCount=${opened?.optionCount} options=${JSON.stringify(opened?.options)}`);
    if (!opened?.optionCount) {
      log("  ✗ 下拉没打开 —— 连 Trigger 都驱动不了");
      ws.close();
      log("");
      log("（只读诊断：没有点「开始研究」，不产生任何研究数据。）");
      return;
    }
    log("  ✅ 下拉已打开（Trigger 被原生点击驱动成功）");

    // ---- 步骤 2：原生点击 v2 选项 ----
    log("");
    log("=== 步骤 2：Input.dispatchMouseEvent 点 v2 选项 ===");
    const itemRect = await evaluate(rectOf('[role="option"]', WANT));
    log(`  item rect=${JSON.stringify(itemRect)}`);
    if (!itemRect?.ok) { log("  ✗ 找不到 v2 选项坐标"); }
    else {
      await nativeClick(itemRect.x, itemRect.y, "option(v2)");
      await sleep(1200);
      const after = await evaluate(READY);
      log(`  选后 version=${JSON.stringify(after?.versionText)} dataset=${JSON.stringify(after?.datasetText)}`);
      const ok = typeof after?.versionText === "string" && after.versionText.includes(WANT);
      log(`  ${ok ? "✅ 生效 —— 原生输入管道可以驱动 Radix Select" : "✗ 未生效"}`);
    }

    ws.close();
    log("");
    log("（只读诊断：没有点「开始研究」，不产生任何研究数据。）");
  } finally {
    killTree();
  }
}

main().catch((err) => {
  console.error("探针异常：", err);
  process.exit(2);
});
