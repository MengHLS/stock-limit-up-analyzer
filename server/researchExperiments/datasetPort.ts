/**
 * RESEARCH-EXPERIMENT-001 — Dataset 桥（实验侧**唯一**取数通路）。
 *
 * ## 职责
 *
 * 把「实验声明的 Dataset 需求」翻译成对**既有** Dataset 读取层的调用：
 *
 * ```
 * ExperimentDatasetRequirement            （实验声明：版本由调用方给）
 *   ↓  列名 → 物理列校验（drizzle 表对象，声明了不存在的列当场拒）
 *   ↓  相对日 → 白名单（未声明的相对日读不到）
 *   ↓  rd ≥ 1 → usesForwardData 结构级闸门
 * ResearchDatasetReader                   （server/researchEngine/datasetReader.ts）
 *   ↓
 * ds_first_limit_pullback_{event,prefix,post}
 * ```
 *
 * 🔴 纪律（与 `server/runWorkbenchAssembly/datasetFromRegistry.ts` 同源）：
 *   1. **不新增第二套读取实现** —— 一律复用 `ResearchDatasetReader`（Research 侧唯一读取层），
 *      它内部再复用 Dataset Registry 的 `DatasetDataReader`（表名白名单 / keyset / 索引基建）；
 *   2. **不猜不造** —— 版本不存在 / 不是 READY / 语义代码不匹配 / 相对日超出真实视界
 *      一律**响亮抛领域错误**，不静默回落到别的版本或别的窗口；
 *   3. **版本强制下推** —— 每个查询都带 `datasetVersionId`（读取层本身不提供跨版本入口）；
 *   4. **不给 DB 句柄** —— 实验只能通过 `ExperimentDatasetAccess` 取数，
 *      拿不到 `db` / 表对象 / 任意 SQL 的能力。
 */

import type { ExperimentDescriptor, ExperimentDatasetVersionOption, ExperimentRequiredColumns } from "@shared/researchExperimentsContracts";
import {
  firstLimitPullbackEvents,
  firstLimitPullbackPrefixes,
  firstLimitPullbackPosts,
} from "../../drizzle/schema";
import type { FirstLimitPullbackEvent, FirstLimitPullbackRawBar } from "../datasetRegistry/types";
import { STRUCTURAL_COLUMNS } from "../researchRuntime/datasetColumns";
import type { RegistryResearchDatasetReader, ResearchDatasetReader } from "../researchRuntime/datasetReader";
import type { ResearchDatasetVersionContext } from "../researchRuntime/versionContext";
import { ExperimentError, experimentAssert } from "./errors";
import type {
  ExperimentBarRow,
  ExperimentDatasetAccess,
  ExperimentDatasetFacts,
  ExperimentEventRow,
} from "./types";

/**
 * 事件扫描上限（**平台安全阀**，不是研究范围）。
 *
 * 一个实验最多扫这么多事件；超出部分**不会静默丢弃** —— runner 会把它写进
 * `sampleSummary.notes` 与 `executedByReason`，让「本次只看了前 N 个事件」成为可见事实。
 */
export const EXPERIMENT_EVENT_SCAN_LIMIT = 20000;

/** 列投影的可用表（列名白名单的权威来源 = drizzle 表对象）。 */
const COLUMN_TABLES = {
  events: firstLimitPullbackEvents,
  feature: firstLimitPullbackPrefixes,
  observation: firstLimitPullbackPosts,
} as const;

/** 行级身份列（永远可读，不受投影影响；不参与 `requiredColumns` 声明）。 */
const ROW_IDENTITY_KEYS = ["relativeDay", "tradeDate", "eventId", "symbol"] as const;

