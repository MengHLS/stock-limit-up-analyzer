/**
 * STEP 14 / C-14.1 — 交易模拟核心：校验层。
 *
 * 全部校验为纯函数，返回结构化结果（不抛错）；另有 assert* 便捷入口在非法时抛
 * ResearchValidationError（复用 research 层既有 ResearchValidationIssue / Result /
 * Error，与 framework validation.ts 同一错误体系）。
 *
 * 校验对象：
 *   - SimulationConfig（模拟输入）：窗口/资金/成本/执行模型/持仓上限/方向策略/
 *     涨跌停拦截/板块覆盖的形状与取值合法性；
 *   - TradeSimulationRun（结果记录）：供反序列化后结构复核（字段种类、枚举、数组
 *     形态、数值有限性、权益曲线日期升序），保证 JSON → 对象不回退类型边界。
 */

import {
  ResearchValidationError,
  type ResearchValidationIssue,
  type ResearchValidationResult,
} from "../experimentValidation";
import type { ExecutionModelId, Side } from "../../backtest/types";
import type { SecurityBoard } from "./types";
import type {
  SimulationConfig,
  SimulationConfigSnapshot,
  TradeSimulationRun,
} from "./types";

function issue(
  code: string,
  path: string,
  message: string
): ResearchValidationIssue {
  return { code, path, message };
}

function result(issues: ResearchValidationIssue[]): ResearchValidationResult {
  return { valid: issues.length === 0, issues };
}

function assertValid(r: ResearchValidationResult): void {
  if (!r.valid) throw new ResearchValidationError(r.issues);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EXECUTION_MODEL_IDS: readonly ExecutionModelId[] = [
  "NEXT_OPEN",
  "NEXT_CLOSE",
  "VWAP_PROXY",
  "LIMIT_PRICE",
];
const BOARDS: readonly SecurityBoard[] = ["main", "gem", "star", "bse"];

function isValidDate(value: unknown): value is string {
  return typeof value === "string" && DATE_RE.test(value);
}

// ---------------------------------------------------------------------------
// SimulationConfig
// ---------------------------------------------------------------------------

function validateCostModel(
  cost: unknown,
  path: string
): ResearchValidationIssue[] {
  const issues: ResearchValidationIssue[] = [];
  if (cost === null || typeof cost !== "object") {
    issues.push(issue("SIM_COST_INVALID", path, "cost 必须是对象"));
    return issues;
  }
  const c = cost as Record<string, unknown>;
  for (const field of [
    "commissionRate",
    "stampDutyRate",
    "transferFeeRate",
    "slippageBps",
    "lotSize",
    "minCommission",
  ] as const) {
    const value = c[field];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      issues.push(
        issue(
          "SIM_COST_FIELD_INVALID",
          `${path}.${field}`,
          `${field} 必须是有限数字`
        )
      );
    }
  }
  if (
    typeof c.commissionRate === "number" &&
    (c.commissionRate as number) < 0
  ) {
    issues.push(
      issue(
        "SIM_COST_RATE_NEGATIVE",
        `${path}.commissionRate`,
        "commissionRate 不能为负"
      )
    );
  }
  if (typeof c.stampDutyRate === "number" && (c.stampDutyRate as number) < 0) {
    issues.push(
      issue(
        "SIM_COST_RATE_NEGATIVE",
        `${path}.stampDutyRate`,
        "stampDutyRate 不能为负"
      )
    );
  }
  if (
    typeof c.transferFeeRate === "number" &&
    (c.transferFeeRate as number) < 0
  ) {
    issues.push(
      issue(
        "SIM_COST_RATE_NEGATIVE",
        `${path}.transferFeeRate`,
        "transferFeeRate 不能为负"
      )
    );
  }
  if (typeof c.slippageBps === "number" && (c.slippageBps as number) < 0) {
    issues.push(
      issue(
        "SIM_COST_RATE_NEGATIVE",
        `${path}.slippageBps`,
        "slippageBps 不能为负"
      )
    );
  }
  if (
    typeof c.lotSize === "number" &&
    (!Number.isInteger(c.lotSize) || (c.lotSize as number) <= 0)
  ) {
    issues.push(
      issue("SIM_COST_LOT_INVALID", `${path}.lotSize`, "lotSize 必须是正整数")
    );
  }
  if (typeof c.minCommission === "number" && (c.minCommission as number) < 0) {
    issues.push(
      issue(
        "SIM_COST_FEE_NEGATIVE",
        `${path}.minCommission`,
        "minCommission 不能为负"
      )
    );
  }
  return issues;
}

