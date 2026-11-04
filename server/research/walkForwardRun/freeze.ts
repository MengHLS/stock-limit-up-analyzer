/**
 * STEP 19 / C-19.1 — Freeze 纪律：Optimize 产物在 Test 之前冻结，Test 段不得参与优化。
 *
 * 本文件是「OOS 段严禁参与优化/参数选择」这一铁律的**代码化落点**，不是注释承诺：
 *
 * 1. **结构解耦**（见 types.ts）：
 *      - `WalkForwardOptimizeContext` 不含任何 test 交易日 → 窗内搜索在类型层面看不到 OOS；
 *      - `WalkForwardTestContext` 不含 searchRun / 候选 / 参数空间 → Test 阶段在类型层面
 *        拿不到 optimizer 结果，唯一输入是「冻结参数集」本身。
 * 2. **不可写副本**：`deepFreezeParameterSet` 产出深冻结副本交给 test 评估器；run.ts 在调用
 *    点实测 `Object.isFrozen` 并记档到 `testStage.parameterSetFrozen`。
 * 3. **机器检查**：`verifyWalkForwardFreezeDiscipline` / `assertWalkForwardFreezeDiscipline`
 *    对整条 Run 逐窗复核（键一致 / 已冻结 / 逐字段相等 / Test 严格晚于 Train / skip 必须有
 *    原因码），任一条被破坏 → violations 非空（assert 版本直接抛错）。
 * 4. **实证测试**（见 walkForwardRun.test.ts）：注入式 evaluator 记录调用参数——篡改 test 数据
 *    （把 OOS 段的绩效改成极端值 / 让 test 评估器返回任意排序）后，冻结参数**不变**；
 *    optimize 上下文对象键集合不含任何 test 字段。
 *
 * 选择口径：从 Train 段稳定区**合格成员**中取「下中位数」（lower median：按收益升序取
 * index = floor((n-1)/2)），显式**非 argmax**——对齐 ROADMAP §19「找表现良好且稳定的参数
 * 区域，而不是历史收益最高参数」。members 已由 C-17.1 analyzeCandidateRegion 按
 * （totalReturnPct 降序、参数集 canonical 键升序）确定性排序，选取结果可复现。
 *
 * 铁律：纯函数、无 IO / Date.now / Math.random；不做 promotion（本文件不产出候选策略记录，
 * 冻结参数只是 Test 阶段的输入，不是 Final/Production 声明）。
 */

import { createHash } from "node:crypto";
import { canonicalStringify } from "../../researchDataset/version";
import { rollingParameterSetKey } from "../rollingOptimization/stability";
import { ResearchValidationError, type ResearchValidationIssue } from "../experimentValidation";
import type { ResearchParameterSet, ResearchParameterValue } from "../types";
import type { ParameterSearchRun } from "../parameterSearch";
import type {
  WalkForwardFreezeAudit,
  WalkForwardFrozenParameters,
  WalkForwardSkipReasonCode,
  WalkForwardWindowRecord,
} from "./types";

// ---------------------------------------------------------------------------
// 深冻结（不可写副本）
// ---------------------------------------------------------------------------

