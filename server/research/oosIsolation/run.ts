/**
 * STEP 19 / C-19.2 — IS/OOS 隔离记录与归档编排。
 *
 * 编排流程（同步、纯函数、无 IO / Math.random；runId / createdAt 注入式）：
 *   1. 校验请求（WalkForwardRun 身份 / OOS 权益曲线形态 / runId / createdAt）；
 *   2. `buildWindowResultRecords`：从 WalkForwardRun 构建逐窗 IS/OOS 隔离记录（复用 C-19.1
 *      `generateWalkForwardSplits` 窗口几何，做无重叠 / OOS 曲线 PIT 边界校验）；
 *   3. `verifyOosIsolation` → 隔离纪律机器检查（violations 非空 → 抛错，不产出可疑记录）；
 *   4. `computeOosAggregationReport`：OOS 结果聚合报告（复用 C-19.1 最小聚合 + C-16.1/C-16.2
 *      计算器做段级完整指标）；
 *   5. 组装 OosIsolationRun：身份 / 来源绑定（sourceWalkForwardRunId + 指纹）/ 逐窗记录 /
 *      隔离纪律审计 / 聚合报告 / createdAt / fingerprint；
 *   6. 出口断言 `assertOosIsolationDiscipline`（FAIL FAST）。
 *
 * 确定性纪律：编排内容由（WalkForwardRun, oosEquityCurves）完全决定；runId / createdAt 是
 * 运行元数据（默认随运行实例生成，调用方可注入固定值使整条记录确定性可复现）。
 *
 * 铁律：**不做 promotion**、**不下「过拟合/未过拟合」结论**（C-20 职责）、不跑真实回测、
 * 不改输入。
 */

import { randomBytes } from "node:crypto";
import {
  ResearchValidationError,
  type ResearchValidationIssue,
} from "../experimentValidation";
import { WALK_FORWARD_RUN_RECORD_KIND } from "../walkForwardRun/types";
import { computeOosAggregationReport } from "./aggregate";
import { assertOosIsolationDiscipline, verifyOosIsolation } from "./discipline";
import { buildWindowResultRecords } from "./record";
import { computeOosIsolationRunFingerprint } from "./serialize";
import {
  OOS_ISOLATION_RUN_ID_PREFIX,
  OOS_ISOLATION_RUN_RECORD_KIND,
  OOS_ISOLATION_RUN_RECORD_VERSION,
  type OosIsolationRequest,
  type OosIsolationRun,
} from "./types";

// ---------------------------------------------------------------------------
// Run ID（运行元数据；风格对齐 WFA-* / SEARCH-*）
// ---------------------------------------------------------------------------

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** 组装 OosIsolationRun ID（`OOSISO-YYYYMMDD-XXXXXXXX`）。 */
export function formatOosIsolationRunId(date: string, suffix: string): string {
  return `${OOS_ISOLATION_RUN_ID_PREFIX}-${date}-${suffix}`;
}

/** 生成 OosIsolationRun ID；注入 suffix 时（测试）确定性；属于运行元数据，允许随机后缀。 */
export function generateOosIsolationRunId(now: Date = new Date(), suffix?: string): string {
  const date = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
  const resolvedSuffix = suffix ?? randomBytes(4).toString("hex").toUpperCase();
  return formatOosIsolationRunId(date, resolvedSuffix);
}

// ---------------------------------------------------------------------------
// 请求校验
// ---------------------------------------------------------------------------

