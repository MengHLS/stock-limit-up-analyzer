/**
 * STEP STRATEGY-002 — StrategyService：策略持久化的领域编排。
 *
 * 职责：
 *   - 编排 create / save / load / list / delete / createVersion / listVersions / loadVersion；
 *   - **后端权威重算**：wire 输入的 fingerprint 不可信，落库前一律 createStrategyDocument 重组装（重算指纹 + 全字段校验）；
 *   - 版本语义闸门（§9）：createVersion 复用 cloneStrategyDocument / bumpStrategyVersion /
 *     classifyRequiredBumpKind，结构变化→major、参数/文本→minor，不重新实现 semver；
 *   - fingerprint 完整性（§6）：读取经 deserialize*（含指纹复核），篡改即 LOAD FAIL；
 *   - 不可变（§18）：同 version 不同内容 → 拒绝（要求新建版本）；
 *   - 幂等（§19）：同 version 同内容 → 跳过，不产生重复版本。
 *
 * 注入式元数据：codeVersion / createdAt 由入口注入（Service 不读文件系统、不依赖时钟确定性），
 * 风格对齐 experimentLineage。
 */

import { classifyRequiredBumpKind } from "../strategySchema/compare";
import { compareStrategyVersions } from "../strategySchema/version";
import { createStrategyDocument, createStrategyVersionRecord, cloneStrategyDocument } from "../strategySchema/map";
import type { StrategyDocumentPatch } from "../strategySchema/map";
import type { StrategyVersionBump } from "../strategySchema/types";
import type {
  StrategyDocument,
  StrategyDocumentInput,
  StrategyVersionRecord,
} from "../strategySchema/types";
import type {
  StrategyRepository,
  StrategySummary,
  StrategyVersionSummary,
} from "./contract";

export interface StrategyServiceOptions {
  /** codeVersion（composeCodeVersion 产物）；由入口注入，缺省 "unknown"。 */
  readonly codeVersion?: string;
  /** createdAt 提供者（ISO-8601 UTC）；缺省 new Date().toISOString()。 */
  readonly now?: () => string;
}

export interface StrategyCreateInput {
  readonly document: Record<string, unknown>;
}

export interface StrategyCreateVersionInput {
  readonly strategyId: string;
  readonly document: Record<string, unknown>;
  /** 显式 bump 级别；缺省由内容差异自动判定（none→minor）。 */
  readonly bump?: StrategyVersionBump;
}

/** 从 wire 提取 StrategyDocumentInput（剔除书签 + fingerprint，其余透传，由重组装层权威重算）。 */
function extractContent(wire: Record<string, unknown>): StrategyDocumentInput {
  const { recordKind: _rk, recordVersion: _rv, fingerprint: _fp, ...rest } = wire;
  return rest as unknown as StrategyDocumentInput;
}

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** 从 wire 提取 cloneStrategyDocument 的 patch（可选字段缺失 → null=删除；recipe 缺失 → 继承 base）。 */
function toPatch(wire: Record<string, unknown>): StrategyDocumentPatch {
  return {
    name: wire.name as string,
    description: hasOwn(wire, "description") ? (wire.description as string | null) : null,
    universe: wire.universe as StrategyDocumentPatch["universe"],
    entryRules: wire.entryRules as StrategyDocumentPatch["entryRules"],
    exitRules: wire.exitRules as StrategyDocumentPatch["exitRules"],
    positionSizing: wire.positionSizing as StrategyDocumentPatch["positionSizing"],
    riskRules: wire.riskRules as StrategyDocumentPatch["riskRules"],
    parameters: wire.parameters as StrategyDocumentPatch["parameters"],
    datasetVersion: wire.datasetVersion as StrategyDocumentPatch["datasetVersion"],
    executionAssumptions: wire.executionAssumptions as StrategyDocumentPatch["executionAssumptions"],
    recipe: hasOwn(wire, "recipe") ? (wire.recipe as StrategyDocumentPatch["recipe"]) : undefined,
    metadata: hasOwn(wire, "metadata") ? (wire.metadata as StrategyDocumentPatch["metadata"]) : null,
  };
}

/** 把 patch 展开为 StrategyDocumentInput（与 cloneStrategyDocument 内部的 next 构造口径一致）。 */
function patchToInput(base: StrategyDocument, patch: StrategyDocumentPatch): StrategyDocumentInput {
  return {
    strategyId: base.strategyId,
    version: base.version,
    name: patch.name ?? base.name,
    description: patch.description === undefined ? base.description : (patch.description ?? undefined),
    universe: patch.universe ?? base.universe,
    entryRules: patch.entryRules ?? base.entryRules,
    exitRules: patch.exitRules ?? base.exitRules,
    positionSizing: patch.positionSizing ?? base.positionSizing,
    riskRules: patch.riskRules ?? base.riskRules,
    parameters: patch.parameters ?? base.parameters,
    datasetVersion: patch.datasetVersion ?? base.datasetVersion,
    executionAssumptions: patch.executionAssumptions ?? base.executionAssumptions,
    recipe: patch.recipe ?? base.recipe,
    metadata: patch.metadata === undefined ? base.metadata : (patch.metadata ?? undefined),
  };
}

