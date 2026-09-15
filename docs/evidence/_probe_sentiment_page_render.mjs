/**
 * 情绪分析页真机渲染验收（无头 Edge + CDP，零依赖）。
 * 断言三件事：
 *   1) 「每日最高连板明细」整块已不存在；
 *   2) 龙头列表默认折叠，卡片数 <= 6，并出现「展开其余 N 只」按钮；
 *   3) 点按钮后卡片数 == 总数（展开生效）。
 * 只读、零写入。
 */
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const CDP_PORT = 9333;
const PAGE_URL = process.env.PAGE_URL ?? "http://127.0.0.1:3000/sentiment-analysis";
const PREVIEW = 6;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const EXPR = `(() => {
  const txt = document.body.innerText;
  const btns = [...document.querySelectorAll('button')];
  const label = (b) => (b.innerText || '').replace(/\\s+/g, ' ').trim();
  const expandBtn = btns.find((b) => label(b).startsWith('展开其余'));
  const collapseBtn = btns.find((b) => label(b).startsWith('收起（共'));
  const cards = [...document.querySelectorAll('article')];
  return {
    articles: cards.length,
    names: cards.map((c) => (c.querySelector('p')?.innerText || '').trim()),
    expandLabel: expandBtn ? label(expandBtn) : null,
    collapseLabel: collapseBtn ? label(collapseBtn) : null,
    hasDetailBlock: txt.includes('每日最高连板明细'),
    hasLeaderListTitle: txt.includes('龙头列表'),
    emptyLeader: txt.includes('当前样本尚未出现已确认的主板龙头'),
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
  for (let i = 0; i < 90; i++) {
    stats = await evaluate(EXPR);
    if (stats.articles > 0 || stats.emptyLeader) break;
    await sleep(1000);
  }

  const total = stats.expandLabel ? Number((stats.expandLabel.match(/共\s*(\d+)\s*只/) ?? [])[1]) : stats.articles;
  const failures = [];
  const assert = (ok, label) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
    if (!ok) failures.push(label);
  };

  console.log("--- 折叠态 ---");
  console.log(JSON.stringify(stats, null, 2));

  assert(stats.hasLeaderListTitle === true, "龙头列表卡片存在");
  assert(stats.hasDetailBlock === false, "「每日最高连板明细」整块已删除");
  assert(stats.articles <= PREVIEW, `默认折叠：渲染卡片数 ${stats.articles} <= ${PREVIEW}`);
  assert(total !== null && !Number.isNaN(total), `能读到总数（${stats.expandLabel ?? "无按钮"}）`);
  if (total > PREVIEW) {
    assert(stats.expandLabel !== null, "总数 > 6 时出现「展开其余 N 只」按钮");
    assert(stats.collapseLabel === null, "折叠态下不出现「收起」按钮");
  }

  // 展开
  if (stats.expandLabel) {
    await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => (x.innerText||'').replace(/\\s+/g,' ').trim().startsWith('展开其余'));
      if (b) b.click();
      return true;
    })()`);
    await sleep(600);
    const expanded = await evaluate(EXPR);
    console.log("--- 展开态 ---");
    console.log(JSON.stringify(expanded, null, 2));
    assert(expanded.articles === total, `展开后卡片数 ${expanded.articles} == 总数 ${total}`);
    assert(expanded.collapseLabel !== null, "展开态出现「收起」按钮");

    // 收起还原
    await evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => (x.innerText||'').replace(/\\s+/g,' ').trim().startsWith('收起（共'));
      if (b) b.click();
      return true;
    })()`);
    await sleep(600);
    const collapsed = await evaluate(EXPR);
    assert(collapsed.articles <= PREVIEW, `收起还原：卡片数 ${collapsed.articles} <= ${PREVIEW}`);
  }

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
