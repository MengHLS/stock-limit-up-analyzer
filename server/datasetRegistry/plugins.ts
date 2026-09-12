/**
 * STEP DATASET-003A — Dataset 构建插件注册表（多数据集架构核心）。
 *
 * 定位：把「一个数据集用什么表结构、怎么读、怎么构建」从核心 Registry/Runner 中解耦出来，
 * 让 **每个 datasetCode 拥有自己的物理表结构与构建逻辑**（用户明确要求，不做模板复用）。
 *
 * 三层职责（互不越界）：
 *   - DatasetPluginRegistry：datasetCode → DatasetPlugin 的唯一查找入口（register / get / has / list）；
 *   - DatasetPhysicalTableSpec：该数据集的物理表结构（DDL 自包含，表名由 datasetCode 派生注入）；
 *   - DatasetPlugin.createIO / createBuilder：该数据集的数据读取与构建实现。
 *
 * 纪律：
 *   - **核心不硬编码任何 datasetCode**：Registry / Lifecycle / Runner / Router 一律经本注册表查找，
 *     未注册的 datasetCode 由调用方抛 `BUILDER_NOT_REGISTERED`（稳定错误码），不静默回退。
 *   - **DDL 自包含**：建表语句不依赖「模板表存在」（避免删表后无法重建），表名参数化，
 *     与 migration 0028 的实际结构一致（由验证脚本核对 `SHOW CREATE TABLE`）。
 *   - **表名不可注入**：DDL 只由 datasetCode + role 经 naming 规则派生，不接受外部表名。
 *   - 纯注册表 + 声明，不承载 IO / 策略 / 因子逻辑。
 */

import type { DatasetBuildIO, DatasetBuilder } from "./builder";
import { FirstLimitPullbackDatasetBuilder } from "./builder";
import { DbDatasetBuildIO } from "./db";
import { buildDatasetTableName, type DatasetRole } from "./naming";

// ---------------------------------------------------------------------------
// 物理表结构声明
// ---------------------------------------------------------------------------

export interface DatasetPhysicalTableSpec {
  role: DatasetRole;
  /** 中文用途说明（供前端展示；不承载业务语义）。 */
  label: string;
  /** 建表 DDL：表名由 datasetCode 派生后注入（幂等 IF NOT EXISTS）。 */
  createSql: (tableName: string) => string;
}

/** 构建器构造参数（由 Runner 从 version 的构建配置解析后传入）。 */
export interface DatasetPluginBuildOptions {
  /** 批量写入大小（events 逐日 / paths·outcomes 分块）。 */
  batchSize: number;
}

/** 一个 Dataset 的完整构建能力声明。 */
export interface DatasetPlugin {
  /** 稳定语义代码（= dataset_definition.datasetCode，lowercase snake_case）。 */
  datasetCode: string;
  /** 展示名。 */
  displayName: string;
  /** 说明（供前端「新建数据集」时展示）。 */
  description: string;
  /** 该数据集的物理表结构（event / path / outcome …）。 */
  physicalTables: readonly DatasetPhysicalTableSpec[];
  /** 构造该数据集的数据读写 IO（真实 DB 实现）。 */
  createIO: () => DatasetBuildIO;
  /** 构造该数据集的构建器。 */
  createBuilder: (io: DatasetBuildIO, options: DatasetPluginBuildOptions) => DatasetBuilder;
}

// ---------------------------------------------------------------------------
// 注册表
// ---------------------------------------------------------------------------

export class DatasetPluginRegistry {
  private readonly plugins = new Map<string, DatasetPlugin>();

  /** 注册插件；同一 datasetCode 重复注册直接拒绝（防运行期静默覆盖）。 */
  register(plugin: DatasetPlugin): void {
    if (this.plugins.has(plugin.datasetCode)) {
      throw new Error(`Dataset 插件已注册，禁止覆盖：${plugin.datasetCode}`);
    }
    if (plugin.physicalTables.length === 0) {
      throw new Error(`Dataset 插件必须声明至少一张物理表：${plugin.datasetCode}`);
    }
    this.plugins.set(plugin.datasetCode, plugin);
  }

  /** 注销插件（仅供验证脚本清理临时插件；生产不在运行期调用）。 */
  unregister(datasetCode: string): boolean {
    return this.plugins.delete(datasetCode);
  }

  get(datasetCode: string): DatasetPlugin | undefined {
    return this.plugins.get(datasetCode);
  }