/**
 * 每个声明角色的**骨架列**（无论实验声明什么都必须 SELECT）。
 *
 * 🔴 复用既有唯一权威 `STRUCTURAL_COLUMNS`（`server/researchEngine/columnProjection.ts`），
 * 再补上本契约承诺的行身份列（`ExperimentBarRow` 声明了 `tradeDate` / `symbol`）。
 *
 * 为什么必须补齐：`buildColumnSelection` **只** SELECT 清单里的列
 * ⇒ 漏了 `eventId` 时领域映射器会产出 `eventId: undefined`，
 * 后续按 eventId 批量取行情会**恒返回 0 行**（而内存读取层不实现列裁剪 ⇒ 单测全绿）。
 * 本会话真库 E2E 实测就是这个症状：`prefixRowCount = 0 / postRowCount = 0`。
 */
const ROLE_SKELETON_COLUMNS: Readonly<Record<keyof typeof COLUMN_TABLES, readonly string[]>> = {
  events: STRUCTURAL_COLUMNS.event,
  feature: [...STRUCTURAL_COLUMNS.prefix, "symbol", "tradeDate"],
  observation: [...STRUCTURAL_COLUMNS.post, "symbol", "tradeDate"],
};

/** 实际下推的列 = 骨架列 ∪ 声明列（顺序稳定：骨架在前）。 */
function projectionFor(
  role: keyof typeof COLUMN_TABLES,
  declared: readonly string[],
): readonly string[] {
  const merged: string[] = [...ROLE_SKELETON_COLUMNS[role]];
  for (const name of declared) if (!merged.includes(name)) merged.push(name);
  return merged;
}

/** 校验声明列是否真实存在（写错列名必须当场失败，否则会静默全 null）。 */
function assertDeclaredColumns(
  role: keyof typeof COLUMN_TABLES,
  columns: readonly string[],
  experimentId: string,
): void {
  const table = COLUMN_TABLES[role] as unknown as Record<string, unknown>;
  for (const name of columns) {
    if (ROW_IDENTITY_KEYS.includes(name as (typeof ROW_IDENTITY_KEYS)[number])) continue;
    if (table[name] === undefined) {
      throw new ExperimentError(
        "EXPERIMENT_METADATA_INVALID",
        `实验 "${experimentId}" 在 requiredColumns.${role} 里声明了不存在的列 "${name}"` +
          `（该表没有此列；写错列名会让取值静默变 null，因此在此拒绝）`,
        { role, column: name },
      );
    }
  }
}

/** 按声明投影一行：只保留声明过的列（未声明的列在结构上不存在）。 */
function projectRow(
  source: Readonly<Record<string, unknown>>,
  columns: readonly string[],
): Readonly<Record<string, number | boolean | string | null>> {
  const values: Record<string, number | boolean | string | null> = {};
  for (const name of columns) {
    const value = source[name];
    if (value === null || value === undefined) {
      values[name] = null;
    } else if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
      values[name] = value;
    } else {
      // 日期等非常规标量一律按字符串透传（不臆测语义）。
      values[name] = String(value);
    }
  }
  return values;
}

function toEventRow(event: FirstLimitPullbackEvent, columns: readonly string[]): ExperimentEventRow {
  return {
    eventId: event.eventId,
    symbol: event.symbol,
    relativeDay: 0,
    tradeDate: event.tradeDate,
    values: projectRow(event as unknown as Record<string, unknown>, columns),
  };
}

function toBarRow(bar: FirstLimitPullbackRawBar, columns: readonly string[]): ExperimentBarRow {
  return {
    eventId: bar.eventId,
    symbol: bar.symbol,
    relativeDay: bar.relativeDay,
    tradeDate: bar.tradeDate,
    values: projectRow(bar as unknown as Record<string, unknown>, columns),
  };
}

/** 一次访问的计数（证明「读了什么」）。 */
export interface ExperimentAccessStats {
  eventCount: number;
  prefixRowCount: number;
  postRowCount: number;
  maxPostRelativeDayRead: number | null;
  /** 事件扫描是否被平台安全阀截断。 */
  eventScanTruncated: boolean;
}

// ---------------------------------------------------------------------------
// 端口
// ---------------------------------------------------------------------------

