/**
 * STEP STRATEGY-002 — 内存 Strategy Persistence 实现（单元测试用）。
 *
 * 说明：本实现仅用于「Repository 契约逻辑」的单元测试（幂等 / 指纹冲突 / 不可变 / 排序），
 * **不用于证明持久化**——持久化验收必须基于真实 DB（DbStrategyRepository + 真实 TiDB E2E，§21）。
 * 存储与读取均结构化克隆，保证 mutation isolation；时间戳由注入的 now 提供（测试可固定）。
 */

import { compareStrategyVersions } from "../strategySchema/version";
import type {
  SaveVersionResult,
  StrategyEntityInput,
  StrategyRepository,
  StrategySummary,
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
}

export class InMemoryStrategyRepository implements StrategyRepository {
  private readonly entities = new Map<string, StoredEntity>();
  private readonly versions = new Map<string, Map<string, StoredVersion>>();
  private readonly now: () => string;

  constructor(now: () => string = () => new Date().toISOString()) {
    this.now = now;
  }

  async saveStrategy(input: StrategyEntityInput): Promise<void> {
    const existing = this.entities.get(input.strategyId);
    if (existing === undefined) {
      const ts = this.now();
      this.entities.set(input.strategyId, {
        entity: structuredClone(input),
        createdAt: ts,
        updatedAt: ts,
      });
      return;
    }
    this.entities.set(input.strategyId, {
      entity: structuredClone(input),
      createdAt: existing.createdAt,
      updatedAt: this.now(),
    });
  }

  async getStrategy(strategyId: string): Promise<StrategySummary | undefined> {
    const stored = this.entities.get(strategyId);
    if (stored === undefined) return undefined;
    return {
      ...structuredClone(stored.entity),
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
    };
  }

  async listStrategies(): Promise<StrategySummary[]> {
    return Array.from(this.entities.entries())
      .map(([strategyId, stored]) => ({
        ...structuredClone(stored.entity),
        createdAt: stored.createdAt,
        updatedAt: stored.updatedAt,
      }))
      .sort((a, b) => a.strategyId.localeCompare(b.strategyId));
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
    if (existing === undefined) {
      bucket.set(version, { input: structuredClone(input) });
      this.versions.set(input.strategyId, bucket);
      return { outcome: "inserted", version, fingerprint: input.document.fingerprint };
    }
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

  async getVersion(strategyId: string, version: string): Promise<import("../strategySchema/types").StrategyVersionRecord | undefined> {
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
        universeId: stored.input.document.universe.universeId,
        codeVersion: stored.input.versionRecord.codeVersion,
        createdAt: stored.input.versionRecord.createdAt,
      }))
      .sort((a, b) => compareStrategyVersions(b.version, a.version));
  }

  async getLatestVersion(strategyId: string): Promise<import("../strategySchema/types").StrategyVersionRecord | undefined> {
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
}
