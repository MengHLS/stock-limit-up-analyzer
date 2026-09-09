/**
 * STEP 24 / C-24.2 — 纪律反馈分析（Discipline Feedback Analysis）：统一出口。
 *
 * 交付内容：
 *   - types.ts        领域类型契约（DisciplineFeedbackRun + 四类报告 + 配置 + 模式清单 +
 *                     DFA_REASON_CODES + DFA_ENV_UNLABELED_KEY + DFA_SEVERITY_INDEX）；
 *   - errors.ts       结构化错误（DisciplineFeedbackError，DFA_* 稳定码，FAIL FAST）；
 *   - common.ts       确定性公共工具（entry 校验/归并、日历日号、稳定百分比/均值、策略键）；
 *   - causes.ts       ① aggregateViolationCauses 违规原因统计；
 *   - repeat.ts       ② detectRepeatMistakes 重复错误识别；
 *   - executionQuality.ts ③ rankExecutionQuality 最差执行策略排序；
 *   - environments.ts ④ identifyErrorProneEnvironments 易错环境识别；
 *   - run.ts          buildDisciplineFeedbackRun 主编排（汇总 + 模式清单 + 描述性结论）；
 *   - validate.ts     结构 + 语义校验（validateDisciplineFeedbackRun / assert…）；
 *   - serialize.ts    canonical + sha256 指纹 + round-trip + 篡改拒绝。
 *
 * 复用（只读 import，不复制不重写）：C-24.1 tradeJournal（TradeJournalEntry /
 * AnnotationBlock / DeviationDimension / 受控词表 / assertValidTradeJournalEntry /
 * computeTradeJournalEntryFingerprint）、researchDataset/version canonicalStringify。
 *
 * 边界（诚实）：不做 C-25.1 端到端编排/生产结论/promotion；不下交易建议/处方式结论；
 * 环境标签由调用方注入（不自行计算 regime）；跨模块注册由协调者在 server/research/index.ts
 * 统一补 `export * from "./disciplineFeedback"`，本文件不触碰统一出口。
 *
 * 命名域前缀（全库查重零冲突，见 ROADMAP §49）：Discipline* / Feedback* / DFA_* /
 * Violation* / Repeat* / ExecutionQuality* / Environment*。
 */

export * from "./types";
export * from "./errors";
export * from "./common";
export * from "./causes";
export * from "./repeat";
export * from "./executionQuality";
export * from "./environments";
export * from "./run";
export * from "./validate";
export * from "./serialize";
