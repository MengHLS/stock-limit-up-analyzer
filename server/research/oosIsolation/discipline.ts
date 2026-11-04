/**
 * STEP 19 / C-19.2 — 隔离纪律机器检查（记录层 IS/OOS 结果隔离 + 可审计归档）。
 *
 * 这是「OOS 段严禁参与优化 / 参数选择」铁律在**记录层**的代码化落点（不是注释承诺）：
 *
 * 与 C-19.1 `verifyWalkForwardFreezeDiscipline`（冻结键一致 / 深冻结 / Test 晚于 Train）互补：
 *   - C-19.1 管「冻结键一致 / 深冻结 / Test 晚于 Train」；
 *   - C-19.2 管「记录层 IS/OOS 结果字段分离 + 无重叠 + window id 唯一 + 参数不回写 + 可审计归档」。
 *
 * 检查项（任一失败 → violations 非空、passed = false；assert 版本直接抛错）：
 *   1. records 非空；
 *   2. 每个 windowId 唯一；
 *   3. 每个 windowIndex 唯一且 >= 0；
 *   4. 每窗 Test 严格晚于 Train（lastTrainDate < firstTestDate）；
 *   5. 每窗 Train / Test 日期集合无重叠（isolation.trainTestOverlapCount === 0）；
 *   6. 每窗 paramsFrozenFromTrain（test 参数 === 冻结参数，未改写 / 未回写）；
 *   7. 每窗 testResultWritesBackParams === false（结构分离，键白名单锁定）。
 *
 * 键白名单（字段分离的机器保证）：`WindowTrainResult` 与 `WindowTestResult` 除身份键
 * （windowId / windowIndex）外**键集合无交集**——任何把 train 结果字段塞进 test、或把 test
 * 结果字段塞进 train 的记录都会在这里被拦下（禁止同一字段被两端共享写入）。
 *
 * 铁律：纯函数、无 IO / Date.now / Math.random；破坏 → 响亮抛错（稳定 error code）。
 */

import {
  ResearchValidationError,
  type ResearchValidationIssue,
} from "../experimentValidation";
import { canonicalStringify } from "../../researchDataset/version";
import type {
  OosIsolationAudit,
  WindowResultRecord,
  WindowTestResult,
  WindowTrainResult,
} from "./types";

// ---------------------------------------------------------------------------
// 键白名单（字段分离的机器保证）
// ---------------------------------------------------------------------------

/** WindowTrainResult 允许的键（身份键 + Train 段参数/绩效键）。 */
const TRAIN_KEYS: ReadonlySet<string> = new Set([
  "windowId",
  "windowIndex",
  "firstTrainDate",
  "lastTrainDate",
  "frozenParameterSetKey",
  "frozenParameterSet",
  "trainTotalReturnPct",
  "trainMaxDrawdownPct",
  "trainTradeCount",
]);

/** WindowTestResult 允许的键（身份键 + OOS 段参数/绩效/归档键；无任何「写回 params」键）。 */
const TEST_KEYS: ReadonlySet<string> = new Set([
  "windowId",
  "windowIndex",
  "firstTestDate",
  "lastTestDate",
  "status",
  "testParameterSetKey",
  "testParameterSet",
  "totalReturnPct",
  "maxDrawdownPct",
  "tradeCount",
  "skipReasonCode",
  "oosEquityCurve",
]);

/** 身份键（两段共享，仅用于关联，不承载参数/结果）。 */
const IDENTITY_KEYS: ReadonlySet<string> = new Set(["windowId", "windowIndex"]);

/**
 * 键白名单校验：train / test 的键集合必须各自落于白名单，且除身份键外无交集。
 * 返回违规描述；无违规返回 null。
 */
