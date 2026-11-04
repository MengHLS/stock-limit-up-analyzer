/**
 * STEP 13 / C-13.1 — Research Dataset 访问层：Dataset 句柄与绑定。
 *
 * 目标：把一个已构建的 ResearchDataset 实例绑定为「不可变、可序列化、确定性」的
 * 访问对象，携带 datasetVersion / builder 版本 / rowSchema 版本 / universe 引用，
 * 并作为 ExperimentConfig.datasetVersion ↔ 数据集实例一致性的唯一校验点。
 *
 * 数据语义与铁律（对齐 researchDataset C-12.6.1）：
 *   - dataset.rows 按 (tradeDate, securityId) 升序且唯一；行即逐日 PIT 决议产物，
 *     默认口径每行 asOf === tradeDate（asOfPerTradeDate=true）。本访问层只支持逐日
 *     PIT 面板；冻结快照（asOfPerTradeDate=false）含相对 tradeDate 的未来知识，
 *     禁止作为按日 Research Engine 输入——绑定期即 FAIL FAST，不做静默降级。
 *   - datasetVersion 是内容指纹（content-addressed），版本即内容，内容即版本；
 *     同一 handle 不允许被不同 datasetVersion 的实验配置消费。
 *   - 本层纯函数：无 IO / 无 Date.now / 无 Math.random；所有公开数组以 readonly 暴露。
 *   - 失败响亮：所有不变量破坏均 throw（带中文错误信息）。
 *
 * 序列化口径：句柄本体可能引用数万行的 rows，不整体序列化；提供
 * snapshotDatasetHandle / serializeDatasetHandle 输出「绑定记录 + 摘要」，
 * 供审计与可复现（完整内容由 datasetVersion 指纹寻址，见 researchDataset/version.ts）。
 */

import {
  type ResearchDataset,
  type ResearchDatasetGate,
  type ResearchDatasetRow,
  type UniverseDayResult,
  RESEARCH_DATASET_BUILDER_VERSION,
  RESEARCH_DATASET_ROW_SCHEMA_VERSION,
} from "../../researchDataset/types";
import type { ExperimentConfig } from "../framework/contract";
import { assertRowPitInvariant } from "./invariants";

// ---------------------------------------------------------------------------
// Universe id 派生
// ---------------------------------------------------------------------------

/**
 * 由 datasetVersion 确定性派生 universeId。
 *
 * framework 的 UniverseProvider 契约要求 universeId 与 ExperimentConfig.universe.universeId
 * 一致（pipeline 会校验）。把 datasetVersion 编入 universeId，可让「实验配置指向的数据集版本」
 * 与「实际供给的 universe」天然互锁：配 v1 跑 v2 数据集在版本一致性校验与 universeId 双保险下
 * 都会 FAIL FAST，防止静默串用版本。
 */
export function deriveDatasetUniverseId(datasetVersion: string): string {
  return `research-dataset:${datasetVersion}`;
}

// ---------------------------------------------------------------------------
// 句柄类型
// ---------------------------------------------------------------------------

/** ResearchDataset 的不可变绑定句柄。 */
export interface ResearchDatasetHandle {
  /** 内容指纹版本（= dataset.datasetVersion，绑定期冻结）。 */
  readonly datasetVersion: string;
  /** 构建器版本（绑定期冻结 RESEARCH_DATASET_BUILDER_VERSION）。 */
  readonly builderVersion: string;
  /** 行投影 schema 版本（绑定期冻结 RESEARCH_DATASET_ROW_SCHEMA_VERSION）。 */
  readonly rowSchemaVersion: string;
  /** framework UniverseProvider 用 id（= deriveDatasetUniverseId(datasetVersion)）。 */
  readonly universeId: string;
  /** 数据集窗口起点（YYYY-MM-DD，闭区间端点含）。 */
  readonly startDate: string;
  /** 数据集窗口终点（YYYY-MM-DD，闭区间端点含）。 */
  readonly endDate: string;
  readonly rowCount: number;
  readonly universeDayCount: number;
  /** 数据门态（gate=FAIL 仍可绑定，供 smoke/诊断；生产消费建议由上层 gate 把关）。 */
  readonly gate: ResearchDatasetGate;
  /** 绑定的原始数据集（只读引用；本层不复制不修改）。 */
  readonly dataset: ResearchDataset;
  /** 全量标准行（按 (tradeDate, securityId) 升序）。 */
  readonly rows: readonly ResearchDatasetRow[];
  /** universe 决议逐日结果（按 tradeDate 升序）。 */
  readonly universeDays: readonly UniverseDayResult[];
}