/** 校验 OosIsolationRequest；issues 为空即合法。 */
export function validateOosIsolationRequest(request: OosIsolationRequest): ResearchValidationIssue[] {
  const issues: ResearchValidationIssue[] = [];
  const issue = (code: string, path: string, message: string): void => {
    issues.push({ code, path, message });
  };

  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    issue("OOS19_REQUEST_INVALID", "request", "request 必须是对象");
    return issues;
  }

  const wf = request.walkForwardRun;
  if (wf === null || typeof wf !== "object" || Array.isArray(wf)) {
    issue("OOS19_WALK_FORWARD_RUN_MISSING", "walkForwardRun", "walkForwardRun 必须是 WalkForwardRun 对象");
  } else {
    if (wf.recordKind !== WALK_FORWARD_RUN_RECORD_KIND) {
      issue("OOS19_WALK_FORWARD_RUN_KIND_MISMATCH", "walkForwardRun.recordKind", `recordKind=${String(wf.recordKind)} 不是 ${WALK_FORWARD_RUN_RECORD_KIND}`);
    }
    if (typeof wf.runId !== "string" || wf.runId.trim() === "") {
      issue("OOS19_WALK_FORWARD_RUN_ID_EMPTY", "walkForwardRun.runId", "walkForwardRun.runId 不能为空");
    }
    if (typeof wf.fingerprint !== "string" || wf.fingerprint.trim() === "") {
      issue("OOS19_WALK_FORWARD_RUN_FP_EMPTY", "walkForwardRun.fingerprint", "walkForwardRun.fingerprint 不能为空");
    }
  }

  if (request.oosEquityCurves !== undefined && request.oosEquityCurves !== null) {
    if (!(request.oosEquityCurves instanceof Map)) {
      issue("OOS19_OOS_CURVES_INVALID", "oosEquityCurves", "oosEquityCurves 必须是 Map（key = windowId）");
    } else {
      request.oosEquityCurves.forEach((value, key) => {
        if (typeof key !== "string" || key.trim() === "") {
          issue("OOS19_OOS_CURVES_INVALID", "oosEquityCurves", "oosEquityCurves 的 key 必须是非空 windowId 字符串");
        }
        if (!Array.isArray(value)) {
          issue("OOS19_OOS_CURVES_INVALID", `oosEquityCurves[${String(key)}]`, "oosEquityCurves 的 value 必须是 EquityPoint 数组");
        }
      });
    }
  }

  if (request.runId !== undefined && (typeof request.runId !== "string" || request.runId.trim() === "")) {
    issue("OOS19_RUN_ID_INVALID", "runId", "runId 必须是非空字符串");
  }
  if (request.createdAt !== undefined && (typeof request.createdAt !== "string" || request.createdAt.trim() === "")) {
    issue("OOS19_CREATED_AT_INVALID", "createdAt", "createdAt 必须是非空字符串（ISO-8601 UTC）");
  }
  return issues;
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

/**
 * 执行一次 IS/OOS 隔离记录与归档，产出完整 OosIsolationRun。
 *
 * 隔离纪律落点：`assertOosIsolationDiscipline` 在出口把任何「OOS 段参与参数 / Train 与 OOS
 * 重叠 / 字段共享」的可疑记录拦下（响亮抛错），绝不产出隔离被破坏的归档。
 */
export function runOosIsolation(request: OosIsolationRequest): OosIsolationRun {
  const issues = validateOosIsolationRequest(request);
  if (issues.length > 0) {
    throw new ResearchValidationError([...issues]);
  }

  const walkForwardRun = request.walkForwardRun;
  const runId = request.runId ?? generateOosIsolationRunId();
  const createdAt = request.createdAt ?? new Date().toISOString();

  const records = buildWindowResultRecords(walkForwardRun, request.oosEquityCurves);
  const discipline = verifyOosIsolation(records);
  const report = computeOosAggregationReport(records, walkForwardRun);

  const body: Omit<OosIsolationRun, "fingerprint"> = {
    recordKind: OOS_ISOLATION_RUN_RECORD_KIND,
    recordVersion: OOS_ISOLATION_RUN_RECORD_VERSION,
    runId,
    sourceWalkForwardRunId: walkForwardRun.runId,
    sourceWalkForwardRunFingerprint: walkForwardRun.fingerprint,
    strategyId: walkForwardRun.strategyId,
    strategyVersion: walkForwardRun.strategyVersion,
    tradeDatesFingerprint: walkForwardRun.tradeDatesFingerprint,
    windowCount: records.length,
    windows: records,
    discipline,
    report,
    createdAt,
  };
  const fingerprint = computeOosIsolationRunFingerprint(body);
  const run: OosIsolationRun = { ...body, fingerprint };

  // 出口断言：隔离纪律必须成立（violations 非空 → 响亮抛错，不产出可疑归档）。
  assertOosIsolationDiscipline(records);
  return run;
}
