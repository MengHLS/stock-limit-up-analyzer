/**
 * SINGLE_FACTOR_EXPERIMENT_V1 —— **PIT Data Access**（通用基础之一）。
 *
 * ## 职责
 *
 * 1. 按声明过的相对日读行情（唯一读法：走 `context.dataset`，不碰 DB）；
 * 2. 把「相对日 → 交易日」的映射暴露给上层 ⇒ 逐笔留档里的 `signalDate` /
 *    `entryDate` / `exitDate` 是**真实交易日**，不是「相对日 × 自然日」推算出来的；
 * 3. 提供 `PIT_INFORMATION_CUTOFF` 的**执行级闸门**：任何 `rd > 5` 的取值都抛错。
 *
 * ## 为什么读 `rd ∈ [1,6] ∪ [10,20]`
 *
 * - `1..5`：因子计算可用的**全部**未来信息（观察窗）；
 * - `6`：入场日（`T+6` 开盘）——它不是「信息」，是**成交点**；
 * - `10..20`：退出日及其顺延搜索范围——同样只用于**成交**，不回流到因子或排名。
 *
 * ⇒ 结构上「因子 / 排名 / 信号」拿不到 `rd > 5` 的数据（见 `factorAccessOf`）。
 *
 * ## 成本
 *
 * 这些相对日 12F 的 `derive.ts` 已经读过一次；`server/researchExperiments/datasetPort.ts`
 * 对 `loadPostBars` 做了**单飞缓存**（`barCache`），因此这里的重复读取命中同一个 Promise，
 * **不会产生第二次数据库查询**。这是「双读对拍」在性能上可行的前提。
 */

import type {
  ExperimentBarRow,
  ExperimentRunContext,
} from "@shared/researchExperimentsContracts";
import {
  ENTRY_DAY,
  EXIT_CANDIDATE_RELATIVE_DAYS,
} from "./coordinate";
import {
  OBSERVATION_RELATIVE_DAYS,
  PIT_INFORMATION_CUTOFF_RELATIVE_DAY,
} from "./types";

/** 「成交侧」相对日：入场日 + 退出候选日（只用于成交，不参与因子与排名）。 */
export const EXECUTION_RELATIVE_DAYS: readonly number[] = [
  ENTRY_DAY,
  ...EXIT_CANDIDATE_RELATIVE_DAYS,
];

/** 本模块实际声明的全部相对日（去重升序）。 */
export const PIT_READ_RELATIVE_DAYS: readonly number[] = [
  ...new Set([...OBSERVATION_RELATIVE_DAYS, ...EXECUTION_RELATIVE_DAYS]),
].sort((left, right) => left - right);

/**
 * 一个事件的 PIT 视图。
 *
 * 🔴 `factorBarAt()` 是**唯一**允许给因子计算用的入口：它只接受观察窗内的相对日，
 * 越界抛错 ⇒ 「用了未来数据」不是靠纪律禁止，而是取不到。
 */
export interface PitEventAccess {
  readonly eventId: string;
  /** 真实交易日（缺失时 `null`）。 */
  tradeDateAt(relativeDay: number): string | null;
  /** 成交侧行情（入场 / 退出用）。 */
  executionBarAt(relativeDay: number): ExperimentBarRow | undefined;
  /** 因子侧行情（**仅**观察窗内）。 */
  factorBarAt(relativeDay: number): ExperimentBarRow | undefined;
}

export interface PitAccessLoadResult {
  readonly byEventId: ReadonlyMap<string, PitEventAccess>;
  /** 实际读到的相对日（可用于复核「读了什么」）。 */
  readonly readRelativeDays: readonly number[];
  /** OBSERVATION 侧的相对日行数（每相对日的行数之和）。 */
  readonly observationRowCount: number;
  readonly executionRowCount: number;
}

function createEventAccess(
  eventId: string,
  barsByDay: ReadonlyMap<number, ReadonlyMap<string, ExperimentBarRow>>
): PitEventAccess {
  return {
    eventId,
    tradeDateAt(relativeDay) {
      return barsByDay.get(relativeDay)?.get(eventId)?.tradeDate ?? null;
    },
    executionBarAt(relativeDay) {
      if (!EXECUTION_RELATIVE_DAYS.includes(relativeDay)) {
        throw new Error(
          `PIT 违约：相对日 ${relativeDay} 不在成交侧声明范围 ` +
            `[${EXECUTION_RELATIVE_DAYS.join(", ")}] 内`
        );
      }
      return barsByDay.get(relativeDay)?.get(eventId);
    },
    factorBarAt(relativeDay) {
      if (!OBSERVATION_RELATIVE_DAYS.includes(relativeDay)) {
        throw new Error(
          `PIT 违约：因子计算只允许读观察窗 T+${OBSERVATION_RELATIVE_DAYS[0]}..T+` +
            `${PIT_INFORMATION_CUTOFF_RELATIVE_DAY}，请求了相对日 ${relativeDay}`
        );
      }
      return barsByDay.get(relativeDay)?.get(eventId);
    },
  };
}

/**
 * 读一遍 PIT 视图。
 *
 * `eventIds` 为空集合时返回空表（调用方决定这是不是错误）。
 */
export async function loadPitAccess(
  context: ExperimentRunContext,
  eventIds: readonly string[]
): Promise<PitAccessLoadResult> {
  const barsByDay = new Map<number, ReadonlyMap<string, ExperimentBarRow>>();
  let observationRowCount = 0;
  let executionRowCount = 0;
  for (const relativeDay of PIT_READ_RELATIVE_DAYS) {
    const rows = await context.dataset.observation(relativeDay);
    barsByDay.set(relativeDay, new Map(rows.map(row => [row.eventId, row])));
    if (OBSERVATION_RELATIVE_DAYS.includes(relativeDay)) {
      observationRowCount += rows.length;
    } else {
      executionRowCount += rows.length;
    }
  }

  const byEventId = new Map<string, PitEventAccess>();
  for (const eventId of eventIds) {
    byEventId.set(eventId, createEventAccess(eventId, barsByDay));
  }

  return {
    byEventId,
    readRelativeDays: PIT_READ_RELATIVE_DAYS,
    observationRowCount,
    executionRowCount,
  };
}

/**
 * PIT 自查：所有事件的 `signalDate` / `entryDate` 都必须真实存在，
 * 且顺序满足 `T < signal(T+5) < entry(T+6) ≤ exit`。
 *
 * 交易日历**只认平台数据**：任何一天取不到 `tradeDate` 都说明声明窗口与数据集视界不符，
 * 此时必须失败（继续算会产出一批「日期是 null」的逐笔记录）。
 */
export function assertPitDatesResolved(
  entries: readonly {
    eventId: string;
    eventDate: string;
    signalDate: string | null;
    entryDate: string | null;
  }[]
): void {
  const broken = entries.filter(
    entry =>
      entry.signalDate === null ||
      entry.entryDate === null ||
      !(entry.eventDate < entry.signalDate!) ||
      !(entry.signalDate! < entry.entryDate!)
  );
  if (broken.length > 0) {
    const sample = broken
      .slice(0, 5)
      .map(
        entry =>
          `${entry.eventId}(T=${entry.eventDate}, signal=${entry.signalDate ?? "null"}, ` +
          `entry=${entry.entryDate ?? "null"})`
      )
      .join("; ");
    throw new Error(
      `PIT 日期未解析或顺序非法：${broken.length} 个事件（示例 ${sample}）。` +
        `请检查 Dataset 视界是否覆盖 T+${PIT_INFORMATION_CUTOFF_RELATIVE_DAY} 与 T+${ENTRY_DAY}。`
    );
  }
}
