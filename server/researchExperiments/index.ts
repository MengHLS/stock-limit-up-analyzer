/**
 * RESEARCH-EXPERIMENT-001 — 独立研究实验体系（统一出口）。
 *
 * 组成：
 *   - ./types          领域契约（ExperimentDefinition / ExperimentRunContext / 取数句柄）
 *   - ./errors         领域错误 + 稳定错误码
 *   - ./registry       最小注册表（注册即校验元数据；显式清单，无目录扫描）
 *   - ./datasetPort    Dataset 桥（列投影 + 相对日白名单 + PIT 结构闸门）
 *   - ./runner         Experiment Runner（load/validate/resolve/execute/capture）
 *   - ./defaults       真实装配（惰性单例；唯一出现 DB 的地方）
 *   - ./router         tRPC 端点（zero-write）
 *
 * 🔴 本模块**不**并入任何既有 research barrel：它与旧 Research 链路
 * （Analysis / Finding / Conclusion）**逻辑隔离**，且刻意为「不依赖旧结构」而设计。
 * 消费方显式 `import { ... } from "../researchExperiments"`。
 */

export * from "./types";
export {
  createDefaultExperimentRegistry,
  defaultExperimentRegistry,
} from "./registryDefaults";
export {
  EXPERIMENT_STRATEGY_ERROR,
  ExperimentStrategyError,
  createExperimentStrategyBridge,
  digestOfExperimentResult,
  type CreateStrategyFromExperimentInput,
  type CreateStrategyFromExperimentResult,
  type ExperimentStrategyBridge,
  type ExperimentStrategyBridgeDeps,
  type ExperimentStrategyDraft,
  type ExperimentStrategyErrorCode,
} from "./strategyBridge";
export {
  buildExperimentStrategyRouter,
  type ExperimentStrategyRouter,
  type ExperimentStrategyRouterDeps,
} from "./strategyBridgeRouter";
export * from "./errors";
export { ExperimentRegistry, validateExperimentDescriptor } from "./registry";
export {
  EXPERIMENT_EVENT_SCAN_LIMIT,
  assertDatasetCodeMatches,
  assertRelativeDaysWithinHorizon,
  assertVersionReady,
  createRegistryExperimentDatasetPort,
  flattenRequiredColumns,
  type ExperimentAccessStats,
  type ExperimentDatasetPort,
  type ExperimentDatasetReaderSource,
} from "./datasetPort";
export {
  MAX_EXPERIMENT_LOG_LINES,
  createExperimentRunner,
  resolveExperimentParameters,
  validateExperimentResultEnvelope,
  type ExperimentRunner,
  type ExperimentRunnerDeps,
  type ExperimentRunRequest,
  type PreparedExperimentRun,
} from "./runner";
export {
  buildResearchExperimentsRouter,
  researchExperimentsRouter,
  type ResearchExperimentsRouter,
  type ResearchExperimentsRouterDeps,
} from "./router";
