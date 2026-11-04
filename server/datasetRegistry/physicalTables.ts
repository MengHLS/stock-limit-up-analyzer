/**
 * STEP DATASET-003A — Dataset 物理表存储（建表 / 清版本数据 / 删表）。
 *
 * 删除语义（用户明确要求）：
 *   - **删除版本**：只删该版本的物理表数据行（`DELETE ... WHERE datasetVersionId = ?`），
 *     **保留表结构**（表可继续服务其它版本，同 code 后续版本零 DDL 成本）；
 *   - **删除数据集**：级联删除其所有版本的数据行 + **DROP 掉该数据集的物理表**（表结构一并删除）。
 *
 * 安全铁律：
 *   - 表名**只**来自两条可信路径：`dataset_definition` 落库的表名 / 由 datasetCode 经 naming 规则派生；
 *     任何外部传入的表名都会被 `assertSafeTableName` 拒绝（防 DROP/DELETE 表名注入）；
 *   - 一律用反引号包裹 + 白名单校验（`parseDatasetTableName` 反解后必须与期望 code/role 完全一致）；
 *   - 分批 DELETE（LIMIT）避免跨境长事务；`DROP TABLE IF EXISTS` 保证幂等。
 *
 * 不承载策略 / 因子 / 构建逻辑；构建写数由各 Dataset 插件的 IO 负责。
 */

import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { DATASET_ROLES, buildDatasetTableName, parseDatasetTableName, type DatasetRole } from "./naming";
import { resolvePluginTables, type DatasetPlugin } from "./plugins";
import type { DatasetDefinition } from "./types";

/** 单表删除结果。 */
export interface PhysicalTablePurgeResult {
  table: string;
  /** 实际删除行数；表不存在时为 0（诚实 0，不冒充）。 */
  deleted: number;
  /** 表不存在（未注册插件 / 尚未建表的定义）。 */
  tableMissing: boolean;
}

/** 物理表操作结果（删除数据集用）。 */
export interface PhysicalDropResult {
  table: string;
  dropped: boolean;
}

export interface DatasetPhysicalStore {
  /** 幂等建立该数据集的全部物理表（已存在则跳过），返回表名清单。 */
  ensureTables(definition: DatasetDefinition, plugin: DatasetPlugin): Promise<string[]>;
  /** 删除某版本的全部物理表数据行（保留表结构）。 */
  purgeVersionRows(definition: DatasetDefinition, datasetVersionId: number): Promise<PhysicalTablePurgeResult[]>;
  /** 删除该数据集的全部物理表（DROP，表结构一并删除）。 */
  dropTables(definition: DatasetDefinition): Promise<PhysicalDropResult[]>;
}

/** 单批删除行数（避免跨境 TiDB 单事务过大）。 */
const DELETE_BATCH_SIZE = 5000;

/** MySQL/TiDB「表不存在」错误码。 */
const ERR_TABLE_NOT_EXISTS = 1146;

/** 判定「物理表不存在」错误（未注册插件的定义尚无表 / 表已被删除）。 */
export function isTableMissingError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const anyErr = err as { errno?: number; cause?: { errno?: number }; message?: string };
  if (anyErr.errno === ERR_TABLE_NOT_EXISTS || anyErr.cause?.errno === ERR_TABLE_NOT_EXISTS) return true;
  const msg = anyErr.message ?? "";
  return /doesn't exist|does not exist|Unknown table/i.test(msg);
}

/**
 * 表名安全校验：必须是 `ds_{datasetCode}_{role}` 且反解一致。
 * 拒绝一切非派生表名（含用户输入、外部字符串、含反引号的注入尝试）。
 */
export function assertSafeTableName(tableName: string, datasetCode: string, role: DatasetRole): void {
  if (typeof tableName !== "string" || tableName.length === 0) {
    throw new Error(`物理表名为空（datasetCode=${datasetCode} role=${role}）`);
  }
  const expected = buildDatasetTableName(datasetCode, role);
  if (tableName !== expected) {
    throw new Error(`物理表名不符合命名规范：期望 "${expected}"，实际 "${tableName}"`);
  }
  const parsed = parseDatasetTableName(tableName);
  if (!parsed || parsed.datasetCode !== datasetCode || parsed.role !== role) {
    throw new Error(`物理表名反解失败（拒绝执行 DDL/DML）：${tableName}`);
  }
}

/** 从 definition 解析「该数据集应管理的物理表名」（落库值优先，缺失则按命名规范派生）。 */
export function resolveDefinitionTables(definition: DatasetDefinition): Array<{ role: DatasetRole; tableName: string }> {
  const byRole: Record<DatasetRole, string | null> = {
    event: definition.eventTableName,
    prefix: definition.prefixTableName,
    post: definition.postTableName,
    path: definition.pathTableName,
    outcome: definition.outcomeTableName,
    feature: definition.featureTableName,
  };
  const tables: Array<{ role: DatasetRole; tableName: string }> = [];
  for (const role of DATASET_ROLES) {
    const stored = byRole[role];
    if (stored === null) continue; // 该数据集不声明该角色（如无 feature）
    const tableName = stored ?? buildDatasetTableName(definition.datasetCode, role);
    assertSafeTableName(tableName, definition.datasetCode, role);
    tables.push({ role, tableName });
  }
  return tables;
}

