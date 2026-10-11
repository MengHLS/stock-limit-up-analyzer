/**
 * `FIRSTBOARD-ROLLING-POOL-RECOVERY-ST-004` —— 破位修复再触发 + 每日 ST 硬闸门（barrel）。
 *
 * | 文件 | 职责 |
 * |---|---|
 * | `types.ts` | 冻结常量、状态机、逐日证据与评估的**类型** |
 * | `entry.ts` | **唯一**信号求值实现（A = 003 的 D；B = 原分支 + 修复分支） |
 * | `stGate.ts` | 两时点 ST 闸门、覆盖缺口与 `ST_COVERAGE_BLOCKED` |
 *
 * 🔴 本模块**不**做排序 / 随机 / 撮合 / 成本 / 退出，也不 import `server/**` 运行时。
 */
export * from "./types";

export {
  ABSENT_STATUS_PROVIDER,
  ABSENT_STATUS_PROVIDER_ID,
  BUY_ELIGIBILITIES,
  CONFIRM_CLOSE_EFFECTIVE_TIME,
  PRE_FILL_EFFECTIVE_TIME,
  ST_CHECK_TIMEPOINTS,
  ST_COVERAGE_BLOCKED,
  ST_COVERAGE_GAP_SAMPLE_LIMIT,
  ST_EXECUTION_ELIGIBILITY_POLICY_VERSION,
  ST_GATE_CONTRACT_VERSION,
  ST_GATE_OUTCOMES,
  ST_GATE_REASONS,
  StCoverageBlockedError,
  effectiveAtOf,
  evaluateStGate,
  evaluateStGateForCandidate,
  formatStCoverageGapSummary,
  summarizeStCoverage,
} from "./stGate";
export type {
  SecurityStatusProvider,
  SecurityStatusQuery,
  StCandidateGate,
  StCheckTimepoint,
  StCoverageCheckpoint,
  StCoverageGapSummary,
  StGateDecision,
  StGateOutcome,
  StGateReason,
} from "./stGate";

export {
  confirmDayBlockers,
  evaluateRecoveryDays,
  evaluateRecoveryDaysFor,
  isBuyableSignal,
  isNewLocalLow,
  originalAttributionReason,
  recoveryTriggerOn,
  repairEpisodeIdOf,
  repairScoreComponentsOf,
  repairScoreOf,
  triggersOfBranch,
} from "./entry";

// ---------------------------------------------------------------------------
// `FIRSTBOARD-ROLLING-POOL-RECOVERY-LIGHT-ST-007` 追加（**显式政策变体，缺省仍为严格**）
// ---------------------------------------------------------------------------

export {
  KNOWN_ST_LABEL_KINDS,
  KNOWN_ST_LABEL_REASONS,
  KNOWN_ST_ONLY_ELIGIBILITY_POLICY_ID,
  KNOWN_ST_ONLY_POLICY_VERSION,
  ST_ELIGIBILITY_POLICIES,
  ST_ELIGIBILITY_POLICY_IDS,
  ST_ELIGIBILITY_STATUSES,
  ST_POLICY_DEFAULT_VALUE,
  ST_POLICY_PARAMETER_CODE,
  ST_POLICY_PARAMETER_VALUES,
  STRICT_ELIGIBILITY_POLICY_ID,
  STRICT_ELIGIBILITY_POLICY_VERSION,
  UNKNOWN_ALLOWED_THIS_ROUND_NOTE,
  decideKnownStOnlyEligibility,
  decideStrictEligibility,
  resolveStEligibilityPolicy,
} from "./knownStPolicy";
export type {
  KnownStLabelFact,
  KnownStLabelIndexPort,
  KnownStLabelKind,
  KnownStLabelObservation,
  KnownStLabelReason,
  StEligibilityDecision,
  StEligibilityPolicy,
  StEligibilityPolicyId,
  StEligibilityStatus,
  StPolicyParameterValue,
} from "./knownStPolicy";
