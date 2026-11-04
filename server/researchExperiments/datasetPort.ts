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

import type {
  ExperimentDescriptor,
  ExperimentDatasetRequirement,
  ExperimentDatasetVersionOption,
  ExperimentEvaluationWindow,
  ExperimentRequiredColumns,
} from "@shared/researchExperimentsContracts";
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
 * 事件扫描上限（**平台安全阀**）。
 *
 * 🔴 常量的权威来源已上移到**作者契约面**（`shared/researchExperimentsContracts.ts`）：
 * 这些数字同时约束平台实现**与**实验作者（实验要把它们写进 `summary.notes` 并据此
 * 计算「账目缺口」）。放在 `shared` 里，实验 `import` 到的是同一个值；
 * 各抄一份就意味着将来改阀时**静默漂移**（`9ci` 时 EXP-001 自己抄了一个 20000）。
 * 这里 re-export 保持既有 import 路径不破。
 */
import {
  EXPERIMENT_BAR_BATCH_SIZE,
  EXPERIMENT_EVENT_PAGE_SIZE,
  EXPERIMENT_EVENT_SCAN_HARD_LIMIT,
  EXPERIMENT_EVENT_SCAN_LIMIT,
} from "@shared/researchExperimentsContracts";

export {
  EXPERIMENT_BAR_BATCH_SIZE,
  EXPERIMENT_EVENT_PAGE_SIZE,
  EXPERIMENT_EVENT_SCAN_HARD_LIMIT,
  EXPERIMENT_EVENT_SCAN_LIMIT,
};

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

/**
 * 一次访问的计数（证明「读了什么」）。
 *
 * 🔴 这是 access 级**累计**计数：同一 access 上重复发起事件读取（`events()` 已缓存，
 *    但 `eventPages()` 每次调用都是一次真实分页扫描）会让 `eventCount` / `eventPageCount`
 *    如实累加 —— 它反映的是「这次访问实际读了多少」，不是「去重后有多少」。去重是实验自己的事。
 */
export interface ExperimentAccessStats {
  eventCount: number;
  /** 事件分页实际发生了几轮（证明「全量扫描是分页做的，不是一次性读」）。 */
  eventPageCount: number;
  /** 行情批量读实际发起了几次查询（每相对日 × 块数）。 */
  barQueryCount: number;
  prefixRowCount: number;
  postRowCount: number;
  maxPostRelativeDayRead: number | null;
  /** 事件扫描是否被安全阀截断（缺省阀或硬阀，取先触达的那个）。 */
  eventScanTruncated: boolean;
  /** 本次生效的事件扫描策略（来自实验声明）。 */
  eventScanPolicy: "PLATFORM_LIMIT" | "FULL_DATASET";
  /** 本次生效的扫描上限（＝策略对应的那个阀值）。 */
  eventScanLimit: number;
  /** 样本资格是否已冻结。 */
  selectionFrozen: boolean;
  /** 冻结样本数。 */
  selectedEventCount: number;
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
    requirement?: ExperimentDatasetRequirement;
    facts: ExperimentDatasetFacts;
    evaluationWindow?: ExperimentEvaluationWindow | null;
  }): {
    access: ExperimentDatasetAccess;
    stats: ExperimentAccessStats;
    freezeSelection: (eventIds: readonly string[]) => void;
  };
}

