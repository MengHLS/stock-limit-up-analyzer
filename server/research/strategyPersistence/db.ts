/**
 * STEP STRATEGY-002 / STRATEGY-003 — DB Strategy Persistence 实现（TiDB / MySQL，沿用 drizzle + getDb）。
 *
 * 只做策略实体、不可变版本与查询投影的落库与读取；不引入新 ORM / 新库 / 队列。
 *
 * 幂等 / 指纹冲突 / 不可变（§7/§18/§19）：
 *   - saveVersion 先查后插（幂等 + 冲突判定），并发由 DB 唯一约束 (strategyId, version) 兜底；
 *   - 版本内容一经写入，绝不提供「修改内容」的 UPDATE 入口（改内容必须新建版本）；
 *     允许的 UPDATE 仅限于生命周期 `status`、星标元数据与谱系元数据 `parentVersionId`。
 *
 * 🔴 STRATEGY-003 事务纪律（SPEC §七）：
 *   canonical 本体 + §17 追溯记录 + **由 definition 单向派生的 5 类投影** 在同一事务内写入；
 *   任一步失败整体回滚，**不允许**「Canonical 已写入、Projection 没写入」。
 *
 * 🔴 STRATEGY-004 引用完整性（SPEC §5 / §6）：
 *   saveVersion 在**同一事务内**、写入之前先做 Dataset Binding 引用完整性校验
 *   （`assertStrategyDatasetBindings`，只读 Dataset Registry）——「存在 AND READY AND
 *   datasetId 属于该版本 AND label 一致」，失败即抛 `StrategyDatasetBindingError` 并整体回滚。
 *   查库走 Dataset Registry 既有 Repository（`DbDatasetRegistry`），不新写 SQL、不绕过 Registry。
 *
 * 指纹验证（§6）：读取时 deserialize* 会重算指纹并拒绝篡改；此外 `assertStoredVersionConsistency`
 * 额外断言 `versionRecordJson.strategy.fingerprint == 列 fingerprint == strategyDocumentJson 重算指纹`
 * （F1 双份定义的漂移检测），不一致即抛错，不静默修复。
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../db";
import { DbDatasetRegistry } from "../../datasetRegistry/db";
import {
  strategies,
  strategyEntryRules,
  strategyExecutionRules,
  strategyExitRules,
  strategyParameters,
  strategyVersionDatasets,
  strategyVersionStars,
  strategyVersions,
} from "../../../drizzle/schema";
import { buildStrategyProjections, type StrategyProjections } from "../strategySchema/projection";
import {
  deserializeStrategyDocument,
  serializeStrategyDocument,
  serializeStrategyVersionRecord,
} from "../strategySchema/serialize";
import { compareStrategyVersions } from "../strategySchema/version";
import type { StrategyDocument, StrategyVersionRecord } from "../strategySchema/types";
import { assertStoredVersionConsistency, type StoredVersionColumns } from "./consistency";
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

type StrategyRow = typeof strategies.$inferSelect;
type StrategyVersionRow = typeof strategyVersions.$inferSelect;

/** drizzle 事务回调上下文类型（用于把投影写入封装成同一事务内的私有方法）。 */
type DbExecutor = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type TxExecutor = Parameters<Parameters<DbExecutor["transaction"]>[0]>[0];

/** MySQL 唯一约束冲突错误码（并发兜底）。 */
const ER_DUP_ENTRY = 1062;

