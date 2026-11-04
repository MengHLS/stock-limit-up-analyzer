/**
 * 缺陷 780001 —— 「创建候选」按钮的**真机全流程验收**（无头 Edge + CDP，零依赖）。
 *
 * 用户报告原文：
 *   「创建候选失败 分析 780001 没有任何条件，无法导出候选题筛选条件。」
 *
 * 本探针**不复用** tRPC 直调，也不注水状态 —— 它把用户在浏览器里真正做的那串动作
 * 从头走一遍，最后点下那颗按钮：
 *
 *   ① 打开 /research/ask
 *   ② 选 Dataset 版本 = v2（390002，与用户实际使用的一致）
 *   ③ 把研究问题打进去（`#ask-question`）
 *   ④ 把分析规模上限设成 20（`#ask-cap`，最省时间的合法值）
 *   ⑤ 点「开始研究」→ 等「② 研究计划预览」
 *   ⑥ 点「执行这份计划」→ 等「④ 研究结论」（轮询，真实跑）
 *   ⑦ 断言结论页出现了「候选筛选条件来源」区（本次修复新增）
 *   ⑧ 🔴 点「创建 Candidate」—— **这正是用户报的那一步**
 *   ⑨ 断言按钮变成「查看候选 #N（DRAFT）」且没有报错 toast
 *
 * 🔴 为什么必须走真机：本次缺陷的成因正是「前端挑了错的分析」。
 *    上一轮 §27 的 E2E 用 tRPC 直调并自己写挑选判据（`priority === "P0" && CONDITIONAL`），
 *    **绕过了产品的真实调用路径**，于是产品恒失败而测试全绿。
 *    要证明产品修好，就必须点产品的按钮。
 *
 * 用法：node docs/evidence/_e2e_candidate_button_real_ui.mjs [pageUrl]
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
const CDP_PORT = 9800 + Math.floor(Math.random() * 190);
const PAGE_URL = process.argv[2] ?? process.env.PAGE_URL ?? "http://127.0.0.1:3000/research/ask";

const QUESTION = "首板之后回踩，只要不跌破首板开盘价，后面的收益是不是更好？";
const WANT_VERSION = "v2";
const CAP = "20";

/** 预览卡独有内容（`ResearchAsk.tsx`）——判定「已进入第二步」。 */
const PREVIEW_SENTINEL = "预计分析数";
/** 结论卡独有内容（步骤条**恒渲染**「④ 研究结论」四个字，所以不能拿它当判据）。 */
const OUTCOME_SENTINEL = "研究计划与原始分析（复核用）";
/** 本次修复新增的区块（点按钮**之前**就该看得到条件来源）。 */
const SOURCE_BLOCK_SENTINEL = "创建候选时会自动使用";
const NO_CONDITION_SENTINEL = "没有一条带条件";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const READ_STATE = `(() => {
  // 🔴 CDP 连上时文档可能还没就绪（body 为 null）⇒ 必须防御。
  //    上一版直接读 document.body.innerText，实测抛
  //    「TypeError: Cannot read properties of null (reading 'innerText')」，
  //    而且是在第一次求值就抛 ⇒ 整个探针在浏览器起来之前就死了、.out.txt 只剩空文件。
  if (!document.body) return { __notReady: true };
  const txt = document.body.innerText;
  const btn = (t) => [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim().includes(t));
  const trigText = (id) => { const e = document.querySelector(id); return e ? (e.textContent || '').trim() : null; };
  return {
    hasQuestionBox: document.querySelector('#ask-question') !== null,
    datasetText: trigText('#ask-dataset'),
    versionText: trigText('#ask-version'),
    capValue: document.querySelector('#ask-cap')?.value ?? null,
    questionValue: document.querySelector('#ask-question')?.value ?? null,
    previewReady: txt.includes(${JSON.stringify(PREVIEW_SENTINEL)}),
    outcomeReady: txt.includes(${JSON.stringify(OUTCOME_SENTINEL)}),
    sourceBlockVisible: txt.includes(${JSON.stringify(SOURCE_BLOCK_SENTINEL)}),
    noConditionWarned: txt.includes(${JSON.stringify(NO_CONDITION_SENTINEL)}),
    hasStartAsk: !!btn('开始研究'),
    hasExecutePlan: !!btn('执行这份计划'),
    hasCreateCandidate: !!btn('创建 Candidate'),
    candidateLink: (document.querySelector('a[href^="/research/candidates/"]')?.textContent || '').trim() || null,
    candidateLinkHref: document.querySelector('a[href^="/research/candidates/"]')?.getAttribute('href') ?? null,
    // toast（sonner）落在 body 上；把可见 toast 文本抓出来判断是否报了错
    toastText: [...document.querySelectorAll('[data-sonner-toast]')].map((t) => (t.textContent || '').trim()).join(' | '),
    bodyText: txt,
  };
})()`;

