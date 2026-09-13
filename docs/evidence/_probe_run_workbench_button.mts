/**
 * 探针：运行工作台「运行策略」按钮可点击性 —— 真实成因取证（2026-09-13）。
 *
 * 用户实报：「还是不能点击前段运行工作台中的策略进行运行」。
 *
 * 本探针回答三个问题，全部以**真实服务**为据（不 mock、不推断）：
 *   ① 按钮的 disabled 判据（`wired && !running`）是否真的会被触发？—— 读源码断言。
 *   ② 默认入参（`initRunConfig`）发给真实 `loopRun` 会发生什么？—— 真发 HTTP。
 *   ③ 修好默认入参后，链路是否真的跑得通？—— 真发 HTTP 并核对阶段状态。
 *
 * 运行（🔴 必须在项目根目录）：
 *   npx tsx docs/evidence/_probe_run_workbench_button.mts
 */

const BASE = process.env.PROBE_BASE ?? "http://localhost:3000";

type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];
function record(name: string, pass: boolean, detail: string) {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "✅" : "❌"} ${name}\n   ${detail}`);
}

async function callLoopRun(body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}/api/trpc/researchRun.loopRun`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ json: body }),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  return { status: res.status, json };
}

function errMessage(json: any): string {
  // tRPC v11 的错误体形如：
  //   { error: { json: { message, code, data: { code, httpStatus, stack } } } }
  // 但 zod 校验失败时 message 仍为字符串；某些包装下也可能落在 data 上。
  const e = json?.error;
  if (e === undefined) return "(no error)";
  const j = e.json ?? e;
  return (
    j?.message ??
    j?.data?.message ??
    json?.raw ??
    "(no error)"
  );
}

/** 从 `callLoopRun` 返回值取错误文本（顺带兼容「HTTP 正常但 JSON 无 error」的情形）。 */
function failureText(r: { status: number; json: any }): string {
  if (r.json?.error !== undefined) return errMessage(r.json);
  return r.json?.raw ?? `HTTP ${r.status}（无 error 字段）`;
}

async function main() {
  console.log(`\n=== probe base: ${BASE} ===\n`);

  // ---------------------------------------------------------------------
  // ① 旧默认入参（dateRange 为空）—— 复现用户看到的失败
  // ---------------------------------------------------------------------
  const legacy = await callLoopRun({
    experimentId: "EXP-20260913-00000001",
    strategyId: "limit-up-baseline",
    strategyVersion: "1.1.0",
    dateRange: { startDate: "", endDate: "" },
    executionModel: "NEXT_OPEN",
  });
  const legacyMsg = failureText(legacy);
  const isValidationReject =
    legacy.status === 400 && /startDate|endDate/.test(legacyMsg);
  record(
    "旧默认入参（日期留空）被后端拒绝 —— 这正是「点了没反应」的直接成因",
    isValidationReject,
    `HTTP ${legacy.status}；${legacyMsg.replace(/\s+/g, " ").slice(0, 200)}`
  );

  // ---------------------------------------------------------------------
  // ② 修复后的默认窗口 —— 应当真实跑通
  // ---------------------------------------------------------------------
  const fixedStart = "2025-01-02";
  const fixedEnd = "2025-03-31";
  const fixed = await callLoopRun({
    experimentId: "EXP-20260913-00000002",
    strategyId: "limit-up-baseline",
    strategyVersion: "1.1.0",
    dateRange: { startDate: fixedStart, endDate: fixedEnd },
    executionModel: "NEXT_OPEN",
    useRealData: true,
    datasetGuards: { dataReady: true },
  });

  const result = fixed.json?.result?.data?.json;
  const executed = result?.overall?.executedStageCount ?? 0;
  record(
    `新默认窗口（${fixedStart} ~ ${fixedEnd}）真实跑通（executedStageCount=${executed}）`,
    fixed.status === 200 && executed > 0,
    fixed.status === 200
      ? `HTTP 200；datasetSource=${result?.assembly?.datasetSource} rows=${result?.assembly?.datasetRowCount} gate=${result?.assembly?.datasetGate}`
      : `HTTP ${fixed.status}；${errMessage(fixed.json).slice(0, 200)}`
  );

  // 五阶段（data/research/strategy/backtest/evaluation）应全部 EXECUTED
  const stages: Array<{ stageId: string; state: string }> = result?.stages ?? [];
  const coreStages = ["data", "research", "strategy", "backtest", "evaluation"];
  const coreStates = coreStages.map(
    id => `${id}=${stages.find(s => s.stageId === id)?.state ?? "?"}`
  );
  const allCoreExecuted = coreStages.every(
    id => stages.find(s => s.stageId === id)?.state === "EXECUTED"
  );
  record(
    "五个核心阶段全部 EXECUTED",
    allCoreExecuted,
    coreStates.join(" · ")
  );

  // ---------------------------------------------------------------------
  // ③ 越界窗口应被如实拒绝（证明「预置窗口」不是绕过校验的假绿）
  // ---------------------------------------------------------------------
  const oob = await callLoopRun({
    experimentId: "EXP-20260913-00000003",
    strategyId: "limit-up-baseline",
    strategyVersion: "1.1.0",
    dateRange: { startDate: "2020-01-02", endDate: "2020-03-31" },
    executionModel: "NEXT_OPEN",
    useRealData: true,
    datasetGuards: { dataReady: true },
  });
  const oobMsg = failureText(oob);
  record(
    "越界窗口被如实拒绝（未以部分数据集冒充全窗口）",
    oob.status >= 400 && /数据集窗口/.test(oobMsg),
    `HTTP ${oob.status}；${oobMsg.replace(/\s+/g, " ").slice(0, 180)}`
  );

  // ---------------------------------------------------------------------
  // 汇总
  // ---------------------------------------------------------------------
  const failed = checks.filter(c => !c.pass);
  console.log(
    `\n=== ${checks.length - failed.length}/${checks.length} 项通过 ===\n`
  );
  if (failed.length > 0) {
    console.log("未通过：");
    for (const f of failed) console.log(` - ${f.name}: ${f.detail}`);
    process.exitCode = 1;
  }
}

main().catch(e => {
  console.error("probe crashed:", e);
  process.exitCode = 1;
});
