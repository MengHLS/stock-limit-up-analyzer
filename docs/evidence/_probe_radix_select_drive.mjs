/**
 * `_probe_radix_select_drive.mjs` —— 实测「怎么驱动 Radix Select」才真的生效（只读，不点提交）。
 *
 * 背景：`_e2e_candidate_button_real_ui.mjs` 需要把 Dataset 版本切到 `v2` 才能复刻用户的场景。
 * 两次尝试都失败：
 *   · 第一版按隐藏原生 `<select>` 驱动 ⇒ 报「找不到原生 select」。**读源码后确认**：
 *     `@radix-ui/react-select@2.2` 只在 `isFormControl`（传了 `name`）时才渲染
 *     `SelectBubbleInput`（那个隐藏原生 select），本页两个下拉都没传 `name` ⇒ DOM 里真没有。
 *   · 第二版按 `pointerdown` + `pointerup`（`pointerType: "mouse"`）驱动 ⇒
 *     选项**找得到**（`picked` 正确返回 v2）、但触发器文案**没变**。
 *
 * 本探针把四种候选驱动方式逐个跑一遍，**用「触发器文案是否变化」当判据**，
 * 把「哪种真的生效」变成实测结论，而不是继续猜。
 *
 * 用法：node docs/evidence/_probe_radix_select_drive.mjs
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
const OUT_PATH = "docs/evidence/_probe_radix_select_drive.out.txt";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lines = [];
writeFileSync(OUT_PATH, "", "utf8");
const log = (s = "") => {
  lines.push(s);
  console.log(s);
  appendFileSync(OUT_PATH, `${s}\n`, "utf8");
};

const READY = `(() => {
  if (!document.body) return { __notReady: true };
  const t = (id) => { const e = document.querySelector(id); return e ? (e.textContent || '').trim() : null; };
  const ds = t('#ask-dataset');
  return {
    datasetText: ds,
    versionText: t('#ask-version'),
    hasQuestionBox: document.querySelector('#ask-question') !== null,
    options: [...document.querySelectorAll('[role="option"]')].map((el) => ({
      text: (el.textContent || '').trim(),
      state: el.getAttribute('data-state'),
      selected: el.getAttribute('aria-selected'),
    })),
  };
})()`;

/** 打开下拉：Trigger 的 onPointerDown 在 `pointerType === "mouse"` 时 handleOpen。 */
const OPEN = `(() => {
  const trig = document.querySelector('#ask-version');
  if (!trig) return { ok: false, why: 'no trigger' };
  trig.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true, cancelable: true, composed: true,
    button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse', isPrimary: true,
  }));
  return { ok: true };
})()`;

/** 关掉已展开的下拉（按 Escape，或点 body）。 */
const CLOSE = `(() => {
  const el = document.activeElement ?? document.body;
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
  document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse', pointerId: 9, isPrimary: true }));
  return { ok: true };
})()`;

