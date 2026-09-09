/**
 * STEP 14 / C-14.3 — 执行与约束模型：声明校验层。
 *
 * 全部校验为纯函数，返回结构化结果（不抛错）；另有 assert* 便捷入口在非法时抛
 * ResearchValidationError（复用 research 层既有 ResearchValidationIssue / Result /
 * Error，与 framework validation.ts / simulator validate.ts 同一错误体系）。
 *
 * 校验对象：
 *   - ExecutionConstraintDeclaration（声明本体）：资金 > 0、仓位上限 ∈ (0,1] 且互相
 *     不冲突（单标的 ≤ 总仓位）、持仓数上限为正整数或 null、手数为正整数、买卖限制
 *     布尔/禁买禁卖列表规范序（升序去重）、成交时机 ∈ STEP 8 值域、部分成交布尔、
 *     marketClaims 字面量未被篡改（tPlus1=true / point=close / longOnly 等）、
 *     boards 键值合法。非法执行模型 id（含「研究链自造时机」如 open+5m）一律拦截。
 */

import {
  ResearchValidationError,
  type ResearchValidationIssue,
  type ResearchValidationResult,
} from "../experimentValidation";
import type { ExecutionModelId } from "../../backtest/types";
import type { SecurityBoard } from "../simulator/types";
import type { ExecutionConstraintDeclaration } from "./types";
import {
  EXECUTION_CONSTRAINT_DECLARATION_KIND,
  EXECUTION_CONSTRAINT_DECLARATION_VERSION,
} from "./types";

/** STEP 8 执行模型值域（对齐 backtest ExecutionModelId；新增枚举须同步此处）。 */
export const EXECUTION_MODEL_IDS: readonly ExecutionModelId[] = [
  "NEXT_OPEN",
  "NEXT_CLOSE",
  "VWAP_PROXY",
  "LIMIT_PRICE",
];

/** 板块值域（对齐 simulator SecurityBoard）。 */
export const SECURITY_BOARDS: readonly SecurityBoard[] = ["main", "gem", "star", "bse"];

function issue(code: string, path: string, message: string): ResearchValidationIssue {
  return { code, path, message };
}

function result(issues: ResearchValidationIssue[]): ResearchValidationResult {
  return { valid: issues.length === 0, issues };
}

