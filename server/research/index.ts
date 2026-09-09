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
// STEP 10 — Strategy Research Framework（Universe → Features → Signal → Ranking → Selection → Position Intent）
export * from "./framework";
// STEP 13 (C-13.1) — Research Dataset 访问层（dataset → framework 契约适配，只读、PIT 安全）
export * from "./datasetAccess";
// STEP 13 (C-13.2) — Signal/Candidate 引擎（dataset 逐日驱动 STEP 10 pipeline → Candidate Evaluation Run）
export * from "./signalEngine";
// STEP 13 (C-13.3) — Experiment Lineage（§28 15 字段实验谱系记录，回答「结果怎么产生的」）
export * from "./experimentLineage";
// STEP 14 (C-14.1) — 交易模拟核心（ResearchDataset 候选 → 多日交易模拟 → Trade/Equity 记录流，复用 STEP 8 原语）
export * from "./simulator";
// STEP 15 (C-15.1) — 策略 Schema + 版本化（§16 全字段结构化策略本体 + §17 最小版本追溯）
export * from "./strategySchema";
// STEP STRATEGY-002 — 策略持久化（Repository + Service + DB 落库，§5/§7/§8/§18/§19）
export * from "./strategyPersistence";
// STEP 14 (C-14.2) — 成本模型专项（市场冲击显式建模 + 成本声明 schema/校验/分解，复用 STEP 8 cost 原子函数）
export * from "./costModel";
// STEP 14 (C-14.3) — 执行与约束模型（组合式声明/校验/映射 simulator 配置，诚实 blocker 不冒充执行）
export * from "./executionConstraints";
// STEP 16 (C-16.1) — 收益/风险/回撤指标（CAGR/Recovery Factor/MaxDD 剖面/tail risk 确定性评估器，消费 simulator 产出）
export * from "./performanceMetrics";
// STEP 16 (C-16.2) — 风险调整指标（Sharpe/Sortino/Calmar，rf 参数化，复用 C-16.1 收益序列/回撤能力）
export * from "./riskAdjustedMetrics";
// STEP 16 (C-16.3) — 交易质量与稳定性指标（WinRate/PF/Expectancy/Turnover/平均持仓/月度年度一致性/regime 占位）
export * from "./tradeQualityMetrics";
// STEP 17 (C-17.1) — Grid/Random Search（稳定参数区搜索，非历史最高；产 Candidate Strategies；完整 SearchRun 实验记录）
export * from "./parameterSearch";
// STEP 17 (C-17.2) — Rolling Optimization（交易日锚定滚动窗 × 参数搜索 → 跨窗一致性 → 候选策略，非 argmax）
export * from "./rollingOptimization";
// STEP 18 (C-18.1) — 鲁棒性测试（Cost/Slippage/Parameter/Execution 扰动重估 → 漂移敏感归因，MC/Bootstrap 属 C-18.2）
export * from "./robustness";
// STEP 18 (C-18.2) — 随机化稳健性（Monte Carlo / Bootstrap / Trade Order Randomization，复用 C-18.1 阈值语义）
export * from "./stochasticRobustness";
// STEP 22 (C-22.1) — 市场状态体系（Trend/Volatility/Liquidity/Breadth/Sentiment/Index State/Limit-up Env 七维 PIT 标签 + 归因）
export * from "./marketRegime";
// STEP 19 (C-19.1) — Walk-Forward 滚动窗口划分 + 冻结纪律 + 逐窗编排（Train→Optimize→Freeze→Test→Move Window）
export * from "./walkForwardRun";
// STEP 19 (C-19.2) — IS/OOS 隔离记录 + 归档账本 + OOS 聚合报告（OOS 严禁参与优化，描述性对比不下过拟合结论）
export * from "./oosIsolation";
// STEP 21 (C-21.1) — 策略生命周期状态机 + 审计（§23 Draft→…→Retired，四要素 transition，禁止无记录修改）
export * from "./lifecycle";
// STEP 23 (C-23.1) — 模拟账户与持仓（六维贴近实盘：Signal/Position/Execution/Risk/Capital/Cost，复用 C-14.2/C-14.3/C-16.3）
// 注：toTradeQualityEvaluationInput 在 C-23.2 也导出同名（同目标函数、参数不同：PaperAccountRun vs SignalToPnlRun），
//     这里显式重命名 C-23.1 版本避免下游歧义；C-23.2 版本以下方的 toTradeQualityEvaluationInput 主导（消费 SignalToPnlRun）。
export {
  PAPER_ACCOUNT_RUN_KIND,
  PAPER_ACCOUNT_RUN_RECORD_VERSION,
  PAPER_ACCOUNT_ERROR_CODES,
  PaperAccountError,
  type PaperAccountErrorCode,
  type PaperSixDimension,
  type PaperEnforcementState,
  type PaperAccountConstraintEnforcementItem,
  type PaperOrderCheckInput,
  type PaperOrderCheckResult,
  type PaperCashOperation,
  type PaperFillApplication,
  type PaperFillConstraintHits,
  type PaperSignalSource,
  type PaperAccount,
  type PaperAccountOrder,
  type PaperAccountFill,
  type PaperAccountPosition,
  type PaperAccountPositionSnapshot,
  type PaperCashLedgerEntry,
  type PaperCashLedgerEntryKind,
  type PaperPnlBreakdown,
  type PaperAccountRun,
  type PaperAccountRunInput,
  type CreatePaperAccountInput,
  computePaperCostDeclarationFingerprint,
  computePaperPnlBreakdown,
  assemblePaperAccountRun,
  createPaperAccount,
  settlePaperAccountT1,
  freezePaperCash,
  unfreezePaperCash,
  applyPaperBuyFill,
  applyPaperSellFill,
  markPaperAccountToMarket,
  computePaperAccountEquity,
  snapshotPaperAccount,
  assertValidPaperAccount,
  describePaperAccountConstraintEnforcement,
  checkPaperOrder,
  assertPaperOrderCheckable,
  toPaperFillConstraintHits,
  computePaperAccountRunFingerprint,
  serializePaperAccountRun,
  deserializePaperAccountRun,
  assertValidPaperAccountRun,
} from "./paperAccount";
// STEP 23 (C-23.2) — 信号→订单→成交→PnL 闭环编排（Signal → Order → Fill → PnL closed-loop，复用 C-13.2/C-14.1/C-14.2/C-14.3/C-23.1）
export * from "./signalToPnl";
// STEP 20 (C-20.1) — PBO（CSCV 倒置统计）+ 参数敏感性（复用 C-18.1 扰动集）+ Overfitting 聚合判定
export * from "./overfittingDetection";
// STEP 20 (C-20.2) — 因子消融与 OOS 退化（Factor Ablation / IS-OOS 双轨贡献对照，识别「回测好、泛化差」，描述性非因果）
export * from "./factorAblation";
// STEP 24 (C-24.1) — 交易日志与复盘（Planned vs Actual 机器核对 + 人工标注承载 + append-only 账本 + Post-review 快照）
export * from "./tradeJournal";
// STEP 24 (C-24.2) — 纪律反馈分析（跨交易聚合：违规原因统计 / 重复错误识别 / 最差执行策略排序 / 易错环境识别，描述性非处方）
export * from "./disciplineFeedback";
// STEP 25 (C-25.1) — 闭环整合（§27 Production Quant Platform 编排：14 阶段链契约 + handoff 流转 + 注入式执行器 + BLOCKED 诚实门禁）
export * from "./closedLoop";
