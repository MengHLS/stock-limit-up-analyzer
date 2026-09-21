/**
 * STRATEGY-RESEARCH-BRIDGE-001 —— **首条真实策略** `first-board-pullback@1.0.0` 的草稿与证据引用。
 *
 * ## 这个文件是什么 / 不是什么
 *
 * ✅ 是：一次**人的策略设计决策**的完整、可版本化表达 —— 研究来源（`evidences`）+ 交易规则（`draft`）
 *    + 每个取值的**来源登记表**（`DECISION_LEDGER`：FIXED / TUNABLE / DERIVED × 研究 / 设计）。
 * ❌ 不是：从研究结果**自动推导**出的规则。规格 §0 明令「不要为了完成任务而强行自动推导交易规则」，
 *    规格 §3 明令「研究结果不得自动变成交易规则」。
 *
 * ## 为什么必须是**同一个模块**给测试与 E2E 用
 *
 * 若测试里另写一份「等价草稿」，就会出现「测试绿的那份草稿」与「真机跑的那份草稿」不是同一个对象 ——
 * 这正是本仓反复踩过的「判据与事实分叉」。因此此处是**唯一**来源：
 *   - 单测（`tests/server/research/strategyCandidate/firstBoardPullbackStrategy.test.ts`）读它；
 *   - 真机 E2E（`docs/evidence/_e2e_srb001_*.mts`）读它。
 *
 * ## 研究给了什么 / 没给什么（逐条可核）
 *
 * EXP-001（`first-board-pullback/fundamental-study`，Run `RUN-20260921-8557F38A`）：
 *   - 事件 = **首板**（`isFirstLimit`），数据集 `first_limit_pullback` 的事件定义；
 *   - **信息边界**：`decisionOffsetDays = 5` ⇒ 任何「截至某观察日」的判定只用 `rd ∈ [1, 5]`；
 *   - 观察口径：`回踩` = 当日最低价 < 首板日收盘价；`破位` = 当日最低价 < 首板日开盘价；
 *   - 回撤深度**观察桶**（0 / -200 / -500 / -800 / -1000 bps）—— 实验自述「这是观察口径而非寻优参数」。
 *
 * EXP-002（`first-board-pullback/stability-validation`，Run `RUN-20260921-C95B1D47`）：
 *   - 换 16 组同样合理的条件重算，逐变体判定 `stable / sensitive / insufficient`；
 *   - 它只回答「结论稳不稳」，**不回答**「哪一组条件更好」。
 *
 * 🔴 **研究没有给出**（因此下列取值在 `DECISION_LEDGER` 里一律登记为 `DESIGN`）：
 *    入场时点（`NEXT_OPEN`）、成交价类型、滑点 / 手续费 / 印花税 / 过户费率、单笔仓位、
 *    最大持仓数、止损 / 止盈 / 最大持有天数、初始资金、回踩深度阈值、缩量阈值。
 *    研究是**事后描述性研究**，其 `forwardDataPurpose` 自述「不是可交易决策；不产出信号、参数、候选或策略结论」。
 *
 * ## 为什么阈值参数留 `TUNABLE` 而不是写死一个「研究最优值」
 *
 * 规格 §17 明令**严禁自动择优**。研究只给了回撤深度的**观察桶**（`[-0, -200bps, …]`）与
 * 「不破 / 破开盘价」的**分类**，没有任何一处说「哪个更优」。因此：
 *   - 唯一的正确做法是把阈值表达成**待搜索参数**（`TUNABLE`），让 Parameter Search 去证伪 / 取证；
 *   - 缺省值取一个**中性的、可解释的**边界（`maxBreakDepthRatio = 0` = 恰好「不破开盘价」，
 *     与 EXP-001 的 `NON_BREAK_OPEN` 分类**同名同义**），而不是某个"看起来好"的值。
 */

import type { ExperimentStrategyDraft } from "./strategyBridge";
import type { ResearchEvidenceRef } from "../research/strategyCandidate/researchEvidence";

/** 策略 id（`strategies.strategyId`）；`@/` 命名空间留给别的来源体系。 */
export const FIRST_BOARD_PULLBACK_STRATEGY_ID = "first-board-pullback";

export const FIRST_BOARD_PULLBACK_STRATEGY_NAME = "首板回踩（不破首板日开盘价 + 缩量）";