/** 校验模拟输入配置。 */
export function validateSimulationConfig(
  config: SimulationConfig | undefined | null
): ResearchValidationResult {
  const issues: ResearchValidationIssue[] = [];
  if (config === null || typeof config !== "object") {
    return result([
      issue("SIM_CONFIG_INVALID", "simConfig", "模拟配置缺失或非对象"),
    ]);
  }
  if (config.name !== undefined && typeof config.name !== "string") {
    issues.push(
      issue("SIM_CONFIG_NAME_INVALID", "simConfig.name", "name 必须是字符串")
    );
  }
  if (config.dateRange !== undefined) {
    const range = config.dateRange;
    if (!isValidDate(range.startDate) || !isValidDate(range.endDate)) {
      issues.push(
        issue(
          "SIM_CONFIG_DATE_RANGE_INVALID",
          "simConfig.dateRange",
          "dateRange 必须含合法 startDate/endDate（YYYY-MM-DD）"
        )
      );
    } else if (range.startDate > range.endDate) {
      issues.push(
        issue(
          "SIM_CONFIG_DATE_RANGE_REVERSED",
          "simConfig.dateRange",
          "dateRange.startDate 不能晚于 endDate"
        )
      );
    }
  }
  if (
    typeof config.initialCapital !== "number" ||
    !Number.isFinite(config.initialCapital) ||
    config.initialCapital <= 0
  ) {
    issues.push(
      issue(
        "SIM_CONFIG_CAPITAL_INVALID",
        "simConfig.initialCapital",
        "initialCapital 必须是正有限数字"
      )
    );
  }
  issues.push(...validateCostModel(config.cost, "simConfig.cost"));
  if (
    config.executionModel !== undefined &&
    !EXECUTION_MODEL_IDS.includes(config.executionModel as ExecutionModelId)
  ) {
    issues.push(
      issue(
        "SIM_CONFIG_EXECUTION_MODEL_INVALID",
        "simConfig.executionModel",
        `executionModel 必须是 ${EXECUTION_MODEL_IDS.join(" / ")} 之一`
      )
    );
  }
  if (config.maxPositions !== undefined && config.maxPositions !== null) {
    if (
      typeof config.maxPositions !== "number" ||
      !Number.isInteger(config.maxPositions) ||
      config.maxPositions <= 0
    ) {
      issues.push(
        issue(
          "SIM_CONFIG_MAX_POSITIONS_INVALID",
          "simConfig.maxPositions",
          "maxPositions 必须是正整数或 null"
        )
      );
    }
  }
  if (
    config.directionPolicy !== undefined &&
    config.directionPolicy !== "longOnly"
  ) {
    issues.push(
      issue(
        "SIM_CONFIG_DIRECTION_POLICY_INVALID",
        "simConfig.directionPolicy",
        "directionPolicy 必须是 longOnly"
      )
    );
  }
  if (config.executionRules !== undefined) {
    const rules = config.executionRules;
    if (
      rules.blockLimitUpBuy !== undefined &&
      typeof rules.blockLimitUpBuy !== "boolean"
    ) {
      issues.push(
        issue(
          "SIM_CONFIG_RULE_INVALID",
          "simConfig.executionRules.blockLimitUpBuy",
          "blockLimitUpBuy 必须是布尔"
        )
      );
    }
    if (
      rules.blockLimitDownSell !== undefined &&
      typeof rules.blockLimitDownSell !== "boolean"
    ) {
      issues.push(
        issue(
          "SIM_CONFIG_RULE_INVALID",
          "simConfig.executionRules.blockLimitDownSell",
          "blockLimitDownSell 必须是布尔"
        )
      );
    }
  }
  if (
    config.allowPartialFill !== undefined &&
    typeof config.allowPartialFill !== "boolean"
  ) {
    issues.push(
      issue(
        "SIM_CONFIG_PARTIAL_INVALID",
        "simConfig.allowPartialFill",
        "allowPartialFill 必须是布尔"
      )
    );
  }
  if (config.securityBoards !== undefined) {
    const boards = config.securityBoards;
    if (
      boards === null ||
      typeof boards !== "object" ||
      Array.isArray(boards)
    ) {
      issues.push(
        issue(
          "SIM_CONFIG_BOARDS_INVALID",
          "simConfig.securityBoards",
          "securityBoards 必须是 securityId → board 映射"
        )
      );
    } else {
      for (const [securityId, board] of Object.entries(boards)) {
        if (typeof securityId !== "string" || securityId.trim() === "") {
          issues.push(
            issue(
              "SIM_CONFIG_BOARD_KEY_INVALID",
              "simConfig.securityBoards",
              "securityBoards 键（securityId）不能为空"
            )
          );
        }
        if (!BOARDS.includes(board as SecurityBoard)) {
          issues.push(
            issue(
              "SIM_CONFIG_BOARD_VALUE_INVALID",
              `simConfig.securityBoards.${securityId}`,
              `board 必须是 ${BOARDS.join(" / ")} 之一`
            )
          );
        }
      }
    }
  }
  return result(issues);
}

