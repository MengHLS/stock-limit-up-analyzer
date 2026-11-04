/**
 * STOCK-SELECTION-002 —— **数据载体（data source）端口**。
 *
 * ## 为什么要把「载体」抽出来
 * 选股 = **口径** × **载体**：
 *   - **口径**（属策略，载体无关）：首板判定、观察窗 T+1..T+5、3F 排序、次日开盘执行；
 *   - **载体**（属数据面）：这份口径作用在什么数据上 —— 冻结数据集快照，还是当日原始行情。
 *
 * 🔴 铁律：**解耦的是载体，不是口径**。载体可以换（dataset ↔ live），但「候选事件怎么判、
 * 窗口看几天、怎么排序」必须复用同一份权威实现 —— 换载体只换数据来源，不换语义。
 *
 * ## 载体职责边界
 * 载体只回答一个问题：**「决策日 D（= 事件日 T0 + N 收盘）对应的候选事件，以及它的事件窗行」**。
 * 载体**不得**实现打分 / 过滤 / 排序（那是策略与 `compositeRunner` 的职责）。
 *
 * - `dataset`：读 `ds_*_event/prefix/post`（研究 / 回放 / 对拍口径；需要 `datasetVersionId` 坐标）。
 * - `live`  ：读当日原始行情 + 涨停事实（日常选股口径；**不需要数据集版本**）—— 见后续步骤。
 */

import type { BoardCategory } from "../data/boardRules";
import type { FirstLimitPullbackEvent, FirstLimitPullbackRawBar } from "../datasetRegistry/types";

/**
 * 载体返回的事件行：与 `FirstLimitPullbackEvent` 同形状，但 `datasetVersionId` 允许为 `null`
 * —— `live` 载体没有数据集坐标，**如实为 null，不编造版本号**。
 * （事件窗投影 `buildWindowRows` 只读 symbol / previousClose / industryCode / turnover / 市值，
 *   不读该字段；策略在调用处显式补行形状并注明。）
 */
export type SelectionEventRow = Omit<FirstLimitPullbackEvent, "datasetVersionId"> & {
  readonly datasetVersionId: number | null;
};

/** 载体返回的行情行：同理，`datasetVersionId` 允许为 `null`。 */
export type SelectionBarRow = Omit<FirstLimitPullbackRawBar, "datasetVersionId"> & {
  readonly datasetVersionId: number | null;
};

/** 数据载体种类。 */
export type SelectionDataSourceKind = "dataset" | "live";

/**
 * **候选宇宙口径**（策略声明，载体必须遵守）。
 *
 * 🔴 这是「哪些标的可以成为候选」的语义，不是数据来源细节 —— 因此由策略声明、
 *    由各载体以**同一口径**执行（live 侧按板块 + PIT ST 过滤；dataset 侧数据在构建时已固化，
 *    载体负责**反证**返回的事件确实落在该宇宙内）。
 */
export interface SelectionUniverseScope {
  /** 允许的板块（`server/data/boardRules#classifyBoard` 口径）；空数组 = 不限制。 */
  readonly boards: readonly BoardCategory[];
  /** 是否排除 ST / *ST（PIT 口径）。 */
  readonly excludeSt: boolean;
}

export interface SelectionDataSourceRequest {
  /** 决策日（收盘后，YYYY-MM-DD）。 */
  readonly decisionDate: string;
  /** **策略口径**：决策发生在事件日 T0 + N 收盘（本策略 N=5）。 */
  readonly decisionRelativeDay: number;
  /** 需要取回的窗口相对日（升序、含 0；0 = 事件日，来自 prefix）。 */
  readonly relativeDays: readonly number[];
  /** **候选宇宙口径**（策略声明；载体必须遵守或如实拒绝）。 */
  readonly universe: SelectionUniverseScope;
  /** 仅 `dataset` 载体需要：数据集版本真实坐标（`dataset_version.id`）。 */
  readonly datasetVersionId?: number;
}

export interface SelectionDataSourceResult {
  readonly kind: SelectionDataSourceKind;
  /** 展示用标签（页面显示「数据来源」，如「数据集 #780001」/「当日行情」）。 */
  readonly label: string;
  /**
   * 本次候选窗使用的**交易日序列**（升序、含事件日 T0 与执行日）。
   *
   * 🔴 由载体显式给出，不由行数据反推：
   *   - 数据集载体：来自它实际加载到的行；
   *   - live 载体：来自交易日历（不能靠"有没有某只股票的 bar"推断交易日）。
   * 策略据此做「每行 rd 必须能被该日历复现」的**反证**，任一不符即响亮失败。
   */
  readonly calendarDays: readonly string[];
  readonly events: readonly SelectionEventRow[];
  /** rd = 0 行（首板日，作特征基准）。 */
  readonly zeroBars: readonly SelectionBarRow[];
  /** rd ≥ 1 行（观察窗 + 执行日）。 */
  readonly postBars: readonly SelectionBarRow[];
}

export interface SelectionDataSource {
  readonly kind: SelectionDataSourceKind;
  readonly label: string;
  /**
   * 取回「在 `decisionDate` 做决策」的候选事件窗数据。
   * 无候选 = 返回空集（**不是错误**）；载体内数据自相矛盾才抛 `StockSelectionError`。
   */
  load(request: SelectionDataSourceRequest): Promise<SelectionDataSourceResult>;
}