export const FIRST_BOARD_PULLBACK_STRATEGY_DESCRIPTION =
  "首板事件后 T+1…T+5 观察窗口内，出现「未跌破首板日开盘价」且成交量不超过事件日一定倍数的 K 线时，"
  + "收盘出信号、次一交易日开盘买入；持有至止盈 / 止损 / 时间出场之一成立。"
  + "研究来源为 EXP-001（第一性研究）与 EXP-002（条件稳定性验证），"
  + "两者均为**事后描述性研究**；买入时点 / 费用 / 仓位 / 出场阈值属策略设计决策，不来自研究。";

// ---------------------------------------------------------------------------
// 研究证据（每条都指向**真实持久化 Run** 的**真实字段**）
// ---------------------------------------------------------------------------
//
// 🔴 `reference` 会被 `resolveEvidenceReference` 在**该 Run 的真实结果信封**里解析一遍
//    （规格 §12：不得虚构 artifact）。因此这里每一条都是先跑
//    `docs/evidence/_probe_srb001_result_paths.mts` 从落盘结果里**现查**出来的路径。
//
// 🔴 `evidenceKind` 只描述「引用了运行的哪一部分」，**不含**任何评价性取值（规格 §17）。

export const FIRST_BOARD_PULLBACK_EVIDENCES: readonly ResearchEvidenceRef[] = Object.freeze([
  {
    runId: "RUN-20260921-8557F38A",
    evidenceKind: "RESULT_SUMMARY",
    reference: "customPayload.metrics.pullbackRateOnFinalDay",
    description: "EXP-001：观察窗口末日的回踩率（回踩 = 当日最低价 < 首板日收盘价）",
  },
  {
    runId: "RUN-20260921-8557F38A",
    evidenceKind: "SAMPLE_ACCOUNTING",
    reference: "customPayload.candidates.unscannedEventCount",
    description: "EXP-001：全量扫描账目缺口（声明 23978 个事件，未被扫描的必须为 0）",
  },
  {
    runId: "RUN-20260921-8557F38A",
    evidenceKind: "RESULT_SUMMARY",
    reference: "customPayload.informationBoundary.decisionOffsetDays",
    description: "EXP-001：信息边界 = 决策偏移天数（本策略观察窗口上界 5 的**唯一**研究依据）",
  },
  {
    runId: "RUN-20260921-C95B1D47",
    evidenceKind: "STABILITY_VERDICT",
    reference: "customPayload.overallVerdict",
    description: "EXP-002：换 16 组条件重算后的总体稳定性判定（只作来源事实，不解释成「最优」）",
  },
  {
    runId: "RUN-20260921-A95F5B48",
    evidenceKind: "SAMPLE_ACCOUNTING",
    reference: "customPayload.counts.stableCount",
    description: "EXP-002：逐变体稳定计数（第二次独立运行，与上一次的 robustness 指纹相同）",
  },
]);

// ---------------------------------------------------------------------------
// 草稿（人写的交易规则）
// ---------------------------------------------------------------------------

/** 观察窗口上界 = EXP-001 的 `decisionOffsetDays`（研究已证边界内的**包含式**上界，非 `rd < 5`）。 */
export const FIRST_BOARD_PULLBACK_OBSERVATION_WINDOW_END = 5;

/** 观察窗口下界 = T+1（事件日 T+0 的行情属 `prefix` 层，只作基准价，不作为信号 bar）。 */
export const FIRST_BOARD_PULLBACK_OBSERVATION_WINDOW_START = 1;

/**
 * 待搜索参数空间（**独立常量**，先于草稿声明）。
 *
 * 为什么不能直接内联进草稿字面量：草稿的 `notes` 要引用「自然组合数」，
 * 而组合数要从参数空间算 —— 在草稿自己的初始化器里读草稿会撞 TDZ。
 */
export const FIRST_BOARD_PULLBACK_PARAMETER_SPACE: Readonly<Record<string, Record<string, unknown>>> =
  Object.freeze({
    /**
     * 允许的「跌破首板日开盘价」深度（正数 = 跌破）。
     *
     * 🔴 网格边界取自 EXP-001 的 `drawdownBucketEdgesBps`（= `[0, -200, -500, -800, -1000]` bps）
     *    —— 那是实验**观察桶**的边界，不是寻优结果。用它当搜索网格，是为了让「搜到的东西」
     *    与「研究真正观察过的粒度」对齐（不发明研究没看过的分辨率）。
     *    取 0 值 = 恰好「不破开盘价」，与 EXP-001 的 `NON_BREAK_OPEN` 分类**同名同义**。
     */
    maxBreakDepthRatio: {
      type: "number",
      parameterRole: "TUNABLE",
      min: 0,
      max: 0.1,
      step: 0.01,
      defaultValue: 0,
    },
    /**
     * 缩量倍数上限（当日成交量 / 事件日成交量）。
     *
     * 网格 = `[0.5, 1.0, 1.5, 2.0]`：1.0 是「不超过事件日量」这个中性边界，
     * 两侧各取一个粗档。**没有任何研究结论**说哪一个更好 —— 阈值必须由搜索取证。
     */
    maxVolumeRatio: {
      type: "number",
      parameterRole: "TUNABLE",
      min: 0.5,
      max: 2,
      step: 0.5,
      defaultValue: 1,
    },
  });