/** 句柄的「绑定记录 + 摘要」快照（可序列化，稳定字段序）。 */
export interface DatasetHandleSnapshot {
  readonly datasetVersion: string;
  readonly builderVersion: string;
  readonly rowSchemaVersion: string;
  readonly universeId: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly rowCount: number;
  readonly universeDayCount: number;
  readonly gate: ResearchDatasetGate;
  /** 逐日 tradeDate（升序）。 */
  readonly tradingDayDates: readonly string[];
  /** 全量行中出现过的 securityId（升序去重）。 */
  readonly securityIds: readonly string[];
}

// ---------------------------------------------------------------------------
// 内部不变量
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertValidDateString(value: string, label: string): void {
  if (!DATE_RE.test(value)) {
    throw new Error(`DatasetHandle: ${label}（${value}）不是 YYYY-MM-DD`);
  }
}

/** 断言 rows 按 (tradeDate, securityId) 升序且唯一（保证确定性迭代）。 */
function assertRowsSortedAndUnique(rows: readonly ResearchDatasetRow[], datasetVersion: string): void {
  for (let i = 1; i < rows.length; i += 1) {
    const prev = rows[i - 1]!;
    const curr = rows[i]!;
    if (prev.tradeDate > curr.tradeDate || (prev.tradeDate === curr.tradeDate && prev.securityId > curr.securityId)) {
      throw new Error(
        `DatasetHandle(${datasetVersion}): rows 必须按 (tradeDate, securityId) 升序确定性排序；` +
          `在 ${prev.tradeDate}:${prev.securityId} 之后发现 ${curr.tradeDate}:${curr.securityId}，数据源非法。`,
      );
    }
    if (prev.tradeDate === curr.tradeDate && prev.securityId === curr.securityId) {
      throw new Error(
        `DatasetHandle(${datasetVersion}): rows 存在重复行 (${curr.tradeDate}, ${curr.securityId})，(tradeDate, securityId) 必须是唯一键。`,
      );
    }
  }
}

