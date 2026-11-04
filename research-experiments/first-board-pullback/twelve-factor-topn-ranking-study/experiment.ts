import {
  type ExperimentDefinition,
  type ExperimentRunContext,
} from "@shared/researchExperimentsContracts";
import { COMPUTATION_VERSION, assembleTopNRanking, topNRankingSchema } from "./result";
import {
  DECISION_OFFSET_DAYS,
  POST_RELATIVE_DAYS,
  PREFIX_RELATIVE_DAYS,
  deriveTwelveFactorSamples,
} from "../twelve-factor-composite-study/derive";
import { ENTRY_DAY, EXIT_RELATIVE_DAY } from "../twelve-factor-composite-study/result";
import { DEEP_DAY_MIN_SIZE } from "./result";

/**
 * 十二因子综合评分的 **Top-N 排名可用性**研究。
 *
 * 回答的问题（只有一个）：「这个评分到底能不能帮助我每天从首板股票里挑出前几名？」
 *
 * 与 `twelve-factor-composite-study`（等权综合评分）的关系：
 *
 * - 那个实验问的是「评分分档与净收益有没有梯度」——**全样本分档**；
 * - 本实验问的是「**同一天内**按评分排前 N 名，相对当日全部候选有没有优势」——**横截面取头**。
 *
 * 两者不等价：一个评分可以有漂亮的单调分档、却在 Top-N 上毫无优势。
 *
 * 🔴 因子 / 桶 / 方向 / 权重**零改动**：全部 import 自
 *    `twelve-factor-composite-study/result`（FROZEN-BUCKET-CONTRACT-001 的唯一落地处）；
 *    样本派生与其共用 `twelve-factor-composite-study/derive.ts` 同一实现。
 */

const PREFIX_DAYS = PREFIX_RELATIVE_DAYS;
const POST_DAYS = POST_RELATIVE_DAYS;

export const twelveFactorTopNRankingStudyExperiment: ExperimentDefinition = {
  descriptor: {
    id: "first-board-pullback/twelve-factor-topn-ranking-study",
    name: "十二因子综合评分 · Top-N 排名可用性研究（第一版）",
    version: COMPUTATION_VERSION,
    description:
      "把十二因子等权综合评分当作**每日横截面排序键**：在每个决策日（首板日 T，信息截止 T+5 收盘）" +
      `按评分降序取前 N 名（N = 1/2/3/5/10 以及当日样本的 20%），T+6 开盘等权买入、T+10 收盘卖出（20 bps 往返成本），` +
      "与**同一天全部可用样本**的等权均值做配对比较。" +
      "主判据 = 日度超额（Top-N 均值 − 当日池均值）的日期聚类 Moving-Block Bootstrap 95% 区间。" +
      "同时给出随机 N 基准、评分反转对照臂、12 个单因子的同口径对照、「取前 K 名」深度曲线与决策日样本量诊断。" +
      "桶边界与方向全部来自 FROZEN-BUCKET-CONTRACT-001，不做权重优化、不重估边界、不做 OOS、不做归因。",
    source: "stock-limit-up-analyzer/first-board-pullback",
    tags: [
      "first-board-pullback",
      "top-n-ranking",
      "cross-section-selection",
      "composite-score",
      "frozen-buckets",
      "random-benchmark",
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
        `在 T+${DECISION_OFFSET_DAYS} 收盘确定综合评分并按当日前 N 名建仓，于 T+${ENTRY_DAY} 开盘等权买入、` +
        `T+${EXIT_RELATIVE_DAY} 收盘卖出，研究「每日取头部 N 名」相对当日全部候选是否有超额。`,
      eventScanPolicy: "FULL_DATASET",
    },
    pageKey: "first-board-pullback/twelve-factor-topn-ranking-study",
    pageTitle: "十二因子综合评分 · Top-N 排名可用性研究",
  },
  resultSchema: topNRankingSchema,
  run: async (context: ExperimentRunContext) => {
    const derivation = await deriveTwelveFactorSamples(context);
    context.log(
      `候选 ${derivation.candidateCount}；严格涨停 ${derivation.exactLimitUpCloseCount}；` +
        `12 因子完备用例 ${derivation.samples.length}；` +
        `固定日集门槛 = 当日样本 ≥ ${DEEP_DAY_MIN_SIZE}`
    );
    return assembleTopNRanking({ ...derivation });
  },
};

export default twelveFactorTopNRankingStudyExperiment;