/** 参数空间的**自然网格组合数**（`∏ ((max−min)/step + 1)`；供 E2E 与报告**现算**）。 */
export function firstBoardPullbackGridCombinationCount(): number {
  let total = 1;
  for (const spec of Object.values(FIRST_BOARD_PULLBACK_PARAMETER_SPACE)) {
    const min = Number(spec.min);
    const max = Number(spec.max);
    const step = Number(spec.step);
    if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(step) || step <= 0) {
      throw new Error("参数空间声明缺少可用的 min/max/step，无法计算组合数");
    }
    total *= Math.floor((max - min) / step + 1e-9) + 1;
  }
  return total;
}

export const FIRST_BOARD_PULLBACK_DRAFT: ExperimentStrategyDraft = Object.freeze({
  entryRule: {
    /** 研究侧事实：数据集 `first_limit_pullback` 的事件定义就是首板（`isFirstLimit`）。 */
    event: "FIRST_LIMIT_UP",
    /** 设计决策：收盘出信号 → 次一交易日开盘成交（A 股 T+1 最常用口径）。研究未指定。 */
    timing: "NEXT_OPEN",
    extra: {
      observationWindow: {
        start: FIRST_BOARD_PULLBACK_OBSERVATION_WINDOW_START,
        end: FIRST_BOARD_PULLBACK_OBSERVATION_WINDOW_END,
        unit: "TRADING_DAY",
      },
      /** 设计决策：观察窗口内**第一个**满足条件的 bar 触发。 */
      trigger: "FIRST_VALID_DAY",
      execution: {
        /** 设计决策：按目标权重下单。 */
        quantityMethod: "TARGET_WEIGHT",
        /** 设计决策：A 股一手 = 100 股。 */
        lotSize: 100,
        slippageModel: "BPS",
        commissionModel: "BPS",
        executionConstraints: [
          "一字板（开盘即涨停，买不到）不成交",
          "停牌顺延至下一交易日",
        ],
      },
      position: {
        /** 设计决策：固定比例仓位。 */
        sizingMethod: "FIXED_RATIO",
        positionRatio: 0.2,
        maxExposure: 0.8,
      },
      risk: {
        stopLoss: 0.08,
        maxExposure: 0.8,
        maxDrawdown: 0.25,
      },
      document: {
        backtestConfig: { initialCapital: 1_000_000, maxPositions: 5 },
        costModel: {
          commissionRate: 0.00025,
          stampDutyRate: 0.0005,
          transferFeeRate: 0.00001,
          slippageBps: 5,
          lotSize: 100,
          minCommission: 5,
        },
      },
    },
  },
  /**
   * 执行侧筛选条件（两条，AND）。
   *
   * 🔴 两条右值**都是参数引用**（不是常量）—— 这不是为了好看：规格 §14 要求本版策略能被
   *    Parameter Search 真正消费，而参数搜索对「规则图从未引用」的 TUNABLE 参数会**响亮拒绝**
   *    （`PARAMETER_SEARCH_NO_REFERENCED_TUNABLE_PARAMETER`）。把阈值写成参数引用，
   *    「声明了待搜索」与「真的会被搜索」才是同一件事。
   *
   * ⚠️ 字段口径与 EXP-001 的**同名同义**（`strategySchema/definition.ts` 的派生字段表自述）：
   *    `bar.haircutFromEventLow` = (事件日开盘价 − 当日最低价) / 事件日开盘价，**正数 = 跌破**；
   *    `bar.volumeRatio` = 当日成交量 / 事件日成交量（< 1 为缩量）。
   */
  filterRule: {
    groups: [
      {
        groupNo: 0,
        groupLogicalOperator: "AND",
        conditions: [
          {
            groupNo: 0,
            sortOrder: 0,
            fieldName: "bar.haircutFromEventLow",
            operator: "<=",
            value: "maxBreakDepthRatio",
            logicalOperator: "AND",
            groupLogicalOperator: "AND",
            note: "未跌破首板日开盘价（阈值 0 = 与 EXP-001 的 NON_BREAK_OPEN 分类同义）",
          },
          {
            groupNo: 0,
            sortOrder: 1,
            fieldName: "bar.volumeRatio",
            operator: "<=",
            value: "maxVolumeRatio",
            logicalOperator: "AND",
            groupLogicalOperator: "AND",
            note: "缩量：当日成交量不超过事件日成交量的指定倍数",
          },
        ],
      },
    ],
  },
  parameterSpace: FIRST_BOARD_PULLBACK_PARAMETER_SPACE,
  exitRule: {
    /** 设计决策（研究未给出持有期）。 */
    holdingDays: 3,
    takeProfit: 0.15,
    stopLoss: 0.08,
  },
  riskRule: {
    maxPositions: 5,
    maxPositionWeight: 0.3,
  },
  notes: [
    "本策略的**研究来源**是独立实验 EXP-001 / EXP-002（均为事后描述性研究），"
      + "它们不产出信号、参数、候选或策略结论。",
    "观察窗口 rd ∈ [1, 5] 的上界 5 来自 EXP-001 的信息边界（decisionOffsetDays = 5），"
      + "是**包含式**上界（T+5 当天算在内），不是 rd < 5。",
    "两个阈值参数（maxBreakDepthRatio / maxVolumeRatio）刻意留为 TUNABLE："
      + "研究只给观察口径与稳定性判定，没有给出「哪个阈值更优」；"
      + "阈值属策略设计决策，须由 Parameter Search 取证。",
    "搜索网格刻意取**粗档**（回踩深度按 1% 步长、缩量按 0.5 倍步长），"
      + "使自然组合数为 "
      + `${String(firstBoardPullbackGridCombinationCount())} 组 —— `
      + "低于持久化搜索的缺省上限 256，因此本版策略**无需放宽任何上限**即可被参数搜索消费。",
    "仓位 / 费用 / 出场阈值 / 入场时点均为策略设计决策，不来自 EXP-001 / EXP-002。",
  ],
});

