/**
 * RESEARCH-004 — SEGMENT_RELATION 的窗装配（**唯一**把「已解析配置」翻成「真实变量名」的地方）。
 *
 * 为什么单独成模块：窗参数的读取者不止一个 ——
 *   - `analyses/segmentRelation.ts#requiredVariables` 要据此声明装载需求；
 *   - 同名执行器 `execute` 要据此取样本值；
 *   - 结果 metadata / 报告要据此如实记录「这次跑的是哪两个变量」。
 * 三处各自拼一遍变量名，就会出现「声明装的是 A、实际读的是 B」这类静默错配。
 *
 * 纪律：**不给默认窗**。缺窗即返回 `null`，由调用方具名失败 ——
 * 替用户猜一个「看起来合理」的窗等于替他选题，而他的研究问题可能恰好不是那个。
 */

import type { SegmentStatKind } from "../researchCore";
import type { ResolvedEngineAnalysisConfig } from "./types";
import { segmentStatLabel, segmentValueWindow, windowOutcomeVariableName } from "./variables";

/** 一个已解析的窗（起止 + 口径 + 映射到的真实变量名）。 */
export interface AssignedWindow {
  /** 窗的役色：`A` = 分组窗，`B` = 结果窗。 */
  role: "A" | "B";
  /** 相对日闭区间 `[from, to]`；`from = 0` 表示锚点在事件日收盘（复用既有变量族）。 */
  window: [number, number];
  stat: SegmentStatKind;
  /** 口径的中文名（进 effectLabel / 结果 metadata，避免报告里只出现英文枚举）。 */
  statLabel: string;
  /** 该窗映射到的**真实**结果变量名。 */
  variable: string;
  /** 真正被当作数值使用的相对日区间（锚点日只提供基准价，不计入取值）。 */
  valueWindow: [number, number];
  /** 窗 A 的分档数（由 `config.windowBands` 给出；两窗都带上便于诊断输出）。 */
  bands: number;
}

/**
 * 从已解析配置取出两个窗。
 *
 * 返回 `null` 的三种情形：配置里缺 `windowA` / `windowB` / 口径 / 分档数 ——
 * 一律视为**配置未给全**，由调用方报 `INVALID_ANALYSIS_CONFIG`（不兜底、不猜）。
 */
export function assignedWindowVariables(
  config: ResolvedEngineAnalysisConfig,
): [AssignedWindow, AssignedWindow] | null {
  const { windowA, windowB, windowAStat, windowBStat, windowBands } = config;
  if (
    windowA === undefined ||
    windowB === undefined ||
    windowAStat === undefined ||
    windowBStat === undefined ||
    windowBands === undefined
  ) {
    return null;
  }
  const build = (role: "A" | "B", window: [number, number], stat: SegmentStatKind): AssignedWindow => ({
    role,
    window,
    stat,
    statLabel: segmentStatLabel(stat),
    variable: windowOutcomeVariableName(stat, window[0], window[1]),
    valueWindow: segmentValueWindow(window[0], window[1]),
    bands: windowBands,
  });
  return [build("A", windowA, windowAStat), build("B", windowB, windowBStat)];
}
