import {
  type ExperimentDefinition,
  type ExperimentRunContext,
} from "@shared/researchExperimentsContracts";
import {
  COMPUTATION_VERSION,
  ENTRY_DAY,
  EXIT_RELATIVE_DAY,
  assembleTwelveFactorComposite,
  twelveFactorCompositeSchema,
} from "./result";
import {
  DECISION_OFFSET_DAYS,
  POST_RELATIVE_DAYS,
  PREFIX_RELATIVE_DAYS,
  deriveTwelveFactorSamples,
} from "./derive";

/**
 * 十二因子等权综合评分（第一版）。
 *
 * 契约：`docs/research/FROZEN-BUCKET-CONTRACT-001.md`（FBC-1~FBC-6）
 * 规格：`docs/research/PLAN-12F-COMPOSITE-001.md`
 *
 * 决策时点 = T+5 收盘（用到 T+1..T+5 的行情，因此入场只能落在 T+6 开盘）。
 *
 * 🔴 样本派生（Pass A~D）已抽到 `./derive.ts` —— 与
 *    `first-board-pullback/twelve-factor-topn-ranking-study` 共用**同一份**实现，
 *    避免「同一份冻结样本被实现两遍、然后静默漂移」。
 */

const PREFIX_DAYS = PREFIX_RELATIVE_DAYS;
const POST_DAYS = POST_RELATIVE_DAYS;

export const twelveFactorCompositeStudyExperiment: ExperimentDefinition = {
  descriptor: {
    id: "first-board-pullback/twelve-factor-composite-study",
    name: "十二因子等权综合评分研究（第一版）",
    version: COMPUTATION_VERSION,
    description:
      "把 12 个已冻结的首板因子按桶位等权（各 1/12）合成为一个综合评分，" +
      "在 T+6 开盘入场、T+10 收盘退出的固定坐标下考察其十分位净收益梯度，" +
      "并与 12 个单因子在同一份样本上的分桶结果横向比较。" +
      "桶边界与方向全部来自 FROZEN-BUCKET-CONTRACT-001，不做权重优化、不重估边界、不做归因。",
    source: "stock-limit-up-analyzer/first-board-pullback",
    tags: [
      "first-board-pullback",
      "composite-score",
      "equal-weight",
      "frozen-buckets",
      "cross-comparison",
      "bootstrap",
    ],
    parameters: [],
    datasetRequirement: {
      datasetCode: "first_limit_pullback",
      requiredColumns: {
        events: [
          "isFirstLimit",
          "boardType",
          "market",
          "previousClose",
          "limitUpPrice",
          "turnover",
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
      prefixRelativeDays: [...PREFIX_DAYS],
      postRelativeDays: POST_DAYS,
      decisionOffsetDays: DECISION_OFFSET_DAYS,
      usesForwardData: true,
      forwardDataPurpose:
        `在 T+${DECISION_OFFSET_DAYS} 收盘确定综合评分后，于 T+${ENTRY_DAY} 开盘入场、` +
        `T+${EXIT_RELATIVE_DAY} 收盘退出，研究综合评分分档与净收益的关系。`,
      eventScanPolicy: "FULL_DATASET",
    },
    pageKey: "first-board-pullback/twelve-factor-composite-study",
    pageTitle: "十二因子等权综合评分研究",
  },
  resultSchema: twelveFactorCompositeSchema,
  run: async (context: ExperimentRunContext) => {
    const derivation = await deriveTwelveFactorSamples(context);
    context.log(
      `候选 ${derivation.candidateCount}；严格涨停 ${derivation.exactLimitUpCloseCount}；` +
        `12 因子完备用例 ${derivation.samples.length}；` +
        `前置窗口缺失 ${derivation.prefixWindowMissingCount}`
    );
    return assembleTwelveFactorComposite({ ...derivation });
  },
};

export default twelveFactorCompositeStudyExperiment;