export class StrategyService {
  private readonly repo: StrategyRepository;
  private readonly codeVersion: string;
  private readonly now: () => string;

  constructor(repo: StrategyRepository, options: StrategyServiceOptions = {}) {
    this.repo = repo;
    this.codeVersion = options.codeVersion ?? "unknown";
    this.now = options.now ?? (() => new Date().toISOString());
  }

  /** 创建全新策略（strategyId 必须不存在）。返回组装后的策略本体。 */
  async create(input: StrategyCreateInput): Promise<StrategyDocument> {
    const doc = createStrategyDocument(extractContent(input.document));
    const existing = await this.repo.getStrategy(doc.strategyId);
    if (existing !== undefined) {
      throw new Error(`策略已存在，无法 create（请用 save）：${doc.strategyId}`);
    }
    await this.persistDocument(doc, "Draft");
    return doc;
  }

  /** 保存策略版本（幂等；strategyId 不存在时等价 create；同 version 不同内容 → 拒绝）。 */
  async save(input: StrategyCreateInput): Promise<StrategyDocument> {
    const doc = createStrategyDocument(extractContent(input.document));
    const existing = await this.repo.getStrategy(doc.strategyId);
    await this.persistDocument(doc, existing?.status ?? "Draft");
    return doc;
  }

  /** 加载策略最新版本的策略本体（含指纹复核）。 */
  async load(strategyId: string): Promise<StrategyDocument> {
    const record = await this.repo.getLatestVersion(strategyId);
    if (record === undefined) {
      throw new Error(`未找到策略：${strategyId}`);
    }
    return record.strategy;
  }

  /** 加载指定版本（§17 九项追溯记录，含指纹复核）。 */
  async loadVersion(strategyId: string, version: string): Promise<StrategyVersionRecord> {
    const record = await this.repo.getVersion(strategyId, version);
    if (record === undefined) {
      throw new Error(`未找到策略版本：${strategyId}@${version}`);
    }
    return record;
  }

  async list(): Promise<StrategySummary[]> {
    return this.repo.listStrategies();
  }

  async listVersions(strategyId: string): Promise<StrategyVersionSummary[]> {
    return this.repo.listVersions(strategyId);
  }

  async delete(strategyId: string): Promise<void> {
    await this.repo.deleteStrategy(strategyId);
  }

  /**
   * 基于最新版本创建新版本（§9）。
   * 复用 cloneStrategyDocument（semver + 语义闸门）；bump 缺省时按内容差异自动判定。
   * 结构变化→major、参数/文本→minor；同版本内容不变 → 不产生重复版本（闸门由 clone 保证）。
   */
  async createVersion(input: StrategyCreateVersionInput): Promise<StrategyDocument> {
    const base = await this.load(input.strategyId);
    const patch = toPatch(input.document);
    const bump = input.bump ?? this.resolveRequiredBump(base, patch);
    const newDoc = cloneStrategyDocument(base, patch, bump);
    const existing = await this.repo.getStrategy(input.strategyId);
    await this.persistDocument(newDoc, existing?.status ?? "Draft");
    return newDoc;
  }

  /** 由 base + patch 判定内容差异所需的 bump 级别（复用 classifyRequiredBumpKind + bumpCoversChange）。 */
  private resolveRequiredBump(base: StrategyDocument, patch: StrategyDocumentPatch): StrategyVersionBump {
    const nextCandidate = createStrategyDocument(patchToInput(base, patch));
    const required = classifyRequiredBumpKind(base, nextCandidate);
    if (required === "major") return "major";
    return "minor";
  }

  /** 落库一个已组装好的版本（版本记录 + 实体 upsert；幂等 / 冲突在 Repository 层判定）。 */
  private async persistDocument(doc: StrategyDocument, fallbackStatus: string): Promise<void> {
    const versionRecord = createStrategyVersionRecord({
      document: doc,
      context: { codeVersion: this.codeVersion, createdAt: this.now() },
    });
    const result = await this.repo.saveVersion({
      strategyId: doc.strategyId,
      document: doc,
      versionRecord,
    });
    if (result.outcome === "conflict") {
      throw new Error(
        `策略版本不可变：${doc.strategyId}@${doc.version} 已存在且内容不同` +
        `（既有指纹 ${result.existingFingerprint}，本次 ${result.fingerprint}）；请用 createVersion 创建新版本`,
      );
    }
    const existing = await this.repo.getStrategy(doc.strategyId);
    const latestVersion = existing === undefined
      ? doc.version
      : (compareStrategyVersions(doc.version, existing.latestVersion) > 0 ? doc.version : existing.latestVersion);
    await this.repo.saveStrategy({
      strategyId: doc.strategyId,
      name: doc.name,
      latestVersion,
      status: existing?.status ?? fallbackStatus,
    });
  }
}