export interface ExperimentDatasetPort {
  /** 取版本事实；不存在返回 null（由调用方决定是否抛错）。 */
  getVersionFacts(datasetVersionId: number): Promise<ExperimentDatasetFacts | null>;
  /**
   * Dataset 版本目录（前端选择器；只读）。
   *
   * `datasetCode` 过滤是**交付要求**而非优化：一个实验只对某一种数据集有意义，
   * 把别的数据集的版本列出来只会诱导用户选错（随后被 `assertDatasetCodeMatches` 拒绝）。
   */
  listVersionOptions(filter?: { datasetCode?: string }): Promise<ExperimentDatasetVersionOption[]>;
  /** 按声明构造一次性的取数句柄（惰性读取 + 同相对日缓存）。 */
  createAccess(args: {
    descriptor: ExperimentDescriptor;
    facts: ExperimentDatasetFacts;
  }): { access: ExperimentDatasetAccess; stats: ExperimentAccessStats };
}

/** 真实实现：适配 `ResearchDatasetReader`（Research 侧唯一读取层）。 */
export function createRegistryExperimentDatasetPort(deps: {
  reader: Pick<
    ResearchDatasetReader,
    "getVersionContext" | "loadEventPage" | "loadPrefixBars" | "loadPostBars"
  >;
  /** 事件扫描上限；缺省 `EXPERIMENT_EVENT_SCAN_LIMIT`。 */
  eventScanLimit?: number;
  /** 版本目录实现（真实实现由 `defaults.ts` 注入 Dataset Registry；测试可给内存实现）。 */
  listVersionOptions?: (filter?: {
    datasetCode?: string;
  }) => Promise<ExperimentDatasetVersionOption[]>;
  /** 事件分页大小（每次 `loadEventPage` 的行数）。 */
  eventPageSize?: number;
}): ExperimentDatasetPort {
  const reader = deps.reader;
  const scanLimit = deps.eventScanLimit ?? EXPERIMENT_EVENT_SCAN_LIMIT;
  const pageSize = deps.eventPageSize ?? 2000;

  async function getVersionFacts(datasetVersionId: number): Promise<ExperimentDatasetFacts | null> {
    const context: ResearchDatasetVersionContext | null = await reader.getVersionContext(datasetVersionId);
    if (!context) return null;
    return {
      datasetVersionId: context.datasetVersionId,
      datasetCode: context.datasetCode,
      datasetName: context.datasetName,
      datasetVersionLabel: context.versionLabel,
      status: context.status,
      startDate: context.startDate,
      endDate: context.endDate,
      totalEvents: context.totalEvents,
      postRelativeDayRange: context.postRelativeDayRange,
    };
  }

  function createAccess(args: {
    descriptor: ExperimentDescriptor;
    facts: ExperimentDatasetFacts;
  }): { access: ExperimentDatasetAccess; stats: ExperimentAccessStats } {
    const { descriptor, facts } = args;
    const req = descriptor.datasetRequirement;

    const columns: Record<keyof typeof COLUMN_TABLES, readonly string[]> = {
      events: req.requiredColumns.events ?? [],
      feature: req.requiredColumns.feature ?? [],
      observation: req.requiredColumns.observation ?? [],
    };
    for (const role of ["events", "feature", "observation"] as const) {
      assertDeclaredColumns(role, columns[role], descriptor.id);
    }

    // 下推给读取层的列 = 骨架列 ∪ 声明列。骨架列用于构造行身份，
    // 不进 `values`（实验仍然只能读到声明过的列）。
    const projections: Record<keyof typeof COLUMN_TABLES, readonly string[]> = {
      events: projectionFor("events", columns.events),
      feature: projectionFor("feature", columns.feature),
      observation: projectionFor("observation", columns.observation),
    };
    // 声明过的相对日 = 唯一白名单；排序去重保证「同一声明 ⇒ 同一批查询」。
    const prefixDays = [...new Set(req.prefixRelativeDays ?? [])].sort((a, b) => a - b);
    const postDays = [...new Set(req.postRelativeDays ?? [])].sort((a, b) => a - b);

    const stats: ExperimentAccessStats = {
      eventCount: 0,
      prefixRowCount: 0,
      postRowCount: 0,
      maxPostRelativeDayRead: null,
      eventScanTruncated: false,
    };

    let eventsPromise: Promise<readonly ExperimentEventRow[]> | null = null;
    const barCache = new Map<string, Promise<readonly ExperimentBarRow[]>>();

    async function loadEvents(): Promise<readonly ExperimentEventRow[]> {
      const collected: ExperimentEventRow[] = [];
      let cursor: string | null = null;
      for (;;) {
        const page = await reader.loadEventPage({
          datasetVersionId: facts.datasetVersionId,
          cursor,
          limit: pageSize,
          columns: projections.events,
        });
        for (const item of page.items) collected.push(toEventRow(item, columns.events));
        cursor = page.nextCursor;
        if (cursor === null) break;
        if (collected.length >= scanLimit) {
          stats.eventScanTruncated = true;
          break;
        }
      }
      stats.eventCount = collected.length;
      return collected;
    }

    async function loadBars(
      role: "prefix" | "post",
      relativeDay: number,
      eventIds: readonly string[],
    ): Promise<readonly ExperimentBarRow[]> {
      // 物理角色（prefix/post）与声明角色（feature/observation）的映射**只在这里**发生。
      const columnRole: "feature" | "observation" = role === "prefix" ? "feature" : "observation";
      const projected = columns[columnRole];
      const query = {
        datasetVersionId: facts.datasetVersionId,
        eventIds,
        relativeDays: [relativeDay],
        columns: projections[columnRole],
      };
      const rows =
        role === "prefix"
          ? await reader.loadPrefixBars(query)
          : await reader.loadPostBars(query);
      if (role === "prefix") {
        stats.prefixRowCount += rows.length;
      } else {
        stats.postRowCount += rows.length;
        stats.maxPostRelativeDayRead =
          stats.maxPostRelativeDayRead === null
            ? relativeDay
            : Math.max(stats.maxPostRelativeDayRead, relativeDay);
      }
      return rows.map((bar) => toBarRow(bar, projected));
    }

    const access: ExperimentDatasetAccess = {
      facts,
      async events() {
        eventsPromise ??= loadEvents();
        return eventsPromise;
      },
      async feature(relativeDay: number) {
        if (!prefixDays.includes(relativeDay)) {
          throw new ExperimentError(
            "EXPERIMENT_DATASET_REQUIREMENT_INVALID",
            `实验 "${descriptor.id}" 未在 prefixRelativeDays 里声明 rd=${relativeDay}，禁止读取` +
              `（已声明：[${prefixDays.join(", ")}]）`,
            { relativeDay, declared: prefixDays },
          );
        }
        const key = `prefix:${relativeDay}`;
        let pending = barCache.get(key);
        if (pending === undefined) {
          pending = (async () => {
            const events = await access.events();
            return loadBars(
              "prefix",
              relativeDay,
              events.map((e) => e.eventId),
            );
          })();
          barCache.set(key, pending);
        }
        return pending;
      },
      async observation(relativeDay: number) {
        // 🔴 结构级 PIT 闸门：未声明 usesForwardData 时**调用即抛**。
        experimentAssert(
          req.usesForwardData === true,
          "EXPERIMENT_FORWARD_DATA_FORBIDDEN",
          `实验 "${descriptor.id}" 未声明 usesForwardData: true，禁止读取事件日之后的数据（rd=${relativeDay}）`,
          { relativeDay },
        );
        if (!postDays.includes(relativeDay)) {
          throw new ExperimentError(
            "EXPERIMENT_DATASET_REQUIREMENT_INVALID",
            `实验 "${descriptor.id}" 未在 postRelativeDays 里声明 rd=${relativeDay}，禁止读取` +
              `（已声明：[${postDays.join(", ")}]）`,
            { relativeDay, declared: postDays },
          );
        }
        const key = `post:${relativeDay}`;
        let pending = barCache.get(key);
        if (pending === undefined) {
          pending = (async () => {
            const events = await access.events();
            return loadBars(
              "post",
              relativeDay,
              events.map((e) => e.eventId),
            );
          })();
          barCache.set(key, pending);
        }
        return pending;
      },
    };

    return { access, stats };
  }

  return {
    getVersionFacts,
    async listVersionOptions(filter) {
      if (deps.listVersionOptions) return deps.listVersionOptions(filter);
      return [];
    },
    createAccess,
  };
}

