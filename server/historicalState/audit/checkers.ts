/**
 * STEP 12.5 — PIT / 反泄漏抽样审计：纯检查器。
 *
 * runSampleChecks 把「朴素预言机（./oracle）期望」与「重建状态（被测对象）输出」逐项比对，
 * 产出结构化的 FAIL 项。全部纯函数、确定性、无 IO——泄漏场景用合成事实单测可全覆盖。
 *
 * 检查项（稳定 code，报告按此聚合）：
 *   IDENTITY_CODE            朴素活跃标识符 vs 重建 identity（跨 asOf 亦须一致）
 *   LIFECYCLE_MASTER         master 时间界判词 vs 重建 lifecycle.verdict
 *   TRADABILITY_MASTER_BOUND master 判 DELISTED / NOT_YET_LISTED 时禁止可交易
 *   INDUSTRY_PIT             行业 retrievedAt PIT（泄漏 / 遗漏 / 错配 / 重叠异常）
 *   INDUSTRY_GROWTH          asOf 增大行业只增不减（PIT 已知 ⇒ 全知已知且一致）
 *   CA_EFFECTIVE_SET         已生效公司行为集合一致
 *   CA_KNOWN_SET             announcementDate PIT 可知集合（多出 = look-ahead）
 *   PRICE_DAY                价格日级事实：日期 == tradeDate、symbol == 生效代码
 *   LIQUIDITY_DAY            流动性日级事实同上
 *   MARKET_STATE_DAY         市场状态：指数集合一致且日期 == tradeDate
 *   KNOWLEDGE_CONSISTENCY    维度可知性标记与结果字段一致
 *   PIT_SUBSET_DIMS          PIT 已解析状态维度 ⊆ 全知已解析维度（知识只增不减）
 */

import type { CorporateAction } from "../../corporateActions/types";
import type { SecurityHistoricalState } from "../types";
import {
  corporateActionKey,
  naiveActiveCode,
  naiveEffectiveCaKeys,
  naiveIdentityExpectation,
  naiveIndustryAt,
  naiveKnownCaKeys,
  naiveLifecycleExpectation,
} from "./oracle";
import type { PitAuditFacts, PitAuditSample, PitCheckIssue, PitSampleVerdict } from "./types";

/** 全部检查项的稳定 code（报告按此聚合 pass/fail）。 */
export const CHECK_IDS = [
  "IDENTITY_CODE",
  "LIFECYCLE_MASTER",
  "TRADABILITY_MASTER_BOUND",
  "INDUSTRY_PIT",
  "INDUSTRY_GROWTH",
  "CA_EFFECTIVE_SET",
  "CA_KNOWN_SET",
  "PRICE_DAY",
  "LIQUIDITY_DAY",
  "MARKET_STATE_DAY",
  "KNOWLEDGE_CONSISTENCY",
  "PIT_SUBSET_DIMS",
] as const;

/** 从事件列表构造稳定键集。 */
export function caKeySet(actions: readonly CorporateAction[]): Set<string> {
  return new Set(actions.map(corporateActionKey));
}

function push(
  issues: PitCheckIssue[],
  sample: PitAuditSample,
  checkId: string,
  message: string,
): void {
  issues.push({ sampleId: sample.sampleId, bucket: sample.bucket, checkId, severity: "FAIL", message });
}

/** 身份跨字段一致性：naive vs pit vs full。 */
function checkIdentity(
  issues: PitCheckIssue[],
  sample: PitAuditSample,
  facts: PitAuditFacts,
  pit: SecurityHistoricalState,
  full: SecurityHistoricalState,
): void {
  const expected = naiveIdentityExpectation(facts.identifiers, facts.security.securityId, sample.tradeDate);
  const identity = pit.identity;
  const sameShape =
    identity.codeDigits === expected.codeDigits &&
    identity.code === expected.code &&
    identity.identifierType === expected.identifierType &&
    identity.identifierEffectiveFrom === expected.effectiveFrom &&
    identity.identifierEffectiveTo === expected.effectiveTo;
  if (!sameShape) {
    push(
      issues,
      sample,
      "IDENTITY_CODE",
      `身份与朴素期望不一致：期望 code=${expected.code ?? "null"} 区间=[${expected.effectiveFrom ?? "?"},${expected.effectiveTo ?? "∞"}]，` +
        `实际 code=${identity.code ?? "null"} 区间=[${identity.identifierEffectiveFrom ?? "?"},${identity.identifierEffectiveTo ?? "∞"}]`,
    );
    return;
  }
  if (pit.identity.code !== full.identity.code || pit.identity.codeDigits !== full.identity.codeDigits) {
    push(
      issues,
      sample,
      "IDENTITY_CODE",
      `身份跨 asOf 不一致：PIT code=${pit.identity.code ?? "null"} vs FULL code=${full.identity.code ?? "null"}`,
    );
  }
}

