/**
 * SINGLE_FACTOR_EXPERIMENT_V1 —— **单因子研究通用模板（模板实例）**。
 *
 * ## 这个实验回答什么
 *
 * 「把某一个因子当成**每日横截面排序键**，取头部（HIGH）或尾部（LOW）的 N 名，
 *  相对当日全部候选有没有超额？」
 *
 * ## 为什么是「一个实验 + 一个因子参数」而不是「12 个实验」
 *
 * 需求是「后续 12 个现有因子及新增因子**全部复用该模板**，不再为单个因子单独开发
 * 实验逻辑」。因此本实验的 `run()` 只有四步（下面代码里 ①②③④），
 * **换因子只是换参数**：
 *
 * ```ts
 * // 跑 turnover 因子
 * run({ parameters: { factorCode: "turnover" } })
 * // 跑 holdStreak 因子 —— 同一段代码，零改动
 * run({ parameters: { factorCode: "holdStreak" } })
 * ```
 *
 * ## 冻结口径（本文件只做声明，实现在 `@experiments/shared/singleFactor/**`）
 *
 * ```
 * experimentType = SINGLE_FACTOR          Universe = 首板回踩候选池
 * T              = 首板日（rd=0）          Observation = T+1 ~ T+5（观察窗，非买入窗）
 * Entry          = T+6 开盘                Exit = T+10 收盘（不可卖顺延，≤ T+20）
 * Position       = 全仓等权                 Cost = 往返 20 bps
 * Ranking        = HIGH / LOW（两方向都跑）  TopN = 3 / 5 / 10 / 20（四档都跑）
 * Benchmark      = 当日全部符合条件的候选股票（等权）
 * ```
 *
 * 🔴 入场/退出/成本与 `FROZEN-BUCKET-CONTRACT-001` 冻结坐标**逐字一致**
 *    （由 `assertTemplateCoordinate()` 在每次 Run 开头断言），因此本实验的数字与
 *    `twelve-factor-composite-study` / `twelve-factor-topn-ranking-study` **逐笔可比**。
 *
 * 🔴 因子定义 / 桶边界 / 方向**零改动**：全部 import 自
 *    `twelve-factor-composite-study/result.ts`（冻结契约的唯一落地处）。
 *
 * ## 刻意不做
 *
 * - ❌ 不做组合因子（每个 Run 只允许一个因子，结构上无法传入第二个）；
 * - ❌ 不做 Parameter Search（`factorCode` 之外无任何可调参数，方向与 TopN 是静态常量）；
 * - ❌ 不做策略开发（不产 StrategyDefinition、不写 strategy 表）；
 * - ❌ 不做 OOS / Holdout（`researchPhase = EXPLORATORY`）；
 * - ❌ 不按「跑完再看哪个组合最好」输出（8 个组合**全部**落进结果）。
 */

import {
  type ExperimentDefinition,
  type ExperimentRunContext,
} from "@shared/researchExperimentsContracts";
import {
  DEFAULT_FACTOR_CODE,
  COMPUTATION_VERSION,
  SINGLE_FACTOR_CATALOG_CODES,
  assembleSingleFactorResult,
  resolveSingleFactor,
  singleFactorSchema,
} from "./result";
import {
  assertTemplateCoordinate,
  ENTRY_DAY,
  EXIT_RELATIVE_DAY,
  MAX_RELATIVE_DAY,
  ROUND_TRIP_COST_BPS,
} from "@experiments/shared/singleFactor/coordinate";
import {
  PIT_INFORMATION_CUTOFF_RELATIVE_DAY,
  RANKING_DIRECTIONS,
  SINGLE_FACTOR_COMBOS,
  SINGLE_FACTOR_DATASET_CODE,
  SINGLE_FACTOR_DATASET_VERSION_LABEL,
  TOP_N_SIZES,
} from "@experiments/shared/singleFactor/types";
import {
  UNIVERSE_POLICY_DISCLOSURE,
  resolveSingleFactorUniverse,
} from "@experiments/shared/singleFactor/universe";

const EXPERIMENT_ID = "first-board-pullback/single-factor-v1";

/** 12F 的 `derive.ts` 需要的前置窗口（`T-1` 与 `T-10` 的收盘价）。 */
const PREFIX_RELATIVE_DAYS = [-10, -1] as const;
const POST_RELATIVE_DAYS = Array.from(
  { length: MAX_RELATIVE_DAY },
  (_, index) => index + 1
);

