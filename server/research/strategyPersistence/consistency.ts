/**
 * STEP STRATEGY-003 — 已落库版本行的**一致性审计**（F1 处置：把「双份定义」降级为可检测的冗余）。
 *
 * 背景（差异报告 F1）：
 *   `strategy_versions` 同时保存
 *     ① `strategyDocumentJson`（Canonical 完整 StrategyDefinition）
 *     ② `versionRecordJson` —— 其中 `strategy` 字段是①的**完整内嵌副本**（§17 追溯契约，本任务不删除）
 *   两份内容若因任何写入 bug 漂移，各自的指纹都自洽，读取侧无法发现。因此本模块把
 *   「双份」显式降级为**可检测的冗余**：每次读取 / 每次审计都断言三处指纹一致。
 *
 * 铁律（SPEC §三）：
 *   - 不一致 → **FAIL**；
 *   - **不得静默修复**；
 *   - **不得自动选择其中一份覆盖另一份**。
 */

import { canonicalStringify } from "../../researchDataset/version";
import {
  deserializeStrategyDocument,
  deserializeStrategyVersionRecord,
} from "../strategySchema/serialize";
import type { StrategyDocument, StrategyVersionRecord } from "../strategySchema/types";

/** 审计所需的最小列集合（与 `strategy_versions` 行同构，便于 db.ts 与审计脚本共用）。 */
export interface StoredVersionColumns {
  readonly strategyId: string;
  readonly version: string;
  readonly strategyDocumentJson: string;
  readonly versionRecordJson: string;
  readonly fingerprint: string;
}

/** 版本行解析结果（审计通过时可用）。 */
export interface ParsedStoredVersion {
  readonly document: StrategyDocument;
  readonly versionRecord: StrategyVersionRecord;
}

/**
 * 检查版本行的一致性，返回漂移明细（空数组 = 一致）。
 * 不做任何修复；解析失败也以漂移条目形式报告，便于审计脚本一次性列出全部问题。
 */
export function checkStoredVersionConsistency(row: StoredVersionColumns): string[] {
  const drifts: string[] = [];
  const key = `${row.strategyId}@${row.version}`;

  let document: StrategyDocument;
  try {
    document = deserializeStrategyDocument(row.strategyDocumentJson);
  } catch (error) {
    drifts.push(`${key}: strategyDocumentJson 解析/指纹复核失败 —— ${(error as Error).message}`);
    return drifts;
  }

  let versionRecord: StrategyVersionRecord;
  try {
    versionRecord = deserializeStrategyVersionRecord(row.versionRecordJson);
  } catch (error) {
    drifts.push(`${key}: versionRecordJson 解析/指纹复核失败 —— ${(error as Error).message}`);
    return drifts;
  }

  if (document.fingerprint !== row.fingerprint) {
    drifts.push(
      `${key}: 列 fingerprint（${row.fingerprint}）≠ strategyDocumentJson 重算指纹（${document.fingerprint}）`,
    );
  }
  if (versionRecord.strategy.fingerprint !== row.fingerprint) {
    drifts.push(
      `${key}: versionRecordJson.strategy.fingerprint（${versionRecord.strategy.fingerprint}）≠ 列 fingerprint（${row.fingerprint}）`,
    );
  }
  if (versionRecord.strategyId !== row.strategyId || document.strategyId !== row.strategyId) {
    drifts.push(`${key}: strategyId 与内嵌副本不一致（列=${row.strategyId}）`);
  }
  if (versionRecord.version !== row.version || document.version !== row.version) {
    drifts.push(`${key}: version 与内嵌副本不一致（列=${row.version}）`);
  }

  // Canonical Definition 的双份一致性（F1 的核心断言）。
  const documentDefinition = document.definition;
  const recordDefinition = versionRecord.strategy.definition;
  if (documentDefinition === undefined && recordDefinition !== undefined) {
    drifts.push(`${key}: versionRecordJson.strategy.definition 存在，但 strategyDocumentJson.definition 缺失`);
  } else if (documentDefinition !== undefined && recordDefinition === undefined) {
    drifts.push(`${key}: strategyDocumentJson.definition 存在，但 versionRecordJson.strategy.definition 缺失`);
  } else if (documentDefinition !== undefined && recordDefinition !== undefined) {
    if (canonicalStringify(documentDefinition) !== canonicalStringify(recordDefinition)) {
      drifts.push(`${key}: strategyDocumentJson.definition 与 versionRecordJson.strategy.definition 内容不一致（双份定义漂移）`);
    }
  }

  return drifts;
}

/** 一致性检查通过则返回解析结果，否则抛错（不静默修复、不择一覆盖）。 */
export function assertStoredVersionConsistency(row: StoredVersionColumns): ParsedStoredVersion {
  const drifts = checkStoredVersionConsistency(row);
  if (drifts.length > 0) {
    throw new Error(`策略版本一致性校验失败（不自动修复）：\n${drifts.map((line) => `  - ${line}`).join("\n")}`);
  }
  return {
    document: deserializeStrategyDocument(row.strategyDocumentJson),
    versionRecord: deserializeStrategyVersionRecord(row.versionRecordJson),
  };
}
