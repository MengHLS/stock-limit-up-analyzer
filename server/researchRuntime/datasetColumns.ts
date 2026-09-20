/**
 * RESEARCH-EXPERIMENT-003 —— Dataset 物理表的**列清单与骨架列**（唯一权威）。
 *
 * 来源：`server/researchEngine/columnProjection.ts` 的 `ProjectionRole` /
 * `PROJECTION_FULL_COLUMNS` / `STRUCTURAL_COLUMNS` 三块**整体搬迁，定义逐字未改**。
 *
 * 为什么只搬这三块：旧 `columnProjection.ts` 的其余部分（`deriveColumnProjection` 的
 * 「记录访问式代理派生」、`guardProjectedRow` 的越界守卫）其输入是旧 Research 的**变量目录**
 * （`researchEngine/variables.ts`），随旧引擎一并删除；而本模块的三块常量是
 * **读取层的骨架**，新实验体系的 Dataset 桥按同一份清单补齐列。
 *
 * 🔴 `STRUCTURAL_COLUMNS` 的历史代价（2026-09-20 真机实测）：只下推「业务声明列」会把
 * `eventId` / `tradeDate` / `symbol` / `relativeDay` / `datasetVersionId` 一起裁掉 ⇒
 * 领域映射器产出 `eventId: undefined` ⇒ 按 N 个 `undefined` 批量取行情**恒 0 行**。
 * 且**单测结构上发现不了**（内存读取替身不实现列裁剪）。两处共用同一份清单，防止再漂移。
 */

import {
  DATASET_EVENT_COLUMNS,
  DATASET_OUTCOME_COLUMNS,
  DATASET_PATH_COLUMNS,
  DATASET_POST_COLUMNS,
  DATASET_PREFIX_COLUMNS,
} from "../datasetRegistry/query";

/** 五张物理表的角色（与 Dataset Registry 的分层一一对应）。 */
export type ProjectionRole = "event" | "prefix" | "post" | "path" | "outcome";

/**
 * 各角色全部列名（从 drizzle 表对象派生，见 `datasetRegistry/query.ts`）。
 *
 * 🔴 `post` 与 `prefix` **逐字段同构**（仅 `relativeDay` 取值域不同：prefix ≤ 0、post ≥ 1），
 * 因此两者共用同一份列清单常量。这里显式复制而不是引用同一个数组，是为了让
 * 「按 schema 声明顺序输出」对两个角色都成立（顺序相同但语义独立）。
 */
export const PROJECTION_FULL_COLUMNS: Readonly<Record<ProjectionRole, readonly string[]>> = Object.freeze({
  event: DATASET_EVENT_COLUMNS,
  prefix: DATASET_PREFIX_COLUMNS,
  post: DATASET_POST_COLUMNS,
  path: DATASET_PATH_COLUMNS,
  outcome: DATASET_OUTCOME_COLUMNS,
});

/**
 * 结构性列：无论业务怎么声明都必须取。
 *
 * 理由：这些列不是「业务输入」，而是读取层的骨架 —— 没有 `eventId` 就无法把
 * prefix / post / path / outcome 归并回事件，没有 `relativeDay` / `horizon` 就无法定位
 * 取值位置，没有 `tradeDate` / `symbol` 就无法构造可追溯的样本行。
 */
export const STRUCTURAL_COLUMNS: Readonly<Record<ProjectionRole, readonly string[]>> = Object.freeze({
  event: ["datasetVersionId", "eventId", "symbol", "tradeDate"],
  prefix: ["datasetVersionId", "eventId", "relativeDay"],
  post: ["datasetVersionId", "eventId", "relativeDay"],
  path: ["datasetVersionId", "eventId", "relativeDay"],
  outcome: ["datasetVersionId", "eventId", "horizon"],
});