/**
 * Radix Select（`@radix-ui/react-select@2.2`）的驱动方式 —— **必须走 CDP 原生输入管道**。
 *
 * 演进过程（全部是实测结论，不是推断）：
 *
 *   ① 按原生 `<select>` 驱动 ⇒ ✗ 找不到。
 *      读源码：该组件只在 `isFormControl`（即传了 `name`）时才渲染 `SelectBubbleInput`
 *      （隐藏原生 select），**本页两个下拉都没传 `name` ⇒ DOM 里根本没有 select**。
 *
 *   ② 按 `Runtime.evaluate` 派发 `PointerEvent('pointerdown'|'pointerup', { pointerType: 'mouse' })` ⇒ 半成功。
 *      读源码得到的机制是对的：Trigger `onPointerDown` 在 `pointerType === "mouse"` 时 `handleOpen()`；
 *      Item `onPointerUp` 在 `pointerTypeRef.current === "mouse"` 时 `handleSelect()`。
 *      实测结果：下拉**确实打开了**、`[role="option"]` 也读得到（`aria-selected` 正确）、
 *      但**选项点击始终不生效** —— 5 种合成事件组合（`pointerdown+up` / `+pointermove` /
 *      `HTMLElement.click()` / `focus+Enter` / `pointerId=0`）**全部无效**
 *      （证据：`_probe_radix_select_drive.mjs` 输出 5 个 `✗ 未生效`）。
 *      原因：`dispatchEvent(new PointerEvent(...))` 造出来的是**不可信事件**（`isTrusted === false`），
 *      React 19 的合成事件委托对它不按真实手势路径处理。
 *
 *   ③ `Input.dispatchMouseEvent` ⇒ ✅ **生效**。
 *      这是浏览器的**真实输入管线**：Blink 据 mouse 事件生成 `isTrusted: true` 的 mouse 事件，
 *      **并自动派生 `pointerType: "mouse"` 的 pointer 事件** ⇒ Trigger / Item 的分支都走对。
 *      证据：`_probe_radix_select_drive_native.mjs` 输出
 *      `✅ 下拉已打开` + `✅ 生效 —— 原生输入管道可以驱动 Radix Select`。
 *
 * 🔴 **教训**：凡依赖「真实用户手势」的组件（Radix / Headless UI / 自研手势层），
 *    `Runtime.evaluate` 里的 `dispatchEvent` 一律不可靠，必须用 `Input.*` 驱动。
 */


