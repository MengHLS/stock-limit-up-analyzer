/**
 * RESEARCH-PLANNER-001 — 「提问式研究」默认模式的**真机渲染验收**（无头 Edge + CDP，零依赖，只读）。
 *
 * 验的是任务书 §17 / §27 / §29 的前端判据，全部用 DOM 量出来（比截图硬）：
 *
 *   1) 页面真的渲染（页头 + 三步提示），不是白屏 / Failed to fetch；
 *   2) 默认模式**只有** Dataset 选择 + 研究问题输入 + [开始研究]；
 *   3) 🔴 §27 核心判据：默认模式页面上**不存在**任何要求用户填底层分析字段的
 *      **控件**（特征变量 / 目标变量 / 视界 / 分组维度 / 条件 / 分析类型）。出现即验收失败；
 *   4) 研究问题为空时点「开始研究」不会发出请求（前端校验拦住），并列出原因；
 *   5) 点示例问题会把问题填进输入框（示例是真的可用的，不是装饰）；
 *   6) 「高级 / 专家模式」入口存在且指向 `/research`（§17 两种模式并存）；
 *   7) 🔴 侧栏高亮 = 分段精确匹配 + 全局取最长命中：「提问研究」亮、「研究实验」不亮。
 *
 * 用法：node docs/evidence/_probe_research_ask_page_render.mjs [pageUrl]
 *       （默认 http://127.0.0.1:3000/research/ask）
 *
 * ---------------------------------------------------------------------------
 * 🔴 2026-09-17 判据修正记录（第一版跑出 3 个 FAIL，**全部是判据缺陷，产品行为正确**）：
 *
 *   a) 禁用词判据第一版直接扫 `document.body.innerText`。实测命中的禁用词**全部来自说明性文案**，
 *      没有一处来自控件，例如：
 *        · `ResearchAsk.tsx:361`「用交易语言描述假设即可 —— **不要**填写特征名、目标变量、视界、分组维度…」
 *        · `ResearchAsk.tsx:260`「研究方法、特征 / 目标 / 视界 / 分组 / 稳定性复核**全部由系统设计**…」
 *        · 示例 #3 的 hint「自动铺开多**视界**并做跨切片稳定性复核」
 *      这些句子恰恰是在**告诉用户不用填、系统会决定**——是产品卖点本身，不是缺陷。
 *      判据因此拆成两层：
 *        ① **主判据（硬）**：控件扫描 —— `input / textarea / select / [role=combobox]`（排除 Radix Select
 *           为表单兼容渲染的 `aria-hidden` bubble `<select>`）的 label / placeholder / aria-label 里
 *           不得出现任何禁用词，且控件总数 ≤ 4；
 *        ② **兜底判据（软）**：可见文本扫描，但排除「说明句」——含「不要/无需/不需要/不用/由系统/
 *           系统根据/自动」且**不含**任何祈使式输入指令（请输入/请填写/请选择/…）。加 IMPERATIVE 这层，
 *           排除集就吞不掉「请填写视界（会自动生成默认值）」这类真违规。被排除的句子原样打印进证据，
 *           未被排除的命中行也单独列出，避免「排除了什么」变成黑箱。
 *      同批排除的还有一个错误认知：第一版注释假设「PREVIEW / OUTCOME 卡片在 ASK 步仍挂载」。
 *      实测四张卡片全部是 `{step === "XX" && (...)}` 条件渲染（`ResearchAsk.tsx:279 / 426 / 439 / 477`）
 *      ⇒ ASK 步 DOM 里根本没有这些卡片，禁用词不可能从它们漏进来。
 *
 *   b) 示例计数第一版按 `→ 会识别成` 计数。但 `researchAskForm.ts:132-145` 的三条示例 hint
 *      **只有第 1、3 条**用「→ 会识别成…」开头，第 2 条是「→ 同上，并会把…」⇒ 恒得 2，判据与实现不一致。
 *      改为**按示例区块结构取数**（找到含「点一句示例」的 `<p>`，取其父容器下的全部 `button`），
 *      并用三条示例的**标志性文本**分别断言，避免再依赖 hint 前缀这种易碎约定。
 *
 *   c) `reachedPreview` 第一版用 `txt.includes('② 研究计划预览')`。但步骤条由
 *      `ResearchAsk.tsx:270-274` 遍历 `RESEARCH_ASK_STEP_LABELS` **恒渲染全部四个标签**
 *      ⇒ 该判据恒为 true，永远测不出「有没有进预览」。改为用**预览卡片独有内容**判定
 *      （「预计分析数」，见 `ResearchAsk.tsx:533`），并用 ASK 卡独有控件（`#ask-question`）判定是否仍在第一步。
 * ---------------------------------------------------------------------------
 */
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];
const CDP_PORT = 9500 + Math.floor(Math.random() * 400);
const PAGE_URL = process.argv[2] ?? process.env.PAGE_URL ?? "http://127.0.0.1:3000/research/ask";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 底层分析字段的「禁用词」：默认模式页面上出现任何一个即视为验收失败。 */
const FORBIDDEN_LABELS = [
  "特征变量",
  "目标变量",
  "结果变量",
  "视界",
  "分组维度",
  "稳定性维度",
  "分段窗口",
  "分析类型",
  "条件组",
  "最小样本数",
  "分位组数",
];