/** 真实实现：适配 `ResearchDatasetReader`（Research 侧唯一读取层）。 */
export function createRegistryExperimentDatasetPort(deps: {
  reader: Pick<
    ResearchDatasetReader,
    "getVersionContext" | "loadEventPage" | "loadPrefixBars" | "loadPostBars"
  >;
  /** 事件扫描上限；缺省「按实验声明的事件扫描策略」取阀值（见 `eventScanPolicy`）。 */
  eventScanLimit?: number;
  /** 版本目录实现（真实实现由 `defaults.ts` 注入 Dataset Registry；测试可给内存实现）。 */
  listVersionOptions?: (filter?: {
    datasetCode?: string;
  }) => Promise<ExperimentDatasetVersionOption[]>;
  /** 事件分页大小（每次 `loadEventPage` 的行数）；缺省 `EXPERIMENT_EVENT_PAGE_SIZE`。 */
  eventPageSize?: number;
  /** 行情批量读的分块大小；缺省 `EXPERIMENT_BAR_BATCH_SIZE`。 */
  barBatchSize?: number;
}): ExperimentDatasetPort {
  const reader = deps.reader;
  const pageSize = deps.eventPageSize ?? EXPERIMENT_EVENT_PAGE_SIZE;
  const barBatchSize = deps.barBatchSize ?? EXPERIMENT_BAR_BATCH_SIZE;

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
    requirement?: ExperimentDatasetRequirement;
    facts: ExperimentDatasetFacts;
    evaluationWindow?: ExperimentEvaluationWindow | null;
  }): {
    access: ExperimentDatasetAccess;
    stats: ExperimentAccessStats;
    freezeSelection: (eventIds: readonly string[]) => void;
  } {
    const { descriptor, facts, evaluationWindow = null } = args;
    const req = args.requirement ?? descriptor.datasetRequirement;

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

    /**
     * 本次生效的扫描上限 = 实验**显式声明**的策略对应的阀值。
     *
     * 🔴 这里不是「删掉了安全阀」，而是把「能不能突破单次扫描上限」变成一次
     *    **可复核的声明**：默认（或不声明）仍是 `EXPERIMENT_EVENT_SCAN_LIMIT`；
     *    只有写明 `FULL_DATASET` 才升到硬阀，且仍被硬阀兜住。
     */
    const eventScanPolicy: "PLATFORM_LIMIT" | "FULL_DATASET" =
      req.eventScanPolicy ?? "PLATFORM_LIMIT";
    const scanLimit =
      deps.eventScanLimit ??
      (eventScanPolicy === "FULL_DATASET"
        ? EXPERIMENT_EVENT_SCAN_HARD_LIMIT
        : EXPERIMENT_EVENT_SCAN_LIMIT);

    const stats: ExperimentAccessStats = {
      eventCount: 0,
      eventPageCount: 0,
      barQueryCount: 0,
      prefixRowCount: 0,
      postRowCount: 0,
      maxPostRelativeDayRead: null,
      eventScanTruncated: false,
      eventScanPolicy,
      eventScanLimit: scanLimit,
      selectionFrozen: false,
      selectedEventCount: 0,
    };

    const barCache = new Map<string, Promise<readonly ExperimentBarRow[]>>();
    let selectedEventIds: Set<string> | null = null;

    function freezeSelection(eventIds: readonly string[]): void {
      if (selectedEventIds !== null) {
        throw new ExperimentError(
          "EXPERIMENT_RUN_STATE_INVALID",
          `实验 "${descriptor.id}" 已经冻结过样本资格，禁止重复冻结`,
          { selectedEventCount: selectedEventIds.size },
        );
      }
      const unique = new Set(eventIds);
      selectedEventIds = unique;
      stats.selectionFrozen = true;
      stats.selectedEventCount = unique.size;
    }

    /**
     * 事件**流式分页**（chunked scan）：每轮 `loadEventPage` 拉一页，逐页交出。
     *
     * keyset 游标（`tradeDate` + `eventId`）续读 ⇒ 无重复、无跳洞；
     * 触达 `scanLimit` 即停止并把 `eventScanTruncated` 置真（**不静默**）。
     */
    async function* iterateEventPages(): AsyncGenerator<readonly ExperimentEventRow[], void, void> {
      let cursor: string | null = null;
      let collected = 0;
      for (;;) {
        const page = await reader.loadEventPage({
          datasetVersionId: facts.datasetVersionId,
          ...(evaluationWindow !== null
            ? {
                fromDate: evaluationWindow.startDate,
                toDate: evaluationWindow.endDate,
              }
            : {}),
          cursor,
          limit: pageSize,
          columns: projections.events,
        });
        // 防御：空页即终止（`nextCursor` 非空却给空页的实现会让循环空转）。
        if (page.items.length === 0) break;
        collected += page.items.length;
        stats.eventCount = collected;
        stats.eventPageCount += 1;
        yield page.items.map((item) => toEventRow(item, columns.events));
        cursor = page.nextCursor;
        if (cursor === null) break;
        if (collected >= scanLimit) {
          stats.eventScanTruncated = true;
          break;
        }
      }
    }

    let eventsPromise: Promise<readonly ExperimentEventRow[]> | null = null;

    async function loadEvents(): Promise<readonly ExperimentEventRow[]> {
      const collected: ExperimentEventRow[] = [];
      for await (const page of iterateEventPages()) {
        for (const row of page) collected.push(row);
      }
      return collected;
    }

    /**
     * 批量读一天的行情，**按 `barBatchSize` 分块**。
     *
     * 🔴 为什么必须分块：读取层的批量接口实现是**单条** `IN (eventId…)` 查询。
     *    全量扫描时 eventIds 上万，一次性下推会让 SQL 参数表无界膨胀
     *    （参数包 / 解析开销 / 计划退化）。分块后查询次数 = 「每相对日 × 块数」，
     *    量级仍是 O(相对日数 × N/块)，而不是 O(事件数 × 相对日数)。
     */
    async function loadBars(
      role: "prefix" | "post",
      relativeDay: number,
      eventIds: readonly string[],
    ): Promise<readonly ExperimentBarRow[]> {
      // 物理角色（prefix/post）与声明角色（feature/observation）的映射**只在这里**发生。
      const columnRole: "feature" | "observation" = role === "prefix" ? "feature" : "observation";
      const projected = columns[columnRole];
      const out: ExperimentBarRow[] = [];
      for (let start = 0; start < eventIds.length; start += barBatchSize) {
        const chunk = eventIds.slice(start, start + barBatchSize);
        const query = {
          datasetVersionId: facts.datasetVersionId,
          eventIds: chunk,
          relativeDays: [relativeDay],
          columns: projections[columnRole],
        };
        const rows =
          role === "prefix"
            ? await reader.loadPrefixBars(query)
            : await reader.loadPostBars(query);
        stats.barQueryCount += 1;
        for (const bar of rows) out.push(toBarRow(bar, projected));
      }
      if (role === "prefix") {
        stats.prefixRowCount += out.length;
      } else {
        stats.postRowCount += out.length;
        stats.maxPostRelativeDayRead =
          stats.maxPostRelativeDayRead === null
            ? relativeDay
            : Math.max(stats.maxPostRelativeDayRead, relativeDay);
      }
      return out;
    }

    const access: ExperimentDatasetAccess = {
      facts,
      async events() {
        eventsPromise ??= loadEvents();
        return eventsPromise;
      },
      eventPages() {
        // 每次调用都是**一次独立的分页扫描**（从第一页重新开始）；计数如实累加。
        return iterateEventPages();
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
        experimentAssert(
          selectedEventIds !== null,
          "EXPERIMENT_SELECTION_NOT_FROZEN",
          `实验 "${descriptor.id}" 在读取未来观察数据 rd=${relativeDay} 前未调用 freezeSelection()` +
            `（必须先冻结样本资格，随后未来数据只能用于已冻结样本的结果观察）`,
          { relativeDay },
        );
        // 空样本集可以继续走“无观测数据”的结果组装；没有样本时严禁再去触碰未来数据。
        if (selectedEventIds.size === 0) return [];
        const key = `post:${relativeDay}`;
        let pending = barCache.get(key);
        if (pending === undefined) {
          pending = (async () => {
            const events = await access.events();
            const selected = selectedEventIds;
            const eligibleEvents = selected === null
              ? events
              : events.filter((event) => selected.has(event.eventId));
            return loadBars(
              "post",
              relativeDay,
              eligibleEvents.map((e) => e.eventId),
            );
          })();
          barCache.set(key, pending);
        }
        return pending;
      },
    };

    return { access, stats, freezeSelection };
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
  assertRequirementRelativeDaysWithinHorizon(descriptor.id, descriptor.datasetRequirement, facts);
}

