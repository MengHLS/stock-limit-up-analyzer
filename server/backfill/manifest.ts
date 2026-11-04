/**
 * STEP 7.3 — Reproducible Backfill Manifest。
 *
 * 每次回填运行生成一份 manifest，记录目标区间、provider、配置快照、计数，
 * 可回答「这一次回填从哪里开始、结束到哪、写入了多少、用了什么配置」，供审计与复现。
 */

import { randomBytes } from "node:crypto";
import type { BackfillConfig, BackfillManifest } from "./types";

/** 生成 manifest ID（crypto 随机，非 Math.random）。 */
export function generateManifestId(now = new Date()): string {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = randomBytes(4).toString("hex");
  return `BF-${date}-${suffix}`;
}

/** 创建初始 manifest（运行开始）。 */
export function createManifest(params: {
  startDate: string;
  endDate: string;
  provider: string;
  targetTradingDates: number;
  config: BackfillConfig;
  startedAt?: string;
}): BackfillManifest {
  return {
    manifestId: generateManifestId(),
    startedAt: params.startedAt ?? new Date().toISOString(),
    finishedAt: null,
    startDate: params.startDate,
    endDate: params.endDate,
    provider: params.provider,
    targetTradingDates: params.targetTradingDates,
    completedTradingDates: 0,
    failedTradingDates: 0,
    suspiciousTradingDates: 0,
    quotaStoppedTradingDates: 0,
    totalRows: 0,
    config: { ...params.config },
  };
}

/** 结束 manifest（累计计数 + finishedAt）。 */
export function finalizeManifest(
  manifest: BackfillManifest,
  counts: {
    completedTradingDates: number;
    failedTradingDates: number;
    suspiciousTradingDates: number;
    quotaStoppedTradingDates: number;
    totalRows: number;
  },
  finishedAt = new Date().toISOString(),
): BackfillManifest {
  return {
    ...manifest,
    finishedAt,
    completedTradingDates: counts.completedTradingDates,
    failedTradingDates: counts.failedTradingDates,
    suspiciousTradingDates: counts.suspiciousTradingDates,
    quotaStoppedTradingDates: counts.quotaStoppedTradingDates,
    totalRows: counts.totalRows,
  };
}
