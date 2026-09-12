/**
 * RESEARCH-006.3 — Strategy 侧**转正端口**（桥 → Strategy 领域）。
 *
 * 为什么是「端口」而不是直接在 `service.ts` 里 `new StrategyService(...)`：
 *   ① 依赖方向（006.0 §12 铁律）：`strategyPersistence` **不认识** Research；桥是唯一允许
 *      同时看见两侧的地方，因此跨界必须在桥内部**集中到一个文件**，便于被 `importBoundary.test.ts` 断言；
 *   ② 可测性：`service.promote` 的跨存储失败恢复（006.3 §39）需要**注入**一个会在中途失败的替身，
 *      端口化后可以用 InMemory 端口构造 failure injection 测试，不必依赖真实库偶然失败。
 *
 * 🔴 本文件是桥里**唯一**允许 import `strategyPersistence` / `strategySchema` 的生产源文件
 * （`definitionBuild.ts` 只 import `strategySchema/definition` 的**类型与词表**，不碰持久化）。
 *
 * 复用而非重写（006.3 §27）：文档组装走 `createStrategyDocumentFromDefinition`，落库走
 * `StrategyService.create`（→ `StrategyRepository.saveVersion`，**同事务** 5 投影 + Dataset Binding 校验）。
 * 本文件**不**出现任何 `INSERT strategy_versions` 之类的裸写。
 */

import { DbStrategyRepository } from "../strategyPersistence/db";
import { StrategyService } from "../strategyPersistence/service";
import { StrategyDatasetBindingError } from "../strategyPersistence/datasetBindingValidation";
import type { StrategyRepository } from "../strategyPersistence/contract";
import { createStrategyDocumentFromDefinition } from "../strategySchema/map";
import type { StrategyDefinitionInput } from "../strategySchema/definition";
import { ResearchValidationError } from "../experimentValidation";
import {
  STRATEGY_CANDIDATE_ERROR,
  StrategyCandidateError,
  type StrategyCandidateErrorCode,
} from "./candidateTypes";

/** 已存在的版本行事实（幂等 / 恢复判定用）。 */
export interface ExistingStrategyVersion {
  readonly versionRowId: number;
  readonly fingerprint: string;
}

/** 版本写入结果。`created=false` 表示命中既有版本（指纹一致）—— recovery，而不是新建。 */
export interface StrategyVersionCreationResult extends ExistingStrategyVersion {
  readonly created: boolean;
}

/**
 * 转正后复核（006.3 §31）：这些是「Promote 成功」必须同时成立的事实。
 * 任何一项不成立 ⇒ 不算成功（由 `promote` 抛 `PROMOTE_WRITEBACK_FAILED`）。
 */
export interface PromotedVersionInspection {
  readonly versionRowId: number;
  readonly fingerprint: string;
  /** canonical `definition` 是否随版本落库（§28：canonical SoT 在 strategyDocumentJson 内）。 */
  readonly hasDefinition: boolean;
  /** 由 definition 单向派生的 Dataset 绑定投影行数（§29，应 >= 1）。 */
  readonly datasetBindingCount: number;
  readonly universeId: string;
  /** doc 级 PRIMARY 坐标镜像（应与**执行** Dataset 一致）。 */
  readonly datasetVersionId: number | null;
  /** 版本生命周期状态（C-21.1 八态）。 */
  readonly status: string;
}

/** 创建「策略 + 首版本」所需的一切（全部由 `promote` 从候选草稿与 Registry 事实推导）。 */
export interface CreatePromotedStrategyVersionInput {
  readonly strategyId: string;
  readonly version: string;
  readonly name: string;
  readonly description?: string;
  readonly universe: { readonly universeId: string };
  readonly definition: StrategyDefinitionInput;
  /**
   * 文档级执行假设（`backtestConfig` / `costModel`）：`map.ts#alignDefinitionViews` 明确要求显式提供
   * （无法从 definition 派生），因此同样只能来自候选草稿 —— 由 `definitionBuild` 读出。
   */
  readonly executionAssumptions: {
    readonly backtestConfig: { readonly initialCapital: number; readonly maxPositions?: number };
    readonly costModel: {
      readonly commissionRate: number;
      readonly stampDutyRate: number;
      readonly transferFeeRate: number;
      readonly slippageBps: number;
      readonly lotSize: number;
      readonly minCommission: number;
    };
  };
  // ⚠️ `codeVersion` / `createdAt` **不由调用方传入**：它们属于 §17 版本追溯记录，
  //    由端口在构造时注入（`StrategyPromotionPortOptions`），避免同一事实两处声明。
}

