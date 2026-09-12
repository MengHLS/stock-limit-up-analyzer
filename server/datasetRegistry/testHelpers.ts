/**
 * STEP DATASET-003A — datasetRegistry 测试替身（共享）。
 *
 * 提供内存环境下「插件 + 物理表 + service / router」的一致装配，避免各测试各写一套：
 *   - `makeTestPlugin`：可注入 createIO / createBuilder 的假插件（默认 code = first_limit_pullback）；
 *   - `makeTestPluginRegistry`：含该假插件的注册表；
 *   - `makeTestService`：注入 plugins + InMemoryDatasetPhysicalStore 的 service；
 *   - `makeTestRouter`：装配带 plugins / physicalStore / 假 runner 的 router。
 *
 * 这些是**测试替身**（不触真实 DB），但复现真实编排语义（建表 / 清理 / 删除），
 * 不用于冒充生产数据。
 */

import { InMemoryDatasetRegistry, DatasetRegistryService } from "./registry";
import { DatasetPluginRegistry, type DatasetPlugin } from "./plugins";
import { InMemoryDatasetPhysicalStore } from "./physicalTables";
import { buildDatasetRegistryRouter } from "./router";
import type { DatasetBuildRunner } from "./runner";
import {
  InMemoryDatasetDataReader,
  type DatasetDataReader,
} from "./query";
import type { DatasetBuildIO, DatasetBuilder } from "./builder";
import type { DatasetBuildCheckpoint, DatasetBuildResult } from "./types";

export const TEST_DATASET_CODE = "first_limit_pullback";

/** 测试用筛选配置（默认 = 事件日首板 / 不筛板块 / 不排除 ST / t-0..t+20）。 */
export function makeTestFilter(overrides: Record<string, unknown> = {}) {
  const base: Record<string, unknown> = {
    boards: [] as string[],
    excludeSt: false,
    events: [{ relativeDay: 0, kind: "firstBoard" as const }],
    preWindowDays: 0,
    postWindowDays: 20,
    outcomeHorizons: [5, 10, 20],
    batchSize: 1000,
  };
  // 显式传 undefined 表示「该字段缺省」→ 从载荷中删除，交给契约层补默认值。
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete base[k];
    else base[k] = v;
  }
  return base;
}

/** 测试用构建配置（builder.build 入参；DATASET-003B 形态）。 */
export function makeTestBuildConfig(
  datasetVersionId: number,
  overrides: Partial<Record<string, unknown>> = {},
) {
  return {
    datasetVersionId,
    startDate: "2024-01-02",
    endDate: "2024-01-10",
    boards: [] as string[],
    excludeSt: false,
    events: [{ relativeDay: 0, kind: "firstBoard" as const }],
    preWindowDays: 0,
    postWindowDays: 3,
    outcomeHorizons: [5, 10],
    batchSize: 10,
    ...overrides,
  } as never;
}

/** 不期望被调用的 IO 方法（假 IO 的桩）。 */
function notUsed(): never {
  throw new Error("未预期的 IO 调用");
}

export function makeFakeIO(
  tradingDays: string[] = ["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"],
  events: unknown[] = [],
): DatasetBuildIO {
  return {
    loadTradingDays: async () => tradingDays,
    loadSecurityIndexes: async () => {},
    resolveStSync: () => "UNKNOWN",
    resolveSt: async () => "UNKNOWN",
    resolveIndustrySync: () => null,
    fetchLimitUpCandidateBars: notUsed as never,
    fetchBarsForSymbolsInRange: notUsed as never,
    fetchLiquidityForSymbolsInRange: notUsed as never,
    listEvents: (async () => events) as never,
    insertEvents: async () => {},
    insertPrefixes: async () => {},
    insertPosts: async () => {},
    insertPaths: async () => {},
    insertOutcomes: async () => {},
  };
}

