/**
 * STEP 24 / C-24.1 — 交易日志与复盘记录（Trade Journal）：统一出口。
 *
 * 交付内容：
 *   - types.ts      领域类型契约（TradeJournalEntry / PostReviewRecord / Deviation /
 *                   AnnotationBlock + 受控词表 + TJ_UNASSESSED_REASON_CODES）；
 *   - errors.ts     结构化错误（TradeJournalError，稳定 code，FAIL FAST）；
 *   - reconcile.ts  计划 vs 实际 机器核对（reconcilePlanVsActual，纯函数）；
 *   - drafts.ts     从 C-23.2 SignalToPnlRun 提取 journal draft（buildJournalDraftsFromRun）；
 *   - ledger.ts     TradeJournalLedger（in-memory append-only + supersedes 修订链 + 断链检测）；
 *   - review.ts     PostReviewRecord 工厂 + 人工标注修订（withJournalAnnotation / annotateJournalEntry）；
 *   - serialize.ts  canonical + sha256 指纹 + round-trip + 账本内容断链校验；
 *   - validate.ts   结构 + 语义校验（含 PIT 时间序）。
 *
 * 复用（只读 import）：C-23.2 signalToPnl（事实来源 + 来源可信复核）、C-23.1
 * paperAccount（Order/Fill 字段形态）、C-16.3 tradeQualityMetrics（引用，不重算）、
 * C-21.1 lifecycle（append-only 账本哲学）、C-13.3 experimentLineage（显式缺省码哲学）、
 * researchDataset/version canonicalStringify（指纹序列化）。
 *
 * 边界（诚实）：不做 C-24.2 跨交易聚合（违规统计/重复错误/最差执行策略/易错环境）；
 * 不做纪律得分自动打分；reason/emotion/rule violation 人工注入、本模块零生成；
 * 不做任何策略结论；不跑真实回测/评估（C-16.3 仅引用不重算）。
 */

export * from "./types";
export * from "./errors";
export * from "./reconcile";
export * from "./drafts";
export * from "./ledger";
export * from "./review";
export * from "./serialize";
export * from "./validate";