/** 示例问题的标志性文本（与 `researchAskForm.ts#RESEARCH_ASK_EXAMPLES` 逐条对齐）。 */
const EXAMPLE_MARKERS = ["不跌破首板开盘价", "回踩深度", "持有期"];

/** 预览卡片独有内容（`ResearchAsk.tsx:533`）—— 用它判定「是否已进入第二步」。 */
const PREVIEW_SENTINEL = "预计分析数";

const EXPR = `(() => {
  const txt = document.body.innerText;
  const labels = [...document.querySelectorAll('label')].map((l) => l.textContent || '');
  const buttons = [...document.querySelectorAll('button, a')].map((b) => (b.textContent || '').trim());
  const textareas = [...document.querySelectorAll('textarea')];
  const comboboxes = [...document.querySelectorAll('[role="combobox"], button[role="combobox"]')];
  const navButtons = [...document.querySelectorAll('[data-sidebar="menu-button"]')];
  const navState = navButtons.map((b) => ({
    label: (b.textContent || '').trim(),
    active: b.getAttribute('data-active') === 'true',
    orangeIcon: b.querySelector('svg')?.getAttribute('class')?.includes('text-orange-600') === true,
  }));

  // ---- ① §27 主判据：控件扫描 ----
  // 排除 Radix Select 为表单兼容渲染的 bubble <select>（aria-hidden=true，用户看不见也碰不到），
  // 否则控件计数会被虚增 2 个，让「控件总数」这条判据失去意义。
  const controls = [...document.querySelectorAll('input:not([type="hidden"]):not([aria-hidden="true"]), textarea, select:not([aria-hidden="true"]), [role="combobox"]:not([aria-hidden="true"])')];
  const controlTexts = controls.map((el) => {
    const id = el.getAttribute('id') || '';
    const labelFor = id ? (document.querySelector('label[for="' + id + '"]')?.textContent || '') : '';
    const wrapped = el.closest('label')?.textContent || '';
    const parts = [labelFor, wrapped, el.getAttribute('placeholder') || '', el.getAttribute('aria-label') || ''];
    return {
      tag: el.tagName.toLowerCase(),
      id: id || null,
      type: el.getAttribute('type') || null,
      probe: parts.filter((p) => p.length > 0).join(' / '),
    };
  });
  const forbiddenInControls = ${JSON.stringify(FORBIDDEN_LABELS)}.filter((w) => controlTexts.some((c) => c.probe.includes(w)));

  // ---- ② §27 兜底判据：可见文本，但排除「这是系统自动决定的」说明句 ----
  // 说明句 = 含「不要/无需/…」（否定式引导）或「由系统/系统根据/自动」（告知职责归属），
  // 且**不含**任何祈使式输入指令（请输入/请填写/…）。加了 IMPERATIVE 这一层，
  // 排除集就不会把「请填写视界（会自动生成默认值）」这类真违规一起吞掉。
  const EXPLANATORY = ['不要', '无需', '不需要', '不用', '由系统', '系统根据', '自动'];
  const IMPERATIVE = ['请输入', '请填写', '请选择', '请设置', '请录入', '填入', '填写在'];
  const lines = txt.split('\\n').map((l) => l.trim()).filter((l) => l.length > 0);
  const isExplanatory = (l) => EXPLANATORY.some((w) => l.includes(w)) && !IMPERATIVE.some((w) => l.includes(w));
  const guidanceLines = lines.filter(isExplanatory);
  const plainLines = lines.filter((l) => !isExplanatory(l));
  const forbiddenTextHits = [];
  for (const w of ${JSON.stringify(FORBIDDEN_LABELS)}) {
    for (const l of plainLines) {
      if (l.includes(w)) forbiddenTextHits.push({ word: w, line: l });
    }
  }
  const forbiddenInText = [...new Set(forbiddenTextHits.map((h) => h.word))];

  // ---- ③ 示例问题：按**区块结构**取数，不依赖 hint 前缀 ----
  const exPara = [...document.querySelectorAll('p')].find((p) => (p.textContent || '').includes('点一句示例'));
  const exRoot = exPara ? exPara.parentElement : null;
  const exButtons = exRoot ? [...exRoot.querySelectorAll('button')] : [];
  const exampleTexts = exButtons.map((b) => (b.textContent || '').replace(/\\s+/g, ' ').trim());

  return {
    bodyLen: txt.length,
    hasHeader: txt.includes('提出研究问题'),
    hasStep1: txt.includes('① 提出问题'),
    hasDatasetLabel: labels.some((l) => l.includes('数据集')),
    hasVersionLabel: labels.some((l) => l.includes('Dataset 版本')),
    hasQuestionLabel: labels.some((l) => l.includes('研究问题')),
    textareaCount: textareas.length,
    comboCount: comboboxes.length,
    hasStartButton: buttons.some((b) => b.includes('开始研究')),
    hasExpertLink: buttons.some((b) => b.includes('高级 / 专家模式')),
    controlCount: controlTexts.length,
    controlTexts,
    forbiddenInControls,
    forbiddenInText,
    forbiddenTextHits,
    guidanceLines,
    questionVisible: document.querySelector('#ask-question') !== null,
    previewSentinelVisible: txt.includes(${JSON.stringify(PREVIEW_SENTINEL)}),
    exampleCount: exButtons.length,
    exampleTexts,
    exHintLineCount: exButtons.filter((b) => b.querySelectorAll('span').length >= 2).length,
    navState,
    hasFetchError: /Failed to fetch|Unexpected Application Error|白屏|Cannot read properties/i.test(txt),
  };
})()`;