// ---------------------------------------------------------------------------
// 取值来源登记表（报告**从这里现算**，避免报告与代码分叉）
// ---------------------------------------------------------------------------

/** 参数角色（与 `strategySchema#STRATEGY_PARAMETER_ROLES` 同词表）。 */
export type DraftValueRole = "FIXED" | "TUNABLE" | "DERIVED";

/** 取值的**来源类别**：研究（可追溯到 Run）还是策略设计决策。 */
export type DraftValueOrigin = "RESEARCH" | "DESIGN";

export interface DraftDecisionEntry {
  /** 该取值在草稿里的位置（点分路径）。 */
  readonly field: string;
  readonly value: number | string | readonly string[];
  readonly role: DraftValueRole;
  readonly origin: DraftValueOrigin;
  readonly note: string;
}

/**
 * 逐值登记：**每一个**进入 StrategyDefinition 的取值在这一行里都能查到
 * 「它是固定的 / 待搜索的 / 派生的」以及「它来自研究还是来自设计」。
 *
 * 🔴 这张表的存在理由就是规格 §8 的那句话：「若是创建 StrategyVersion 的硬性要求，
 *    必须在报告中明确记录该值属于策略设计决策，不来自 EXP-001/EXP-002」——
 *    与其在报告里手抄一遍（迟早与代码分叉），不如让它成为**可被 E2E 现算**的数据。
 */