  has(datasetCode: string): boolean {
    return this.plugins.has(datasetCode);
  }

  /** 全部已注册插件（按 datasetCode 升序，稳定输出）。 */
  list(): DatasetPlugin[] {
    return Array.from(this.plugins.values()).sort((a, b) => a.datasetCode.localeCompare(b.datasetCode));
  }
}

// ---------------------------------------------------------------------------
// 内置插件：first_limit_pullback
// ---------------------------------------------------------------------------

/** 建表 DDL 公共表尾（存储引擎 / 字符集与 migration 0028 一致）。 */
const TABLE_FOOTER = "\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin";

function eventCreateSql(tableName: string): string {
  return `CREATE TABLE IF NOT EXISTS \`${tableName}\` (
  \`id\` bigint NOT NULL AUTO_INCREMENT,
  \`datasetVersionId\` bigint NOT NULL,
  \`eventId\` varchar(64) NOT NULL,
  \`symbol\` varchar(32) NOT NULL,
  \`tradeDate\` date NOT NULL,
  \`market\` varchar(16) DEFAULT NULL,
  \`industryCode\` varchar(32) DEFAULT NULL,
  \`boardType\` varchar(32) DEFAULT NULL,
  \`previousClose\` double DEFAULT NULL,
  \`limitUpPrice\` double DEFAULT NULL,
  \`turnover\` double DEFAULT NULL,
  \`isFirstLimit\` tinyint(1) DEFAULT NULL,
  \`previousLimitDate\` date DEFAULT NULL,
  \`daysSincePreviousLimit\` int DEFAULT NULL,
  \`historicalLimitCount\` int DEFAULT NULL,
  \`marketCap\` double DEFAULT NULL,
  \`floatMarketCap\` double DEFAULT NULL,
  \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_event_version_event\` (\`datasetVersionId\`,\`eventId\`),
  KEY \`idx_event_version_date\` (\`datasetVersionId\`,\`tradeDate\`),
  KEY \`idx_event_symbol_date\` (\`symbol\`,\`tradeDate\`)${TABLE_FOOTER}`;
}

/**
 * 原始行情窗口表 DDL（`prefix` / `post` 同构，仅表名与索引前缀不同；不变量 I10）。
 *
 * 只承载**纯日线原始列**：不含任何 `*FromEventClose` / `isBreakout`（不变量 I8/I9），
 * 也不含 `turnover` / 市值（它们不是日线字段，归 `event`）。这是结构级 PIT 防线：
 * 误用未来信息从「需要人工判断」变成「表选错就查不到」。
 */
function rawBarCreateSql(tableName: string, keyPrefix: string): string {
  return `CREATE TABLE IF NOT EXISTS \`${tableName}\` (
  \`id\` bigint NOT NULL AUTO_INCREMENT,
  \`datasetVersionId\` bigint NOT NULL,
  \`eventId\` varchar(64) NOT NULL,
  \`symbol\` varchar(32) NOT NULL,
  \`tradeDate\` date NOT NULL,
  \`relativeDay\` int NOT NULL,
  \`open\` double DEFAULT NULL,
  \`high\` double DEFAULT NULL,
  \`low\` double DEFAULT NULL,
  \`close\` double DEFAULT NULL,
  \`volume\` double DEFAULT NULL,
  \`amount\` double DEFAULT NULL,
  \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_${keyPrefix}_version_event_day\` (\`datasetVersionId\`,\`eventId\`,\`relativeDay\`),
  KEY \`idx_${keyPrefix}_event_day\` (\`eventId\`,\`relativeDay\`),
  KEY \`idx_${keyPrefix}_symbol_date\` (\`symbol\`,\`tradeDate\`),
  KEY \`idx_${keyPrefix}_version_day\` (\`datasetVersionId\`,\`relativeDay\`)${TABLE_FOOTER}`;
}

function prefixCreateSql(tableName: string): string {
  return rawBarCreateSql(tableName, "prefix");
}

function postCreateSql(tableName: string): string {
  return rawBarCreateSql(tableName, "post");
}

