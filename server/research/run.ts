/**
 * STEP 6.2 — Research Run 模型。
 *
 * Experiment 回答「我要研究什么」，Research Run 回答「这次实验实际执行了一次什么」。
 * 一个 Experiment 可对应多个 Run（Run 1 / Run 2 / Run 3 都基于同一个冻结 Snapshot）。
 *
 * Run Result 只保存结构化摘要（复用 engine/domain 的 BacktestResult.metadata / config /
 * performance），不重新实现统计；不保存全量 trades / equityCurve（STEP 6.2 最小范围）。
 */

import { randomBytes } from "node:crypto";
import type { BacktestConfig, BacktestResult, PerformanceMetrics } from "../engine/domain";

/** Run 状态（本阶段同步执行：创建即 running，结束后 succeeded / failed）。 */
export type ResearchRunStatus = "running" | "succeeded" | "failed";

/** 结构化结果摘要：复用 Production Backtest Core 的既有类型，不重实现任何统计。 */
export interface ResearchRunResultSummary {
  /** 回测元数据（strategyId / version / start / end / initialCapital / generatedAt）。 */
  metadata: BacktestResult["metadata"];
  /** 冻结后的完整引擎配置（含 CostModel），记录本次执行实际使用的口径。 */
  config: BacktestConfig;
  /** 绩效指标（复用 engine PerformanceMetrics）。 */
  performance: PerformanceMetrics;
  /** 期末权益（finalPortfolio.equity）。 */
  finalEquity: number;
}

/** 一次实验执行（Run）。 */
export interface ResearchRun {
  runId: string;
  experimentId: string;
  status: ResearchRunStatus;
  /** 执行开始时间（ISO；实验元数据，非核心复现输入）。 */
  startedAt: string;
  /** 执行结束时间（ISO；running 时为 undefined）。 */
  finishedAt?: string;
  /** 成功时的结构化结果摘要；失败 / 运行中为 null。 */
  result: ResearchRunResultSummary | null;
  /** 失败时的错误信息；非失败为 null。 */
  error: string | null;
  /** 创建时间（ISO）。 */
  createdAt: string;
}

/** Run 实体身份（`RUN-<experimentId>-<suffix>`）。runId 是实体身份，非核心复现输入。 */
export function formatRunId(experimentId: string, suffix: string): string {
  return `RUN-${experimentId}-${suffix}`;
}

/** 生成唯一 Run ID；注入 suffix 时（测试）为确定性。 */
export function generateRunId(experimentId: string, suffix?: string): string {
  const resolvedSuffix = suffix ?? randomBytes(4).toString("hex").toUpperCase();
  return formatRunId(experimentId, resolvedSuffix);
}

/** 序列化 Run 结果摘要。引擎产出的 performance 均为有限数字或 null，无 NaN/Infinity。 */
export function serializeResearchRunResultSummary(summary: ResearchRunResultSummary): string {
  return JSON.stringify(summary);
}

/** 反序列化 Run 结果摘要（结构轻校验，拒绝非对象）。 */
export function deserializeResearchRunResultSummary(json: string): ResearchRunResultSummary {
  const parsed: unknown = JSON.parse(json);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("反序列化 Run 结果摘要失败：结果不是对象");
  }
  return parsed as ResearchRunResultSummary;
}