/** master 时间界判词：survivorship 负向断言。 */
function checkLifecycle(
  issues: PitCheckIssue[],
  sample: PitAuditSample,
  facts: PitAuditFacts,
  pit: SecurityHistoricalState,
): void {
  const expected = naiveLifecycleExpectation(facts.security, sample.tradeDate);
  if (expected === "UNKNOWN") return;
  if (pit.lifecycle.verdict !== expected) {
    push(
      issues,
      sample,
      "LIFECYCLE_MASTER",
      `生命周期与 master 时间界不符：期望 ${expected}，重建返回 ${pit.lifecycle.verdict}（listedDate=${facts.security.listedDate ?? "-"}, delistedDate=${facts.security.delistedDate ?? "-"}）`,
    );
  }
  if (expected === "DELISTED" || expected === "NOT_YET_LISTED") {
    if (pit.tradability.eligible) {
      push(
        issues,
        sample,
        "TRADABILITY_MASTER_BOUND",
        `master 判 ${expected} 时仍可交易（默认拒绝语义被破坏）`,
      );
    }
  }
}

/** 行业 retrievedAt PIT（泄漏 / 遗漏 / 错配）+ 全知增长一致性。 */
function checkIndustry(
  issues: PitCheckIssue[],
  sample: PitAuditSample,
  facts: PitAuditFacts,
  pit: SecurityHistoricalState,
  full: SecurityHistoricalState,
  verdict: PitSampleVerdict,
): void {
  const naive = naiveIndustryAt(facts, sample.tradeDate, sample.asOf);
  if (naive.guardExercised) verdict.industryPitGuardExercised = true;
  const actual = pit.industry;

  if (naive.kind === "none") {
    if (actual !== null) {
      push(
        issues,
        sample,
        "INDUSTRY_PIT",
        `look-ahead：asOf=${sample.asOf} 时点无可用行业归属（retrievedAt 过滤后为空），但重建返回 ${actual.industryCode} ${actual.industryName}`,
      );
    }
  } else if (naive.kind === "single") {
    const want = naive.assignment!;
    if (actual === null) {
      push(
        issues,
        sample,
        "INDUSTRY_PIT",
        `遗漏：asOf=${sample.asOf} 时点应可知 ${want.industryCode} ${want.industryName}（retrievedAt=${want.retrievedAt.slice(0, 10)}），重建返回 null`,
      );
    } else if (
      actual.industryCode !== want.industryCode ||
      actual.industryName !== want.industryName ||
      actual.effectiveFrom !== want.effectiveFrom
    ) {
      push(
        issues,
        sample,
        "INDUSTRY_PIT",
        `错配：期望 ${want.industryCode}/${want.industryName}[${want.effectiveFrom},${want.effectiveTo ?? "∞"}]，重建 ${actual.industryCode}/${actual.industryName}[${actual.effectiveFrom},${actual.effectiveTo ?? "∞"}]`,
      );
    }
  } else {
    // overlap：reconstruct 的 getIndustryAt 会抛错，正常不会产出状态 → 走到这里说明预言机视角有重叠行
    push(
      issues,
      sample,
      "INDUSTRY_PIT",
      `数据异常：asOf=${sample.asOf} 时点存在 ${facts.industryRows.length} 行但朴素判定为重叠（应触发歧义抛错而非返回状态）`,
    );
  }

  // 全知增长：PIT 已知 ⇒ 全知已知且同一归属；PIT 未知 ⇒ 全知可增长。
  if (pit.industry !== null && full.industry === null) {
    push(
      issues,
      sample,
      "INDUSTRY_GROWTH",
      `asOf 增大后行业反而消失：PIT=${pit.industry.industryCode} 但 FULL=null（知识倒退，违反 PIT⊆FULL）`,
    );
  } else if (
    pit.industry !== null &&
    full.industry !== null &&
    (pit.industry.industryCode !== full.industry.industryCode ||
      pit.industry.effectiveFrom !== full.industry.effectiveFrom)
  ) {
    push(
      issues,
      sample,
      "INDUSTRY_GROWTH",
      `asOf 增大后行业归属改变：PIT=${pit.industry.industryCode}[${pit.industry.effectiveFrom}] FULL=${full.industry.industryCode}[${full.industry.effectiveFrom}]`,
    );
  }
}