function keySeparationViolation(
  train: WindowTrainResult,
  test: WindowTestResult,
  tag: string,
): string | null {
  const trainKeys = Object.keys(train);
  const testKeys = Object.keys(test);

  for (const key of trainKeys) {
    if (!TRAIN_KEYS.has(key)) {
      return `${tag}: train 含白名单之外的键 "${key}"（字段分离被破坏）`;
    }
  }
  for (const key of testKeys) {
    if (!TEST_KEYS.has(key)) {
      return `${tag}: test 含白名单之外的键 "${key}"（字段分离被破坏）`;
    }
  }

  const trainResultKeys = trainKeys.filter((key) => !IDENTITY_KEYS.has(key));
  const testResultKeys = new Set(testKeys.filter((key) => !IDENTITY_KEYS.has(key)));
  const shared = trainResultKeys.filter((key) => testResultKeys.has(key));
  if (shared.length > 0) {
    return `${tag}: train 与 test 共享非身份键 [${shared.join(", ")}]（禁止同一字段被两端共享写入）`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 机器检查
// ---------------------------------------------------------------------------

/**
 * 对逐窗隔离记录做机器检查（编排出口与反序列化后均可调用）。
 *
 * 返回审计结果（violations 为空 = passed）。不抛错；抛错由 `assertOosIsolationDiscipline`
 * 承担（FAIL FAST）。
 */
export function verifyOosIsolation(records: readonly WindowResultRecord[]): OosIsolationAudit {
  const violations: string[] = [];
  let allWindowIdsUnique = true;
  let allWindowIndexesUnique = true;
  let allTestStrictlyAfterTrain = true;
  let allTrainTestNonOverlapping = true;
  let allParamsFrozenFromTrain = true;
  let noTestResultWritesBackParams = true;

  if (!Array.isArray(records) || records.length === 0) {
    return {
      windowCount: 0,
      allWindowIdsUnique: false,
      allWindowIndexesUnique: false,
      allTestStrictlyAfterTrain: false,
      allTrainTestNonOverlapping: false,
      allParamsFrozenFromTrain: false,
      noTestResultWritesBackParams: false,
      violations: ["records 不能为空（空记录集无法审计）"],
      passed: false,
    };
  }

  const seenIds = new Set<string>();
  const seenIndexes = new Set<number>();

  for (const record of records) {
    const tag = `window[${record.windowIndex}]/${record.windowId}`;

    if (seenIds.has(record.windowId)) {
      allWindowIdsUnique = false;
      violations.push(`${tag}: windowId 重复（${record.windowId}）`);
    }
    seenIds.add(record.windowId);

    if (!Number.isInteger(record.windowIndex) || record.windowIndex < 0) {
      allWindowIndexesUnique = false;
      violations.push(`${tag}: windowIndex 非法（${String(record.windowIndex)}）`);
    } else if (seenIndexes.has(record.windowIndex)) {
      allWindowIndexesUnique = false;
      violations.push(`${tag}: windowIndex 重复（${record.windowIndex}）`);
    }
    seenIndexes.add(record.windowIndex);

    // Test 严格晚于 Train。
    if (!record.isolation.testStrictlyAfterTrain || record.train.lastTrainDate >= record.test.firstTestDate) {
      allTestStrictlyAfterTrain = false;
      violations.push(
        `${tag}: Test 段未严格晚于 Train 段（lastTrainDate=${record.train.lastTrainDate} / firstTestDate=${record.test.firstTestDate}）`,
      );
    }

    // Train / Test 无重叠。
    if (record.isolation.trainTestOverlapCount !== 0) {
      allTrainTestNonOverlapping = false;
      violations.push(`${tag}: Train 与 Test 日期重叠 ${record.isolation.trainTestOverlapCount} 个交易日（隔离被破坏）`);
    }

    // 参数不回写（OOS 段参数 === 冻结参数）。
    if (!record.isolation.paramsFrozenFromTrain) {
      allParamsFrozenFromTrain = false;
      violations.push(`${tag}: OOS 段参数与 Train 冻结参数不一致（参数被改写 / 回写）`);
    }

    // 结构分离（键白名单）。
    if (record.isolation.testResultWritesBackParams) {
      noTestResultWritesBackParams = false;
      violations.push(`${tag}: OOS 结果回写参数（结构分离被破坏）`);
    }
    const keyViolation = keySeparationViolation(record.train, record.test, tag);
    if (keyViolation !== null) {
      noTestResultWritesBackParams = false;
      violations.push(keyViolation);
    }

    // succeeded 的窗必须有非空冻结参数与 test 参数，且逐字段相等。
    if (record.test.status === "succeeded") {
      if (record.train.frozenParameterSet === null || record.test.testParameterSet === null) {
        allParamsFrozenFromTrain = false;
        violations.push(`${tag}: succeeded 但冻结参数或 test 参数缺失（隔离被破坏）`);
      } else if (
        canonicalStringify(record.train.frozenParameterSet) !== canonicalStringify(record.test.testParameterSet)
        || record.train.frozenParameterSetKey !== record.test.testParameterSetKey
      ) {
        allParamsFrozenFromTrain = false;
        violations.push(`${tag}: test 参数与冻结参数不一致（键或值被改写）`);
      }
    }
  }

  return {
    windowCount: records.length,
    allWindowIdsUnique,
    allWindowIndexesUnique,
    allTestStrictlyAfterTrain,
    allTrainTestNonOverlapping,
    allParamsFrozenFromTrain,
    noTestResultWritesBackParams,
    violations,
    passed: violations.length === 0,
  };
}

/**
 * 断言隔离纪律成立；任一条被破坏 → 结构化抛错（稳定 code `OOS19_ISOLATION_VIOLATION`）。
 * 用于编排出口与反序列化后的复核（FAIL FAST）。
 */
export function assertOosIsolationDiscipline(records: readonly WindowResultRecord[]): void {
  const audit = verifyOosIsolation(records);
  if (audit.passed) return;
  const issues: ResearchValidationIssue[] = audit.violations.map((violation, index) => ({
    code: "OOS19_ISOLATION_VIOLATION",
    path: `discipline.violations[${index}]`,
    message: violation,
  }));
  throw new ResearchValidationError(issues);
}

/** 断言单个窗口的隔离完整性（succeeded 窗的 test 参数 === 冻结参数，且无重叠 / Test 晚于 Train）。 */
export function assertWindowResultIsolation(record: WindowResultRecord): void {
  const issues: ResearchValidationIssue[] = [];
  const tag = `window[${record.windowIndex}]/${record.windowId}`;
  const issue = (code: string, path: string, message: string): void => {
    issues.push({ code, path, message });
  };

  if (!record.isolation.testStrictlyAfterTrain || record.train.lastTrainDate >= record.test.firstTestDate) {
    issue("OOS19_ISOLATION_TEST_NOT_AFTER_TRAIN", `${tag}.isolation.testStrictlyAfterTrain`, "Test 段未严格晚于 Train 段");
  }
  if (record.isolation.trainTestOverlapCount !== 0) {
    issue("OOS19_ISOLATION_OVERLAP", `${tag}.isolation.trainTestOverlapCount`, `Train/Test 重叠 ${record.isolation.trainTestOverlapCount} 日`);
  }
  if (record.test.status === "succeeded") {
    if (record.train.frozenParameterSet === null || record.test.testParameterSet === null) {
      issue("OOS19_ISOLATION_PARAMS_MISSING", `${tag}.test.testParameterSet`, "succeeded 但冻结参数或 test 参数缺失");
    } else if (
      canonicalStringify(record.train.frozenParameterSet) !== canonicalStringify(record.test.testParameterSet)
      || record.train.frozenParameterSetKey !== record.test.testParameterSetKey
    ) {
      issue("OOS19_ISOLATION_PARAMS_MISMATCH", `${tag}.test.testParameterSet`, "test 参数与冻结参数不一致");
    }
  }
  const keyViolation = keySeparationViolation(record.train, record.test, tag);
  if (keyViolation !== null) {
    issue("OOS19_ISOLATION_FIELD_SHARED", `${tag}`, keyViolation);
  }
  if (issues.length > 0) {
    throw new ResearchValidationError(issues);
  }
}
