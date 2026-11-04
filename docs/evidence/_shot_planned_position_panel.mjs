/**
 * 截图取证：组合回测 → 交易明细 → 「当前持仓与下一交易日准备买入」整块（含新增的计划仓位胶囊）。
 * 无头 Chrome + CDP，只读；输出 PNG 到 docs/evidence/。
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const CDP_PORT = Number(process.env.CDP_PORT ?? 9385);
const PAGE_URL = process.env.PAGE_URL ?? "http://127.0.0.1:3000/backtest";
const OUT = process.env.OUT ?? "docs/evidence/_evidence_planned_position_panel.png";
const WAIT_SEC = Number(process.env.WAIT_SEC ?? 900);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
      "--hide-scrollbars",
      "--disable-features=Translate,MediaRouter",
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${CDP_PORT}`,
      "--window-size=1920,1400",
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
  if (!target?.webSocketDebuggerUrl) throw new Error("CDP 未就绪");

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
    return res.result?.result?.value;
  };

  await send("Runtime.enable");
  await send("Page.enable");

  for (let i = 0; i < 120; i++) {
    const ok = await evaluate(`(() => {
      const b = [...document.querySelectorAll('[role="tab"]')].find((x) => (x.innerText || '').trim() === '交易明细');
      if (!b) return false; b.click(); return true;
    })()`);
    if (ok) break;
    await sleep(1000);
  }

  const deadline = Date.now() + WAIT_SEC * 1000;
  let rect = null;
  while (Date.now() < deadline) {
    await sleep(3000);
    rect = await evaluate(`(() => {
      // 就绪判据：快照面板 + 「准备买入」合计行（比例现已在表格列与合计行内，不再有胶囊容器）
      const el = document.querySelector('[data-strategy-portfolio-snapshot] tfoot');
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const host = document.querySelector('[data-strategy-portfolio-snapshot]');
      const r = host.getBoundingClientRect();
      return { x: Math.max(0, r.x), y: Math.max(0, r.y + window.scrollY), width: r.width, height: r.height };
    })()`);
    if (rect && rect.width > 100) break;
  }
  if (!rect) throw new Error(`等待 ${WAIT_SEC}s 仍未渲染计划仓位区块`);

  await sleep(800);
  const shot = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 2 },
  });
  const data = shot.result?.data;
  if (!data) throw new Error("截图失败");
  writeFileSync(OUT, Buffer.from(data, "base64"));
  console.log(`已保存 ${OUT}  (${rect.width}×${rect.height} @2x)`);

  ws.close();
  try { child.kill(); } catch { /* ignore */ }
  process.exit(0);
}

main().catch((err) => {
  console.error("截图异常：", err.message);
  process.exit(2);
});
