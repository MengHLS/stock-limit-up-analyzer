/**
 * SINGLE_FACTOR_EXPERIMENT_V1 —— 单因子研究通用模板：**契约常量与类型**（唯一真源）。
 *
 * ## 这个模板是什么
 *
 * 「首板回踩候选池 → 单一因子横截面排序 → 取头部/尾部 Top-N → 统一入场退出 → 与当日池对照」
 * 这一整套流程的**唯一实现**。后续 12 个现有因子与新增因子都复用本模板，
 * **不再为单个因子单独开发实验逻辑**。
 *
 * ## 冻结口径（本文件是声明处，实现在同名兄弟模块里）
 *
 * ```
 * experimentType  = SINGLE_FACTOR
 * Universe        = 首板回踩候选池（= 12F 入池池，见 universe.ts 的口径披露）
 * T               = 首板日（rd = 0）
 * Observation     = T+1 .. T+5            ← 观察窗，**不是**重复买入窗
 * Signal          = T+5 收盘（信息截止）
 * Entry           = T+6 开盘（统一入场条件：`canBuyAtOpen === true`）
 * Exit            = T+10 收盘（统一退出；不可卖则顺延到其后第一个可卖日，≤ T+20）
 * Position        = Equal Weight
 * Cost            = 往返 20 bps（= 单边 2.5+2.5+2.5 bps + 卖出印花税 5 bps）
 * Ranking         = HIGH / LOW（两个方向**都必须跑**，不允许事后择优）
 * TopN            = 3 / 5 / 10 / 20（四档**都必须跑**）
 * Benchmark       = 当日全部符合条件的候选股票（等权）
 * ```
 *
 * 🔴 上述坐标**不是**本模板新发明的：入场 `T+6` / 退出 `T+10` / 成本 `20 bps` 与
 * `FROZEN-BUCKET-CONTRACT-001` 完全一致（唯一实现在 `derive.ts`），
 * 因此单因子实验结果与 12F / Top-N 两个实验**逐笔可比**。
 */

// ---------------------------------------------------------------------------
// 一、模板身份
// ---------------------------------------------------------------------------

/** 模板编号（写进 `customPayload.templateId`，事后可审计「这批实验用的是哪一版模板」）。 */
export const SINGLE_FACTOR_TEMPLATE_ID = "SINGLE_FACTOR_EXPERIMENT_V1";
/** 实验类型（模板要求 `experimentType = SINGLE_FACTOR`）。 */
export const SINGLE_FACTOR_EXPERIMENT_TYPE = "SINGLE_FACTOR";
/** 本模板自己的契约编号（排序 / 组合 / 指标口径），与 FBC-001（分桶口径）区分。 */
export const SINGLE_FACTOR_CONTRACT_ID = "SF-V1-001";

/** 本模板随 12F 共用 Dataset 语义代码与版本标签。 */
export const SINGLE_FACTOR_DATASET_CODE = "first_limit_pullback";
export const SINGLE_FACTOR_DATASET_VERSION_LABEL = "v5";

// ---------------------------------------------------------------------------
// 二、观察窗与信息边界（PIT）
// ---------------------------------------------------------------------------

/** T = 首板日。 */
export const EVENT_RELATIVE_DAY = 0;
/** 观察窗起点（T+1）。 */
export const OBSERVATION_START_RELATIVE_DAY = 1;
/** 观察窗终点（T+5）——也是**信息截止日**：因子/排名/信号只允许用到这里为止的信息。 */
export const OBSERVATION_END_RELATIVE_DAY = 5;
/** 信息截止相对日（= 观察窗终点）。禁止任何 `rd > 5` 的数据进入因子或排名。 */
export const PIT_INFORMATION_CUTOFF_RELATIVE_DAY = OBSERVATION_END_RELATIVE_DAY;

/** 观察窗内的相对日集合（因子计算唯一允许使用的未来数据）。 */
export const OBSERVATION_RELATIVE_DAYS: readonly number[] = Array.from(
  { length: OBSERVATION_END_RELATIVE_DAY - OBSERVATION_START_RELATIVE_DAY + 1 },
  (_, index) => index + OBSERVATION_START_RELATIVE_DAY
);

// ---------------------------------------------------------------------------
// 三、预定义实验组合（Ranking × TopN）
// ---------------------------------------------------------------------------