/** 真实 DB 实现（TiDB / MySQL）。 */
export class DbDatasetPhysicalStore implements DatasetPhysicalStore {
  async ensureTables(definition: DatasetDefinition, plugin: DatasetPlugin): Promise<string[]> {
    const db = await getDb();
    if (!db) throw new Error("数据库不可用");
    const tables = resolvePluginTables(plugin, definition.datasetCode);
    for (const t of tables) {
      assertSafeTableName(t.tableName, definition.datasetCode, t.role);
      await db.execute(sql.raw(t.createSql));
    }
    return tables.map((t) => t.tableName);
  }

  async purgeVersionRows(
    definition: DatasetDefinition,
    datasetVersionId: number,
  ): Promise<PhysicalTablePurgeResult[]> {
    const db = await getDb();
    if (!db) throw new Error("数据库不可用");
    const results: PhysicalTablePurgeResult[] = [];
    for (const { tableName } of resolveDefinitionTables(definition)) {
      let deleted = 0;
      let tableMissing = false;
      try {
        for (;;) {
          const raw = await db.execute(
            sql`DELETE FROM ${sql.raw(`\`${tableName}\``)} WHERE \`datasetVersionId\` = ${datasetVersionId} LIMIT ${DELETE_BATCH_SIZE}`,
          );
          const header = Array.isArray(raw) ? raw[0] : undefined;
          const affected = typeof header?.affectedRows === "number" ? header.affectedRows : 0;
          deleted += affected;
          if (affected < DELETE_BATCH_SIZE) break;
        }
      } catch (err) {
        if (!isTableMissingError(err)) throw err;
        tableMissing = true;
      }
      results.push({ table: tableName, deleted, tableMissing });
    }
    return results;
  }

  async dropTables(definition: DatasetDefinition): Promise<PhysicalDropResult[]> {
    const db = await getDb();
    if (!db) throw new Error("数据库不可用");
    const results: PhysicalDropResult[] = [];
    for (const { tableName } of resolveDefinitionTables(definition)) {
      await db.execute(sql.raw(`DROP TABLE IF EXISTS \`${tableName}\``));
      const gone = await db.execute(sql.raw(`SHOW TABLES LIKE '${tableName}'`));
      const rows = (Array.isArray(gone) ? gone[0] : undefined) as unknown[] | undefined;
      results.push({ table: tableName, dropped: (rows?.length ?? 0) === 0 });
    }
    return results;
  }
}

// ---------------------------------------------------------------------------
// 内存实现（测试替身：不触 DB，但完整复现「建表 / 清版本 / 删表」的编排语义）
// ---------------------------------------------------------------------------

/**
 * 内存物理表存储。
 * - 记录每张表的「存在与否」与「各版本行数」，因此删除逻辑（保留表结构 vs DROP 表）
 *   可以在无 DB 环境下被真实验证（非 mock 冒名：断言的是真实调用序列与状态变化）。
 */
export class InMemoryDatasetPhysicalStore implements DatasetPhysicalStore {
  /** tableName → 各 datasetVersionId 的行数。 */
  private readonly tables = new Map<string, Map<number, number>>();

  /** 预置某版本行数（供删除测试断言「清理了多少行」）。 */
  seedRows(definition: DatasetDefinition, datasetVersionId: number, rowsPerTable: number): void {
    for (const { tableName } of resolveDefinitionTables(definition)) {
      const byVersion = this.tables.get(tableName) ?? new Map<number, number>();
      byVersion.set(datasetVersionId, rowsPerTable);
      this.tables.set(tableName, byVersion);
    }
  }

  /** 表是否仍存在（用于断言「删版本保留表结构」「删数据集 DROP 表」）。 */
  hasTable(tableName: string): boolean {
    return this.tables.has(tableName);
  }

  listTables(): string[] {
    return Array.from(this.tables.keys()).sort();
  }

  async ensureTables(definition: DatasetDefinition, plugin: DatasetPlugin): Promise<string[]> {
    const tables = resolvePluginTables(plugin, definition.datasetCode);
    for (const t of tables) {
      assertSafeTableName(t.tableName, definition.datasetCode, t.role);
      if (!this.tables.has(t.tableName)) this.tables.set(t.tableName, new Map());
    }
    return tables.map((t) => t.tableName);
  }

  async purgeVersionRows(
    definition: DatasetDefinition,
    datasetVersionId: number,
  ): Promise<PhysicalTablePurgeResult[]> {
    const results: PhysicalTablePurgeResult[] = [];
    for (const { tableName } of resolveDefinitionTables(definition)) {
      const byVersion = this.tables.get(tableName);
      if (!byVersion) {
        results.push({ table: tableName, deleted: 0, tableMissing: true });
        continue;
      }
      const deleted = byVersion.get(datasetVersionId) ?? 0;
      byVersion.delete(datasetVersionId);
      results.push({ table: tableName, deleted, tableMissing: false });
    }
    return results;
  }

  async dropTables(definition: DatasetDefinition): Promise<PhysicalDropResult[]> {
    const results: PhysicalDropResult[] = [];
    for (const { tableName } of resolveDefinitionTables(definition)) {
      const existed = this.tables.delete(tableName);
      results.push({ table: tableName, dropped: existed });
    }
    return results;
  }
}
