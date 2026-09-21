/**
 * RESEARCH-EXPERIMENT-001 — 默认装配（真实依赖注入的**唯一**落点）。
 *
 * ## 为什么单独一个文件
 *
 * `registry.ts` / `runner.ts` / `datasetPort.ts` 都是**纯逻辑**（依赖注入、可单测）。
 * 「真实 DB / 真实 Dataset 读取层 / 真实清单」只在装配层出现一次 ——
 * 这样单测可以构造与真实装配**不同**的替身，而生产路径上也**只有一套**装配。
 *
 * ## 惰性单例（不是顶层常量）
 *
 * 顶层 `const x = createX()` 在跨模块循环 import 时会因**求值顺序**炸出
 * `TypeError: ... is not a function`，而 `tsc --noEmit` 看不出来
 * （本轮仓库真实踩过，见 `.workbuddy/memory/PROJECT_RULES.md`）。
 * 因此默认注册表用「`??=` 惰性构造」。
 */

import type { ExperimentDatasetVersionOption } from "@shared/researchExperimentsContracts";
import { defaultArtifactStorage } from "../artifactStorage/factory";
import { DbDatasetRegistry } from "../datasetRegistry/db";
import { DbDatasetDataReader } from "../datasetRegistry/query";
import { RegistryResearchDatasetReader } from "../researchRuntime/datasetReader";
import { createRegistryExperimentDatasetPort, type ExperimentDatasetPort } from "./datasetPort";
import {
  DbExperimentRunRepository,
  type ExperimentRunRepository,
} from "./persistence/runRepository";
import { createExperimentRunService, type ExperimentRunService } from "./persistence/runService";
import { createExperimentRunner, type ExperimentRunner } from "./runner";
// 注册表工厂拆到轻量模块（不 import DB / researchEngine）—— 见该文件头注释。
import { defaultExperimentRegistry } from "./registryDefaults";
// RESEARCH-EXPERIMENT-002：Experiment → Strategy 桥的真实依赖。
import { createStrategyPromotionPort } from "../research/strategyCandidate/strategyPromotionPort";
import { DbStrategyResearchProvenanceRepository } from "../research/strategyCandidate/provenance";
import { createExperimentStrategyBridge, type ExperimentStrategyBridge } from "./strategyBridge";
// STRATEGY-RESEARCH-BRIDGE-001：按真实持久化 Run 建策略的只读读回端口。
import { createPersistedEvidenceRunReader } from "./evidenceRunReader";

export { createDefaultExperimentRegistry, defaultExperimentRegistry } from "./registryDefaults";

/**
 * 真实 Dataset 目录（版本选择器用）。
 *
 * 只读：`listDefinitions` + `listVersions`，没有任何写口。
 * `datasetCode` 过滤在**查询后**做（版本表本身不带 datasetCode），
 * 但定义数极少（当前 1 个），因此不引入额外查询层。
 */
async function listRealVersionOptions(filter?: {
  datasetCode?: string;
}): Promise<ExperimentDatasetVersionOption[]> {
  const repo = new DbDatasetRegistry();
  const definitions = await repo.listDefinitions();
  const wanted = filter?.datasetCode;
  const targets = wanted ? definitions.filter((d) => d.datasetCode === wanted) : definitions;
  const options: ExperimentDatasetVersionOption[] = [];
  for (const definition of targets) {
    const versions = await repo.listVersions(definition.id!);
    for (const version of versions) {
      options.push({
        datasetVersionId: version.id!,
        datasetCode: definition.datasetCode,
        datasetName: definition.name,
        version: version.version,
        status: version.status,
        startDate: version.startDate ?? null,
        endDate: version.endDate ?? null,
        totalEvents: version.totalEvents ?? null,
      });
    }
  }
  // 稳定顺序：先按数据集，再按 id 降序（新版本在前，便于默认选中最新）。
  return options.sort((a, b) =>
    a.datasetCode === b.datasetCode
      ? b.datasetVersionId - a.datasetVersionId
      : a.datasetCode.localeCompare(b.datasetCode),
  );
}

/** 真实 Dataset 桥（复用 Research 侧唯一读取层，不另写 SQL）。 */
export function createDefaultExperimentDatasetPort(): ExperimentDatasetPort {
  return createRegistryExperimentDatasetPort({
    reader: new RegistryResearchDatasetReader({ registryRepo: new DbDatasetRegistry() }),
    listVersionOptions: listRealVersionOptions,
  });
}