/** 断言 universe days 按 tradeDate 升序且唯一。 */
function assertUniverseDaysSortedAndUnique(days: readonly UniverseDayResult[], datasetVersion: string): void {
  for (let i = 1; i < days.length; i += 1) {
    const prev = days[i - 1]!;
    const curr = days[i]!;
    if (prev.tradeDate >= curr.tradeDate) {
      throw new Error(
        `DatasetHandle(${datasetVersion}): universeDefinition.days 必须按 tradeDate 严格升序且唯一；` +
          `发现 ${prev.tradeDate} 之后出现 ${curr.tradeDate}，universe 决议非法。`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 绑定
// ---------------------------------------------------------------------------

/**
 * 把一个 ResearchDataset 实例绑定为不可变访问句柄。
 *
 * 绑定期校验（FAIL FAST）：
 *   1. datasetVersion / startDate / endDate 非空且日期合法；
 *   2. 每行 PIT 不变量 asOf === tradeDate；
 *   3. rows 按 (tradeDate, securityId) 升序且唯一；
 *   4. universeDefinition.days 按 tradeDate 严格升序且唯一。
 *
 * 说明：rows / days 数组可能巨大，本层只做校验与只读引用，不做深拷贝/深冻结
 * （内存克制）；句柄自身的元数据字段为冻结快照。确定性由「访问函数不改输入」+「绑定期
 * 排序唯一校验」保证。
 */
export function bindResearchDataset(dataset: ResearchDataset): ResearchDatasetHandle {
  if (!dataset || typeof dataset !== "object") {
    throw new Error("DatasetHandle: 传入的 ResearchDataset 缺失或非对象");
  }
  const { datasetVersion, rows, universeDefinition, dataSnapshot } = dataset;
  if (typeof datasetVersion !== "string" || datasetVersion.trim() === "") {
    throw new Error("DatasetHandle: datasetVersion 不能为空（内容指纹版本缺失，禁止绑定）");
  }
  if (!Array.isArray(rows)) {
    throw new Error(`DatasetHandle(${datasetVersion}): dataset.rows 必须是数组`);
  }
  if (!universeDefinition || !Array.isArray(universeDefinition.days)) {
    throw new Error(`DatasetHandle(${datasetVersion}): dataset.universeDefinition.days 缺失`);
  }

  const startDate = dataSnapshot?.request?.startDate;
  const endDate = dataSnapshot?.request?.endDate;
  if (typeof startDate !== "string" || typeof endDate !== "string") {
    throw new Error(`DatasetHandle(${datasetVersion}): dataSnapshot.request.startDate/endDate 缺失`);
  }
  assertValidDateString(startDate, "dataSnapshot.request.startDate");
  assertValidDateString(endDate, "dataSnapshot.request.endDate");
  if (startDate > endDate) {
    throw new Error(`DatasetHandle(${datasetVersion}): 数据集窗口倒序 startDate(${startDate}) > endDate(${endDate})`);
  }

  // PIT 与确定性不变量。
  for (const row of rows) {
    if (typeof row !== "object" || row === null || typeof row.securityId !== "string" || row.securityId.trim() === "") {
      throw new Error(`DatasetHandle(${datasetVersion}): rows 中存在缺 securityId 的脏行`);
    }
    assertValidDateString(row.tradeDate, `行 tradeDate (${row.securityId})`);
    assertValidDateString(row.asOf, `行 asOf (${row.securityId})`);
    assertRowPitInvariant(row);
  }
  assertRowsSortedAndUnique(rows, datasetVersion);
  assertUniverseDaysSortedAndUnique(universeDefinition.days, datasetVersion);

  const universeDays = Object.freeze(universeDefinition.days.slice());
  return Object.freeze({
    datasetVersion,
    builderVersion: RESEARCH_DATASET_BUILDER_VERSION,
    rowSchemaVersion: RESEARCH_DATASET_ROW_SCHEMA_VERSION,
    universeId: deriveDatasetUniverseId(datasetVersion),
    startDate,
    endDate,
    rowCount: rows.length,
    universeDayCount: universeDays.length,
    gate: dataset.gate,
    dataset,
    rows,
    universeDays,
  });
}

// ---------------------------------------------------------------------------
// ExperimentConfig ↔ 数据集一致性
// ---------------------------------------------------------------------------

/**
 * 校验 ExperimentConfig.datasetVersion 与句柄 datasetVersion 一致。
 *
 * 这是「dataset version 可追溯」的落地：实验配置必须显式指向它实际消费的数据集，
 * 版本不一致（配 v1 跑 v2 / 数据集漂移）一律 FAIL FAST，禁止静默。
 */
export function assertDatasetVersionConsistent(config: ExperimentConfig, handle: ResearchDatasetHandle): void {
  if (config.datasetVersion !== handle.datasetVersion) {
    throw new Error(
      `实验配置 datasetVersion=${config.datasetVersion} 与数据集句柄 datasetVersion=${handle.datasetVersion} 不一致；` +
        `禁止用错误版本的数据集运行实验（dataset version 必须可追溯）。`,
    );
  }
}

// ---------------------------------------------------------------------------
// 序列化（绑定记录 + 摘要；稳定字段序，确定性）
// ---------------------------------------------------------------------------

/** 快照：句柄的绑定记录 + 窗口摘要（稳定字段序）。 */
export function snapshotDatasetHandle(handle: ResearchDatasetHandle): DatasetHandleSnapshot {
  const dateSet = new Set<string>();
  for (const row of handle.rows) dateSet.add(row.tradeDate);
  const tradingDayDates = Array.from(dateSet).sort();
  const securitySet = new Set<string>();
  for (const row of handle.rows) securitySet.add(row.securityId);
  const securityIds = Array.from(securitySet).sort();
  return {
    datasetVersion: handle.datasetVersion,
    builderVersion: handle.builderVersion,
    rowSchemaVersion: handle.rowSchemaVersion,
    universeId: handle.universeId,
    startDate: handle.startDate,
    endDate: handle.endDate,
    rowCount: handle.rowCount,
    universeDayCount: handle.universeDayCount,
    gate: handle.gate,
    tradingDayDates,
    securityIds,
  };
}

/** 句柄绑定记录 JSON（稳定字段序；同 handle 必然同串，可复现）。 */
export function serializeDatasetHandle(handle: ResearchDatasetHandle): string {
  return JSON.stringify(snapshotDatasetHandle(handle));
}

/** 反序列化绑定记录快照。 */
export function deserializeDatasetHandle(json: string): DatasetHandleSnapshot {
  const parsed: unknown = JSON.parse(json);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("DatasetHandle: 反序列化结果不是对象");
  }
  return parsed as DatasetHandleSnapshot;
}
