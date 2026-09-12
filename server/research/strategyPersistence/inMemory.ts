/**
 * STEP STRATEGY-002 / STRATEGY-003 — 内存 Strategy Persistence 实现（单元测试用）。
 *
 * 说明：本实现仅用于「Repository 契约逻辑」的单元测试（幂等 / 指纹冲突 / 不可变 / 排序 /
 * 投影派生 / clone），**不用于证明持久化** —— 持久化验收必须基于真实 DB
 * （DbStrategyRepository + 真实 TiDB E2E，§21 / STRATEGY-003 §十三）。
 * 存储与读取均结构化克隆，保证 mutation isolation；时间戳由注入的 now 提供（测试可固定）。
 *
 * 与 DB 实现的一致性：saveVersion 同样在 document.definition 存在时由 canonical Definition
 * 单向派生投影（不持久化则不会发生，但契约行为必须一致）。
 */

import { buildStrategyProjections, type StrategyProjections } from "../strategySchema/projection";
import { compareStrategyVersions } from "../strategySchema/version";
import type { StrategyVersionRecord } from "../strategySchema/types";
import {
  assertStrategyDatasetBindings,
  collectStrategyDatasetBindingRequests,
  type DatasetVersionReferencePort,
} from "./datasetBindingValidation";
import type {
  SaveVersionResult,
  StrategyEntityInput,
  StrategyRepository,
  StrategySummary,
  StrategyVersionBundle,
  StrategyVersionInput,
  StrategyVersionSummary,
} from "./contract";