/** 默认 Runner（真实装配；惰性单例）。 */
let runnerCache: ExperimentRunner | null = null;

export function defaultExperimentRunner(): ExperimentRunner {
  runnerCache ??= createExperimentRunner({
    registry: defaultExperimentRegistry(),
    datasetPort: createDefaultExperimentDatasetPort(),
  });
  return runnerCache;
}

/**
 * Router 的依赖包（runner + dataset 目录）。
 *
 * 🔴 两者必须来自**同一份**装配 —— 若 router 另造一个 port，
 * 就会出现「列表里的版本能被选到、但 runner 用另一个 port 解析」的两份口径。
 */
export interface ResearchExperimentsDeps {
  runner: ExperimentRunner;
  datasetPort: ExperimentDatasetPort;
  /** RESEARCH-EXPERIMENT-004：Run 持久化编排（TiDB 元数据 + 对象存储产物）。 */
  runService: ExperimentRunService;
}

let depsCache: ResearchExperimentsDeps | null = null;

/** 默认依赖包（惰性单例；只装配一次）。 */
export function defaultResearchExperimentsDeps(): ResearchExperimentsDeps {
  depsCache ??= (() => {
    const registry = defaultExperimentRegistry();
    const datasetPort = createDefaultExperimentDatasetPort();
    const runner = createExperimentRunner({ registry, datasetPort });
    return { runner, datasetPort, runService: createDefaultExperimentRunService(runner) };
  })();
  runnerCache = depsCache.runner;
  return depsCache;
}

// ---------------------------------------------------------------------------
// RESEARCH-EXPERIMENT-004 — Run 持久化装配
// ---------------------------------------------------------------------------

let runRepositoryCache: ExperimentRunRepository | null = null;

/** 默认 Run 仓储（TiDB；惰性单例）。 */
export function defaultExperimentRunRepository(): ExperimentRunRepository {
  runRepositoryCache ??= new DbExperimentRunRepository();
  return runRepositoryCache;
}

/**
 * 默认 Run 服务。
 *
 * 🔴 `resolveStorage` 必须是**惰性闭包**（不是 `defaultArtifactStorage()` 的即时调用）：
 *    未配置 MinIO 时，实验列表 / 历史 Run / Manifest 之外的只读操作仍应可用，
 *    只有真正读写产物时才该抛「对象存储未配置」。若在这里 eager 求值，
 *    整个实验页会因为没配 MinIO 而**整页 500** —— 把「不能持久化」放大成了「不能用」。
 */
export function createDefaultExperimentRunService(runner: ExperimentRunner): ExperimentRunService {
  return createExperimentRunService({
    runner,
    repository: defaultExperimentRunRepository(),
    resolveStorage: () => defaultArtifactStorage(),
  });
}

let runServiceCache: ExperimentRunService | null = null;

/** 默认 Run 服务（惰性单例）。 */
export function defaultExperimentRunService(): ExperimentRunService {
  runServiceCache ??= createDefaultExperimentRunService(defaultResearchExperimentsDeps().runner);
  return runServiceCache;
}

/**
 * RESEARCH-EXPERIMENT-002 —— **Experiment → Strategy 桥**的默认装配。
 *
 * 复用既有转正端口（幂等创建策略 + 首版本）与既有溯源仓储（唯一落点），
 * 本函数只做「把三件真实依赖装到一起」。
 *
 * 🔴 STRATEGY-RESEARCH-BRIDGE-001：追加注入 `evidenceRuns` —— 按**真实持久化 Run**
 * 建策略的第二条路径需要一个只读读回端口。它与 Run 服务共用**同一份**仓储装配，
 * 不新造第二套读 SQL（「列表里的 Run」与「建策略时读的 Run」必须同源）。
 */
let strategyBridgeCache: ExperimentStrategyBridge | null = null;

export function defaultExperimentStrategyBridge(): ExperimentStrategyBridge {
  strategyBridgeCache ??= createExperimentStrategyBridge({
    runner: defaultResearchExperimentsDeps().runner,
    strategies: createStrategyPromotionPort(),
    provenance: new DbStrategyResearchProvenanceRepository(),
    evidenceRuns: createPersistedEvidenceRunReader({ runService: defaultExperimentRunService() }),
  });
  return strategyBridgeCache;
}