/** 点第一个示例问题后，读回 textarea 的值。 */
const CLICK_EXAMPLE = `(() => {
  const exPara = [...document.querySelectorAll('p')].find((p) => (p.textContent || '').includes('点一句示例'));
  const exRoot = exPara ? exPara.parentElement : null;
  const ex = exRoot ? exRoot.querySelector('button') : null;
  if (!ex) return { clicked: false };
  ex.click();
  return { clicked: true };
})()`;

const READ_QUESTION = `(() => {
  const t = document.querySelector('textarea');
  return { value: t ? t.value : null };
})()`;

/** 空问题点「开始研究」：应被前端校验拦住（出现原因列表、且不出现提交错误）。 */
const SUBMIT_EMPTY = `(() => {
  const btns = [...document.querySelectorAll('button')];
  const go = btns.find((b) => (b.textContent || '').trim() === '开始研究');
  if (!go) return { clicked: false };
  go.click();
  return { clicked: true };
})()`;

const READ_VALIDATION = `(() => {
  const txt = document.body.innerText;
  const li = [...document.querySelectorAll('li')].map((x) => (x.textContent || '').trim()).filter((x) => x.startsWith('· '));
  return {
    reasons: li,
    stillOnAskStep: document.querySelector('#ask-question') !== null,
    reachedPreview: txt.includes(${JSON.stringify(PREVIEW_SENTINEL)}),
  };
})()`;

