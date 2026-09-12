/**
 * STEP STRATEGY-002 / STRATEGY-003 — StrategyService：策略持久化的领域编排。
 *
 * 职责：
 *   - 编排 create / save / load / list / delete / createVersion / listVersions / loadVersion；
 *   - **后端权威重算**：wire 输入的 fingerprint 不可信，落库前一律 createStrategyDocument 重组装
 *     （重算指纹 + 全字段校验）；
 *   - 版本语义闸门（§9）：createVersion 复用 cloneStrategyDocument / bumpStrategyVersion /
 *     classifyRequiredBumpKind，结构变化→major、参数/文本→minor，不重新实现 semver；
 *   - fingerprint 完整性（§6）：读取经 deserialize*（含指纹复核），篡改即 LOAD FAIL；
 *   - 不可变（§18）：同 version 不同内容 → 拒绝（要求新建版本）；
 *   - 幂等（§19）：同 version 同内容 → 跳过，不产生重复版本。
 *
 * STRATEGY-003 新增（SPEC §26 / §31 / §32）：
 *   - `cloneFromVersion`：**按指定版本** clone（不再只能基于 latest），复制完整 Canonical Definition
 *     （含 parameters / entry / exit / execution / dataset 绑定）→ 重算指纹 → `parentVersionId`
 *     指向源版本行 → 幂等三态（inserted / idempotent-skip / conflict，**不覆盖已有版本**）；
 *   - `loadBundle`：一次返回完整版本包（Canonical + §17 追溯 + 5 类投影）；
 *   - `validateVersion`：读库 → 校验（含 Look-Ahead）+ 投影漂移检测；
 *   - `setVersionStatus`：版本生命周期状态迁移（唯一允许的 UPDATE；内容仍不可变）。
 *
 * 注入式元数据：codeVersion / createdAt 由入口注入（Service 不读文件系统、不依赖时钟确定性），
 * 风格对齐 experimentLineage。
 */

import { classifyRequiredBumpKind } from "../strategySchema/compare";
import { compareStrategyVersions, bumpStrategyVersion } from "../strategySchema/version";
import { createStrategyDocument, createStrategyVersionRecord, cloneStrategyDocument, cloneStrategyDocumentToVersion } from "../strategySchema/map";
import type { StrategyDocumentPatch } from "../strategySchema/map";
import { buildStrategyProjections, verifyStrategyProjections } from "../strategySchema/projection";
import { validateCanonicalStrategyDefinition } from "../strategySchema/definitionValidation";
import { validateStrategyDocument } from "../strategySchema/validate";
import { deserializeStrategyDocument } from "../strategySchema/serialize";
import type { StrategyVersionBump } from "../strategySchema/types";
import type {
  StrategyDocument,
  StrategyDocumentInput,
  StrategyVersionRecord,
} from "../strategySchema/types";
import { isStrategyLifecycleStatus } from "../lifecycle/types";
import type {
  StrategyRepository,
  StrategySummary,
  StrategyVersionBundle,
  StrategyVersionSummary,
} from "./contract";
import type { ResearchValidationResult } from "../experimentValidation";

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

/** STRATEGY-003：按指定源版本 clone。 */
export interface StrategyCloneVersionInput {
  readonly strategyId: string;
  /** 源版本（必须是已存在的版本，**可以不是 latest**，SPEC §13）。 */
  readonly fromVersion: string;
  /** 目标版本号；缺省 = 源版本按 `bump`（缺省 major）递增。 */
  readonly targetVersion?: string;
  readonly bump?: StrategyVersionBump;
  /** 新版本变更说明。 */
  readonly description?: string;
  /** 新版本生命周期状态（缺省 Draft；必须属于 C-21.1 八态）。 */
  readonly status?: string;
}

/** STRATEGY-003：clone 结果（幂等三态 + 演进链锚点）。 */
export interface StrategyCloneVersionResult {
  readonly outcome: "inserted" | "idempotent-skip" | "conflict";
  readonly strategyId: string;
  readonly sourceVersion: string;
  readonly version: string;
  /** 新版本写入行主键（idempotent-skip / conflict 时不提供）。 */
  readonly versionRowId?: number;
  /** 源版本行 id（新版本的 parentVersionId）。 */
  readonly parentVersionId: number | null;
  readonly fingerprint: string;
  readonly existingFingerprint?: string;
}