export interface StrategyPromotionPort {
  /** 读取 (strategyId, version) 是否已存在（幂等闸门与恢复路径共用）。 */
  findVersion(strategyId: string, version: string): Promise<ExistingStrategyVersion | undefined>;
  /**
   * 幂等创建「策略 + 首版本」：
   *   - 版本已存在且指纹一致 ⇒ **不写入**，返回既有行（`created=false`）；
   *   - 版本已存在但指纹不同 ⇒ `PROMOTE_VERSION_CONFLICT`（违反版本不可变，绝不覆盖）；
   *   - `strategyId` 已被**另一个**策略占用（同 id 但该版本不存在）⇒ `PROMOTE_STRATEGY_ID_CONFLICT`；
   *   - 否则走 `StrategyService.create`（canonical 组装 + 同事务 5 投影 + Dataset Binding 校验）。
   */
  createStrategyVersion(input: CreatePromotedStrategyVersionInput): Promise<StrategyVersionCreationResult>;
  /** 读回版本事实（定义是否在、投影绑定几条、指纹是什么）——转正后复核用（§31）。 */
  inspectVersion(strategyId: string, version: string): Promise<PromotedVersionInspection | undefined>;
}

// ---------------------------------------------------------------------------
// 真实实现（复用既有 StrategyService / DbStrategyRepository）
// ---------------------------------------------------------------------------

/**
 * Strategy 持久化层的 Dataset Binding 错误码 → **桥的**错误码（同名）。
 *
 * 为什么要在桥里翻译一次：`promote` 的调用方（Router / 前端 / 验收脚本）只需要认识
 * `StrategyCandidateError` 一套领域错误；把两侧错误码混在传输层会让「谁该负责」变得含糊。
 */
function mapDatasetBindingCode(code: string): StrategyCandidateErrorCode {
  switch (code) {
    case "DATASET_VERSION_NOT_FOUND":
      return STRATEGY_CANDIDATE_ERROR.DATASET_VERSION_NOT_FOUND;
    case "DATASET_VERSION_NOT_READY":
      return STRATEGY_CANDIDATE_ERROR.DATASET_VERSION_NOT_READY;
    default:
      return STRATEGY_CANDIDATE_ERROR.DATASET_BINDING_INVALID;
  }
}

export interface StrategyPromotionPortOptions {
  /** `composeCodeVersion` 产物；由入口注入（与 `researchRouter` 同口径），缺省 `unknown`。 */
  readonly codeVersion?: string;
  /** createdAt 提供者（ISO-8601 UTC）。 */
  readonly now?: () => string;
}

export class StrategyServicePromotionPort implements StrategyPromotionPort {
  private readonly repo: StrategyRepository;
  private readonly service: StrategyService;

  constructor(repo: StrategyRepository, options: StrategyPromotionPortOptions = {}) {
    this.repo = repo;
    this.service = new StrategyService(repo, {
      codeVersion: options.codeVersion ?? "unknown",
      ...(options.now === undefined ? {} : { now: options.now }),
    });
  }

  async findVersion(strategyId: string, version: string): Promise<ExistingStrategyVersion | undefined> {
    const bundle = await this.repo.getVersionBundle(strategyId, version);
    if (bundle === undefined) return undefined;
    /**
     * 🔴 必须用 **document 指纹**（= `strategy_versions.fingerprint`，版本内容的唯一身份；
     * `saveVersion` 的幂等 / 冲突判定也用它）。
     *
     * 为什么不能用 `repo.getVersion().fingerprint`：那是 **§17 追溯记录**的指纹 ——
     * 它的摘要里含 `codeVersion` / `createdAt` 这些**每次注入都可能不同**的元数据，
     * 拿它做「内容是否一致」的判据会把「同一份内容、换了个时间戳」误判成
     * `PROMOTE_VERSION_CONFLICT`，从而让 §25 的幂等恢复路径整个失效。
     */
    return { versionRowId: bundle.versionRowId, fingerprint: bundle.fingerprint };
  }