/** 模拟输入配置非法即抛 ResearchValidationError。 */
export function assertValidSimulationConfig(
  config: SimulationConfig | undefined | null
): void {
  assertValid(validateSimulationConfig(config));
}

// ---------------------------------------------------------------------------
// TradeSimulationRun（反序列化复核用）
// ---------------------------------------------------------------------------

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** 校验结果记录的形态（供 deserialize 复核；不重算统计一致性）。 */
export function validateTradeSimulationRun(
  record: TradeSimulationRun | undefined | null
): ResearchValidationResult {
  const issues: ResearchValidationIssue[] = [];
  if (record === null || typeof record !== "object") {
    return result([issue("RECORD_INVALID", "record", "运行记录缺失或非对象")]);
  }
  if (record.recordKind !== "TRADE_SIMULATION_RUN") {
    issues.push(
      issue(
        "RECORD_KIND_INVALID",
        "record.recordKind",
        "recordKind 必须是 TRADE_SIMULATION_RUN"
      )
    );
  }
  if (record.recordVersion !== 1) {
    issues.push(
      issue(
        "RECORD_VERSION_INVALID",
        "record.recordVersion",
        "recordVersion 必须是 1"
      )
    );
  }
  for (const [field, label] of [
    ["datasetVersion", "datasetVersion"],
    ["builderVersion", "builderVersion"],
    ["rowSchemaVersion", "rowSchemaVersion"],
    ["universeId", "universeId"],
    ["strategyId", "strategyId"],
    ["strategyVersion", "strategyVersion"],
    ["sourceFingerprint", "sourceFingerprint"],
  ] as const) {
    const value = (record as unknown as Record<string, unknown>)[field];
    if (typeof value !== "string" || value.trim() === "") {
      issues.push(
        issue(
          "RECORD_FIELD_EMPTY",
          `record.${field}`,
          `${label} 不能为空字符串`
        )
      );
    }
  }
  if (typeof record.datasetGate !== "string") {
    issues.push(
      issue(
        "RECORD_DATASET_GATE_INVALID",
        "record.datasetGate",
        "datasetGate 必须是字符串"
      )
    );
  }
  if (
    record.parameters === null ||
    typeof record.parameters !== "object" ||
    Array.isArray(record.parameters)
  ) {
    issues.push(
      issue(
        "RECORD_PARAMETERS_INVALID",
        "record.parameters",
        "parameters 必须是参数值对象"
      )
    );
  } else {
    for (const value of Object.values(record.parameters)) {
      const v: unknown = value;
      const isScalar =
        v === null ||
        typeof v === "number" ||
        typeof v === "string" ||
        typeof v === "boolean";
      if (!isScalar)
        issues.push(
          issue(
            "RECORD_PARAMETERS_VALUE_INVALID",
            "record.parameters",
            "参数值不是可序列化原子值"
          )
        );
      if (typeof v === "number" && !Number.isFinite(v))
        issues.push(
          issue(
            "RECORD_PARAMETERS_NAN",
            "record.parameters",
            "参数值禁止 NaN/Infinity"
          )
        );
    }
  }
  const decisionRange = record.decisionDateRange;
  const simRange = record.dateRange;
  if (
    !decisionRange ||
    !isValidDate(decisionRange.startDate) ||
    !isValidDate(decisionRange.endDate) ||
    decisionRange.startDate > decisionRange.endDate
  ) {
    issues.push(
      issue(
        "RECORD_DECISION_RANGE_INVALID",
        "record.decisionDateRange",
        "decisionDateRange 必须含合法且不倒序的日期区间"
      )
    );
  }
  if (
    !simRange ||
    !isValidDate(simRange.startDate) ||
    !isValidDate(simRange.endDate) ||
    simRange.startDate > simRange.endDate
  ) {
    issues.push(
      issue(
        "RECORD_SIM_RANGE_INVALID",
        "record.dateRange",
        "dateRange 必须含合法且不倒序的日期区间"
      )
    );
  }
  if (!isFiniteNumber(record.initialCapital) || record.initialCapital <= 0) {
    issues.push(
      issue(
        "RECORD_CAPITAL_INVALID",
        "record.initialCapital",
        "initialCapital 必须是正有限数字"
      )
    );
  }
  if (!isFiniteNumber(record.finalEquity) || record.finalEquity < 0) {
    issues.push(
      issue(
        "RECORD_FINAL_EQUITY_INVALID",
        "record.finalEquity",
        "finalEquity 必须是非负有限数字"
      )
    );
  }
  if (
    typeof record.decisionDayCount !== "number" ||
    !Number.isInteger(record.decisionDayCount) ||
    record.decisionDayCount <= 0
  ) {
    issues.push(
      issue(
        "RECORD_DECISION_DAY_COUNT_INVALID",
        "record.decisionDayCount",
        "decisionDayCount 必须是正整数（引擎保证至少一个决策日）"
      )
    );
  }

  // config 快照形态。
  const config: SimulationConfigSnapshot | undefined = record.config;
  if (!config || typeof config !== "object") {
    issues.push(
      issue("RECORD_CONFIG_INVALID", "record.config", "config 快照缺失或非对象")
    );
  } else {
    if (
      !config.dateRange ||
      !isValidDate(config.dateRange.startDate) ||
      !isValidDate(config.dateRange.endDate)
    ) {
      issues.push(
        issue(
          "RECORD_CONFIG_RANGE_INVALID",
          "record.config.dateRange",
          "config.dateRange 日期非法"
        )
      );
    }
    if (!isFiniteNumber(config.initialCapital) || config.initialCapital <= 0) {
      issues.push(
        issue(
          "RECORD_CONFIG_CAPITAL_INVALID",
          "record.config.initialCapital",
          "config.initialCapital 非法"
        )
      );
    }
    if (!config.cost || typeof config.cost !== "object") {
      issues.push(
        issue(
          "RECORD_CONFIG_COST_INVALID",
          "record.config.cost",
          "config.cost 缺失"
        )
      );
    } else {
      issues.push(...validateCostModel(config.cost, "record.config.cost"));
    }
    if (
      !EXECUTION_MODEL_IDS.includes(config.executionModel as ExecutionModelId)
    ) {
      issues.push(
        issue(
          "RECORD_CONFIG_EXECUTION_MODEL_INVALID",
          "record.config.executionModel",
          "executionModel 非法"
        )
      );
    }
    if (
      config.maxPositions !== null &&
      (typeof config.maxPositions !== "number" ||
        !Number.isInteger(config.maxPositions) ||
        config.maxPositions <= 0)
    ) {
      issues.push(
        issue(
          "RECORD_CONFIG_MAX_POSITIONS_INVALID",
          "record.config.maxPositions",
          "maxPositions 必须是正整数或 null"
        )
      );
    }
    if (config.directionPolicy !== "longOnly") {
      issues.push(
        issue(
          "RECORD_CONFIG_DIRECTION_POLICY_INVALID",
          "record.config.directionPolicy",
          "directionPolicy 必须是 longOnly"
        )
      );
    }
    const rules = config.executionRules;
    if (
      !rules ||
      typeof rules.blockLimitUpBuy !== "boolean" ||
      typeof rules.blockLimitDownSell !== "boolean"
    ) {
      issues.push(
        issue(
          "RECORD_CONFIG_RULES_INVALID",
          "record.config.executionRules",
          "executionRules 必须含两个布尔开关"
        )
      );
    }
    if (typeof config.allowPartialFill !== "boolean") {
      issues.push(
        issue(
          "RECORD_CONFIG_PARTIAL_INVALID",
          "record.config.allowPartialFill",
          "allowPartialFill 必须是布尔"
        )
      );
    }
    if (
      typeof config.tPlus1 !== "boolean" ||
      typeof config.lotSize !== "number" ||
      !Number.isInteger(config.lotSize) ||
      config.lotSize <= 0
    ) {
      issues.push(
        issue(
          "RECORD_CONFIG_MARKET_INVALID",
          "record.config",
          "tPlus1/lotSize 形态非法"
        )
      );
    }
    if (
      config.decisionPoint !== "close" ||
      config.entryExitModel !== "HOLD_WHILE_SELECTED_LONG_ONLY_CASH_BUDGET" ||
      config.corporateActions !== "NOT_APPLIED"
    ) {
      issues.push(
        issue(
          "RECORD_CONFIG_SEMANTICS_INVALID",
          "record.config",
          "执行假设语义常量与版本不匹配"
        )
      );
    }
  }

  // 权益曲线：日期升序 + 数值有限。
  if (!Array.isArray(record.equityCurve) || record.equityCurve.length === 0) {
    issues.push(
      issue(
        "RECORD_EQUITY_CURVE_EMPTY",
        "record.equityCurve",
        "equityCurve 必须是非空数组"
      )
    );
  } else {
    record.equityCurve.forEach((point, index) => {
      const base = `record.equityCurve[${index}]`;
      if (!point || !isValidDate(point.date))
        issues.push(
          issue(
            "RECORD_EQUITY_POINT_DATE_INVALID",
            `${base}.date`,
            "date 必须是 YYYY-MM-DD"
          )
        );
      for (const field of ["cash", "marketValue", "equity"] as const) {
        if (!isFiniteNumber(point[field]) || point[field] < 0) {
          issues.push(
            issue(
              "RECORD_EQUITY_POINT_NUMERIC_INVALID",
              `${base}.${field}`,
              `${field} 必须是非负有限数字`
            )
          );
        }
      }
      if (!Number.isInteger(point.openPositions) || point.openPositions < 0) {
        issues.push(
          issue(
            "RECORD_EQUITY_POINT_OPEN_INVALID",
            `${base}.openPositions`,
            "openPositions 必须是非负整数"
          )
        );
      }
      if (index > 0 && record.equityCurve[index - 1]!.date >= point.date) {
        issues.push(
          issue(
            "RECORD_EQUITY_CURVE_UNSORTED",
            "record.equityCurve",
            "equityCurve 日期必须严格升序"
          )
        );
      }
    });
  }

  if (!Array.isArray(record.trades)) {
    issues.push(
      issue("RECORD_TRADES_INVALID", "record.trades", "trades 必须是数组")
    );
  } else {
    record.trades.forEach((trade, index) => {
      const base = `record.trades[${index}]`;
      if (!trade || !isValidDate(trade.entryTime))
        issues.push(
          issue(
            "RECORD_TRADE_ENTRY_INVALID",
            `${base}.entryTime`,
            "entryTime 必须是 YYYY-MM-DD"
          )
        );
      if (!isFiniteNumber(trade.quantity) || trade.quantity <= 0)
        issues.push(
          issue(
            "RECORD_TRADE_QUANTITY_INVALID",
            `${base}.quantity`,
            "quantity 必须是正有限数字"
          )
        );
      if (!isFiniteNumber(trade.entryPrice) || trade.entryPrice <= 0)
        issues.push(
          issue(
            "RECORD_TRADE_ENTRY_PRICE_INVALID",
            `${base}.entryPrice`,
            "entryPrice 必须是正有限数字"
          )
        );
      if (typeof trade.openAtEnd !== "boolean")
        issues.push(
          issue(
            "RECORD_TRADE_OPEN_AT_END_INVALID",
            `${base}.openAtEnd`,
            "openAtEnd 必须是布尔"
          )
        );
    });
  }

  if (!Array.isArray(record.positions))
    issues.push(
      issue(
        "RECORD_POSITIONS_INVALID",
        "record.positions",
        "positions 必须是数组"
      )
    );
  const costs = record.costs;
  if (!costs || typeof costs !== "object") {
    issues.push(
      issue("RECORD_COSTS_INVALID", "record.costs", "costs 缺失或非对象")
    );
  } else {
    for (const field of [
      "buyCommission",
      "sellCommission",
      "stampDuty",
      "transferFee",
      "slippage",
      "otherFees",
      "totalFees",
      "totalCost",
    ] as const) {
      if (!isFiniteNumber(costs[field]))
        issues.push(
          issue(
            "RECORD_COSTS_NUMERIC_INVALID",
            `record.costs.${field}`,
            `${field} 必须是有限数字`
          )
        );
    }
  }
  const execStats = record.executionStats;
  if (!execStats || typeof execStats !== "object") {
    issues.push(
      issue(
        "RECORD_EXEC_STATS_INVALID",
        "record.executionStats",
        "executionStats 缺失或非对象"
      )
    );
  } else {
    for (const field of [
      "totalSignals",
      "totalOrders",
      "totalFills",
      "rejectedOrders",
      "partialFills",
    ] as const) {
      const value = execStats[field];
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        issues.push(
          issue(
            "RECORD_EXEC_STATS_COUNT_INVALID",
            `record.executionStats.${field}`,
            `${field} 必须是非负整数`
          )
        );
      }
    }
    if (
      !execStats.byReason ||
      typeof execStats.byReason !== "object" ||
      Array.isArray(execStats.byReason)
    ) {
      issues.push(
        issue(
          "RECORD_EXEC_STATS_BY_REASON_INVALID",
          "record.executionStats.byReason",
          "byReason 必须是对象"
        )
      );
    }
  }
  if (!Array.isArray(record.skipped))
    issues.push(
      issue("RECORD_SKIPPED_INVALID", "record.skipped", "skipped 必须是数组")
    );
  const sides: readonly Side[] = ["buy", "sell"];
  if (Array.isArray(record.skipped)) {
    record.skipped.forEach((entry, index) => {
      const base = `record.skipped[${index}]`;
      if (!entry || !isValidDate(entry.date))
        issues.push(
          issue(
            "RECORD_SKIPPED_DATE_INVALID",
            `${base}.date`,
            "date 必须是 YYYY-MM-DD"
          )
        );
      if (!sides.includes((entry as { side?: Side }).side as Side))
        issues.push(
          issue(
            "RECORD_SKIPPED_SIDE_INVALID",
            `${base}.side`,
            "side 必须是 buy/sell"
          )
        );
      if (
        typeof (entry as { code?: unknown }).code !== "string" ||
        typeof (entry as { reason?: unknown }).reason !== "string"
      ) {
        issues.push(
          issue(
            "RECORD_SKIPPED_SHAPE_INVALID",
            base,
            "code/reason 必须是字符串"
          )
        );
      }
    });
  }
  const audit = record.audit;
  if (
    !audit ||
    typeof audit !== "object" ||
    !Array.isArray(audit.orders) ||
    !Array.isArray(audit.fills) ||
    !Array.isArray(audit.positions)
  ) {
    issues.push(
      issue(
        "RECORD_AUDIT_INVALID",
        "record.audit",
        "audit 必须含 orders/fills/positions 三数组"
      )
    );
  }
  if (
    typeof record.fingerprint !== "string" ||
    record.fingerprint.trim() === ""
  ) {
    issues.push(
      issue(
        "RECORD_FINGERPRINT_INVALID",
        "record.fingerprint",
        "fingerprint 不能为空"
      )
    );
  }
  return result(issues);
}

/** 结果记录非法即抛 ResearchValidationError。 */
export function assertValidTradeSimulationRun(
  record: TradeSimulationRun | undefined | null
): void {
  assertValid(validateTradeSimulationRun(record));
}