/** 便捷：把 `RegistryResearchDatasetReader` 直接当 reader 用（类型收窄，避免误传）。 */
export type ExperimentDatasetReaderSource = Pick<
  RegistryResearchDatasetReader,
  "getVersionContext" | "loadEventPage" | "loadPrefixBars" | "loadPostBars"
>;

/** 声明式校验：相对日必须落在该版本的真实视界内（超出即拒，不夹取）。 */
export function assertRelativeDaysWithinHorizon(
  descriptor: ExperimentDescriptor,
  facts: ExperimentDatasetFacts,
): void {
  const req = descriptor.datasetRequirement;
  const postDays = req.postRelativeDays ?? [];
  if (postDays.length === 0) return;
  const range = facts.postRelativeDayRange;
  if (range === null) {
    throw new ExperimentError(
      "EXPERIMENT_RELATIVE_DAY_OUT_OF_RANGE",
      `数据集版本 ${facts.datasetVersionId} 没有 post（观察日）数据，` +
        `但实验 "${descriptor.id}" 声明了 postRelativeDays=[${postDays.join(", ")}]`,
      { datasetVersionId: facts.datasetVersionId, postDays },
    );
  }
  const beyond = postDays.filter((day) => day < range.min || day > range.max);
  if (beyond.length > 0) {
    throw new ExperimentError(
      "EXPERIMENT_RELATIVE_DAY_OUT_OF_RANGE",
      `实验 "${descriptor.id}" 声明的 post 相对日超出该版本真实视界 ` +
        `[${range.min}, ${range.max}]：${beyond.join(", ")}（**夹取等于悄悄改窄研究范围**，故拒绝）`,
      { beyond, range },
    );
  }
}

