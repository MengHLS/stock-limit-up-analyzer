/**
 * OOS-001 §6 — OOS 数据窗口隔离规则（**纯函数**，零 IO）。
 *
 * ## 为什么单独一个文件
 *
 * 「OOS 与 Search 必须数据隔离」是本任务**最核心的正确性主张**（规格 §20 完成标准第一条）。
 * 它是**一条判定**，因此必须有**唯一实现**：任何调用方（executor / 路由 / 测试 / 探针）
 * 都调这里，而不是各写一遍 `if (oosStart <= searchEnd)` —— 那样「隔离」就变成口号。
 *
 * ## 判定顺序（顺序即语义；报错按最先卡住的那条给，避免一次抛 5 条把人淹没）
 *
 * ```text
 * ① 日期形态      两端都必须是 YYYY-MM-DD            ⇒ OOS_WINDOW_INVALID
 * ② 自身合法      oosStart <  oosEnd                  ⇒ OOS_WINDOW_INVALID
 * ③ 源窗口合法    searchStart <= searchEnd            ⇒ OOS_SEARCH_WINDOW_INVALID
 * ④ 不重叠        oosStart >  searchEnd（**默认禁止重叠**）⇒ OOS_WINDOW_OVERLAP
 * ⑤ 在数据集内    datasetStart <= oosStart ∧ oosEnd <= datasetEnd
 *                                                      ⇒ OOS_WINDOW_OUT_OF_DATASET_RANGE
 * ```
 *
 * 日期一律按 `YYYY-MM-DD` **字典序**比较（与 PARAMETER-001/002 的业务日口径一致；
 * ⚠️ `dataset_version.startDate/endDate` 是 UTC 时间戳，取业务日必须按北京时区 ——
 * 那是 `parameterSearch/persistence.ts#readDatasetVersionWindow` 的职责，本层只吃已归一化的字符串）。
 *
 * 🔴 「默认禁止重叠」的含义：本层**不提供**允许重叠的开关。规格 §6 允许未来出现
 *   `allowOverlap` 之类的显式语义，但那必须是一次**显式的契约变更**并留下领域码；
 *   在没有那条变更之前，任何重叠都是错误的，不做「差一点就放过」的宽容。
 */

import { ResearchValidationError } from "../experimentValidation";

/** 业务日格式（`YYYY-MM-DD`）。 */
const BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 一个闭区间窗口。 */
export interface WindowInput {
  readonly startDate: string;
  readonly endDate: string;
}

/** 窗口隔离判定结果（成功路径也**如实说明**结论，供 Run notes 留档）。 */
export interface WindowIsolationReport {
  /** OOS 窗口相对 Search 窗口的间隔天数（按日历日；> 0 = 有间隔，恰为 1 = 紧邻）。 */
  readonly gapDays: number;
  readonly note: string;
}

function assertBusinessDate(
  value: string,
  path: string,
  code: "OOS_WINDOW_INVALID" | "OOS_SEARCH_WINDOW_INVALID",
): void {
  if (!BUSINESS_DATE.test(value)) {
    throw new ResearchValidationError([
      {
        code,
        path,
        message: `日期必须是 YYYY-MM-DD（收到 ${JSON.stringify(value)}）—— 本域一律按北京业务日比较。`,
      },
    ]);
  }
  // 形态合法但日期不存在（如 2025-02-30）也要判非法：用 UTC 解析回读比对。
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ResearchValidationError([
      {
        code,
        path,
        message: `日期不是真实存在的日历日：${value}`,
      },
    ]);
  }
}

/**
 * 两个业务日之间的日历日差（`to` − `from`）。
 *
 * ⚠️ 带 `oos` 前缀是因为 `server/research/disciplineFeedback/common.ts` 已有同名
 *   `calendarDaysBetween`，且它经 `server/research/index.ts` 全域 re-export ⇒
 *   同名会在聚合时**静默遮蔽**（ESM `export *` 对冲突名直接不导出）。
 */
export function oosCalendarDaysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00.000Z`);
  const b = Date.parse(`${to}T00:00:00.000Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * 校验单个窗口自身合法（形态 + 起止顺序）。
 *
 * `code` 由调用方指定：**源窗口**的问题必须报 `OOS_SEARCH_WINDOW_INVALID`
 * （问题在**上游数据**，不是调用方给的 OOS 窗口），否则排查时会去找错方向。
 * 缺省 = `OOS_WINDOW_INVALID`（OOS 窗口自身的问题）。
 */