/** React 受控 input/textarea：必须用原型上的原生 setter + input 事件，直接赋值不会触发 onChange。 */
const fillControlled = (selector, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return { ok: false, why: '找不到 ' + ${JSON.stringify(selector)} };
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return { ok: true, value: el.value };
})()`;

const clickButton = (text) => `(() => {
  const b = [...document.querySelectorAll('button')].find((x) => (x.textContent || '').trim().includes(${JSON.stringify(text)}));
  if (!b) return { clicked: false };
  b.click();
  return { clicked: true, label: (b.textContent || '').trim() };
})()`;

async function main() {
  const fsMod = await import("node:fs");
  const edge = EDGE_CANDIDATES.find((p) => fsMod.existsSync(p));
  if (!edge) throw new Error("找不到 Edge / Chrome 可执行文件");

  const profile = mkdtempSync(join(tmpdir(), "edge-cdp-candidate-btn-"));
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
  const OUT_PATH = "docs/evidence/_e2e_candidate_button_real_ui.out.txt";
  // 🔴 **逐行同步落盘**：本探针要跑十几分钟（真实研究执行），
  //    一旦被外部信号打断（工具超时 / 手动停止），异步 pipe 里未 flush 的 stdout 会**全部丢失**，
  //    只留下一片空白，无法判断「跑到哪一步死的」。追加写保证任何时候中断都有证据。
  writeFileSync(OUT_PATH, "", "utf8");
  const log = (s = "") => {
    lines.push(s);
    console.log(s);
    appendFileSync(OUT_PATH, `${s}\n`, "utf8");
  };
  const failures = [];
  const assert = (ok, label) => {
    log(`${ok ? "PASS" : "FAIL"}  ${label}`);
    if (!ok) failures.push(label);
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
      if (res.result?.exceptionDetails) throw new Error(`evaluate 异常：${JSON.stringify(res.result.exceptionDetails)}`);
      return res.result?.result?.value;
    };
    /**
     * 求值直到「文档就绪」。
     * 🔴 为什么需要：浏览器刚起来时 `document.body` 还可能是 null，第一次求值直接抛异常，
     *    探针会在页面渲染之前整体退出（实测症状 = `.out.txt` 是空文件、日志一句话都没有）。
     */
    const evaluateWhenReady = async (expression) => {
      let last = null;
      for (let i = 0; i < 60; i++) {
        try {
          last = await evaluate(expression);
          if (last !== undefined && last !== null && last.__notReady !== true) return last;
        } catch {
          /* 文档还没就绪，重试 */
        }
        await sleep(1000);
      }
      throw new Error(`文档始终未就绪（60 次重试仍拿不到页面状态）：${JSON.stringify(last)}`);
    };
    /**
     * 取元素（或按文本谓词在同类元素里找）的**视口中心坐标**，供原生输入用。
     * `wantText` 传 `null` 表示取第一个匹配 `sel` 的元素。
     */
    const rectOfExpr = (sel, wantText) => `(() => {
      const els = [...document.querySelectorAll(${JSON.stringify(sel)})];
      const el = ${wantText === null
        ? "els[0]"
        : `els.find((e) => (e.textContent || '').includes(${JSON.stringify(wantText)}))`};
      if (!el) return { ok: false, why: 'not found', count: els.length,
                        texts: els.map((e) => (e.textContent || '').trim()) };
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return { ok: false, why: 'zero rect', count: els.length };
      return { ok: true, count: els.length,
               x: Math.round(r.left + r.width / 2),
               y: Math.round(r.top + r.height / 2),
               text: (el.textContent || '').trim() };
    })()`;

    /**
     * **CDP 原生鼠标点击** —— moved → pressed → released，走浏览器真实输入管线。
     * 这是驱动 Radix Select 的唯一可靠方式（见文件上方 §驱动方式 说明）。
     */
    const nativeClick = async (x, y, label) => {
      await send("Input.dispatchMouseEvent", {
        type: "mouseMoved", x, y, button: "none", pointerType: "mouse",
      });
      await sleep(80);
      const base = { x, y, button: "left", pointerType: "mouse", modifiers: 0, clickCount: 1 };
      await send("Input.dispatchMouseEvent", { type: "mousePressed", ...base, buttons: 1 });
      await sleep(60);
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...base, buttons: 0 });
      log(`    [native-click] ${label} @ (${x},${y})`);
    };

    /** 原生点击一个 Radix Select 下拉：先开关器，再点选项，返回是否真的切成了 `wantText`。 */
    const nativePickRadixOption = async (triggerId, wantText, readState) => {
      const trig = await evaluate(rectOfExpr(triggerId, null));
      if (!trig?.ok) return { ok: false, why: `取不到触发器坐标：${JSON.stringify(trig)}` };
      await nativeClick(trig.x, trig.y, `trigger ${triggerId}`);
      await sleep(900);

      const item = await evaluate(rectOfExpr('[role="option"]', wantText));
      if (!item?.ok) {
        return { ok: false, why: `下拉没打开 / 找不到选项「${wantText}」：${JSON.stringify(item)}` };
      }
      await nativeClick(item.x, item.y, `option「${wantText}」`);
      await sleep(1300);

      const after = await readState();
      return { ok: true, picked: item.text, optionCount: item.count, state: after };
    };

    const waitFor = async (predicate, timeoutMs, what) => {
      const deadline = Date.now() + timeoutMs;
      let last = null;
      while (Date.now() < deadline) {
        // 期间可能正在整页跳转（HMR / 路由切换），求值失败不能当致命错误。
        try {
          last = await evaluate(READ_STATE);
          if (predicate(last)) return { ok: true, state: last };
        } catch {
          /* 文档瞬时空窗，继续等 */
        }
        await sleep(2000);
      }
      return { ok: false, state: last, what };
    };

    await send("Runtime.enable");

    // ---- ① 等 ASK 就位（含「数据集 / 版本」两个异步下拉加载完成）----
    // 🔴 上一版只等 `#ask-question` 出现就去选版本 —— 而数据集列表是异步查的，
    //    那一刻两个下拉还是「加载中… / 请先选择数据集」，Radix Select 连原生 bubble
    //    `<select>` 都还没渲染 ⇒ 选版本必然失败（实测 FAIL）。
    //    判据改成「数据集文案不再含『加载』『请选择』」。
    const datasetReady = (s) =>
      typeof s.datasetText === "string"
      && s.datasetText.length > 0
      && !/加载中|请选择|加载/.test(s.datasetText);
    let st = await evaluateWhenReady(READ_STATE);
    for (let i = 0; i < 60 && !(datasetReady(st) && st.hasQuestionBox && st.hasStartAsk); i++) {
      await sleep(1000);
      st = await evaluate(READ_STATE);
    }
    // 版本下拉在「数据集选定后才加载」⇒ 再多等一会儿
    for (let i = 0; i < 30 && /加载/.test(st.versionText ?? ""); i++) {
      await sleep(1000);
      st = await evaluate(READ_STATE);
    }
    log("--- ① 首屏 ---");
    log(`  数据集 = ${st.datasetText}`);
    log(`  版本   = ${st.versionText}`);
    assert(st.hasQuestionBox === true, "① 提出问题卡已渲染（#ask-question 存在）");
    assert(st.hasStartAsk === true, "存在 [开始研究] 按钮");

    // ---- ② 选 v2 ----
    // 🔴 用 **CDP 原生鼠标输入**（`Input.dispatchMouseEvent`）驱动 Radix Select。
    //    上一版用 `Runtime.evaluate` 的合成 `PointerEvent` ⇒ 5 种组合全部驱动不了选项
    //    （证据：`_probe_radix_select_drive.mjs`）。原生管线才有效
    //    （证据：`_probe_radix_select_drive_native.mjs` 输出 `✅ 生效`）。
    log("");
    log("--- ② 选择 Dataset 版本（原生鼠标输入驱动）---");
    const pick = await nativePickRadixOption("#ask-version", WANT_VERSION, () => evaluate(READ_STATE));
    log(`  ${JSON.stringify({ ok: pick.ok, picked: pick.picked, optionCount: pick.optionCount, why: pick.why })}`);
    st = pick.state ?? (await evaluate(READ_STATE));
    log(`  选后版本 = ${st.versionText}`);
    assert(pick.ok === true, `版本下拉里能找到「${WANT_VERSION}」选项（实得 ${JSON.stringify(pick.why ?? pick.picked)}）`);
    assert(
      typeof st.versionText === "string" && st.versionText.includes(WANT_VERSION),
      `Dataset 版本已切到 ${WANT_VERSION}（实得 ${JSON.stringify(st.versionText)}）`,
    );

    // ---- ③④ 填问题 + 规模上限 ----
    log("");
    log("--- ③④ 填写研究问题与规模上限 ---");
    log(`  ${JSON.stringify(await evaluate(fillControlled("#ask-question", QUESTION)))}`);
    log(`  ${JSON.stringify(await evaluate(fillControlled("#ask-cap", CAP)))}`);
    await sleep(600);
    st = await evaluate(READ_STATE);
    assert(st.questionValue === QUESTION, "研究问题已填入（受控组件真的收到了 onChange）");
    assert(st.capValue === CAP, `分析规模上限 = ${CAP}（实得 ${st.capValue}）`);

    // ---- ⑤ 开始研究 → 预览 ----
    log("");
    log("--- ⑤ 点「开始研究」→ 等计划预览 ---");
    log(`  ${JSON.stringify(await evaluate(clickButton("开始研究")))}`);
    const preview = await waitFor((s) => s.previewReady, 120000, "预览");
    assert(preview.ok === true, `进入「② 研究计划预览」（判据 = 「${PREVIEW_SENTINEL}」出现）`);

    // ---- ⑥ 执行计划 → 结论 ----
    log("");
    log("--- ⑥ 点「执行这份计划」→ 等研究跑完（真实执行，最长 10 分钟）---");
    const planText = (preview.state?.bodyText ?? "").match(/预计分析数：[^\n]*/g);
    if (planText) log(`  ${planText.join(" / ")}`);
    log(`  ${JSON.stringify(await evaluate(clickButton("执行这份计划")))}`);
    const done = await waitFor((s) => s.outcomeReady, 600000, "结论");
    assert(done.ok === true, `研究跑完并进入结论页（判据 = 「${OUTCOME_SENTINEL}」出现）`);
    if (!done.ok) {
      log("  实得 bodyText 片段：");
      log((done.state?.bodyText ?? "").split("\n").filter((l) => l.trim()).slice(0, 40).map((l) => `    ${l}`).join("\n"));
    }

    // ---- ⑦ 结论页的「候选筛选条件来源」区 ----
    log("");
    log("--- ⑦ 候选筛选条件来源（本次修复新增的区块）---");
    const before = done.state ?? (await evaluate(READ_STATE));
    const condLine = (before.bodyText ?? "").match(/创建候选时会自动使用[^\n]*/g);
    log(`  ${condLine ? condLine.join(" / ") : "（未出现该区块）"}`);
    log(`  noConditionWarned = ${before.noConditionWarned}`);
    assert(
      before.sourceBlockVisible === true || before.noConditionWarned === true,
      "结论页在点按钮之前就展示了「筛选条件从哪条分析来」（或有条件缺失的如实警告）",
    );
    assert(before.hasCreateCandidate === true, "存在 [创建 Candidate] 按钮");

    // ---- ⑧ 🔴 点按钮 —— 用户报的那一步 ----
    log("");
    log("--- ⑧ 点「创建 Candidate」（🔴 用户报的就是这一步）---");
    log(`  ${JSON.stringify(await evaluate(clickButton("创建 Candidate")))}`);
    const created = await waitFor((s) => s.candidateLink !== null || /创建候选失败/.test(s.toastText), 120000, "候选结果");
    const after = created.state ?? (await evaluate(READ_STATE));
    log(`  toast      = ${after.toastText}`);
    log(`  候选链接   = ${after.candidateLink} → ${after.candidateLinkHref}`);
    assert(
      !/创建候选失败/.test(after.toastText),
      `没有出现「创建候选失败」toast（实得：${after.toastText || "无 toast"}）`,
    );
    assert(after.candidateLink !== null, "按钮已变为「查看候选 #N（DRAFT）」");
    assert(
      typeof after.candidateLink === "string" && /DRAFT/.test(after.candidateLink),
      `候选链接文案含 DRAFT（实得 ${JSON.stringify(after.candidateLink)}）`,
    );
    const finalMsg = (after.bodyText ?? "").match(/候选 #\d+ 的筛选条件：[^\n]*/g);
    if (finalMsg) log(`  回执：${finalMsg.join(" / ")}`);
    assert(
      (after.bodyText ?? "").includes("候选 #") && (after.bodyText ?? "").includes("的筛选条件："),
      "候选创建后如实回显了「筛选条件来自哪条分析 / 几条条件」",
    );

    ws.close();
    log("");
    log(failures.length === 0 ? "ALL PASS" : `FAILURES(${failures.length}): ${failures.join(" | ")}`);
    process.exitCode = failures.length === 0 ? 0 : 1;
  } finally {
    killTree();
  }
}

main().catch((err) => {
  console.error("探针异常：", err);
  process.exit(2);
});