/** 声明式校验：Dataset 语义代码必须与实验声明一致。 */
export function assertDatasetCodeMatches(
  descriptor: ExperimentDescriptor,
  facts: ExperimentDatasetFacts,
): void {
  if (facts.datasetCode !== descriptor.datasetRequirement.datasetCode) {
    throw new ExperimentError(
      "EXPERIMENT_DATASET_CODE_MISMATCH",
      `实验 "${descriptor.id}" 声明需要数据集 "${descriptor.datasetRequirement.datasetCode}"，` +
        `但版本 ${facts.datasetVersionId} 属于 "${facts.datasetCode}"`,
      { expected: descriptor.datasetRequirement.datasetCode, actual: facts.datasetCode },
    );
  }
}

/** 声明式校验：版本必须 READY。 */
export function assertVersionReady(facts: ExperimentDatasetFacts): void {
  if (facts.status !== "READY") {
    throw new ExperimentError(
      "EXPERIMENT_DATASET_VERSION_NOT_READY",
      `数据集版本 ${facts.datasetVersionId}（${facts.datasetVersionLabel}）status=${facts.status}，` +
        `只有 READY 版本可用于实验`,
      { status: facts.status },
    );
  }
}

/** 只读辅助：把声明列按角色摊平（运行时诊断 / 前端展示）。 */
export function flattenRequiredColumns(required: ExperimentRequiredColumns): string[] {
  return [
    ...(required.events ?? []),
    ...(required.feature ?? []),
    ...(required.observation ?? []),
  ];
}
