/**
 * STEP 6.1 — Research 层统一出口。
 *
 * 导出：基础类型 / 策略研究契约 / 身份 / 校验 / 实验构造 / 序列化 / 注册中心 / 生产适配器。
 * 本层是「研究实验描述」层，不触碰生产交易语义；legacy 研究模拟器仍由同目录
 * `legacyTransactionSimulator.ts` 独立导出（不在本 index 聚合，避免边界混淆）。
 */

export * from "./types";
export * from "./strategyContract";
export * from "./experimentIdentity";
export * from "./experimentValidation";
export * from "./experiment";
export * from "./serialization";
export * from "./registry";
export * from "./adapter";
// STEP 6.2 — Experiment Registry + Persistence + Research Run
export * from "./run";
export * from "./status";
export * from "./experimentRegistry";
export * from "./engineAdapter";
export * from "./experimentService";
export * from "./runService";
export * from "./persistence";
// STEP 6.3 — Parameter Space + Combination + Sweep
export * from "./parameterSpace";
export * from "./combinationGenerator";
export * from "./sweep";
export * from "./sweepService";
// STEP 6.4 — Train / Validation / OOS 时间切分与评估基础设施
export * from "./datasetSplit";
export * from "./validationSelection";
export * from "./trainValidationOos";
export * from "./trainEvaluation";
export * from "./oosEvaluation";
export * from "./evaluationService";
// STEP 6.5 — WFO + PBO + Overfitting Detection
export * from "./walkForward";
export * from "./parameterStability";
export * from "./pbo";
export * from "./overfittingAssessment";
export * from "./walkForwardService";