/** 四种驱动方式（都作用在含 `role="option"` 的那个节点上）。 */
const strategies = {
  "A. pointerdown+pointerup(mouse)": `(() => {
    const item = [...document.querySelectorAll('[role="option"]')].find((el) => (el.textContent || '').includes(${JSON.stringify(WANT)}));
    if (!item) return { ok: false, why: 'no item' };
    const fire = (t, buttons) => item.dispatchEvent(new PointerEvent(t, {
      bubbles: true, cancelable: true, composed: true,
      button: 0, buttons, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    fire('pointerdown', 1); fire('pointerup', 0);
    return { ok: true };
  })`,
  "B. pointermove+down+up(mouse)": `(() => {
    const item = [...document.querySelectorAll('[role="option"]')].find((el) => (el.textContent || '').includes(${JSON.stringify(WANT)}));
    if (!item) return { ok: false, why: 'no item' };
    const fire = (t, buttons) => item.dispatchEvent(new PointerEvent(t, {
      bubbles: true, cancelable: true, composed: true,
      button: 0, buttons, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    fire('pointermove', 0); fire('pointerdown', 1); fire('pointerup', 0);
    return { ok: true };
  })`,
  "C. HTMLElement.click()": `(() => {
    const item = [...document.querySelectorAll('[role="option"]')].find((el) => (el.textContent || '').includes(${JSON.stringify(WANT)}));
    if (!item) return { ok: false, why: 'no item' };
    item.click();
    return { ok: true };
  })`,
  "D. focus item + Enter keydown": `(() => {
    const item = [...document.querySelectorAll('[role="option"]')].find((el) => (el.textContent || '').includes(${JSON.stringify(WANT)}));
    if (!item) return { ok: false, why: 'no item' };
    item.focus();
    const target = document.activeElement ?? item;
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    target.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    return { ok: true, focusIs: (document.activeElement || {}).outerHTML ? document.activeElement.tagName : null };
  })`,
  "E. focus item + pointerdown/up(pointerId=0)": `(() => {
    const item = [...document.querySelectorAll('[role="option"]')].find((el) => (el.textContent || '').includes(${JSON.stringify(WANT)}));
    if (!item) return { ok: false, why: 'no item' };
    const fire = (t, buttons) => item.dispatchEvent(new PointerEvent(t, {
      bubbles: true, cancelable: true, composed: true,
      button: 0, buttons, pointerType: 'mouse', isPrimary: true }));
    fire('pointerdown', 1); fire('pointerup', 0);
    return { ok: true };
  })`,
};

async function main() {
  const fsMod = await import("node:fs");
  const edge = EDGE_CANDIDATES.find((p) => fsMod.existsSync(p));
  if (!edge) throw new Error("找不到 Edge / Chrome");

  const profile = mkdtempSync(join(tmpdir(), "edge-cdp-radix-"));
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
    try {
      spawn("taskkill", ["/F", "/T", "/PID", String(child.pid)], { stdio: "ignore" });
    } catch { /* ignore */ }
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
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)(m);
        pending.delete(m.id);
      }
    });
    const send = (method, params = {}) =>
      new Promise((resolve) => {
        const id = nextId++;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
      });
    const evaluate = async (expression) => {
      const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.result?.exceptionDetails) throw new Error(`evaluate 异常：${JSON.stringify(r.result.exceptionDetails)}`);
      return r.result?.result?.value;
    };
    await send("Runtime.enable");

    // 等数据集/版本就绪
    let st = null;
    for (let i = 0; i < 90; i++) {
      try {
        st = await evaluate(READY);
        if (st && st.__notReady !== true && st.datasetText && !/加载中|请选择/.test(st.datasetText) && !/加载/.test(st.versionText ?? "")) break;
      } catch { /* 文档未就绪 */ }
      await sleep(1000);
    }
    log(`起始状态：dataset=${JSON.stringify(st.datasetText)} version=${JSON.stringify(st.versionText)}`);
    log(`（v2 必须可选：说明下拉本身没问题，问题只在「怎么点」）`);

    for (const [name, expr] of Object.entries(strategies)) {
      log("");
      log(`=== ${name} ===`);
      const opened = await evaluate(OPEN);
      await sleep(600);
      const before = await evaluate(READY);
      log(`  打开后 options=${JSON.stringify(before.options)}`);
      if ((before.options ?? []).length === 0) {
        log("  ✗ 下拉没打开，跳过该策略");
        await evaluate(CLOSE);
        await sleep(500);
        continue;
      }
      const fired = await evaluate(expr);
      await sleep(1200);
      const after = await evaluate(READY);
      const changed = typeof after.versionText === "string" && after.versionText.includes(WANT);
      log(`  fired=${JSON.stringify(fired)}`);
      log(`  选后 version=${JSON.stringify(after.versionText)}`);
      log(`  ${changed ? "✅ 生效" : "✗ 未生效"}`);
      if (changed) break;
      await evaluate(CLOSE);
      await sleep(700);
      const reset = await evaluate(READY);
      log(`  （复位后 version=${JSON.stringify(reset.versionText)}）`);
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