  async createStrategyVersion(
    input: CreatePromotedStrategyVersionInput,
  ): Promise<StrategyVersionCreationResult> {
    // canonical 组装（含 v1 兼容视图派生 + 全字段校验 + 指纹重算）。
    // 组装层的 ResearchValidationError 在这里**翻译**成桥的错误码：调用方只需要认识一套领域错误。
    const document = (() => {
      try {
        return createStrategyDocumentFromDefinition({
          strategyId: input.strategyId,
          version: input.version,
          name: input.name,
          ...(input.description === undefined ? {} : { description: input.description }),
          universe: input.universe,
          definition: input.definition,
          executionAssumptions: input.executionAssumptions,
        });
      } catch (error) {
        if (error instanceof StrategyCandidateError) throw error;
        throw new StrategyCandidateError(
          STRATEGY_CANDIDATE_ERROR.PROMOTE_DEFINITION_INVALID,
          "候选草稿构建出的 StrategyDocument 未通过既有组装 / 校验："
            + (error instanceof Error ? error.message : String(error)),
          { stage: "DOCUMENT_ASSEMBLY" },
        );
      }
    })();

    const existing = await this.findVersion(input.strategyId, input.version);
    if (existing !== undefined) {
      if (existing.fingerprint !== document.fingerprint) {
        throw new StrategyCandidateError(
          STRATEGY_CANDIDATE_ERROR.PROMOTE_VERSION_CONFLICT,
          `策略版本已存在但内容不同：${input.strategyId}@${input.version}`
            + `（既有指纹 ${existing.fingerprint}，本次 ${document.fingerprint}）；`
            + "版本内容不可变 —— 绝不覆盖，请核对候选是否被改写",
        );
      }
      // 幂等恢复：上一轮跨存储失败留下的版本行被复用，**不新建第二份**（006.3 §25 / §26）。
      return { ...existing, created: false };
    }

    const existingStrategy = await this.repo.getStrategy(input.strategyId);
    if (existingStrategy !== undefined) {
      throw new StrategyCandidateError(
        STRATEGY_CANDIDATE_ERROR.PROMOTE_STRATEGY_ID_CONFLICT,
        `strategyId=${input.strategyId} 已被另一个策略占用（该版本 ${input.version} 不存在）⇒ 拒绝挂靠；`
          + "不会覆盖既有策略，也不会新建第二份",
      );
    }

    try {
      await this.service.create({ document: document as unknown as Record<string, unknown> });
    } catch (error) {
      // Dataset Binding 引用完整性在 `saveVersion` 事务内再校验一次（STRATEGY-004）：
      // 把它翻译成桥的**同名**错误码，使 promote 的失败面与 §14 / §15 的契约一致。
      if (error instanceof StrategyDatasetBindingError) {
        throw new StrategyCandidateError(
          mapDatasetBindingCode(error.code),
          `Strategy 写入被 Dataset Binding 引用完整性校验拒绝：${error.message}`,
          {
            stage: "STRATEGY_WRITE",
            bindingIssues: error.issues.map((item) => ({
              code: item.code,
              path: item.path,
              message: item.message,
            })),
          },
        );
      }
      // 落库前的**后端权威重组装**（`StrategyService.create` → `createStrategyDocument`）若报校验错，
      // 说明 definition 在「组装层已通过」与「写库层」之间被判定非法 —— 同样翻成定义类错误码，
      // 而不是把 `ResearchValidationError` 原样泄漏给传输层（调用方只认识一套领域错误）。
      if (error instanceof ResearchValidationError) {
        throw new StrategyCandidateError(
          STRATEGY_CANDIDATE_ERROR.PROMOTE_DEFINITION_INVALID,
          "候选草稿构建出的 StrategyDocument 未通过写库前的权威重校验："
            + error.issues.map((item) => `[${item.code}] ${item.path}: ${item.message}`).join("; "),
          { stage: "STRATEGY_WRITE", issueCount: error.issues.length },
        );
      }
      throw error;
    }

    const created = await this.findVersion(input.strategyId, input.version);
    if (created === undefined) {
      throw new Error(
        `策略版本写入后读取失败：${input.strategyId}@${input.version}（StrategyService.create 已返回）`,
      );
    }
    return { ...created, created: true };
  }

  async inspectVersion(
    strategyId: string,
    version: string,
  ): Promise<PromotedVersionInspection | undefined> {
    const bundle = await this.repo.getVersionBundle(strategyId, version);
    if (bundle === undefined) return undefined;
    return {
      versionRowId: bundle.versionRowId,
      fingerprint: bundle.fingerprint,
      hasDefinition: bundle.hasDefinition,
      datasetBindingCount: bundle.projections.datasetBindings.length,
      universeId: bundle.document.universe.universeId,
      datasetVersionId: bundle.document.datasetVersionId ?? null,
      status: bundle.status,
    };
  }
}

/** 真实装配：`DbStrategyRepository` + 既有 `StrategyService`。 */
export function createStrategyPromotionPort(
  options: StrategyPromotionPortOptions = {},
): StrategyPromotionPort {
  return new StrategyServicePromotionPort(new DbStrategyRepository(), options);
}