/** STRATEGY-003：版本校验报告。 */
export interface StrategyVersionValidationReport {
  readonly strategyId: string;
  readonly version: string;
  readonly valid: boolean;
  /** 文档级校验（既有 validateStrategyDocument 全量结果，含 definition 与视图一致性）。 */
  readonly document: ResearchValidationResult;
  /** Canonical Definition 校验（含 Look-Ahead）；无定义时 valid=true 且 issues 为空。 */
  readonly definition: ResearchValidationResult;
  readonly definitionPresent: boolean;
  /** canonical 期望投影 vs DB 实际投影的漂移明细（空 = 一致）。 */
  readonly projectionDrifts: readonly string[];
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
    datasetVersionId: wire.datasetVersionId as StrategyDocumentPatch["datasetVersionId"],
    executionAssumptions: wire.executionAssumptions as StrategyDocumentPatch["executionAssumptions"],
    ...(hasOwn(wire, "definition") ? { definition: wire.definition as StrategyDocumentPatch["definition"] } : {}),
    recipe: hasOwn(wire, "recipe") ? (wire.recipe as StrategyDocumentPatch["recipe"]) : undefined,
    metadata: hasOwn(wire, "metadata") ? (wire.metadata as StrategyDocumentPatch["metadata"]) : null,
  };
}

/**
 * 把 patch 展开为 StrategyDocumentInput（与 cloneStrategyDocument 内部的 next 构造口径一致）。
 *
 * 🔴 STRATEGY-004 修正：传入新 `definition` 时，v1 视图（entryRules / exitRules / riskRules /
 * positionSizing / parameters）**必须由新 definition 重新派生** —— 因此这里不下发视图键，
 * 交给组装层 `alignDefinitionViews` 的 `fillOrCheck` 从 definition 派生。
 * 与此前「透传 base 视图」的行为相比：后者在 definition 变更视图时会让组装层报
 * `SCHEMA_DEFINITION_VIEW_CONFLICT`，导致 `createVersion(带 definition)` 恒失败
 * （本 STEP 的真实 tRPC 全链验证暴露）。
 * `cloneStrategyDocument` 同样是「传 definition 即不透传视图」，本函数与之严格对齐。
 */
