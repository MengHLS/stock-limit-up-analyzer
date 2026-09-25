/**
 * SINGLE_FACTOR_EXPERIMENT_V1 · 模板实例 —— 结果层。
 *
 * 本文件**不做任何计算**：它只把通用基础（`@experiments/shared/singleFactor`）里的
 * 结果契约与装配函数暴露给本实验的 `experiment.ts` 与契约测试。
 *
 * 🔴 这样做的意义：**新增因子不需要改这个文件**。模板实例是「一层薄壳」，
 * 换因子只改运行参数（`factorCode`），换口径才需要动模板本体。
 */

export {
  COMPUTATION_VERSION,
  BOOTSTRAP_SEED_BASE,
  TRADE_TABLE_SAMPLE_PER_COMBO,
  assembleSingleFactorResult,
  singleFactorSchema,
  singleFactorMetricsSchema,
  singleFactorTradeSchema,
  singleFactorComboSchema,
  singleFactorTimeSliceSchema,
  tradeArtifactNameOf,
  comboSeedOf,
  comboYearSeedOf,
} from "@experiments/shared/singleFactor/resultWriter";

export type {
  SingleFactorAssemblyArgs,
  SingleFactorPayload,
} from "@experiments/shared/singleFactor/resultWriter";

export {
  MIN_DECISION_DAY_COUNT,
  BOOTSTRAP_ITERATIONS,
  BOOTSTRAP_BLOCK_DAYS,
} from "@experiments/shared/singleFactor/metrics";

export {
  SINGLE_FACTOR_CATALOG,
  SINGLE_FACTOR_CATALOG_CODES,
  FROZEN_TWELVE_FACTOR_CATALOG,
  factorContractFingerprintOf,
  resolveSingleFactor,
} from "@experiments/shared/singleFactor/factorResolver";

export type { SingleFactorCatalogEntry } from "@experiments/shared/singleFactor/factorResolver";

export {
  SINGLE_FACTOR_COMBOS,
  SINGLE_FACTOR_CONTRACT_ID,
  SINGLE_FACTOR_EXPERIMENT_TYPE,
  SINGLE_FACTOR_TEMPLATE_ID,
  RANKING_DIRECTIONS,
  TOP_N_SIZES,
} from "@experiments/shared/singleFactor/types";

export type {
  RankingDirection,
  SingleFactorComboResult,
  SingleFactorMetrics,
  SingleFactorSample,
  SingleFactorTrade,
  SingleFactorVerdict,
  TopNSize,
} from "@experiments/shared/singleFactor/types";

/**
 * 未显式指定因子时的默认因子。
 *
 * 之所以给默认值而不是「必填」：`required: true` 会让「忘了填参数」变成一次硬失败，
 * 而模板的默认行为应当是「跑一个具体的因子」——`turnover` 是 12 因子里口径最稳定
 * （无 UNKNOWN 桶、无 null 值）的一个，适合当默认。
 */
export const DEFAULT_FACTOR_CODE = "turnover";