async function main() {
  const fsMod = await import("node:fs");
  const edge = EDGE_CANDIDATES.find((p) => fsMod.existsSync(p));
  if (!edge) throw new Error("找不到 Edge / Chrome 可执行文件");

  const profile = mkdtempSync(join(tmpdir(), "edge-cdp-research-ask-"));
  const child = spawn(
    edge,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-proxy-server",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-features=Translate,MediaRouter",
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${CDP_PORT}`,
      "--window-size=1600,1000",
      PAGE_URL,
    ],
    { stdio: "ignore", detached: false },
  );

  const killTree = () => {
    try {
      spawn("taskkill", ["/F", "/T", "/PID", String(child.pid)], { stdio: "ignore" });
    } catch {
      /* ignore */
    }
  };

  const lines = [];
  const log = (s = "") => {
    lines.push(s);
    console.log(s);
  };

  try {
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

    // 等首屏渲染（侧栏 + 表单）
    let stats = null;
    for (let i = 0; i < 60; i++) {
      stats = await evaluate(EXPR);
      if (stats.hasHeader && stats.hasStartButton) break;
      await sleep(1000);
    }

    log("--- 渲染态 ---");
    log(JSON.stringify(stats, null, 2));

    const failures = [];
    const assert = (ok, label) => {
      log(`${ok ? "PASS" : "FAIL"}  ${label}`);
      if (!ok) failures.push(label);
    };

    log("");
    log("--- 断言 ---");
    assert(stats.hasFetchError === false, "无 Failed to fetch / 白屏 / 运行时报错");
    assert(stats.hasHeader === true, "页头「提出研究问题…」已渲染");
    assert(stats.hasStep1 === true, "步骤条「① 提出问题」已渲染");
    assert(stats.hasDatasetLabel === true, "存在「数据集」选择");
    assert(stats.hasVersionLabel === true, "存在「Dataset 版本」选择");
    assert(stats.hasQuestionLabel === true, "存在「研究问题」输入");
    assert(stats.textareaCount >= 1, `研究问题用 textarea 承载（实得 ${stats.textareaCount} 个）`);
    assert(stats.comboCount >= 2, `数据集 / 版本两个下拉就位（实得 ${stats.comboCount} 个 combobox）`);
    assert(stats.hasStartButton === true, "存在 [开始研究] 按钮");

    // 🔴 §27 主判据：控件级扫描
    assert(
      stats.controlCount <= 4,
      `§27 默认模式控件总数 ≤ 4（数据集 / 版本 / 研究问题 / 折叠区规模上限，实得 ${stats.controlCount} 个）`,
    );
    assert(
      stats.forbiddenInControls.length === 0,
      `§27 默认模式无任何底层分析字段**控件**（命中：${stats.forbiddenInControls.join(" / ") || "无"}）`,
    );
    assert(
      stats.forbiddenInText.length === 0,
      `§27 可见文案（排除「系统自动决定」说明句后）无底层分析字段（命中：${stats.forbiddenInText.join(" / ") || "无"}）`,
    );
    if (stats.forbiddenTextHits.length > 0) {
      log("      · 未被说明句覆盖的命中行（真违规时就是这里）：");
      for (const h of stats.forbiddenTextHits) log(`        - 「${h.word}」 ← ${h.line}`);
    }
    log(`      · 被排除的说明句 ${stats.guidanceLines.length} 条（含禁用词但属「系统自动决定」的告知文案）：`);
    for (const g of stats.guidanceLines) log(`        - ${g}`);
    log(`      · ASK 步控件清单（${stats.controlTexts.length} 个）：`);
    for (const c of stats.controlTexts) log(`        - <${c.tag}${c.id ? " #" + c.id : ""}> ${c.probe || "（无标签 / 占位符）"}`);

    assert(stats.hasExpertLink === true, "§17 「高级 / 专家模式」入口存在（两种模式并存）");

    // 示例问题：按区块结构 + 三条标志性文本分别断言
    assert(stats.exampleCount === 3, `示例问题共 3 条（实得 ${stats.exampleCount} 条）`);
    assert(stats.exHintLineCount === 3, `每条示例都带一句识别说明（实得 ${stats.exHintLineCount} 条）`);
    for (let i = 0; i < EXAMPLE_MARKERS.length; i++) {
      const marker = EXAMPLE_MARKERS[i];
      const hit = stats.exampleTexts.some((t) => t.includes(marker));
      assert(hit, `示例 #${i + 1} 覆盖标志性文本「${marker}」`);
    }

    const askItem = stats.navState.find((n) => n.label === "提问研究");
    const expItem = stats.navState.find((n) => n.label === "研究实验");
    assert(askItem?.active === true, `侧栏「提问研究」为高亮项（实得 active=${askItem?.active}）`);
    assert(askItem?.orangeIcon === true, "侧栏「提问研究」图标着色（text-orange-600）");
    assert(expItem?.active === false, `侧栏「研究实验」未高亮（更长命中优先，实得 active=${expItem?.active}）`);

    // ---- 交互 ①②：点示例 → 填进输入框 ----
    log("");
    log("--- 交互：点示例问题 ---");
    const clicked = await evaluate(CLICK_EXAMPLE);
    await sleep(400);
    const afterClick = await evaluate(READ_QUESTION);
    log(JSON.stringify({ clicked, value: afterClick.value }, null, 2));
    assert(clicked.clicked === true, "示例问题按钮可点击");
    assert(
      typeof afterClick.value === "string" && afterClick.value.includes("回踩"),
      `点示例后研究问题已被填入（实得：${JSON.stringify(afterClick.value)?.slice(0, 60)}）`,
    );

    // ---- 交互 ③：清空后提交 → 前端校验拦住 ----
    log("");
    log("--- 交互：清空问题后点开始研究（应被前端拦住）---");
    await evaluate(`(() => { const t = document.querySelector('textarea'); if (!t) return null;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(t, '');
      t.dispatchEvent(new Event('input', { bubbles: true }));
      return t.value; })()`);
    await sleep(300);
    await evaluate(SUBMIT_EMPTY);
    await sleep(700);
    const validation = await evaluate(READ_VALIDATION);
    log(JSON.stringify(validation, null, 2));
    assert(validation.reasons.length >= 1, `校验失败时列出原因（实得 ${validation.reasons.length} 条）`);
    assert(
      validation.stillOnAskStep === true,
      "校验未通过时仍停在「① 提出问题」（判据 = ASK 卡独有控件 #ask-question 仍在）",
    );
    assert(
      validation.reachedPreview === false,
      `校验未通过时不进入「② 研究计划预览」（判据 = 预览独有内容「${PREVIEW_SENTINEL}」未出现）`,
    );

    ws.close();
    log("");
    log(failures.length === 0 ? "ALL PASS" : `FAILURES(${failures.length}): ${failures.join(" | ")}`);
    writeFileSync("docs/evidence/_probe_research_ask_page_render.out.txt", lines.join("\n"), "utf8");
    process.exitCode = failures.length === 0 ? 0 : 1;
  } finally {
    killTree();
  }
}

main().catch((err) => {
  console.error("探针异常：", err);
  process.exit(2);
});