/** 公司行为：已生效集合 + announcementDate PIT 可知集合。 */
function checkCorporateActions(
  issues: PitCheckIssue[],
  sample: PitAuditSample,
  facts: PitAuditFacts,
  pit: SecurityHistoricalState,
): void {
  // 1) 已生效集合（与 asOf 无关，effectiveDate<=tradeDate 且归属正确）。
  const expectedEffective = naiveEffectiveCaKeys(facts, sample.tradeDate);
  const actualEffective = caKeySet(pit.corporateActions.effectiveOnOrBefore);
  const effectiveExtra = Array.from(actualEffective).filter((k) => !expectedEffective.has(k));
  const effectiveMissing = Array.from(expectedEffective).filter((k) => !actualEffective.has(k));
  if (effectiveExtra.length > 0 || effectiveMissing.length > 0) {
    push(
      issues,
      sample,
      "CA_EFFECTIVE_SET",
      `已生效公司行为集合不一致：多出 ${effectiveExtra.length} 项（${effectiveExtra.slice(0, 3).join("; ")}），缺失 ${effectiveMissing.length} 项（${effectiveMissing.slice(0, 3).join("; ")}）`,
    );
  }

  // 2) announcementDate PIT 可知集合（仅 PIT 口径判定；全知时 known = effective）。
  if (sample.asOf === null) return;
  const expectedKnown = naiveKnownCaKeys(facts, sample.tradeDate, sample.asOf);
  const actualKnown = caKeySet(pit.corporateActions.knownAtAsOf);
  const knownExtra = Array.from(actualKnown).filter((k) => !expectedKnown.has(k));
  const knownMissing = Array.from(expectedKnown).filter((k) => !actualKnown.has(k));
  if (knownExtra.length > 0 || knownMissing.length > 0) {
    push(
      issues,
      sample,
      "CA_KNOWN_SET",
      `announcementDate PIT 可知集合不一致：` +
        `${knownExtra.length > 0 ? `look-ahead 多出 ${knownExtra.length} 项（${knownExtra.slice(0, 3).join("; ")}）` : ""}` +
        `${knownExtra.length > 0 && knownMissing.length > 0 ? "；" : ""}` +
        `${knownMissing.length > 0 ? `遗漏 ${knownMissing.length} 项（${knownMissing.slice(0, 3).join("; ")}）` : ""}`,
    );
  }
}

/** 价格 / 流动性 / 市场状态：日级事实的对齐（日期、归属代码、存在性）。 */
function checkDailyFacts(
  issues: PitCheckIssue[],
  sample: PitAuditSample,
  facts: PitAuditFacts,
  pit: SecurityHistoricalState,
): void {
  const expectedCode = naiveActiveCode(facts.identifiers, facts.security.securityId, sample.tradeDate);

  // 价格。
  if (facts.priceBar !== null && pit.price === null) {
    push(issues, sample, "PRICE_DAY", `(code=${expectedCode ?? "-"}, tradeDate=${sample.tradeDate}) 存在行情行但重建 price=null`);
  } else if (facts.priceBar === null && pit.price !== null) {
    push(issues, sample, "PRICE_DAY", `(code=${expectedCode ?? "-"}, tradeDate=${sample.tradeDate}) 无行情行但重建返回了价格（幽灵数据）`);
  } else if (pit.price !== null) {
    if (pit.price.timestamp !== sample.tradeDate) {
      push(issues, sample, "PRICE_DAY", `价格日期错位：期望 ${sample.tradeDate}，实际 ${pit.price.timestamp}`);
    }
    if (expectedCode === null) {
      push(issues, sample, "PRICE_DAY", `有价格但 tradeDate 无生效代码（身份与价格矛盾）`);
    } else if (pit.price.symbol !== expectedCode) {
      push(issues, sample, "PRICE_DAY", `价格归属代码错位：期望 ${expectedCode}，实际 ${pit.price.symbol}`);
    }
  }

  // 流动性。
  if (facts.liquidity !== null && pit.liquidity === null) {
    push(issues, sample, "LIQUIDITY_DAY", `(code=${expectedCode ?? "-"}, tradeDate=${sample.tradeDate}) 存在流动性行但重建 liquidity=null`);
  } else if (facts.liquidity === null && pit.liquidity !== null) {
    push(issues, sample, "LIQUIDITY_DAY", `(code=${expectedCode ?? "-"}, tradeDate=${sample.tradeDate}) 无流动性行但重建返回了流动性（幽灵数据）`);
  } else if (pit.liquidity !== null) {
    if (pit.liquidity.tradeDate !== sample.tradeDate) {
      push(issues, sample, "LIQUIDITY_DAY", `流动性日期错位：期望 ${sample.tradeDate}，实际 ${pit.liquidity.tradeDate}`);
    }
    if (expectedCode === null) {
      push(issues, sample, "LIQUIDITY_DAY", `有流动性但 tradeDate 无生效代码`);
    } else if (pit.liquidity.securityId !== expectedCode) {
      push(issues, sample, "LIQUIDITY_DAY", `流动性归属代码错位：期望 ${expectedCode}，实际 ${pit.liquidity.securityId}`);
    }
  }

  // 市场状态。
  const expectedCodes = facts.indexBars.map((bar) => bar.indexCode).sort();
  const actualCodes = pit.marketState.map((entry) => entry.indexCode).sort();
  if (expectedCodes.join(",") !== actualCodes.join(",")) {
    push(
      issues,
      sample,
      "MARKET_STATE_DAY",
      `核心指数集合不一致：期望 [${expectedCodes.join(",")}]，实际 [${actualCodes.join(",")}]`,
    );
  }
  for (const entry of pit.marketState) {
    if (entry.bar.tradeDate !== sample.tradeDate) {
      push(issues, sample, "MARKET_STATE_DAY", `${entry.indexCode} 指数日期错位：期望 ${sample.tradeDate}，实际 ${entry.bar.tradeDate}`);
    }
  }
}