/** 衍生指标表：只存相对事件价的衍生量，`relativeDay ≥ 1`（前视，仅打标签用）。 */
function pathCreateSql(tableName: string): string {
  return `CREATE TABLE IF NOT EXISTS \`${tableName}\` (
  \`id\` bigint NOT NULL AUTO_INCREMENT,
  \`datasetVersionId\` bigint NOT NULL,
  \`eventId\` varchar(64) NOT NULL,
  \`symbol\` varchar(32) NOT NULL,
  \`tradeDate\` date NOT NULL,
  \`relativeDay\` int NOT NULL,
  \`highFromEventClose\` double DEFAULT NULL,
  \`lowFromEventClose\` double DEFAULT NULL,
  \`closeFromEventClose\` double DEFAULT NULL,
  \`pullbackFromEventHigh\` double DEFAULT NULL,
  \`volumeRatio\` double DEFAULT NULL,
  \`isBreakout\` tinyint(1) DEFAULT NULL,
  \`breakoutPrice\` double DEFAULT NULL,
  \`daysToBreakout\` int DEFAULT NULL,
  \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_path_version_event_day\` (\`datasetVersionId\`,\`eventId\`,\`relativeDay\`),
  KEY \`idx_path_event_day\` (\`eventId\`,\`relativeDay\`),
  KEY \`idx_path_symbol_date\` (\`symbol\`,\`tradeDate\`),
  KEY \`idx_path_version_day\` (\`datasetVersionId\`,\`relativeDay\`)${TABLE_FOOTER}`;
}

function outcomeCreateSql(tableName: string): string {
  return `CREATE TABLE IF NOT EXISTS \`${tableName}\` (
  \`id\` bigint NOT NULL AUTO_INCREMENT,
  \`datasetVersionId\` bigint NOT NULL,
  \`eventId\` varchar(64) NOT NULL,
  \`horizon\` int NOT NULL,
  \`maxReturn\` double DEFAULT NULL,
  \`minReturn\` double DEFAULT NULL,
  \`maxDrawdown\` double DEFAULT NULL,
  \`isBreakout\` tinyint(1) DEFAULT NULL,
  \`daysToBreakout\` int DEFAULT NULL,
  \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uq_outcome_version_event_horizon\` (\`datasetVersionId\`,\`eventId\`,\`horizon\`),
  KEY \`idx_outcome_event_horizon\` (\`eventId\`,\`horizon\`)${TABLE_FOOTER}`;
}

/**
 * 首板回踩 Dataset 插件（第一个实现；其余数据集需各自注册插件）。
 * 物理表 = ds_{datasetCode}_{event|prefix|post|path|outcome}，结构自包含（不依赖模板表存在）。
 *
 * 五表三层血缘（事件窗口分层）：
 *   event(身份) → prefix(原始 rd≤0) / post(原始 rd≥1) → path(衍生 rd≥1) → outcome(按 horizon 聚合)
 */
export const firstLimitPullbackPlugin: DatasetPlugin = {
  datasetCode: "first_limit_pullback",
  displayName: "首板回踩",
  description: "首板事件 + 事件前/后原始行情 + 回踩路径 + 未来结果（事件型 Dataset）",
  physicalTables: [
    { role: "event", label: "事件身份", createSql: eventCreateSql },
    { role: "prefix", label: "前置行情（rd ≤ 0）", createSql: prefixCreateSql },
    { role: "post", label: "后置行情（rd ≥ 1）", createSql: postCreateSql },
    { role: "path", label: "路径衍生", createSql: pathCreateSql },
    { role: "outcome", label: "未来结果", createSql: outcomeCreateSql },
  ],
  createIO: () => new DbDatasetBuildIO(),
  createBuilder: (io, options) => new FirstLimitPullbackDatasetBuilder(io, { batchSize: options.batchSize }),
};

/** 派生出该插件在某 datasetCode 下的物理表清单（表名 + 建表 DDL）。 */
export function resolvePluginTables(
  plugin: DatasetPlugin,
  datasetCode: string,
): Array<{ role: DatasetRole; label: string; tableName: string; createSql: string }> {
  return plugin.physicalTables.map((t) => {
    const tableName = buildDatasetTableName(datasetCode, t.role);
    return { role: t.role, label: t.label, tableName, createSql: t.createSql(tableName) };
  });
}

/** 默认注册表：生产内置插件集合（当前仅 first_limit_pullback）。 */
export function createDefaultPluginRegistry(): DatasetPluginRegistry {
  const registry = new DatasetPluginRegistry();
  registry.register(firstLimitPullbackPlugin);
  return registry;
}

export const defaultDatasetPluginRegistry = createDefaultPluginRegistry();
