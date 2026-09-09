/**
 * STEP 12.5 — PIT / 反泄漏抽样审计（C-12.5.2）：统一出口。
 *
 * 能力：
 *   - runPitAudit(options)        确定性抽样审计编排器（真实 DB），产出 PitAuditSummary；
 *   - runSampleChecks(...)        纯函数检查器（合成事实单测用，无 IO）；
 *   - 朴素预言机 oracle.*        独立于 reconstruct 的 PIT 期望（身份/行业 retrievedAt/
 *                                 CA announcementDate/master 时间界/日级事实）；
 *   - 抽样器 db.*                DB 抽样（RANDOM_ACTIVE/DELISTED_AFTER/PRE_LISTING/
 *                                 CODE_REUSE + 边界衍生桶）与独立事实拉取。
 *
 * 使用约定：研究/认证口径必须传 asOf=tradeDate（PIT）。报告 gate 语义见 ./runAudit 注释
 * （dataReady=true 且无 FAIL/样本错误 才允许作为 §45.1 VALIDATED 证据）。
 */

export * from "./types";
export * from "./oracle";
export * from "./checkers";
export * from "./db";
export * from "./runAudit";