function patchToInput(base: StrategyDocument, patch: StrategyDocumentPatch): StrategyDocumentInput {
  const datasetVersionId = patch.datasetVersionId ?? base.datasetVersionId;
  const views = patch.definition !== undefined
    ? {}
    : {
        entryRules: patch.entryRules ?? base.entryRules,
        exitRules: patch.exitRules ?? base.exitRules,
        positionSizing: patch.positionSizing ?? base.positionSizing,
        riskRules: patch.riskRules ?? base.riskRules,
        parameters: patch.parameters ?? base.parameters,
      };
  return {
    strategyId: base.strategyId,
    version: base.version,
    name: patch.name ?? base.name,
    description: patch.description === undefined ? base.description : (patch.description ?? undefined),
    universe: patch.universe ?? base.universe,
    ...views,
    datasetVersion: patch.datasetVersion ?? base.datasetVersion,
    ...(datasetVersionId === undefined ? {} : { datasetVersionId }),
    executionAssumptions: patch.executionAssumptions ?? base.executionAssumptions,
    ...(patch.definition === undefined ? {} : { definition: patch.definition }),
    recipe: patch.recipe ?? base.recipe,
    metadata: patch.metadata === undefined ? base.metadata : (patch.metadata ?? undefined),
  } as unknown as StrategyDocumentInput;
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

  /** STRATEGY-003：一次取全（Canonical 本体 + §17 追溯 + 5 类投影），SPEC §32。 */
  async loadBundle(strategyId: string, version: string): Promise<StrategyVersionBundle> {
    const bundle = await this.repo.getVersionBundle(strategyId, version);
    if (bundle === undefined) {
      throw new Error(`未找到策略版本：${strategyId}@${version}`);
    }
    return bundle;
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
    const parentVersionId = await this.repo.getVersionRowId(input.strategyId, base.version);
    const existing = await this.repo.getStrategy(input.strategyId);
    await this.persistDocument(newDoc, existing?.status ?? "Draft", {
      parentVersionId: parentVersionId ?? null,
      description: typeof input.document.description === "string" ? input.document.description : null,
    });
    return newDoc;
  }

  /**
   * STRATEGY-003 — **按指定版本** clone（SPEC §13 / §26 / §14）。
   *
   * 与 createVersion 的区别：源版本可以是任意历史版本（不限于 latest），
   * 且 `parentVersionId` 指向**源版本行**（而不是 latest）。
   * 复制内容 = 完整 Canonical Definition（params / entry / exit / execution / dataset 绑定）
   * + universe / datasetVersion / executionAssumptions / recipe / metadata；随后**重算指纹**。
   * 幂等三态：目标版本不存在 → inserted；存在且内容一致 → idempotent-skip；
   * 存在但内容不同 → conflict（**绝不覆盖既有版本**）。
   */
  async cloneVersion(input: StrategyCloneVersionInput): Promise<StrategyCloneVersionResult> {
    if (input.status !== undefined && !isStrategyLifecycleStatus(input.status)) {
      throw new Error(
        `版本状态非法：${input.status}（必须属于 C-21.1 八态：Draft/Research/Candidate/Validated/Paper/Approved/Production/Retired）`,
      );
    }
    const source = await this.repo.getVersion(input.strategyId, input.fromVersion);
    if (source === undefined) {
      throw new Error(`未找到源版本，无法 clone：${input.strategyId}@${input.fromVersion}`);
    }
    const targetVersion = input.targetVersion ?? bumpStrategyVersion(input.fromVersion, input.bump ?? "major");
    const description = input.description ?? null;
    const doc = cloneStrategyDocumentToVersion(source.strategy, targetVersion, description);

    const parentVersionId = (await this.repo.getVersionRowId(input.strategyId, input.fromVersion)) ?? null;
    const versionRecord = createStrategyVersionRecord({
      document: doc,
      context: { codeVersion: this.codeVersion, createdAt: this.now() },
    });
    const result = await this.repo.saveVersion({
      strategyId: input.strategyId,
      document: doc,
      versionRecord,
      status: input.status ?? "Draft",
      parentVersionId,
      description,
    });

    if (result.outcome === "inserted") {
      await this.refreshEntityPointer(doc, input.status ?? "Draft", result.versionRowId);
    }
    return {
      outcome: result.outcome,
      strategyId: input.strategyId,
      sourceVersion: input.fromVersion,
      version: targetVersion,
      ...(result.versionRowId === undefined ? {} : { versionRowId: result.versionRowId }),
      parentVersionId,
      fingerprint: doc.fingerprint,
      ...(result.existingFingerprint === undefined ? {} : { existingFingerprint: result.existingFingerprint }),
    };
  }

  /**
   * STRATEGY-003 — 读库校验指定版本：文档全量校验（含 definition / 视图一致性 / Look-Ahead）
   * + **投影漂移检测**（canonical 期望投影 vs DB 实际投影，SPEC §17/§18）。
   * 不做任何修复；漂移以明细形式返回，由调用方决定是否失败。
   */
  async validateVersion(strategyId: string, version: string): Promise<StrategyVersionValidationReport> {
    const bundle = await this.loadBundle(strategyId, version);
    const document = bundle.document;
    // 复用既有文档校验器（含 definition 校验与视图一致性）——不另造校验路径。
    const documentResult = validateStrategyDocument(document);
    const definitionPresent = document.definition !== undefined;
    // 校验器的 issue.path 以 StrategyDefinition 根为基准；这里 rebase 成 `definition.…`，
    // 与 documentResult（validateStrategyDocument）的路径语义保持一致，便于消费方合并去重。
    const definitionResult: ResearchValidationResult = definitionPresent
      ? (() => {
        const raw = validateCanonicalStrategyDefinition(document.definition);
        return {
          valid: raw.valid,
          issues: raw.issues.map((item) => ({
            code: item.code,
            path: `definition.${item.path}`,
            message: item.message,
          })),
        };
      })()
      : { valid: true, issues: [] };
    const projectionDrifts = definitionPresent
      ? verifyStrategyProjections(
        buildStrategyProjections(document.definition as NonNullable<typeof document.definition>),
        bundle.projections,
      )
      : [];
    return {
      strategyId,
      version,
      valid: documentResult.valid && definitionResult.valid && projectionDrifts.length === 0,
      document: documentResult,
      definition: definitionResult,
      definitionPresent,
      projectionDrifts,
    };
  }

  /** STRATEGY-003 — 版本生命周期状态迁移（唯一允许的 UPDATE；内容仍不可变）。 */
  async setVersionStatus(strategyId: string, version: string, status: string): Promise<void> {
    if (!isStrategyLifecycleStatus(status)) {
      throw new Error(
        `版本状态非法：${status}（必须属于 C-21.1 八态：Draft/Research/Candidate/Validated/Paper/Approved/Production/Retired）`,
      );
    }
    await this.repo.updateVersionStatus(strategyId, version, status);
  }

  /** 由 base + patch 判定内容差异所需的 bump 级别（复用 classifyRequiredBumpKind + bumpCoversChange）。 */
  private resolveRequiredBump(base: StrategyDocument, patch: StrategyDocumentPatch): StrategyVersionBump {
    const nextCandidate = createStrategyDocument(patchToInput(base, patch));
    const required = classifyRequiredBumpKind(base, nextCandidate);
    if (required === "major") return "major";
    return "minor";
  }

  /** 落库一个已组装好的版本（版本记录 + 实体 upsert；幂等 / 冲突在 Repository 层判定）。 */
  private async persistDocument(
    doc: StrategyDocument,
    fallbackStatus: string,
    metadata: { parentVersionId?: number | null; description?: string | null } = {},
  ): Promise<void> {
    const versionRecord = createStrategyVersionRecord({
      document: doc,
      context: { codeVersion: this.codeVersion, createdAt: this.now() },
    });
    const result = await this.repo.saveVersion({
      strategyId: doc.strategyId,
      document: doc,
      versionRecord,
      parentVersionId: metadata.parentVersionId ?? null,
      description: metadata.description ?? null,
    });
    if (result.outcome === "conflict") {
      throw new Error(
        `策略版本不可变：${doc.strategyId}@${doc.version} 已存在且内容不同` +
        `（既有指纹 ${result.existingFingerprint}，本次 ${result.fingerprint}）；请用 createVersion / cloneVersion 创建新版本`,
      );
    }
    await this.refreshEntityPointer(doc, fallbackStatus, result.versionRowId);
  }

  /**
   * 刷新策略实体：维持 `latestVersion`（兼容冗余列）与 `currentVersionId`（权威指针）的一致性。
   * 不变式：`currentVersionId` 指向版本号最大的那一行；`latestVersion` = 该行的 version。
   */
  private async refreshEntityPointer(
    doc: StrategyDocument,
    fallbackStatus = "Draft",
    insertedRowId?: number,
  ): Promise<void> {
    const existing = await this.repo.getStrategy(doc.strategyId);
    const isNewLatest = existing === undefined
      || compareStrategyVersions(doc.version, existing.latestVersion) > 0;
    let currentVersionId = existing?.currentVersionId ?? null;
    if (isNewLatest) {
      const resolved = insertedRowId
        ?? (await this.repo.getVersionRowId(doc.strategyId, doc.version))
        ?? currentVersionId;
      currentVersionId = resolved ?? null;
    }
    await this.repo.saveStrategy({
      strategyId: doc.strategyId,
      name: doc.name,
      latestVersion: isNewLatest ? doc.version : (existing?.latestVersion ?? doc.version),
      status: existing?.status ?? fallbackStatus,
      description: doc.description ?? existing?.description ?? null,
      currentVersionId,
    });
  }
}

/** 便捷导出：读库后按 canonical 重算文档（含指纹复核），供审计脚本复用。 */
export function reloadStrategyDocument(json: string): StrategyDocument {
  return deserializeStrategyDocument(json);
}