/** 排序方向。`HIGH` = 因子值大的在前；`LOW` = 因子值小的在前。 */
export const RANKING_DIRECTIONS = ["HIGH", "LOW"] as const;
export type RankingDirection = (typeof RANKING_DIRECTIONS)[number];

export const RANKING_DIRECTION_LABELS: Readonly<Record<RankingDirection, string>> = {
  HIGH: "HIGH（因子值从大到小取前 N）",
  LOW: "LOW（因子值从小到大取前 N）",
};

/** TopN 档位（**固定四档**；不得改成「跑完再挑」）。 */
export const TOP_N_SIZES = [3, 5, 10, 20] as const;
export type TopNSize = (typeof TOP_N_SIZES)[number];

/**
 * 全部预定义实验组合 = 2 方向 × 4 档 = **8 个**。
 *
 * 🔴 组合在代码里**静态枚举** ⇒ 「事后挑选最优结果」在结构上做不到：
 * 一次 Run 会把这 8 个组合全部算出来并全部落进结果，
 * 没有任何「只保留最好的那个」的开关。
 */
export interface SingleFactorCombo {
  /** 组合 id，形如 `HIGH_N3`。 */
  readonly id: string;
  readonly direction: RankingDirection;
  readonly size: TopNSize;
  readonly label: string;
}

export const SINGLE_FACTOR_COMBOS: readonly SingleFactorCombo[] =
  RANKING_DIRECTIONS.flatMap(direction =>
    TOP_N_SIZES.map(size => ({
      id: `${direction}_N${size}`,
      direction,
      size,
      label: `${direction} · Top-${size}`,
    }))
  );

export function comboIdOf(direction: RankingDirection, size: TopNSize): string {
  return `${direction}_N${size}`;
}

/** 仓位模型（模板只允许等权）。 */
export const POSITION_MODEL = "EQUAL_WEIGHT";
export const POSITION_MODEL_LABEL = "全仓等权（每笔 1/N 名义本金，不做资金管理）";

// ---------------------------------------------------------------------------
// 四、样本与逐笔交易
// ---------------------------------------------------------------------------

/**
 * 一个**已入池**的候选事件（= 一笔潜在交易）。
 *
 * 🔴 时间坐标全部来自 Dataset 的 `tradeDate`（不是「相对日 × 自然日」推算）——
 * 交易日历只认平台数据，本模板不自己算日历。
 */
export interface SingleFactorSample {
  eventId: string;
  /** 代码域标识（`symbol`，如 `600000.SH`）。⚠️ 是代码不是身份，见契约注释。 */
  stockCode: string;
  /** T：首板日。 */
  eventDate: string;
  /** 信息截止日（T+5 收盘）。 */
  signalDate: string;
  /** 入场日（T+6，开盘买入）。 */
  entryDate: string;
  /** 实际退出日（T+10 收盘，或其后第一个可卖日）。 */
  exitDate: string;
  entryRelativeDay: number;
  exitRelativeDay: number;
  /** 持有交易日数 = `exitRelativeDay − entryRelativeDay + 1`。 */
  holdingDays: number;
  /** 入场价 = T+6 开盘。 */
  entryPrice: number;
  /** 退出价 = 实际退出日的收盘价。 */
  exitPrice: number;
  /** 毛收益（未扣成本）。 */
  grossReturn: number;
  /** 单笔往返成本（比例，= 20 bps ⇒ 0.002）。 */
  cost: number;
  /** 单笔往返成本（bps，= 20）。 */
  costBps: number;
  /** 净收益 = 毛收益 − 成本（**与 12F 的 `netReturn` 逐位相同**）。 */
  netReturn: number;
  year: number;
  /** 该因子的**原始值**（不是桶位分）：用于排名与逐笔留档。 */
  factorValue: number;
}

/**
 * 逐笔交易明细（结果契约要求的最小字段集）。
 *
 * ```
 * stockCode · factorValue · rank · signalDate · entryDate · entryPrice
 * exitDate · exitPrice · holdingDays · grossReturn · cost · netReturn
 * ```
 */