/** Date / ISO 字符串 → ISO 字符串（null → ""）。 */
function toIso(value: Date | string | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? "" : value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function rowToSummary(row: StrategyRow): StrategySummary {
  return {
    strategyId: row.strategyId,
    name: row.name,
    latestVersion: row.latestVersion,
    status: row.status,
    description: row.description ?? null,
    strategyType: row.strategyType ?? null,
    currentVersionId: row.currentVersionId ?? null,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function rowToVersionSummary(row: StrategyVersionRow, isStarred: boolean): StrategyVersionSummary {
  return {
    strategyId: row.strategyId,
    version: row.version,
    versionRowId: row.id,
    fingerprint: row.fingerprint,
    datasetVersion: row.datasetVersion,
    datasetVersionId: row.datasetVersionId ?? null,
    universeId: row.universeId,
    codeVersion: row.codeVersion,
    status: row.status,
    parentVersionId: row.parentVersionId ?? null,
    description: row.description ?? null,
    // 星标以 strategy_version_star 为准（0053 起），不再读 0052 的历史列。
    isStarred,
    createdAt: toIso(row.createdAt),
  };
}

/** 空投影（v1 文档无 Canonical definition 时）。 */
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

function isDupEntry(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const err = error as { errno?: unknown; code?: unknown };
  return err.errno === ER_DUP_ENTRY || err.code === "ER_DUP_ENTRY";
}

export class DbStrategyRepository implements StrategyRepository {
  /**
   * STRATEGY-004：Dataset Binding 引用完整性的只读来源 = Dataset Registry 既有 Repository。
   * 默认 `DbDatasetRegistry`（读真实 TiDB）；测试可注入 fake 端口验证各类错误码。
   */
  private readonly datasetRegistry: DatasetVersionReferencePort;

  constructor(datasetRegistry: DatasetVersionReferencePort = new DbDatasetRegistry()) {
    this.datasetRegistry = datasetRegistry;
  }

  async saveStrategy(input: StrategyEntityInput): Promise<void> {
    const db = await getDb();
    if (!db) throw new Error("数据库不可用，无法持久化策略");
    const existing = await db.select({ id: strategies.id })
      .from(strategies)
      .where(eq(strategies.strategyId, input.strategyId))
      .limit(1);
    if (existing.length > 0) {
      // currentVersionId 为权威指针，但调用方未显式提供时不得被 null 覆盖既有值。
      // 同理 strategyType：undefined = 本次调用不表态，保留既有分类；
      // null = 显式清空。service 层已保证「文档缺省 → 传既有值」，这里再守一道。
      await db.update(strategies)
        .set({
          name: input.name,
          latestVersion: input.latestVersion,
          status: input.status,
          description: input.description ?? null,
          ...(input.strategyType === undefined ? {} : { strategyType: input.strategyType }),
          ...(input.currentVersionId === undefined ? {} : { currentVersionId: input.currentVersionId }),
        })
        .where(eq(strategies.strategyId, input.strategyId));
      return;
    }
    await db.insert(strategies).values({
      strategyId: input.strategyId,
      name: input.name,
      latestVersion: input.latestVersion,
      status: input.status,
      description: input.description ?? null,
      strategyType: input.strategyType ?? null,
      currentVersionId: input.currentVersionId ?? null,
    });
  }

  async getStrategy(strategyId: string): Promise<StrategySummary | undefined> {
    const db = await getDb();
    if (!db) return undefined;
    const rows = await db.select().from(strategies)
      .where(eq(strategies.strategyId, strategyId))
      .limit(1);
    const row = rows[0];
    return row === undefined ? undefined : rowToSummary(row);
  }

  async listStrategies(): Promise<StrategySummary[]> {
    const db = await getDb();
    if (!db) return [];
    const rows = await db.select().from(strategies).orderBy(desc(strategies.updatedAt));
    return rows.map(rowToSummary);
  }

  async deleteStrategy(strategyId: string): Promise<void> {
    const db = await getDb();
    if (!db) throw new Error("数据库不可用，无法删除策略");
    // 级联（无 FK，应用层保证顺序）：先删 5 张投影 → 再删版本 → 最后删实体。
    const versionRows = await db.select({ id: strategyVersions.id })
      .from(strategyVersions)
      .where(eq(strategyVersions.strategyId, strategyId));
    const versionIds = versionRows.map((row) => row.id);
    await db.transaction(async (tx) => {
      if (versionIds.length > 0) {
        await tx.delete(strategyParameters).where(inArray(strategyParameters.strategyVersionId, versionIds));
        await tx.delete(strategyEntryRules).where(inArray(strategyEntryRules.strategyVersionId, versionIds));
        await tx.delete(strategyExitRules).where(inArray(strategyExitRules.strategyVersionId, versionIds));
        await tx.delete(strategyExecutionRules).where(inArray(strategyExecutionRules.strategyVersionId, versionIds));
        await tx.delete(strategyVersionDatasets).where(inArray(strategyVersionDatasets.strategyVersionId, versionIds));
      }
      // 星标按 strategyId 独立存储，删除策略时必须显式清理。
      await tx.delete(strategyVersionStars).where(eq(strategyVersionStars.strategyId, strategyId));
      await tx.delete(strategyVersions).where(eq(strategyVersions.strategyId, strategyId));
      const result = await tx.delete(strategies).where(eq(strategies.strategyId, strategyId));
      if (result[0].affectedRows === 0) {
        throw new Error(`未找到策略，无法删除：${strategyId}`);
      }
    });
  }

  async saveVersion(input: StrategyVersionInput): Promise<SaveVersionResult> {
    const db = await getDb();
    if (!db) throw new Error("数据库不可用，无法持久化策略版本");
    const { strategyId } = input;
    const version = input.document.version;
    const fingerprint = input.document.fingerprint;

    const existing = await db.select({ fingerprint: strategyVersions.fingerprint })
      .from(strategyVersions)
      .where(and(eq(strategyVersions.strategyId, strategyId), eq(strategyVersions.version, version)))
      .limit(1);

    if (existing.length > 0) {
      if (existing[0].fingerprint === fingerprint) {
        return { outcome: "idempotent-skip", version, fingerprint };
      }
      return {
        outcome: "conflict",
        version,
        fingerprint,
        existingFingerprint: existing[0].fingerprint,
      };
    }

    const strategyDocumentJson = serializeStrategyDocument(input.document);
    const versionRecordJson = serializeStrategyVersionRecord(input.versionRecord);
    const definition = input.document.definition;
    const projections = definition === undefined ? undefined : buildStrategyProjections(definition);

    let versionRowId: number;
    try {
      versionRowId = await db.transaction(async (tx) => {
        // 🔴 STRATEGY-004：Dataset Binding 引用完整性 —— 与写入处于**同一事务边界**。
        // 校验不过 → 抛 StrategyDatasetBindingError → 事务回滚，不产生任何版本 / 投影行。
        // 诚实边界：项目约定「不加 FK」，因此无法用数据库层阻止「校验后、提交前」
        // 另一个事务删除该 dataset_version（应用层一致性的已知残留窗口，见 STRATEGY-004 报告）。
        await assertStrategyDatasetBindings(
          collectStrategyDatasetBindingRequests(input.document),
          this.datasetRegistry,
        );
        const inserted = await tx.insert(strategyVersions).values({
          strategyId,
          version,
          strategyDocumentJson,
          versionRecordJson,
          fingerprint,
          datasetVersion: input.document.datasetVersion,
          datasetVersionId: input.document.datasetVersionId ?? null,
          universeId: input.document.universe.universeId,
          codeVersion: input.versionRecord.codeVersion,
          parentVersionId: input.parentVersionId ?? null,
          status: input.status ?? "Draft",
          description: input.description ?? null,
          createdAt: new Date(input.versionRecord.createdAt),
        });
        const rowId = Number(inserted[0].insertId);
        // 🔴 投影必须与 canonical 同事务写入（SPEC §七）。
        if (projections !== undefined) {
          await this.writeProjections(tx, rowId, strategyId, version, projections);
        }
        return rowId;
      });
    } catch (error) {
      if (isDupEntry(error)) {
        // 并发兜底：唯一约束冲突 → 重新判定幂等 vs 冲突。
        const raced = await db.select({ fingerprint: strategyVersions.fingerprint })
          .from(strategyVersions)
          .where(and(eq(strategyVersions.strategyId, strategyId), eq(strategyVersions.version, version)))
          .limit(1);
        if (raced.length > 0 && raced[0].fingerprint === fingerprint) {
          return { outcome: "idempotent-skip", version, fingerprint };
        }
        return {
          outcome: "conflict",
          version,
          fingerprint,
          existingFingerprint: raced[0]?.fingerprint,
        };
      }
      throw error;
    }

    const projectionRowCount = projections === undefined
      ? 0
      : projections.parameters.length + projections.entryRules.length + projections.exitRules.length
        + 1 + projections.datasetBindings.length;

    return { outcome: "inserted", version, fingerprint, versionRowId, projectionRowCount };
  }

  /** 写入 5 类投影行（在事务上下文内调用）。 */
  private async writeProjections(
    tx: TxExecutor,
    strategyVersionId: number,
    strategyId: string,
    version: string,
    projections: StrategyProjections,
  ): Promise<void> {
    const scope = { strategyVersionId, strategyId, strategyVersion: version };
    if (projections.parameters.length > 0) {
      await tx.insert(strategyParameters).values(
        projections.parameters.map((row) => ({ ...scope, ...row })),
      );
    }
    if (projections.entryRules.length > 0) {
      await tx.insert(strategyEntryRules).values(
        projections.entryRules.map((row) => ({ ...scope, ...row })),
      );
    }
    if (projections.exitRules.length > 0) {
      await tx.insert(strategyExitRules).values(
        projections.exitRules.map((row) => ({ ...scope, ...row })),
      );
    }
    await tx.insert(strategyExecutionRules).values({ ...scope, ...projections.executionRule });
    if (projections.datasetBindings.length > 0) {
      await tx.insert(strategyVersionDatasets).values(
        projections.datasetBindings.map((row) => ({ ...scope, ...row })),
      );
    }
  }

  async getVersion(strategyId: string, version: string): Promise<StrategyVersionRecord | undefined> {
    const row = await this.selectVersionRow(strategyId, version);
    if (row === undefined) return undefined;
    // 反序列化含指纹复核 + 双份定义一致性断言（篡改 / 漂移即抛错，不静默接受，§6 / F1）。
    return assertStoredVersionConsistency(this.toStoredColumns(row)).versionRecord;
  }

  async getVersionBundle(strategyId: string, version: string): Promise<StrategyVersionBundle | undefined> {
    const row = await this.selectVersionRow(strategyId, version);
    if (row === undefined) return undefined;
    const parsed = assertStoredVersionConsistency(this.toStoredColumns(row));
    const definition = parsed.document.definition;
    const projections = definition === undefined
      ? emptyProjections()
      : await this.loadProjections(row.id);
    return {
      strategyId: row.strategyId,
      version: row.version,
      versionRowId: row.id,
      status: row.status,
      parentVersionId: row.parentVersionId ?? null,
      description: row.description ?? null,
      fingerprint: row.fingerprint,
      document: parsed.document,
      versionRecord: parsed.versionRecord,
      projections,
      hasDefinition: definition !== undefined,
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
    };
  }

  /** 从 5 张投影表读回投影（仅用于查询 / 漂移比对，绝不用于重建 canonical Definition）。 */
  async loadProjections(strategyVersionId: number): Promise<StrategyProjections> {
    const db = await getDb();
    if (!db) return emptyProjections();
    const [parameters, entryRules, exitRules, executionRules, datasetBindings] = await Promise.all([
      db.select().from(strategyParameters)
        .where(eq(strategyParameters.strategyVersionId, strategyVersionId))
        .orderBy(strategyParameters.ordinal),
      db.select().from(strategyEntryRules)
        .where(eq(strategyEntryRules.strategyVersionId, strategyVersionId))
        .orderBy(strategyEntryRules.priority),
      db.select().from(strategyExitRules)
        .where(eq(strategyExitRules.strategyVersionId, strategyVersionId))
        .orderBy(strategyExitRules.ordinal),
      db.select().from(strategyExecutionRules)
        .where(eq(strategyExecutionRules.strategyVersionId, strategyVersionId))
        .limit(1),
      db.select().from(strategyVersionDatasets)
        .where(eq(strategyVersionDatasets.strategyVersionId, strategyVersionId))
        .orderBy(strategyVersionDatasets.ordinal),
    ]);
    const execution = executionRules[0];
    return {
      parameters: parameters.map((row) => ({
        code: row.code,
        name: row.name,
        dataType: row.dataType,
        parameterRole: row.parameterRole,
        defaultValueJson: row.defaultValueJson ?? null,
        minValue: row.minValue ?? null,
        maxValue: row.maxValue ?? null,
        stepValue: row.stepValue ?? null,
        unit: row.unit ?? null,
        description: row.description ?? null,
        required: row.required,
        ordinal: row.ordinal,
      })),
      entryRules: entryRules.map((row) => ({
        ruleId: row.ruleId,
        ruleType: row.ruleType as "CONDITION" | "EVENT_OBSERVATION",
        eventType: row.eventType,
        windowStart: row.windowStart,
        windowEnd: row.windowEnd,
        windowUnit: row.windowUnit,
        triggerType: row.triggerType,
        conditionJson: row.conditionJson ?? null,
        conditionCount: row.conditionCount,
        priority: row.priority,
        enabled: row.enabled,
      })),
      exitRules: exitRules.map((row) => ({
        ruleId: row.ruleId,
        ruleType: row.ruleType,
        triggerType: row.triggerType,
        thresholdValue: row.thresholdValue ?? null,
        thresholdUnit: row.thresholdUnit ?? null,
        policyJson: row.policyJson ?? null,
        parameterCode: row.parameterCode ?? null,
        conditionJson: row.conditionJson ?? null,
        priority: row.priority,
        enabled: row.enabled,
        ordinal: row.ordinal,
      })),
      executionRule: execution === undefined
        ? emptyProjections().executionRule
        : {
          signalTiming: execution.signalTiming,
          executionTiming: execution.executionTiming,
          priceType: execution.priceType,
          quantityMethod: execution.quantityMethod,
          lotSize: execution.lotSize,
          slippageModel: execution.slippageModel ?? null,
          commissionModel: execution.commissionModel ?? null,
          executionConstraintsJson: execution.executionConstraintsJson ?? null,
        },
      datasetBindings: datasetBindings.map((row) => ({
        datasetId: row.datasetId,
        datasetVersion: row.datasetVersion,
        datasetVersionId: row.datasetVersionId ?? null,
        role: row.role,
        note: row.note ?? null,
        ordinal: row.ordinal,
      })),
    };
  }

  async listVersions(strategyId: string): Promise<StrategyVersionSummary[]> {
    const db = await getDb();
    if (!db) return [];
    const rows = await db.select().from(strategyVersions)
      .where(eq(strategyVersions.strategyId, strategyId))
      .orderBy(desc(strategyVersions.createdAt));
    const starred = new Set(await this.listVersionStars(strategyId));
    return rows
      .map(row => rowToVersionSummary(row, starred.has(row.version)))
      .sort((a, b) => compareStrategyVersions(b.version, a.version));
  }

  async listVersionStars(strategyId: string): Promise<string[]> {
    const db = await getDb();
    if (!db) return [];
    const rows = await db.select({ version: strategyVersionStars.version })
      .from(strategyVersionStars)
      .where(eq(strategyVersionStars.strategyId, strategyId));
    return rows.map(row => row.version);
  }

  async getLatestVersion(strategyId: string): Promise<StrategyVersionRecord | undefined> {
    const rows = await this.selectAllVersionRows(strategyId);
    if (rows.length === 0) return undefined;
    let latest = rows[0];
    for (const row of rows) {
      if (compareStrategyVersions(row.version, latest.version) > 0) {
        latest = row;
      }
    }
    return assertStoredVersionConsistency(this.toStoredColumns(latest)).versionRecord;
  }

  async getVersionRowId(strategyId: string, version: string): Promise<number | undefined> {
    const row = await this.selectVersionRow(strategyId, version);
    return row?.id;
  }

  async getVersionStatus(strategyId: string, version: string): Promise<string | undefined> {
    const row = await this.selectVersionRow(strategyId, version);
    return row?.status;
  }

  async isCurrentStrategyVersion(strategyId: string, version: string): Promise<boolean> {
    const strategy = await this.getStrategy(strategyId);
    if (strategy === undefined || strategy.currentVersionId === null) return false;
    const rowId = await this.getVersionRowId(strategyId, version);
    return rowId === strategy.currentVersionId;
  }

  async updateVersionStatus(strategyId: string, version: string, status: string): Promise<void> {
    const db = await getDb();
    if (!db) throw new Error("数据库不可用，无法迁移版本状态");
    const result = await db.update(strategyVersions)
      .set({ status })
      .where(and(eq(strategyVersions.strategyId, strategyId), eq(strategyVersions.version, version)));
    if (result[0].affectedRows === 0) {
      throw new Error(`未找到策略版本，无法迁移状态：${strategyId}@${version}`);
    }
  }

  async updateVersionParent(
    strategyId: string,
    version: string,
    parentVersionId: number | null,
  ): Promise<void> {
    const db = await getDb();
    if (!db) throw new Error("数据库不可用，无法更新版本父链");
    const child = await this.selectVersionRow(strategyId, version);
    if (child === undefined) {
      throw new Error(`未找到策略版本，无法更新父链：${strategyId}@${version}`);
    }
    if (parentVersionId === child.id) {
      throw new Error(`版本父链不能指向自身：${strategyId}@${version}`);
    }
    if (child.parentVersionId === parentVersionId) return;

    if (parentVersionId !== null) {
      const parentRows = await db.select({
        id: strategyVersions.id,
        strategyId: strategyVersions.strategyId,
      }).from(strategyVersions)
        .where(eq(strategyVersions.id, parentVersionId))
        .limit(1);
      const parent = parentRows[0];
      if (parent === undefined) {
        throw new Error(`父版本行不存在：${parentVersionId}`);
      }
      if (parent.strategyId !== strategyId) {
        throw new Error(
          `父版本必须属于同一策略：${strategyId}@${version} -> ${parent.strategyId}#${parentVersionId}`,
        );
      }
    }

    // 显式写回原 updatedAt，避免 onUpdateNow() 把谱系元数据修复误记为版本内容变更。
    const result = await db.update(strategyVersions)
      .set({ parentVersionId, updatedAt: child.updatedAt })
      .where(and(eq(strategyVersions.strategyId, strategyId), eq(strategyVersions.version, version)));
    if (result[0].affectedRows === 0) {
      throw new Error(`未找到策略版本，无法更新父链：${strategyId}@${version}`);
    }
  }

  async updateVersionStarred(strategyId: string, version: string, isStarred: boolean): Promise<void> {
    const db = await getDb();
    if (!db) throw new Error("数据库不可用，无法更新版本星标");
    // 正式版本是版本存在的唯一来源：先确认 strategy_versions 行存在，避免留下
    // 「正式目录查不到、星标却存在」的孤儿元数据。
    const versionRow = await this.selectVersionRow(strategyId, version);
    if (versionRow === undefined) {
      throw new Error(`未找到策略版本，无法更新星标：${strategyId}@${version}`);
    }
    if (isStarred) {
      await db.insert(strategyVersionStars)
        .values({ strategyId, version })
        .onDuplicateKeyUpdate({ set: { version } });
      return;
    }
    await db.delete(strategyVersionStars)
      .where(and(eq(strategyVersionStars.strategyId, strategyId), eq(strategyVersionStars.version, version)));
  }

  // ---- 内部：行读取与列裁剪 ----

  private async selectVersionRow(strategyId: string, version: string): Promise<StrategyVersionRow | undefined> {
    const db = await getDb();
    if (!db) return undefined;
    const rows = await db.select().from(strategyVersions)
      .where(and(eq(strategyVersions.strategyId, strategyId), eq(strategyVersions.version, version)))
      .limit(1);
    return rows[0];
  }

  private async selectAllVersionRows(strategyId: string): Promise<StrategyVersionRow[]> {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(strategyVersions).where(eq(strategyVersions.strategyId, strategyId));
  }

  private toStoredColumns(row: StrategyVersionRow): StoredVersionColumns {
    return {
      strategyId: row.strategyId,
      version: row.version,
      strategyDocumentJson: row.strategyDocumentJson,
      versionRecordJson: row.versionRecordJson,
      fingerprint: row.fingerprint,
    };
  }
}

/** 反序列化策略本体（供 load 复用；含指纹复核）。 */
export function deserializeStoredDocument(json: string): StrategyDocument {
  return deserializeStrategyDocument(json);
}
