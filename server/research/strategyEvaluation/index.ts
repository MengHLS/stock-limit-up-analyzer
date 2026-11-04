/**
 * `strategyEvaluation` barrel（STEP B 落点①）。
 *
 * 唯一实现 = `./evaluate`；本层只做转出，**不新增任何逻辑**。
 */
export {
  evaluateStrategyParameters,
  deriveExperimentId,
  STRATEGY_EVALUATION_STAGE_IDS,
  type StrategyEvaluationRequest,
  type StrategyEvaluationResult,
  type StrategyEvaluationStageState,
} from "./evaluate";
export {
  createStrategyParameterEvaluator,
  type StrategyParameterEvaluatorInput,
} from "./evaluator";
export {
  deriveParameterSpaceFromDocument,
  type ExcludedParameter,
  type ParameterSpaceDerivation,
} from "./parameterSpaceFromDocument";
export {
  createStrategyBacktestBridge,
  type StrategyBacktestBridge,
  type StrategyBacktestBridgeOptions,
  type StrategyBacktestSample,
} from "./backtestBridge";