export const FIRST_BOARD_PULLBACK_DECISION_LEDGER: readonly DraftDecisionEntry[] = Object.freeze([
  {
    field: "entryRule.event",
    value: "FIRST_LIMIT_UP",
    role: "FIXED",
    origin: "RESEARCH",
    note: "数据集 first_limit_pullback 的事件定义即首板（isFirstLimit），EXP-001 据此取样",
  },
  {
    field: "entryRule.extra.observationWindow",
    value: "[1, 5] TRADING_DAY",
    role: "FIXED",
    origin: "RESEARCH",
    note: "上界 5 = EXP-001 的 decisionOffsetDays（信息边界）；下界 1 = 信号 bar 不取事件日本身",
  },
  {
    field: "entryRule.timing",
    value: "NEXT_OPEN",
    role: "FIXED",
    origin: "DESIGN",
    note: "研究为事后描述性研究，不产出可交易决策；入场时点由策略设计决定",
  },
  {
    field: "entryRule.extra.trigger",
    value: "FIRST_VALID_DAY",
    role: "FIXED",
    origin: "DESIGN",
    note: "窗口内首个满足条件的 bar 触发 —— 研究未讨论触发时点",
  },
  {
    field: "entryRule.extra.execution.quantityMethod",
    value: "TARGET_WEIGHT",
    role: "FIXED",
    origin: "DESIGN",
    note: "下单数量语义由策略设计决定",
  },
  {
    field: "entryRule.extra.execution.lotSize",
    value: 100,
    role: "FIXED",
    origin: "DESIGN",
    note: "A 股一手 100 股（市场规则，非研究结论）",
  },
  {
    field: "entryRule.extra.position.sizingMethod",
    value: "FIXED_RATIO",
    role: "FIXED",
    origin: "DESIGN",
    note: "仓位方法由策略设计决定",
  },
  {
    field: "entryRule.extra.position.positionRatio",
    value: 0.2,
    role: "FIXED",
    origin: "DESIGN",
    note: "单笔目标权重 20% —— 研究未涉及资金管理",
  },
  {
    field: "entryRule.extra.risk.maxDrawdown",
    value: 0.25,
    role: "FIXED",
    origin: "DESIGN",
    note: "组合最大回撤闸门 —— 研究未涉及",
  },
  {
    field: "entryRule.extra.document.backtestConfig.initialCapital",
    value: 1_000_000,
    role: "FIXED",
    origin: "DESIGN",
    note: "回测初始资金 —— 研究未涉及资金规模",
  },
  {
    field: "entryRule.extra.document.costModel",
    value: ["commissionRate", "stampDutyRate", "transferFeeRate", "slippageBps", "lotSize", "minCommission"],
    role: "FIXED",
    origin: "DESIGN",
    note: "费用 / 滑点模型 —— 研究未涉及交易成本",
  },
  {
    field: "filterRule.groups[0].conditions[0].value",
    value: "maxBreakDepthRatio",
    role: "TUNABLE",
    origin: "DESIGN",
    note: "「不破首板日开盘价」的口径来自 EXP-001 的 NON_BREAK_OPEN 分类；"
      + "**阈值**留给搜索（研究只给观察桶边界 [0,200,500,800,1000] bps，未说哪个更优）"
      + "；网格边界对齐该观察粒度、缺省 0 = 恰好不破，属设计决策",
  },
  {
    field: "filterRule.groups[0].conditions[1].value",
    value: "maxVolumeRatio",
    role: "TUNABLE",
    origin: "DESIGN",
    note: "缩量倍数阈值由参数搜索取证；研究未给出缩量口径，网格 [0.5,1,1.5,2] 属设计决策",
  },
  {
    field: "exitRule.holdingDays",
    value: 3,
    role: "FIXED",
    origin: "DESIGN",
    note: "最大持有天数 —— 研究未给出出场规则",
  },
  {
    field: "exitRule.takeProfit",
    value: 0.15,
    role: "FIXED",
    origin: "DESIGN",
    note: "止盈阈值 —— 研究未给出",
  },
  {
    field: "exitRule.stopLoss",
    value: 0.08,
    role: "FIXED",
    origin: "DESIGN",
    note: "止损阈值 —— 研究未给出",
  },
  {
    field: "riskRule.maxPositions",
    value: 5,
    role: "FIXED",
    origin: "DESIGN",
    note: "最大持仓数 —— 研究未涉及",
  },
  {
    field: "riskRule.maxPositionWeight",
    value: 0.3,
    role: "FIXED",
    origin: "DESIGN",
    note: "单标的仓位上限 —— 研究未涉及",
  },
]);

/**
 * 计算登记表的**分类计数**（供报告与自检使用）。
 *
 * 🔴 刻意不写死在报告里：报告要引用这些数字，就必须**现算**，
 *    这样「登记表改了而报告没改」会立刻暴露（本仓纪律：数字必须从落盘/代码现算）。
 */
export function summarizeDecisionLedger(
  ledger: readonly DraftDecisionEntry[] = FIRST_BOARD_PULLBACK_DECISION_LEDGER,
): {
  readonly total: number;
  readonly byRole: Record<DraftValueRole, number>;
  readonly byOrigin: Record<DraftValueOrigin, number>;
  readonly researchBackedFields: readonly string[];
  readonly designOnlyFields: readonly string[];
} {
  const byRole: Record<DraftValueRole, number> = { FIXED: 0, TUNABLE: 0, DERIVED: 0 };
  const byOrigin: Record<DraftValueOrigin, number> = { RESEARCH: 0, DESIGN: 0 };
  const researchBacked: string[] = [];
  const designOnly: string[] = [];
  for (const entry of ledger) {
    byRole[entry.role] += 1;
    byOrigin[entry.origin] += 1;
    if (entry.origin === "RESEARCH") researchBacked.push(entry.field);
    else designOnly.push(entry.field);
  }
  return {
    total: ledger.length,
    byRole,
    byOrigin,
    researchBackedFields: researchBacked,
    designOnlyFields: designOnly,
  };
}
