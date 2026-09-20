/**
 * RESEARCH-EXPERIMENT-003 —— Dataset 版本的事实上下文（**唯一**定义）。
 *
 * 来源：`server/researchEngine/types.ts` 的 `ResearchDatasetVersionContext`（整体搬迁，字段逐字未改）。
 * 它描述的**不是**旧 Research 的分析实体，而是「一个 Dataset 版本有哪些数据、视界到哪里、
 * 决策日偏移是多少」——这是**读取层**的入参，独立实验体系的 Dataset 桥同样按它工作。
 *
 * 🔴 `decisionOffsetDays` 的语义（PIT 的核心）：
 *   数据集**声明的决策日偏移 d**（交易日）—— 样本池的信息边界，也是观察日变量 PIT 护栏的
 *   判定日来源（`decisionOffsetDays` 冻结在 `dataset_version.universeDefinition`）。
 *   `null` = 该数据集未声明（无首板回踩筛选）⇒ 引用观察日变量必须**被拒绝**，
 *   不允许退回「整窗可判定」这种恒真的假护栏。
 */

export interface ResearchDatasetVersionContext {
  datasetVersionId: number;
  datasetId: number;
  datasetCode: string;
  datasetName: string;
  versionLabel: string;
  /** DRAFT / BUILDING / READY / FAILED。 */
  status: string;
  startDate: string | null;
  endDate: string | null;
  totalEvents: number | null;
  /** outcome.horizon 的真实取值集合（升序）。 */
  horizons: number[];
  /** path.relativeDay 的真实取值范围（无 path 数据为 null）。 */
  pathRelativeDayRange: { min: number; max: number } | null;
  /**
   * post.relativeDay 的真实取值范围（无 post 数据为 null）——**观察日**变量族的可用上界。
   * 缺失即「该数据集没有观察日数据」⇒ `obs_*` / `pullback_*` 全部不可用（不是默认 20）。
   */
  postRelativeDayRange: { min: number; max: number } | null;
  /**
   * 数据集**声明的决策日偏移 d**（交易日）—— 样本池的信息边界，也是观察日变量 PIT
   * 护栏的判定日来源（`decisionOffsetDays` 冻结在 `dataset_version.universeDefinition`）。
   *
   * 🔴 `null` = 该数据集未声明（无首板回踩筛选）⇒ 引用观察日变量必须**被拒绝**，
   * 不允许退回「整窗可判定」这种恒真的假护栏。
   */
  decisionOffsetDays: number | null;
}
