/**
 * 「前向纸面交易」策略设置 + 生效参数 前端可达性验收（无头 Chrome + CDP，零依赖）。
 *
 * 为什么必须量 DOM：「接线完成」≠「用户够得到」。历史上多次出现后端字段齐备、
 * 页面却因为没有入口 / 被权限拦住 / 渲染在折叠区里而实际不可达。
 *
 * 断言：
 *   A. 新建运行表单（开发模式下为本地管理员，故 isAdmin = true）：
 *      A1 三组设置容器 [data-paper-settings] 与 exit / position / constraint 三组都存在；
 *      A2 「止损 / 回撤止盈判定时点」下拉有 3 个选项，缺省 = 开盘 + 收盘；
 *      A3 「组合无条件止损（%）」缺省值 = 3（页面与 server/paperTrading.ts 的缺省常量一致）；
 *      A4 数值型设置项共 10 个（退出 6 / 仓位 2 / 成交约束 2）；
 *      A5 成交可行性开关共 5 个，默认全部**未勾选**（= 与改动前行为一致，零回归）；
 *      A6 页面正文含「组合无条件止损」这条纸面专属差异的如实声明（声明与实现一致）；
 *      A7 交互：把判定时点改成「仅收盘」后读回值确实变了；点「恢复默认设置」后回到「开盘+收盘」。
 *   B. 「该运行实际生效的参数」面板 [data-paper-effective-settings]：
 *      B1 点某条运行的「查看」后面板出现；
 *      B2 「组合无条件止损」行存在且值为 3%（旧运行 paramsJson 无该键 ⇒ 缺省回落生效，零写库）；
 *      B3 至少一行标记 data-explicit="false"（即如实标注「默认」而不是假装用户设过）；
 *      B4 行内不含「undefined / NaN」等未解析值。
 *   C. 页面无 Failed to fetch / 加载失败。
 *
 * 只读：**不点「创建」**（那会真的建一条运行）；只读列表 / 详情与本地控件状态。
 * 运行：node docs/evidence/_probe_paper_settings_render.mjs
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];
const CHROME = CHROME_CANDIDATES.find((path) => existsSync(path));
const CDP_PORT = Number(process.env.CDP_PORT ?? 9411);
const PAGE_URL = process.env.PAGE_URL ?? "http://127.0.0.1:4001/paper-trading";
const WAIT_SEC = Number(process.env.WAIT_SEC ?? 90);
const OUT = "docs/evidence/_probe_paper_settings_render.json";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const COLLECT_SETTINGS = `(() => {
  const text = document.body ? document.body.innerText : "";
  const grid = document.querySelector('[data-paper-settings]');
  const group = (name) => document.querySelector('[data-paper-settings-group="' + name + '"]');
  const numberInputs = grid ? [...grid.querySelectorAll('input[type="number"]')].map((el) => {
    const label = el.closest('label');
    return { label: label ? (label.childNodes[0]?.textContent || '').trim() : null, value: el.value };
  }) : [];
  const checkboxes = grid ? [...grid.querySelectorAll('input[type="checkbox"]')].map((el) => {
    const label = el.closest('label');
    return { label: label ? (label.innerText || '').split('\\n')[0].trim() : null, checked: el.checked };
  }) : [];
  const phaseSelect = group('exit') ? group('exit').querySelector('select') : null;
  const portfolioInput = numberInputs.find((row) => (row.label || '').includes('组合无条件止损'));
  return {
    hasGrid: !!grid,
    groups: ['exit', 'position', 'constraint'].filter((name) => !!group(name)),
    numberInputs,
    checkboxes,
    phaseOptions: phaseSelect ? [...phaseSelect.options].map((o) => o.value) : [],
    phaseValue: phaseSelect ? phaseSelect.value : null,
    portfolioStopLossDefault: portfolioInput ? portfolioInput.value : null,
    mentionsPortfolioStopRule: text.includes('组合无条件止损'),
    mentionsPaperOnlyDivergence: text.includes('组合无条件止损') && text.includes('回测'),
    pageErr: /Failed to fetch|加载失败|请求失败/.test(text),
  };
})()`;

const COLLECT_EFFECTIVE = `(() => {
  const panel = document.querySelector('[data-paper-effective-settings]');
  const rows = panel ? [...panel.querySelectorAll('[data-paper-effective-row]')].map((el) => ({
    label: el.getAttribute('data-paper-effective-row'),
    explicit: el.getAttribute('data-explicit') === 'true',
    text: (el.innerText || '').replace(/\\s+/g, ' ').trim(),
  })) : [];
  return {
    hasPanel: !!panel,
    rows,
    rowCount: rows.length,
    undefinedish: rows.filter((row) => /undefined|NaN|\\[object/.test(row.text)).map((row) => row.label),
    runRows: [...document.querySelectorAll('table tbody tr')].length,
  };
})()`;

async function main() {
  if (!CHROME) throw new Error("找不到 Chrome 可执行文件");
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
      "--window-size=1600,1200",
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
    } catch { /* 浏览器还没起来 */ }
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
  const send = (method, params = {}) => new Promise((resolve) => {
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

  const log = { url: PAGE_URL, stages: [] };
  const flush = () => writeFileSync(OUT, JSON.stringify(log, null, 2));

  let settings = null;
  const deadline = Date.now() + WAIT_SEC * 1000;
  while (Date.now() < deadline) {
    await sleep(1000);
    try {
      settings = await evaluate(COLLECT_SETTINGS);
    } catch { settings = null; }
    if (settings?.hasGrid) break;
  }
  log.settings = settings;
  log.stages.push({ stage: "settings-collected", hasGrid: settings?.hasGrid ?? null });
  flush();

  // A7 交互：改判定时点 → 读回；再点「恢复默认设置」→ 回到 both。
  // ⚠️ 受控 <select> 必须走原型上的 native value setter：直接 el.value = x 会被 React 的
  // value tracker 判定为「没变化」，onChange 不触发 ⇒ 探针会假通过（页面其实没动）。
  const setPhase = async (value) => evaluate(`(() => {
    const select = document.querySelector('[data-paper-settings-group="exit"] select');
    if (!select) return null;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(select, ${JSON.stringify(value)});
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return select.value;
  })()`);
  const readPhase = async () => {
    await sleep(300);
    return evaluate(`(() => { const s = document.querySelector('[data-paper-settings-group="exit"] select'); return s ? s.value : null; })()`);
  };
  const setPhaseResult = await setPhase("close");
  const phaseAfterChange = await readPhase();
  const resetClicked = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === '恢复默认设置');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  const phaseAfterReset = await readPhase();
  log.interaction = { setPhaseResult, phaseAfterChange, resetClicked, phaseAfterReset };
  flush();

  // B：点第一条运行的「查看」。
  const clicked = await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === '查看');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  let effective = null;
  if (clicked) {
    const effDeadline = Date.now() + 30_000;
    while (Date.now() < effDeadline) {
      await sleep(800);
      try { effective = await evaluate(COLLECT_EFFECTIVE); } catch { effective = null; }
      if (effective?.hasPanel) break;
    }
  }
  log.viewClicked = clicked;
  log.effective = effective;
  flush();

  const failures = [];
  const assert = (ok, label) => {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
    if (!ok) failures.push(label);
  };

  console.log("=== A. 新建运行表单的策略设置 ===");
  assert(settings?.hasGrid === true, "A1 设置容器 [data-paper-settings] 渲染");
  assert(
    Array.isArray(settings?.groups) && settings.groups.length === 3,
    `A1 三组设置齐备（实际：${JSON.stringify(settings?.groups)}）`,
  );
  assert(
    Array.isArray(settings?.phaseOptions) && settings.phaseOptions.join(",") === "both,open,close",
    `A2 判定时点下拉 3 个选项（实际：${JSON.stringify(settings?.phaseOptions)}）`,
  );
  assert(settings?.phaseValue === "both", `A2 判定时点缺省 = 开盘+收盘（实际：${settings?.phaseValue}）`);
  assert(settings?.portfolioStopLossDefault === "3", `A3 组合无条件止损缺省 = 3（实际：${settings?.portfolioStopLossDefault}）`);
  assert(
    Array.isArray(settings?.numberInputs) && settings.numberInputs.length === 10,
    `A4 数值型设置项 10 个（实际：${settings?.numberInputs?.length}）`,
  );
  assert(
    Array.isArray(settings?.checkboxes) && settings.checkboxes.length === 5,
    `A5 成交可行性开关 5 个（实际：${settings?.checkboxes?.length}）`,
  );
  assert(
    Array.isArray(settings?.checkboxes) && settings.checkboxes.every((box) => box.checked === false),
    "A5 开关默认全关（与改动前行为一致）",
  );
  assert(settings?.mentionsPaperOnlyDivergence === true, "A6 页面如实声明「组合无条件止损」为纸面差异");
  assert(
    log.interaction.phaseAfterChange === "close",
    `A7 判定时点可交互（改后=${log.interaction.phaseAfterChange}）`,
  );
  assert(
    log.interaction.resetClicked === true && log.interaction.phaseAfterReset === "both",
    `A7 「恢复默认设置」把判定时点还原为 both（实际：${log.interaction.phaseAfterReset}）`,
  );

  console.log("=== B. 该运行实际生效的参数 ===");
  if (!clicked) {
    assert(false, "B 运行列表里找不到「查看」按钮");
  } else {
    assert(effective?.hasPanel === true, "B1 生效参数面板 [data-paper-effective-settings] 渲染");
    const portfolioRow = (effective?.rows ?? []).find((row) => row.label === "组合无条件止损");
    assert(portfolioRow !== undefined, "B2 含「组合无条件止损」行");
    assert(
      (portfolioRow?.text ?? "").includes("3%"),
      `B2 组合无条件止损实际生效 = 3%（旧运行缺键 ⇒ 缺省回落，零写库；实际：${portfolioRow?.text ?? "(无此行)"}）`,
    );
    const phaseRow = (effective?.rows ?? []).find((row) => row.label === "止损 / 回撤止盈判定时点");
    assert(
      (phaseRow?.text ?? "").includes("开盘 + 收盘"),
      `B2 判定时点实际生效 = 开盘+收盘（实际：${phaseRow?.text ?? "(无此行)"}）`,
    );
    assert(
      (effective?.rows ?? []).some((row) => row.explicit === false),
      "B3 至少一行如实标注为「默认」（未假装用户设过）",
    );
    assert(
      (effective?.undefinedish ?? []).length === 0,
      `B4 生效参数行无 undefined / NaN（实际：${JSON.stringify(effective?.undefinedish)}）`,
    );
  }

  console.log("=== C. 页面健康 ===");
  assert(settings?.pageErr === false, "C 页面无 Failed to fetch / 加载失败");

  ws.close();
  try { child.kill(); } catch { /* ignore */ }
  console.log(`\n${failures.length === 0 ? "ALL PASS" : `FAILURES(${failures.length}): ${failures.join(" | ")}`}`);
  console.log(`证据：${OUT}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("探针异常：", err);
  process.exit(2);
});