/** 维度可知性标记与结果字段的一致性。 */
function checkKnowledge(
  issues: PitCheckIssue[],
  sample: PitAuditSample,
  pit: SecurityHistoricalState,
): void {
  const dims = pit.knowledge.dimensions;
  const expectations = [
    ["price", dims.price === "KNOWN", pit.price !== null],
    ["liquidity", dims.liquidity === "KNOWN", pit.liquidity !== null],
    ["industry", dims.industry === "KNOWN", pit.industry !== null],
    ["marketState", dims.marketState === "KNOWN", pit.marketState.length > 0],
  ] as const;
  for (const [name, flagKnown, hasValue] of expectations) {
    if (flagKnown !== hasValue) {
      push(
        issues,
        sample,
        "KNOWLEDGE_CONSISTENCY",
        `可知性标记矛盾：${name} 标记=${flagKnown ? "KNOWN" : "UNKNOWN"}，但结果${hasValue ? "有值" : "无值"}`,
      );
    }
  }
}

/** PIT ⊆ 全知：已解析状态维度集合单调不减。 */
function checkPitSubset(
  issues: PitCheckIssue[],
  sample: PitAuditSample,
  pit: SecurityHistoricalState,
  full: SecurityHistoricalState,
): void {
  const pitDims = Object.keys(pit.tradability.snapshot.resolved);
  const fullDims = new Set(Object.keys(full.tradability.snapshot.resolved));
  const regressed = pitDims.filter((dim) => !fullDims.has(dim));
  if (regressed.length > 0) {
    push(
      issues,
      sample,
      "PIT_SUBSET_DIMS",
      `PIT 已解析维度 [${regressed.join(",")}] 在全知视角反而缺失（知识倒退）`,
    );
  }
}

/**
 * 对单个样本执行全部反泄漏检查。
 * @param sample 样本（tradeDate/asOf 为该样本口径）。
 * @param facts 独立事实（与重建同源 DB，但判定走朴素预言机）。
 * @param pair 重建状态对（pit = asOf 口径，full = 全知视角），两腿查询均已成功。
 */
export function runSampleChecks(
  sample: PitAuditSample,
  facts: PitAuditFacts,
  pair: { pit: SecurityHistoricalState; full: SecurityHistoricalState },
): PitSampleVerdict {
  const issues: PitCheckIssue[] = [];
  const verdict: PitSampleVerdict = { issues, industryPitGuardExercised: false };
  checkIdentity(issues, sample, facts, pair.pit, pair.full);
  checkLifecycle(issues, sample, facts, pair.pit);
  checkIndustry(issues, sample, facts, pair.pit, pair.full, verdict);
  checkCorporateActions(issues, sample, facts, pair.pit);
  checkDailyFacts(issues, sample, facts, pair.pit);
  checkKnowledge(issues, sample, pair.pit);
  checkPitSubset(issues, sample, pair.pit, pair.full);
  return verdict;
}
