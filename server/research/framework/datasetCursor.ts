import type { CanonicalMarketBar } from "../../data";
import type { ResearchDatasetGate, ResearchDatasetRow } from "../../researchDataset/types";

/** 流式数据集元数据；字段语义与 ResearchDatasetHandle 对齐。 */
export interface ResearchDatasetCursorMetadata {
  readonly datasetVersion: string;
  readonly builderVersion: string;
  readonly rowSchemaVersion: string;
  readonly universeId: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly rowCount: number | null;
  readonly universeDayCount: number;
  readonly gate: ResearchDatasetGate;
}

export interface ResearchDatasetCursorDecisionMember {
  /** 面板身份；同一证券的多个事件成员必须互不相同。 */
  readonly securityId: string;
  /** 相对首板事件日的交易日偏移；池化策略用它区分 T0 入池与 T+1 首评。 */
  readonly relativeDay: number;
  /** 决策时可见的完整 bar 序列（升序，含事件日基准 bar）。 */
  readonly visibleBars: readonly CanonicalMarketBar[];
}

export interface ResearchDatasetCursorDecisionOutcome {
  /** 面板身份（与 day.members / day.visibleBars 的键一致）。 */
  readonly securityId: string;
  /** 当日是否得到有效评分。false = 不可评分，由 cursor 累计连续不可评分天数。 */
  readonly scored: boolean;
  /** true = 低分或硬规则要求立即移出池；只影响未来买入，不驱动已持仓卖出。 */
  readonly removeFromPool: boolean;
}

/** 单个交易日的只读数据切片。 */
export interface ResearchDatasetCursorDay {
  readonly tradeDate: string;
  readonly isTradingDay: boolean;
  readonly rows: readonly ResearchDatasetRow[];
  readonly members: readonly string[];
  readonly executionBars: ReadonlyMap<string, CanonicalMarketBar>;
  /** 决策时可见的逐证券 bar 序列；池化/内存实现都必须提供。 */
  readonly visibleBars: ReadonlyMap<string, readonly CanonicalMarketBar[]>;
  /** 池化游标可选提供；事件窗内存适配器无需提供。 */
  readonly decisionMembers?: readonly ResearchDatasetCursorDecisionMember[];
}

/**
 * Research Engine / Simulator 的统一只读数据游标。
 *
 * 实现可以是全内存 ResearchDataset，也可以是池化策略的逐日物化游标。调用方只能顺序请求
 * `tradingDates` 中的日期；实现不得依赖调用方预先把全部 rows 放入内存。
 */
export interface ResearchDatasetCursorStats {
  readonly barsRead: number;
  readonly admittedMemberCount: number;
  readonly retiredMemberCount: number;
  readonly removedByMinimumScoreCount: number;
  readonly peakActiveMemberCount: number;
  /** POOL-ST-001：事件日被 ST 排除的事件数（未启用 ST 口径时为 0）。 */
  readonly stExcludedEventCount?: number;
  /** POOL-ST-001：池期内转 ST 当日移池的成员数。 */
  readonly stRemovedMemberCount?: number;
  /** 本次读取的实际内容源（本地快照 / TiDB 直读）。 */
  readonly contentSource?: string;
}

export interface ResearchDatasetCursor {
  readonly metadata: ResearchDatasetCursorMetadata;
  readonly tradingDates: readonly string[];
  getDaySlice(tradeDate: string): Promise<ResearchDatasetCursorDay>;
  /** 回到游标起点（可选）；research 与 backtest 两个顺序消费者需要独立读取。 */
  restart?(): Promise<void>;
  /** 池化游标可选接收当日评分结果，以更新连续缺分 / 低分移池状态。 */
  applyDecisionOutcomes?(
    outcomes: readonly ResearchDatasetCursorDecisionOutcome[],
  ): void;
  /** 流式读取审计统计（池化实现提供；内存适配器可省略）。 */
  stats?(): ResearchDatasetCursorStats;
  /**
   * 标记候选运行实际需要的面板身份，供 backtest 复用 research 已读的行。
   * 这是避免“research/backtest 两遍读取 + 数据源漂移”的关键；未实现时回退到 restart+replay。
   */
  retainSecurityIds?(securityIds: readonly string[]): void;
  /** 取出 research 期间为被选身份保留的逐日标准行（升序由调用方保证）。 */
  takeRetainedRows?(): readonly ResearchDatasetRow[];
  close(): Promise<void>;
}