export function assertRequirementRelativeDaysWithinHorizon(
  experimentId: string,
  req: ExperimentDatasetRequirement,
  facts: ExperimentDatasetFacts,
): void {
  const postDays = req.postRelativeDays ?? [];
  if (postDays.length === 0) return;
  const range = facts.postRelativeDayRange;
  if (range === null) {
    throw new ExperimentError(
      "EXPERIMENT_RELATIVE_DAY_OUT_OF_RANGE",
      `数据集版本 ${facts.datasetVersionId} 没有 post（观察日）数据，` +
        `但实验 "${experimentId}" 声明了 postRelativeDays=[${postDays.join(", ")}]`,
      { datasetVersionId: facts.datasetVersionId, postDays },
    );
  }
  const beyond = postDays.filter((day) => day < range.min || day > range.max);
  if (beyond.length > 0) {
    throw new ExperimentError(
      "EXPERIMENT_RELATIVE_DAY_OUT_OF_RANGE",
      `实验 "${experimentId}" 声明的 post 相对日超出该版本真实视界 ` +
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
  assertRequirementCodeMatches(
    descriptor.id,
    descriptor.datasetRequirement,
    facts,
  );
}

export function assertRequirementCodeMatches(
  experimentId: string,
  requirement: ExperimentDatasetRequirement,
  facts: ExperimentDatasetFacts,
): void {
  if (facts.datasetCode !== requirement.datasetCode) {
    throw new ExperimentError(
      "EXPERIMENT_DATASET_CODE_MISMATCH",
      `实验 "${experimentId}" 声明需要数据集 "${requirement.datasetCode}"，` +
        `但版本 ${facts.datasetVersionId} 属于 "${facts.datasetCode}"`,
      { expected: requirement.datasetCode, actual: facts.datasetCode },
    );
  }
  if (
    requirement.requiredDatasetVersionLabel !== undefined &&
    facts.datasetVersionLabel !== requirement.requiredDatasetVersionLabel
  ) {
    throw new ExperimentError(
      "EXPERIMENT_DATASET_CODE_MISMATCH",
      `实验 "${experimentId}" 要求数据集版本 "${requirement.requiredDatasetVersionLabel}"，` +
        `但版本 ${facts.datasetVersionId} 是 "${facts.datasetVersionLabel}"`,
      {
        expected: requirement.requiredDatasetVersionLabel,
        actual: facts.datasetVersionLabel,
      },
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
