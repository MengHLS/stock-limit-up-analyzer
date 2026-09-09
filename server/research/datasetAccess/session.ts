/**
 * STEP 13 / C-13.1 — Research Dataset 访问层：Session 编排。
 *
 * createDatasetSession(dataset, config)：把「一个已构建的 ResearchDataset 实例」与
 * 「一份 ExperimentConfig」绑定为 pipeline 可直接消费的访问会话：
 *
 *   1. bindResearchDataset —— 数据集不可变绑定 + PIT/排序不变量校验；
 *   2. assertDatasetVersionConsistent —— config.datasetVersion 与句柄一致（版本可追溯）；
 *   3. assert 实验 universeId 与数据集派生 universeId 一致（datasetVersion 已编入）；
 *   4. assert 实验日期范围 ⊆ 数据集窗口（闭区间），否则越界行将静默缺失 → 提前 FAIL FAST；
 *   5. 产出 universe（UniverseProvider）/ dataSource（ResearchDataSource）/ 日期切片 rows。
 *
 * 只做「dataset → framework 契约」的适配装配，不实现 Feature / Signal / Candidate 逻辑。
 */

import type { ResearchDataset } from "../../researchDataset/types";
import type { ExperimentConfig, ResearchDataSource, UniverseProvider } from "../framework/contract";
import { createDatasetDataSource } from "./bars";
import {
  assertDatasetVersionConsistent,
  bindResearchDataset,
  deriveDatasetUniverseId,
  type ResearchDatasetHandle,
} from "./handle";
import { sliceRowsByDateRange } from "./slice";
import { createDatasetUniverseProvider } from "./universe";
import type { ResearchDatasetRow } from "../../researchDataset/types";

/** 一次 dataset + config 的只读访问会话（pipeline 输入就绪态）。 */
export interface DatasetSession {
  readonly handle: ResearchDatasetHandle;
  readonly config: ExperimentConfig;
  readonly universe: UniverseProvider;
  readonly dataSource: ResearchDataSource;
  /** config.dateRange（闭区间）内的行切片。 */
  readonly rows: readonly ResearchDatasetRow[];
}

/** 绑定数据集 + 实验配置，产出 pipeline 可消费的访问会话。 */
export function createDatasetSession(dataset: ResearchDataset, config: ExperimentConfig): DatasetSession {
  const handle = bindResearchDataset(dataset);

  assertDatasetVersionConsistent(config, handle);

  if (config.universe.universeId !== handle.universeId) {
    throw new Error(
      `实验配置 universeId=${config.universe.universeId} 与数据集派生 universeId=${handle.universeId} 不一致；` +
        `针对数据集版本 ${handle.datasetVersion} 的实验必须使用 universeId=${deriveDatasetUniverseId(handle.datasetVersion)}`,
    );
  }

  const range = { start: config.dateRange.startDate, end: config.dateRange.endDate };
  if (range.start < handle.startDate || range.end > handle.endDate) {
    throw new Error(
      `实验日期范围 [${range.start}, ${range.end}] 超出数据集窗口 [${handle.startDate}, ${handle.endDate}]（闭区间）；` +
        `越界日期将静默缺失行，禁止以部分数据集冒充全窗口运行`,
    );
  }

  const rows = sliceRowsByDateRange(handle.rows, range);
  const universe = createDatasetUniverseProvider(handle);
  const dataSource = createDatasetDataSource(handle);

  return {
    handle,
    config,
    universe,
    dataSource,
    rows,
  };
}