function assertValid(r: ResearchValidationResult): void {
  if (!r.valid) throw new ResearchValidationError(r.issues);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** 升序去重的规范序判断（localeCompare 严格递增 ⇒ 无重复）。 */
function isCanonicalAscending(values: readonly string[]): boolean {
  for (let i = 1; i < values.length; i += 1) {
    if (values[i - 1]!.localeCompare(values[i]!) >= 0) return false;
  }
  return true;
}

/** 校验 (0,1] 区间比例（仓位上限/总仓位上限共用）。 */
function validateEquityCap(
  value: unknown,
  path: string,
  code: string
): ResearchValidationIssue[] {
  if (value === null) return [];
  if (!isFiniteNumber(value) || value <= 0 || value > 1) {
    return [
      issue(code, path, "仓位占比必须是 (0,1] 的有限数字，或 null（不设上限）"),
    ];
  }
  return [];
}

/**
 * 校验执行与约束声明。
 * 覆盖：形状、资金、并发持仓数、单标的/总仓位上限及其一致性、手数、买卖限制
 * （布尔 + 禁买禁卖列表规范序）、成交时机值域、部分成交、marketClaims 字面量守卫、
 * 板块覆盖。
 */
export function validateExecutionConstraintDeclaration(
  declaration: ExecutionConstraintDeclaration | undefined | null
): ResearchValidationResult {
  const issues: ResearchValidationIssue[] = [];
  if (declaration === null || typeof declaration !== "object") {
    return result([
      issue(
        "EXCON_DECLARATION_INVALID",
        "declaration",
        "执行与约束声明缺失或非对象"
      ),
    ]);
  }
  const d = declaration as unknown as Record<string, unknown>;

  if (d.recordKind !== EXECUTION_CONSTRAINT_DECLARATION_KIND) {
    issues.push(
      issue(
        "EXCON_RECORD_KIND_INVALID",
        "declaration.recordKind",
        `recordKind 必须是 ${EXECUTION_CONSTRAINT_DECLARATION_KIND}`
      )
    );
  }
  if (d.recordVersion !== EXECUTION_CONSTRAINT_DECLARATION_VERSION) {
    issues.push(
      issue(
        "EXCON_RECORD_VERSION_INVALID",
        "declaration.recordVersion",
        `recordVersion 必须是 ${EXECUTION_CONSTRAINT_DECLARATION_VERSION}`
      )
    );
  }
  if (declaration.label !== undefined && typeof declaration.label !== "string") {
    issues.push(
      issue("EXCON_LABEL_INVALID", "declaration.label", "label 必须是字符串")
    );
  }

  // -- 资金 --
  const capital = declaration.capital as Record<string, unknown> | undefined;
  if (!capital || typeof capital !== "object") {
    issues.push(
      issue("EXCON_CAPITAL_INVALID", "declaration.capital", "capital 必须是对象")
    );
  } else {
    const value = capital.initialCapital;
    if (!isFiniteNumber(value) || value <= 0) {
      issues.push(
        issue(
          "EXCON_INITIAL_CAPITAL_INVALID",
          "declaration.capital.initialCapital",
          "初始资金必须是正有限数字（元）"
        )
      );
    }
  }

  // -- 仓位约束 --
  const positions = (declaration.positions as unknown) as
    Record<string, unknown> | undefined;
  if (!positions || typeof positions !== "object") {
    issues.push(
      issue("EXCON_POSITIONS_INVALID", "declaration.positions", "positions 必须是对象")
    );
  } else {
    const maxPositionCount = positions.maxPositionCount;
    if (
      maxPositionCount !== null &&
      (!isFiniteNumber(maxPositionCount) ||
        !Number.isInteger(maxPositionCount) ||
        maxPositionCount <= 0)
    ) {
      issues.push(
        issue(
          "EXCON_MAX_POSITION_COUNT_INVALID",
          "declaration.positions.maxPositionCount",
          "并发持仓数上限必须是正整数或 null（不限）"
        )
      );
    }
    issues.push(
      ...validateEquityCap(
        positions.perSecurityEquityCap,
        "declaration.positions.perSecurityEquityCap",
        "EXCON_PER_SECURITY_CAP_INVALID"
      )
    );
    issues.push(
      ...validateEquityCap(
        positions.totalEquityCap,
        "declaration.positions.totalEquityCap",
        "EXCON_TOTAL_EQUITY_CAP_INVALID"
      )
    );
    const per = positions.perSecurityEquityCap;
    const total = positions.totalEquityCap;
    if (
      isFiniteNumber(per) &&
      isFiniteNumber(total) &&
      per !== null &&
      total !== null &&
      per > total
    ) {
      issues.push(
        issue(
          "EXCON_POSITION_CAP_CONFLICT",
          "declaration.positions",
          `单标的仓位上限 ${per} 大于总仓位上限 ${total}，二者互相冲突`
        )
      );
    }
  }

  // -- 手数 --
  const lot = declaration.lot as Record<string, unknown> | undefined;
  if (!lot || typeof lot !== "object") {
    issues.push(
      issue("EXCON_LOT_INVALID", "declaration.lot", "lot 必须是对象")
    );
  } else {
    const lotSize = lot.lotSize;
    if (!isFiniteNumber(lotSize) || !Number.isInteger(lotSize) || lotSize <= 0) {
      issues.push(
        issue(
          "EXCON_LOT_SIZE_INVALID",
          "declaration.lot.lotSize",
          "一手股数（lotSize）必须是正整数"
        )
      );
    }
  }

  // -- 买卖限制 --
  const restrictions = declaration.restrictions as unknown as Record<string, unknown> | undefined;
  if (!restrictions || typeof restrictions !== "object") {
    issues.push(
      issue(
        "EXCON_RESTRICTIONS_INVALID",
        "declaration.restrictions",
        "restrictions 必须是对象"
      )
    );
  } else {
    for (const field of ["blockLimitUpBuy", "blockLimitDownSell"] as const) {
      const value = restrictions[field];
      if (typeof value !== "boolean") {
        issues.push(
          issue(
            "EXCON_RESTRICTION_BOOLEAN_INVALID",
            `declaration.restrictions.${field}`,
            `${field} 必须是布尔`
          )
        );
      }
    }
    for (const field of ["buyBanned", "sellBanned"] as const) {
      const list = restrictions[field];
      if (!Array.isArray(list)) {
        issues.push(
          issue(
            "EXCON_BANNED_LIST_INVALID",
            `declaration.restrictions.${field}`,
            `${field} 必须是数组（可为空）`
          )
        );
        continue;
      }
      for (let i = 0; i < list.length; i += 1) {
        const entry = list[i];
        if (typeof entry !== "string" || entry.trim() === "") {
          issues.push(
            issue(
              "EXCON_BANNED_ENTRY_INVALID",
              `declaration.restrictions.${field}[${i}]`,
              "禁买/禁卖列表项必须是非空 securityId 字符串"
            )
          );
        }
      }
      const strings = list as string[];
      if (!isCanonicalAscending(strings)) {
        issues.push(
          issue(
            "EXCON_BANNED_NOT_CANONICAL",
            `declaration.restrictions.${field}`,
            `${field} 必须升序去重（规范化序；可用 factory.sortUniqueSecurityIds 规范化）`
          )
        );
      }
    }
  }

  // -- 成交时机与订单约束 --
  const timing = (declaration.timing as unknown) as
    Record<string, unknown> | undefined;
  if (!timing || typeof timing !== "object") {
    issues.push(
      issue("EXCON_TIMING_INVALID", "declaration.timing", "timing 必须是对象")
    );
  } else {
    const model = timing.executionModel;
    if (!EXECUTION_MODEL_IDS.includes(model as ExecutionModelId)) {
      issues.push(
        issue(
          "EXCON_EXECUTION_MODEL_INVALID",
          "declaration.timing.executionModel",
          `executionModel 必须是 STEP 8 值域 ${EXECUTION_MODEL_IDS.join(" / ")} 之一` +
            `（研究链不引入「开盘后 N 分钟」等日线行域外的自造时机）`
        )
      );
    }
    const partial = timing.allowPartialFill;
    if (typeof partial !== "boolean") {
      issues.push(
        issue(
          "EXCON_PARTIAL_FILL_INVALID",
          "declaration.timing.allowPartialFill",
          "allowPartialFill 必须是布尔"
        )
      );
    }
  }

  // -- marketClaims 字面量守卫 --
  const claims = declaration.marketClaims as unknown as Record<string, unknown> | undefined;
  if (!claims || typeof claims !== "object") {
    issues.push(
      issue(
        "EXCON_CLAIMS_INVALID",
        "declaration.marketClaims",
        "marketClaims 必须是对象"
      )
    );
  } else {
    const literalChecks: ReadonlyArray<
      [key: string, expected: unknown, code: string, label: string]
    > = [
      ["tPlus1", true, "EXCON_CLAIM_T_PLUS_1", "tPlus1"],
      ["decisionPoint", "close", "EXCON_CLAIM_DECISION_POINT", "decisionPoint"],
      [
        "directionPolicy",
        "longOnly",
        "EXCON_CLAIM_DIRECTION_POLICY",
        "directionPolicy",
      ],
      [
        "suspensionMode",
        "REJECT_NO_BAR",
        "EXCON_CLAIM_SUSPENSION_MODE",
        "suspensionMode",
      ],
      [
        "corporateActions",
        "NOT_APPLIED",
        "EXCON_CLAIM_CORPORATE_ACTIONS",
        "corporateActions",
      ],
    ];
    for (const [key, expected, code, label] of literalChecks) {
      if (claims[key] !== expected) {
        issues.push(
          issue(
            code,
            `declaration.marketClaims.${key}`,
            `${label} 必须是 ${JSON.stringify(expected)}（研究链当前语义），声明与研究链失配`
          )
        );
      }
    }
    const boards = claims.boards;
    if (
      boards === null ||
      typeof boards !== "object" ||
      Array.isArray(boards)
    ) {
      issues.push(
        issue(
          "EXCON_BOARDS_INVALID",
          "declaration.marketClaims.boards",
          "boards 必须是 securityId → board 映射（可为空对象）"
        )
      );
    } else {
      for (const [securityId, board] of Object.entries(
        boards as Record<string, unknown>
      )) {
        if (typeof securityId !== "string" || securityId.trim() === "") {
          issues.push(
            issue(
              "EXCON_BOARDS_KEY_INVALID",
              "declaration.marketClaims.boards",
              "boards 键（securityId）不能为空"
            )
          );
        }
        if (!SECURITY_BOARDS.includes(board as SecurityBoard)) {
          issues.push(
            issue(
              "EXCON_BOARDS_VALUE_INVALID",
              `declaration.marketClaims.boards.${securityId}`,
              `board 必须是 ${SECURITY_BOARDS.join(" / ")} 之一`
            )
          );
        }
      }
    }
  }

  return result(issues);
}

/** 声明非法即抛 ResearchValidationError。 */
export function assertValidExecutionConstraintDeclaration(
  declaration: ExecutionConstraintDeclaration | undefined | null
): void {
  assertValid(validateExecutionConstraintDeclaration(declaration));
}