export interface SingleFactorTrade {
  /**
   * 决策日（= 首板日 `T`，也是横截面分组的键）。
   *
   * 可选：逐笔的**必需**字段集是需求文档列出的那 12 个（`stockCode` … `netReturn`），
   * 本模板每次都写它，但跨模块复用本类型的装配器（如组合因子）允许省略 ——
   * 省略时时间切片按 `signalDate`（`T+5`，真正的决策时点）定年。
   */
  decisionDate?: string;
  stockCode: string;
  eventId: string;
  factorValue: number;
  /** 该笔在**当日横截面**里的名次（1 = 该方向下的第一名）。 */
  rank: number;
  /** 当日可排名样本数（名次的比较基数，缺了就无法复核名次）。 */
  poolSize: number;
  signalDate: string;
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  exitRelativeDay: number;
  holdingDays: number;
  grossReturn: number;
  cost: number;
  costBps: number;
  netReturn: number;
}

// ---------------------------------------------------------------------------
// 五、指标
// ---------------------------------------------------------------------------

/**
 * 核心指标集合（字段名与需求文档逐字对应）。
 *
 * 🔴 全部可为 `null`：`null` = 样本不足 / 无法计算（**禁 0 兜底**）。
 */
export interface SingleFactorMetrics {
  /** 组合累计净收益：按决策日顺序对「当日等权组合收益」复利。 */
  totalReturn: number | null;
  /** 同一构造下的**毛**累计收益；`totalReturn − grossTotalReturn` 即成本拖累。 */
  grossTotalReturn: number | null;
  /** 逐笔净收益均值（等权交易口径）。 */
  meanTradeReturn: number | null;
  medianTradeReturn: number | null;
  /** 净收益 > 0 的笔数占比。 */
  winRate: number | null;
  /** Σ 正净收益 ÷ |Σ 负净收益|；无亏损交易时为 `null`（不写 Infinity）。 */
  profitFactor: number | null;
  /** 组合净值曲线的最大回撤（**≤ 0**，负值表示回撤）。 */
  maxDrawdown: number | null;
  tradeCount: number;
  /** 基准累计收益（当日池等权，同一复利构造）。 */
  benchmarkReturn: number | null;
  /** 超额 = `totalReturn − benchmarkReturn`。 */
  excessReturn: number | null;
  averageHoldingDays: number | null;
  /** 单笔往返成本（bps，常量）。 */
  costBps: number;
  /** 单笔单边滑点（bps，来自公共成本模型）。 */
  slippageBpsPerSide: number;
  /** 成本拖累 = `grossTotalReturn − totalReturn`。 */
  costDrag: number | null;
}

/** 组合（方向 × TopN）的完整结果。 */
export interface SingleFactorComboResult {
  comboId: string;
  direction: RankingDirection;
  size: TopNSize;
  label: string;
  /** 纳入的决策日数。 */
  daysIncluded: number;
  /** 因「当日可排名样本 < TopN」被排除的决策日数（**账必须看得见**）。 */
  daysExcludedSmall: number;
  metrics: SingleFactorMetrics;
  /** 配对日度超额（`当日组合均值 − 当日池均值`）的日期聚类 Bootstrap 95% CI。 */
  excessCi95Low: number | null;
  excessCi95High: number | null;
  /** 三态判定（`MIN_DAY_COUNT` 把关）。 */
  excessVerdict: SingleFactorVerdict;
  /** 组合自身绝对收益的 Bootstrap 95% CI 与判定。 */
  portfolioCi95Low: number | null;
  portfolioCi95High: number | null;
  portfolioVerdict: SingleFactorVerdict;
  /** 日胜率 = 超额 > 0 的决策日占比。 */
  dayWinRate: number | null;
  trades: readonly SingleFactorTrade[];
}

export const SINGLE_FACTOR_VERDICTS = [
  "POSITIVE",
  "NEGATIVE",
  "INCONCLUSIVE",
  "INSUFFICIENT",
] as const;
export type SingleFactorVerdict = (typeof SINGLE_FACTOR_VERDICTS)[number];

// ---------------------------------------------------------------------------
// 六、装配入参
// ---------------------------------------------------------------------------
//
// `SingleFactorAssemblyArgs` 定义在 `resultWriter.ts`（它要引用 `SingleFactorCatalogEntry`
// 与 `SingleFactorUniverseResult`，放在这里会形成 types ⇄ 兄弟模块的类型环）。