export const singleFactorV1Experiment: ExperimentDefinition = {
  descriptor: {
    id: EXPERIMENT_ID,
    name: "单因子研究通用模板 V1（SINGLE_FACTOR_EXPERIMENT_V1）",
    version: COMPUTATION_VERSION,
    description:
      "单因子研究的**通用模板**：选一个因子 → 在每个决策日（首板日 T，信息截止 T+5 收盘）按该因子的" +
      "**原始值**做横截面排序 → HIGH（取最大 N 个）/ LOW（取最小 N 个）两方向 × TopN 3/5/10/20 共 8 个" +
      `**预定义组合**全部跑出 → T+${ENTRY_DAY} 开盘等权买入、T+${EXIT_RELATIVE_DAY} 收盘卖出` +
      `（不可卖顺延，≤ T+${MAX_RELATIVE_DAY}），往返成本 ${ROUND_TRIP_COST_BPS} bps → ` +
      "与**当日全部候选**（等权）做配对日度超额比较。" +
      "输出：实验定义 / 整体结果 / TopN 结果 / 基准结果 / 超额 / 年切片 / 逐笔明细（全量 CSV 产物）。" +
      "12 个现有因子与新增因子全部复用本模板，换因子只改参数。" +
      "不做组合因子、不做参数搜索、不做策略、不做事后择优；因子定义与冻结分桶零改动。",
    source: "stock-limit-up-analyzer/first-board-pullback",
    tags: [
      "first-board-pullback",
      "single-factor",
      "template",
      "cross-section-selection",
      "top-n-ranking",
      "frozen-buckets",
      "equal-weight",
    ],
    /**
     * 唯一参数：因子。
     *
     * 🔴 **方向（HIGH/LOW）与 TopN（3/5/10/20）刻意不是参数** ——
     *    它们是模板里的静态常量，一次 Run 把 8 个组合全部输出。
     *    若把它们做成参数，「跑 8 次再挑最好的那次」就变成了可操作动作，
     *    而那正是需求里明令禁止的事后择优。
     */
    parameters: [
      {
        code: "factorCode",
        label: "因子",
        description:
          "只允许一个因子（这是单因子实验的定义）。取值来自冻结因子目录；" +
          "排名一律使用该因子的**原始值**，不使用桶位分。",
        kind: "ENUM",
        required: false,
        defaultValue: DEFAULT_FACTOR_CODE,
        allowedValues: [...SINGLE_FACTOR_CATALOG_CODES],
      },
    ],
    datasetRequirement: {
      datasetCode: SINGLE_FACTOR_DATASET_CODE,
      requiredDatasetVersionLabel: SINGLE_FACTOR_DATASET_VERSION_LABEL,
      requiredColumns: {
        events: [
          "isFirstLimit",
          "boardType",
          "market",
          "previousClose",
          "limitUpPrice",
          "turnover",
          "floatMarketCap",
          "historicalLimitCount",
          "daysSincePreviousLimit",
        ],
        feature: ["open", "high", "low", "close", "volume", "amount"],
        observation: [
          "open",
          "high",
          "low",
          "close",
          "volume",
          "limitUpPrice",
          "barPresent",
          "suspensionStatus",
          "canBuyAtOpen",
          "canSellAtClose",
        ],
      },
      prefixRelativeDays: [...PREFIX_RELATIVE_DAYS],
      postRelativeDays: POST_RELATIVE_DAYS,
      // 样本资格的信息边界：只允许用 rd ∈ [1, 5] 判定入池（= 观察窗）。
      decisionOffsetDays: PIT_INFORMATION_CUTOFF_RELATIVE_DAY,
      usesForwardData: true,
      forwardDataPurpose:
        `在 T+${PIT_INFORMATION_CUTOFF_RELATIVE_DAY} 收盘确定因子值与排名，` +
        `于 T+${ENTRY_DAY} 开盘等权买入、T+${EXIT_RELATIVE_DAY} 收盘卖出` +
        `（不可卖顺延，≤ T+${MAX_RELATIVE_DAY}），研究「按该因子取头部/尾部相对当日全部候选是否有超额」。` +
        "同一份未来数据序列同时供公共底座（首板回撤面板）复用。",
      eventScanPolicy: "FULL_DATASET",
    },
    pageKey: EXPERIMENT_ID,
    pageTitle: "单因子研究通用模板 V1",
  },
  resultSchema: singleFactorSchema,
  run: async (context: ExperimentRunContext) => {
    // ① 模板坐标不变量（ENTRY=信息截止+1 / EXIT=持有日推导 / 成本=冻结往返成本）
    assertTemplateCoordinate();

    // ② 因子解析（未登记即响亮失败；只允许一个因子）
    const factorCode = String(context.parameters.factorCode ?? DEFAULT_FACTOR_CODE);
    const factor = resolveSingleFactor(factorCode);
    context.log(
      `模板 SINGLE_FACTOR_EXPERIMENT_V1 · 因子 ${factor.code}（${factor.label}）；` +
        `方向 ${RANKING_DIRECTIONS.join("/")} × TopN ${TOP_N_SIZES.join("/")} = ` +
        `${SINGLE_FACTOR_COMBOS.length} 个预定义组合`
    );
    context.log(`Universe 口径：${UNIVERSE_POLICY_DISCLOSURE}`);

    // ③ 候选池解析（复用公共底座 derive + PIT 视图 + 逐笔对拍）
    const universe = await resolveSingleFactorUniverse(context, factor);
    context.log(
      `候选 ${universe.candidateCount}；公共底座入池 ${universe.eligibleCountBeforeFactorFilter}；` +
        `因子可评估 ${universe.samples.length}；因子不可评估被剔 ${universe.factorValueMissingCount}；` +
        `未扫描 ${universe.unscannedEventCount ?? "未知"}；重复 eventId ${universe.duplicateEventIdCount}`
    );

    // ④ 结构化结果装配（10 张表 + statistics + charts + 全量逐笔 CSV 产物）
    const payload = assembleSingleFactorResult({
      factor,
      universe,
      emitArtifact: spec => context.artifact(spec),
    });
    context.log(
      `装配完成：组合 ${SINGLE_FACTOR_COMBOS.length} 个；表 ${payload.tables?.length ?? 0} 张；` +
        `统计 ${payload.statistics?.length ?? 0} 条；图 ${payload.charts?.length ?? 0} 张`
    );
    return payload;
  },
};

export default singleFactorV1Experiment;