function deepFreezeValue<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreezeValue((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/**
 * 产出参数集的**深冻结副本**（不可写）。
 *
 * Test 阶段只拿到这个副本：任何试图在 test 评估器内改写参数的行为都会在非严格模式下静默
 * 失败、在严格模式抛 TypeError —— 冻结纪律由运行时强制，而非约定。
 */
export function deepFreezeParameterSet(parameterSet: ResearchParameterSet): ResearchParameterSet {
  const copy: Record<string, ResearchParameterValue> = {};
  for (const key of Object.keys(parameterSet).sort()) {
    copy[key] = parameterSet[key] as ResearchParameterValue;
  }
  return deepFreezeValue(copy);
}

/** 参数集（及其嵌套对象）是否已被冻结。 */
export function isDeepFrozenParameterSet(parameterSet: ResearchParameterSet): boolean {
  if (!Object.isFrozen(parameterSet)) return false;
  for (const key of Object.keys(parameterSet)) {
    const value = parameterSet[key];
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// 冻结参数指纹
// ---------------------------------------------------------------------------

/** 冻结参数记录内容指纹（sha256，十六进制；除 fingerprint 字段外的 canonical JSON 摘要）。 */
export function computeWalkForwardFrozenParametersFingerprint(
  body: Omit<WalkForwardFrozenParameters, "fingerprint">,
): string {
  return createHash("sha256").update(canonicalStringify(body), "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// 冻结参数选择
// ---------------------------------------------------------------------------

/** 冻结选择输入。 */
export interface SelectWalkForwardFrozenParametersInput {
  /** 来源 SearchRun（该窗 Train 段搜索结果）。 */
  readonly searchRun: ParameterSearchRun;
  /** 选择口径（当前恒为 median-qualified）。 */
  readonly selection: WalkForwardFrozenParameters["selection"];
  /** 冻结时刻（ISO-8601 UTC；由 run 注入 createdAt，本层不取时钟）。 */
  readonly frozenAt: string;
}

/** 冻结选择结果：无合格成员时 frozen = null 且给出原因码（CALL FAST：不静默）。 */
export interface SelectWalkForwardFrozenParametersResult {
  readonly frozen: WalkForwardFrozenParameters | null;
  readonly reasonCode: WalkForwardSkipReasonCode | null;
}

/**
 * 从 Train 段稳定区合格成员中冻结一个参数集（下中位数，显式非 argmax）。
 *
 * 无合格成员（region.members 为空）→ 返回 `{ frozen: null, reasonCode:
 * "WFO19_NO_QUALIFIED_PARAMETERS" }`，由编排层记 skipped，绝不静默跳过。
 */
export function selectWalkForwardFrozenParameters(
  input: SelectWalkForwardFrozenParametersInput,
): SelectWalkForwardFrozenParametersResult {
  const members = input.searchRun.region.members;
  if (members.length === 0) {
    return { frozen: null, reasonCode: "WFO19_NO_QUALIFIED_PARAMETERS" };
  }

  // 下中位数：按 (totalReturnPct 升序, parameterSetKey 升序) 排序后取 index = floor((n-1)/2)。
  const ordered = members
    .map((member, index) => ({
      index,
      parameterSet: member.parameterSet,
      parameterSetKey: rollingParameterSetKey(member.parameterSet),
      totalReturnPct: member.totalReturnPct,
      maxDrawdownPct: member.maxDrawdownPct,
      tradeCount: member.tradeCount,
    }))
    .sort((a, b) => {
      if (a.totalReturnPct !== b.totalReturnPct) return a.totalReturnPct - b.totalReturnPct;
      return a.parameterSetKey < b.parameterSetKey ? -1 : a.parameterSetKey > b.parameterSetKey ? 1 : 0;
    });
  const pickIndex = Math.floor((ordered.length - 1) / 2);
  const picked = ordered[pickIndex]!;

  const body: Omit<WalkForwardFrozenParameters, "fingerprint"> = {
    parameterSetKey: picked.parameterSetKey,
    parameterSet: deepFreezeParameterSet(picked.parameterSet),
    selection: input.selection,
    trainTotalReturnPct: picked.totalReturnPct,
    trainMaxDrawdownPct: picked.maxDrawdownPct,
    trainTradeCount: picked.tradeCount,
    regionVerdict: input.searchRun.region.verdict,
    qualifiedMemberCount: members.length,
    memberIndex: picked.index,
    sourceSearchRunId: input.searchRun.searchRunId,
    frozenAt: input.frozenAt,
  };
  return {
    frozen: { ...body, fingerprint: computeWalkForwardFrozenParametersFingerprint(body) },
    reasonCode: null,
  };
}

// ---------------------------------------------------------------------------
// 冻结纪律机器检查
// ---------------------------------------------------------------------------

/**
 * 对逐窗记录做冻结纪律机器检查（编排出口与反序列化后均可调用）。
 *
 * 检查项（任一失败 → violations 非空、passed = false）：
 *   1. test succeeded 的窗必须有 frozen 记录；
 *   2. test.parameterSetKey === frozen.parameterSetKey；
 *   3. test.parameterSetFrozen === true（传给 test 评估器的对象已深冻结）；
 *   4. test 记录的参数集与冻结参数集逐字段相等（canonical 比较）；
 *   5. 全部窗：test 首交易日严格晚于 train 末交易日（PIT 边界）；
 *   6. skipped 的窗必须有 skipReasonCode（禁止无原因跳过）。
 */
export function verifyWalkForwardFreezeDiscipline(
  windows: readonly WalkForwardWindowRecord[],
): WalkForwardFreezeAudit {
  const violations: string[] = [];
  let allKeysMatch = true;
  let allFrozen = true;
  let allAfterTrain = true;
  let frozenWindowCount = 0;
  let testedWindowCount = 0;

  for (const window of windows) {
    const tag = `window[${window.windowIndex}]/${window.windowId}`;
    if (window.frozen !== null) frozenWindowCount += 1;

    if (window.train.lastTrainDate >= window.test.firstTestDate) {
      allAfterTrain = false;
      violations.push(
        `${tag}: Test 段未严格晚于 Train 段（lastTrainDate=${window.train.lastTrainDate} / firstTestDate=${window.test.firstTestDate}）`,
      );
    }

    if (window.test.status === "skipped") {
      if (window.test.skipReasonCode === null) {
        violations.push(`${tag}: skipped 窗口缺少 skipReasonCode`);
      }
      continue;
    }

    testedWindowCount += 1;
    const frozen = window.frozen;
    if (frozen === null) {
      allKeysMatch = false;
      allFrozen = false;
      violations.push(`${tag}: test 已评估但没有冻结参数记录（冻结纪律被绕过）`);
      continue;
    }
    if (window.test.parameterSetKey !== frozen.parameterSetKey) {
      allKeysMatch = false;
      violations.push(`${tag}: test 使用参数集键 ${String(window.test.parameterSetKey)} ≠ 冻结参数集键 ${frozen.parameterSetKey}`);
    }
    if (window.test.parameterSetFrozen !== true) {
      allFrozen = false;
      violations.push(`${tag}: 传给 test 评估器的参数集未深冻结（parameterSetFrozen=${String(window.test.parameterSetFrozen)}）`);
    }
    if (
      window.test.parameterSet === null
      || canonicalStringify(window.test.parameterSet) !== canonicalStringify(frozen.parameterSet)
    ) {
      allKeysMatch = false;
      violations.push(`${tag}: test 记录的参数集与冻结参数集不一致`);
    }
  }

  return {
    windowCount: windows.length,
    frozenWindowCount,
    testedWindowCount,
    allTestStageKeysMatchFrozen: allKeysMatch,
    allTestStageParametersFrozen: allFrozen,
    allTestWindowsAfterTrain: allAfterTrain,
    violations,
    passed: violations.length === 0,
  };
}

/**
 * 断言冻结纪律成立；任一条被破坏 → 结构化抛错（稳定 code `WFO19_FREEZE_DISCIPLINE_VIOLATION`）。
 * 用于编排出口与反序列化后的复核（FAIL FAST）。
 */
export function assertWalkForwardFreezeDiscipline(
  windows: readonly WalkForwardWindowRecord[],
): void {
  const audit = verifyWalkForwardFreezeDiscipline(windows);
  if (audit.passed) return;
  const issues: ResearchValidationIssue[] = audit.violations.map((violation, index) => ({
    code: "WFO19_FREEZE_DISCIPLINE_VIOLATION",
    path: `freezeIntegrity.violations[${index}]`,
    message: violation,
  }));
  throw new ResearchValidationError(issues);
}

/** 断言单个窗口的冻结完整性（test 阶段参数 === 冻结参数，且已深冻结）。 */
export function assertWalkForwardWindowFreezeIntegrity(window: WalkForwardWindowRecord): void {
  if (window.test.status === "skipped") return;
  const issues: ResearchValidationIssue[] = [];
  const tag = `windows[${window.windowIndex}]`;
  if (window.frozen === null) {
    issues.push({
      code: "WFO19_FREEZE_MISSING",
      path: `${tag}.frozen`,
      message: "test 已评估但无冻结参数记录",
    });
  } else if (window.test.parameterSetKey !== window.frozen.parameterSetKey) {
    issues.push({
      code: "WFO19_FREEZE_KEY_MISMATCH",
      path: `${tag}.test.parameterSetKey`,
      message: `test 参数集键 ${String(window.test.parameterSetKey)} ≠ 冻结参数集键 ${window.frozen.parameterSetKey}`,
    });
  }
  if (window.test.parameterSetFrozen !== true) {
    issues.push({
      code: "WFO19_FREEZE_NOT_FROZEN",
      path: `${tag}.test.parameterSetFrozen`,
      message: "传给 test 评估器的参数集未深冻结",
    });
  }
  if (issues.length > 0) {
    throw new ResearchValidationError(issues);
  }
}