interface StoredEntity {
  readonly entity: StrategyEntityInput;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface StoredVersion {
  readonly input: StrategyVersionInput;
  readonly rowId: number;
  readonly status: string;
  readonly parentVersionId: number | null;
  readonly description: string | null;
  readonly projections: StrategyProjections;
  readonly hasDefinition: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

function emptyProjections(): StrategyProjections {
  return {
    parameters: [],
    entryRules: [],
    exitRules: [],
    datasetBindings: [],
    executionRule: {
      signalTiming: "",
      executionTiming: "",
      priceType: "",
      quantityMethod: "",
      lotSize: 0,
      slippageModel: null,
      commissionModel: null,
      executionConstraintsJson: null,
    },
  };
}

/** 未接入 Dataset Registry 时的诚实默认端口：任何坐标都判「不存在」（绝不假装通过）。 */
export const EMPTY_DATASET_VERSION_REFERENCE_PORT: DatasetVersionReferencePort = {
  async getVersionById() {
    return undefined;
  },
  async getDefinitionById() {
    return undefined;
  },
};

export class InMemoryStrategyRepository implements StrategyRepository {
  private readonly entities = new Map<string, StoredEntity>();
  private readonly versions = new Map<string, Map<string, StoredVersion>>();
  private readonly now: () => string;
  private readonly datasetRegistry: DatasetVersionReferencePort;
  private nextRowId = 1;

  constructor(
    now: () => string = () => new Date().toISOString(),
    options: { datasetRegistry?: DatasetVersionReferencePort } = {},
  ) {
    this.now = now;
    // STRATEGY-004：默认端口「永远查不到」是**故意**的 —— 未接入 Registry 时必须响亮失败，
    // 不允许静默放过一个未经校验的坐标。需要 PASS 语义的测试显式注入 fake 端口。
    this.datasetRegistry = options.datasetRegistry ?? EMPTY_DATASET_VERSION_REFERENCE_PORT;
  }

  async saveStrategy(input: StrategyEntityInput): Promise<void> {
    const existing = this.entities.get(input.strategyId);
    const description = input.description ?? null;
    const strategyType = input.strategyType ?? null;
    if (existing === undefined) {
      const ts = this.now();
      this.entities.set(input.strategyId, {
        entity: structuredClone({ ...input, description, strategyType, currentVersionId: input.currentVersionId ?? null }),
        createdAt: ts,
        updatedAt: ts,
      });
      return;
    }
    this.entities.set(input.strategyId, {
      entity: structuredClone({
        ...input,
        description,
        strategyType,
        // 与 DB 实现一致：未显式提供时保留既有指针。
        currentVersionId: input.currentVersionId === undefined ? existing.entity.currentVersionId ?? null : input.currentVersionId,
      }),
      createdAt: existing.createdAt,
      updatedAt: this.now(),
    });
  }

  async getStrategy(strategyId: string): Promise<StrategySummary | undefined> {
    const stored = this.entities.get(strategyId);
    if (stored === undefined) return undefined;
    const entity = structuredClone(stored.entity);
    return {
      strategyId: entity.strategyId,
      name: entity.name,
      latestVersion: entity.latestVersion,
      status: entity.status,
      description: entity.description ?? null,
      strategyType: entity.strategyType ?? null,
      currentVersionId: entity.currentVersionId ?? null,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
    };
  }

  async listStrategies(): Promise<StrategySummary[]> {
    const ids = Array.from(this.entities.keys()).sort();
    const list: StrategySummary[] = [];
    for (const id of ids) {
      const summary = await this.getStrategy(id);
      if (summary !== undefined) list.push(summary);
    }
    return list;
  }

  async deleteStrategy(strategyId: string): Promise<void> {
    if (!this.entities.has(strategyId)) {
      throw new Error(`未找到策略，无法删除：${strategyId}`);
    }
    this.entities.delete(strategyId);
    this.versions.delete(strategyId);
  }

  async saveVersion(input: StrategyVersionInput): Promise<SaveVersionResult> {
    const bucket = this.versions.get(input.strategyId) ?? new Map<string, StoredVersion>();
    const version = input.document.version;
    const existing = bucket.get(version);
    if (existing !== undefined) {
      if (existing.input.document.fingerprint === input.document.fingerprint) {
        return { outcome: "idempotent-skip", version, fingerprint: input.document.fingerprint };
      }
      return {
        outcome: "conflict",
        version,
        fingerprint: input.document.fingerprint,
        existingFingerprint: existing.input.document.fingerprint,
      };
    }

    const definition = input.document.definition;
    // STRATEGY-004：与 DB 实现同语义 —— 写入前做 Dataset Binding 引用完整性校验。
    await assertStrategyDatasetBindings(
      collectStrategyDatasetBindingRequests(input.document),
      this.datasetRegistry,
    );
    const projections = definition === undefined ? emptyProjections() : buildStrategyProjections(definition);
    const ts = this.now();
    const rowId = this.nextRowId;
    this.nextRowId += 1;
    bucket.set(version, {
      input: structuredClone(input),
      rowId,
      status: input.status ?? "Draft",
      parentVersionId: input.parentVersionId ?? null,
      description: input.description ?? null,
      projections: structuredClone(projections),
      hasDefinition: definition !== undefined,
      createdAt: input.versionRecord.createdAt,
      updatedAt: ts,
    });
    this.versions.set(input.strategyId, bucket);

    const projectionRowCount = definition === undefined
      ? 0
      : projections.parameters.length + projections.entryRules.length + projections.exitRules.length
        + 1 + projections.datasetBindings.length;
    return { outcome: "inserted", version, fingerprint: input.document.fingerprint, versionRowId: rowId, projectionRowCount };
  }

  async getVersion(strategyId: string, version: string): Promise<StrategyVersionRecord | undefined> {
    const stored = this.versions.get(strategyId)?.get(version);
    return stored === undefined ? undefined : structuredClone(stored.input.versionRecord);
  }

  async listVersions(strategyId: string): Promise<StrategyVersionSummary[]> {
    const bucket = this.versions.get(strategyId);
    if (bucket === undefined) return [];
    return Array.from(bucket.entries())
      .map(([version, stored]) => ({
        strategyId,
        version,
        fingerprint: stored.input.document.fingerprint,
        datasetVersion: stored.input.document.datasetVersion,
        datasetVersionId: stored.input.document.datasetVersionId ?? null,
        universeId: stored.input.document.universe.universeId,
        codeVersion: stored.input.versionRecord.codeVersion,
        status: stored.status,
        parentVersionId: stored.parentVersionId,
        description: stored.description,
        createdAt: stored.input.versionRecord.createdAt,
      }))
      .sort((a, b) => compareStrategyVersions(b.version, a.version));
  }

  async getLatestVersion(strategyId: string): Promise<StrategyVersionRecord | undefined> {
    const bucket = this.versions.get(strategyId);
    if (bucket === undefined || bucket.size === 0) return undefined;
    let latest: StoredVersion | undefined;
    let latestVersion = "";
    for (const [version, stored] of bucket.entries()) {
      if (latest === undefined || compareStrategyVersions(version, latestVersion) > 0) {
        latest = stored;
        latestVersion = version;
      }
    }
    return latest === undefined ? undefined : structuredClone(latest.input.versionRecord);
  }

  async getVersionRowId(strategyId: string, version: string): Promise<number | undefined> {
    return this.versions.get(strategyId)?.get(version)?.rowId;
  }

  async getVersionBundle(strategyId: string, version: string): Promise<StrategyVersionBundle | undefined> {
    const stored = this.versions.get(strategyId)?.get(version);
    if (stored === undefined) return undefined;
    return {
      strategyId,
      version,
      versionRowId: stored.rowId,
      status: stored.status,
      parentVersionId: stored.parentVersionId,
      description: stored.description,
      fingerprint: stored.input.document.fingerprint,
      document: structuredClone(stored.input.document),
      versionRecord: structuredClone(stored.input.versionRecord),
      projections: structuredClone(stored.projections),
      hasDefinition: stored.hasDefinition,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
    };
  }

  async updateVersionStatus(strategyId: string, version: string, status: string): Promise<void> {
    const bucket = this.versions.get(strategyId);
    const stored = bucket?.get(version);
    if (bucket === undefined || stored === undefined) {
      throw new Error(`未找到策略版本，无法迁移状态：${strategyId}@${version}`);
    }
    bucket.set(version, { ...stored, status, updatedAt: this.now() });
  }
}