export function assertWindowWellFormed(
  window: WindowInput,
  label: string,
  code: "OOS_WINDOW_INVALID" | "OOS_SEARCH_WINDOW_INVALID" = "OOS_WINDOW_INVALID",
): void {
  assertBusinessDate(window.startDate, `${label}.startDate`, code);
  assertBusinessDate(window.endDate, `${label}.endDate`, code);
  if (window.startDate > window.endDate) {
    throw new ResearchValidationError([
      {
        code,
        path: `${label}.startDate`,
        message:
          `${label} 起止倒挂：${window.startDate}..${window.endDate}（要求 start <= end）。`,
      },
    ]);
  }
}

/**
 * 断言 OOS 窗口与 Search 窗口**严格隔离**，并通过数据集可用窗口校验。
 *
 * `datasetWindow` 为 `null` ⇒ **跳过**第 ⑤ 条并在 note 里如实说明「未校验数据集范围」
 * （不猜窗口；调用方据此知道本次没有这层保护）。
 */
export function assertOosWindowIsolated(input: {
  readonly searchWindow: WindowInput;
  readonly oosWindow: WindowInput;
  readonly datasetWindow: WindowInput | null;
}): WindowIsolationReport {
  assertWindowWellFormed(input.searchWindow, "searchWindow", "OOS_SEARCH_WINDOW_INVALID");
  assertWindowWellFormed(input.oosWindow, "oosWindow", "OOS_WINDOW_INVALID");

  const { searchWindow, oosWindow } = input;
  if (oosWindow.startDate <= searchWindow.endDate) {
    throw new ResearchValidationError([
      {
        code: "OOS_WINDOW_OVERLAP",
        path: "oosWindow.startDate",
        message:
          `OOS 窗口与 Search 窗口重叠：search window = ${searchWindow.startDate}..${searchWindow.endDate}，`
          + `oos window = ${oosWindow.startDate}..${oosWindow.endDate}。`
          + `要求 oosStart > searchEnd（**默认禁止重叠**）—— 重叠就不是样本外：`
          + `把 OOS 起点挪到 ${searchWindow.endDate} 之后（当天也可，即 ${searchWindow.endDate} 之后的第一天）。`,
      },
    ]);
  }

  if (input.datasetWindow !== null) {
    const range = `${input.datasetWindow.startDate}..${input.datasetWindow.endDate}`;
    if (
      oosWindow.startDate < input.datasetWindow.startDate
      || oosWindow.endDate > input.datasetWindow.endDate
    ) {
      throw new ResearchValidationError([
        {
          code: "OOS_WINDOW_OUT_OF_DATASET_RANGE",
          path: "oosWindow.startDate",
          message:
            `OOS 窗口超出绑定数据集可用窗口：oos window = ${oosWindow.startDate}..${oosWindow.endDate}，`
            + `dataset window = ${range}（含两端，按北京业务日）。`
            + `越界会让 OOS 回测以 SIM_RANGE_OUT_OF_DATASET 失败 —— `
            + `与其跑一半才失败，不如在创建时就拒绝；请把窗口收窄到数据集窗口内。`,
        },
      ]);
    }
  }

  const gapDays = oosCalendarDaysBetween(searchWindow.endDate, oosWindow.startDate);
  const datasetNote =
    input.datasetWindow === null
      ? "未校验数据集可用窗口（调用方未提供 datasetVersionId / 查不到该版本）—— 本次 OOS 缺少这层保护，越界会在执行期失败。"
      : `OOS 窗口落在数据集可用窗口 ${input.datasetWindow.startDate}..${input.datasetWindow.endDate} 内。`;
  return {
    gapDays,
    note:
      `窗口隔离通过：search window = ${searchWindow.startDate}..${searchWindow.endDate}，`
      + `oos window = ${oosWindow.startDate}..${oosWindow.endDate}（间隔 ${String(gapDays)} 个日历日，`
      + `oosStart(${oosWindow.startDate}) > searchEnd(${searchWindow.endDate})）。${datasetNote}`,
  };
}