/** 假构建器：按 chunks 上报进度后返回结果（可注入失败 / 延迟）。 */
export function makeFakeBuilder(opts: {
  chunks?: number;
  fail?: boolean;
  delayPerChunkMs?: number;
  result?: Partial<DatasetBuildResult>;
} = {}): DatasetBuilder {
  const chunks = opts.chunks ?? 3;
  return {
    datasetCode: TEST_DATASET_CODE,
    async build(
      _config: unknown,
      report: (c: DatasetBuildCheckpoint) => Promise<void>,
    ): Promise<DatasetBuildResult> {
      for (let i = 1; i <= chunks; i++) {
        if (opts.delayPerChunkMs) await new Promise((r) => setTimeout(r, opts.delayPerChunkMs));
        if (opts.fail) throw new Error("构建过程中发生真实错误");
        await report({
          phase: "events",
          lastTradeDate: `2024-01-0${i}`,
          lastSymbol: `60000${i}.SH`,
          lastEventId: null,
          processedRows: i * 10,
          completedChunks: i,
        });
      }
      return {
        status: "COMPLETED",
        events: 3,
        prefixes: 3,
        posts: 30,
        paths: 30,
        outcomes: 60,
        chunks,
        processedRows: chunks * 10,
        failedRows: 0,
        ...opts.result,
      };
    },
  } satisfies DatasetBuilder;
}

/** 假插件（默认 code = first_limit_pullback）；可覆盖 IO / builder / 表结构。 */
export function makeTestPlugin(
  overrides: Partial<DatasetPlugin> & { builderOpts?: Parameters<typeof makeFakeBuilder>[0] } = {},
): DatasetPlugin {
  const { builderOpts = {}, ...rest } = overrides;
  const code = rest.datasetCode ?? TEST_DATASET_CODE;
  return {
    datasetCode: code,
    displayName: "首板回踩",
    description: "测试插件",
    physicalTables: [
      { role: "event", label: "事件", createSql: (t) => `CREATE TABLE IF NOT EXISTS \`${t}\` (id bigint)` },
      { role: "prefix", label: "前置行情", createSql: (t) => `CREATE TABLE IF NOT EXISTS \`${t}\` (id bigint)` },
      { role: "post", label: "后置行情", createSql: (t) => `CREATE TABLE IF NOT EXISTS \`${t}\` (id bigint)` },
      { role: "path", label: "路径", createSql: (t) => `CREATE TABLE IF NOT EXISTS \`${t}\` (id bigint)` },
      { role: "outcome", label: "结果", createSql: (t) => `CREATE TABLE IF NOT EXISTS \`${t}\` (id bigint)` },
    ],
    createIO: () => makeFakeIO(),
    createBuilder: () => makeFakeBuilder(builderOpts),
    ...rest,
  };
}

export function makeTestPluginRegistry(plugin: DatasetPlugin = makeTestPlugin()): DatasetPluginRegistry {
  const registry = new DatasetPluginRegistry();
  registry.register(plugin);
  return registry;
}

export interface TestServiceBundle {
  repo: InMemoryDatasetRegistry;
  plugins: DatasetPluginRegistry;
  physicalStore: InMemoryDatasetPhysicalStore;
  service: DatasetRegistryService;
}

/** 装配 service（含插件注册表与内存物理表存储）。 */
export function makeTestService(options: {
  repo?: InMemoryDatasetRegistry;
  plugins?: DatasetPluginRegistry;
  physicalStore?: InMemoryDatasetPhysicalStore;
} = {}): TestServiceBundle {
  const repo = options.repo ?? new InMemoryDatasetRegistry();
  const plugins = options.plugins ?? makeTestPluginRegistry();
  const physicalStore = options.physicalStore ?? new InMemoryDatasetPhysicalStore();
  const service = new DatasetRegistryService(repo, { plugins, physicalStore });
  return { repo, plugins, physicalStore, service };
}

/** 空操作 runner：只走状态机、不真执行构建（router 编排测试用）。 */
export function makeNoopRunner(): DatasetBuildRunner {
  return {
    start: async () => {},
    cancel: () => {},
    // 空操作 runner 没有真实执行体 ⇒ 不存在写入者，立即报告「已停止」。
    waitForStop: async () => true,
    isRunning: () => false,
  };
}

/** 装配带 plugins / physicalStore / 假 runner 的 router（不触真实 DB）。 */
export function makeTestRouter(options: {
  repo: InMemoryDatasetRegistry;
  plugins: DatasetPluginRegistry;
  physicalStore: InMemoryDatasetPhysicalStore;
  service: DatasetRegistryService;
  reader?: DatasetDataReader;
  /** 缺省 = 空操作 runner（只测状态机编排，不真跑构建）。 */
  buildRunner?: DatasetBuildRunner;
}) {
  const reader = options.reader ?? new InMemoryDatasetDataReader([], [], []);
  return buildDatasetRegistryRouter({
    repo: options.repo,
    reader,
    registryService: options.service,
    pluginRegistry: options.plugins,
    physicalStore: options.physicalStore,
    buildRunner: options.buildRunner ?? makeNoopRunner(),
  });
}
