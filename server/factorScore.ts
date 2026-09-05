import type { FactorEffectivenessReport, EvaluableFactorKey } from "./technicalFactors";
import type { FactorNeutralizationReport } from "./factorCombination";
import type { OverfittingGuardReport } from "./overfittingGuard";

/**
 * 因子/策略最终评分（Phase 5）：把有效性、显著性、结构、稳定性、独立性、中性化、衰减等
 * 维度汇总为可配置权重的 0~100 综合分，并给出 Strong/Medium/Weak/Invalid 评级与过拟合风险。
 * 权重可配置（不写死）；所有子分都在 [0,1]，最终分 = Σ wᵢ·sᵢ × 100。
 * 仅做汇总与评级，不参与任何选股/交易决策，避免把"评分好看"当成目标。
 */

export type FactorGrade = "Strong" | "Medium" | "Weak" | "Invalid";
export type OverfittingRiskLabel = "Low" | "Medium" | "High";

export type FactorScoreWeights = {
  predictivePower: number;
  significance: number;
  structure: number;
  stability: number;
  independence: number;
  neutralization: number;
  decay: number;
};

export const DEFAULT_FACTOR_SCORE_WEIGHTS: FactorScoreWeights = {
  predictivePower: 0.3,
  significance: 0.15,
  structure: 0.1,
  stability: 0.2,
  independence: 0.1,
  neutralization: 0.1,
  decay: 0.05,
};

export type FactorVerdict = {
  factorKey: EvaluableFactorKey;
  label: string;
  /** 各维度子分（0~1）。 */
  subScores: Record<keyof FactorScoreWeights, number>;
  /** 最终综合分（0~100）。 */
  finalScore: number;
  grade: FactorGrade;
  overfittingRisk: OverfittingRiskLabel;
  definition: string;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function predictivePowerSubScore(strength: string | null): number {
  if (strength === "strong") return 1;
  if (strength === "moderate") return 0.66;
  if (strength === "weak") return 0.33;
  return 0;
}

function significanceSubScore(pValue: number | null): number {
  if (pValue === null) return 0;
  if (pValue < 0.05) return 1;
  if (pValue < 0.1) return 0.66;
  if (pValue < 0.2) return 0.33;
  return 0;
}

function structureSubScore(shape: string | null): number {
  if (shape === "monotonic_increasing" || shape === "monotonic_decreasing") return 1;
  if (shape === "inverted_u" || shape === "u_shape" || shape === "threshold") return 0.5;
  return 0;
}

/** 阶段方向一致性与年度切片方向一致性加权平均。 */
function stabilitySubScore(phaseConsistent: boolean | null, yearlyConsistency: number | null): number {
  const phaseScore = phaseConsistent === null ? 0.5 : phaseConsistent ? 1 : 0.2;
  const yearlyScore = yearlyConsistency ?? 0.5;
  return clamp01(0.6 * phaseScore + 0.4 * yearlyScore);
}

function independenceSubScore(vif: number | null): number {
  if (vif === null) return 0.33;
  if (vif < 2) return 1;
  if (vif < 5) return 0.66;
  if (vif < 10) return 0.33;
  return 0;
}

function neutralizationSubScore(icReduction: number | null): number {
  if (icReduction === null) return 0.5;
  if (icReduction < 0) return 1;      // 去市值后预测力增强 → 自身有效
  if (icReduction < 0.2) return 1;    // 中性化后基本保留 → 自身有效
  if (icReduction < 0.5) return 0.66; // 部分来自市值
  return 0.33;                        // 主要是市值代理
}

function decaySubScore(meanIcs: Array<number | null>): number {
  const valid = meanIcs.filter((value): value is number => value !== null);
  if (valid.length < 2) return 0.5;
  const first = valid[0]!;
  const last = valid[valid.length - 1]!;
  if (first !== 0 && last !== 0 && Math.sign(first) !== Math.sign(last)) return 0; // 方向反转
  if (Math.abs(last) < Math.abs(first) * 0.5) return 0.5; // 快速衰减
  return 1;
}

/** 年度 IC 与总体方向一致的切片占比。 */
function yearlyConsistency(yearlyMeanIcs: Array<number | null>, overallDirection: "positive" | "negative" | null): number | null {
  const valid = yearlyMeanIcs.filter((value): value is number => value !== null);
  if (valid.length === 0 || overallDirection === null) return null;
  const consistent = valid.filter((value) => (overallDirection === "positive" ? value > 0 : value < 0)).length;
  return consistent / valid.length;
}

function gradeFromScore(score: number): FactorGrade {
  if (score >= 70) return "Strong";
  if (score >= 50) return "Medium";
  if (score >= 30) return "Weak";
  return "Invalid";
}

/**
 * 逐因子最终评分：汇总有效性/显著性/结构/稳定性/独立性/中性化/衰减七个维度。
 * 样本不足（meanIc 为 null）的因子直接判为 Invalid。
 */
export function buildFactorVerdicts(
  factorEvaluation: FactorEffectivenessReport,
  factorCombination: FactorNeutralizationReport,
  weights: FactorScoreWeights = DEFAULT_FACTOR_SCORE_WEIGHTS,
): FactorVerdict[] {
  const rankIcByKey = new Map(factorEvaluation.rankIc.map((item) => [item.factorKey, item]));
  const quintileByKey = new Map(factorEvaluation.quintiles.map((item) => [item.factorKey, item]));
  const phaseByKey = new Map(factorEvaluation.phaseStability.map((item) => [item.factorKey, item]));
  const yearlyByKey = new Map(factorEvaluation.yearlyIc.map((item) => [item.factorKey, item]));
  const decayByKey = new Map(factorEvaluation.icDecay.map((item) => [item.factorKey, item]));
  const neutralizationByKey = new Map<EvaluableFactorKey, FactorNeutralizationReport["neutralizationIc"][number]>();
  for (const item of factorCombination.neutralizationIc) neutralizationByKey.set(item.factorKey, item);

  const verdicts: FactorVerdict[] = [];
  for (const definition of factorEvaluation.rankIc.map((item) => ({ factorKey: item.factorKey, label: item.label }))) {
    const rankIc = rankIcByKey.get(definition.factorKey);
    const quintile = quintileByKey.get(definition.factorKey);
    const phase = phaseByKey.get(definition.factorKey);
    const yearly = yearlyByKey.get(definition.factorKey);
    const decay = decayByKey.get(definition.factorKey);
    const neutralization = neutralizationByKey.get(definition.factorKey);

    // 样本不足：无法可靠评估，直接判 Invalid。
    if (!rankIc || rankIc.meanIc === null || rankIc.dailyIcCount < 2) {
      verdicts.push({
        factorKey: definition.factorKey,
        label: definition.label,
        subScores: { predictivePower: 0, significance: 0, structure: 0, stability: 0, independence: 0, neutralization: 0, decay: 0 },
        finalScore: 0,
        grade: "Invalid",
        overfittingRisk: "Low",
        definition: "有效样本不足，无法可靠评估（样本不足不强行给分）。",
      });
      continue;
    }

    const sPredictive = predictivePowerSubScore(rankIc.strength);
    const sSignificance = significanceSubScore(rankIc.pValue);
    const sStructure = structureSubScore(quintile?.shape ?? null);
    const yConsistency = yearlyConsistency(yearly?.buckets.map((bucket) => bucket.meanIc) ?? [], rankIc.direction);
    const sStability = stabilitySubScore(phase?.directionConsistent ?? null, yConsistency);
    const sIndependence = independenceSubScore(factorCombination.vif[definition.factorKey] ?? null);
    const sNeutralization = neutralizationSubScore(neutralization?.icReduction ?? null);
    const sDecay = decaySubScore(decay?.points.map((point) => point.meanIc) ?? []);

    const subScores: Record<keyof FactorScoreWeights, number> = {
      predictivePower: sPredictive,
      significance: sSignificance,
      structure: sStructure,
      stability: sStability,
      independence: sIndependence,
      neutralization: sNeutralization,
      decay: sDecay,
    };
    const finalScore = Math.round(100 * (
      sPredictive * weights.predictivePower
      + sSignificance * weights.significance
      + sStructure * weights.structure
      + sStability * weights.stability
      + sIndependence * weights.independence
      + sNeutralization * weights.neutralization
      + sDecay * weights.decay
    ));

    // 过拟合风险：预测力强但稳定性差（强 IC 却跨切片方向漂移）→ High；显著性中等但稳定性差 → Medium。
    const overfittingRisk: OverfittingRiskLabel = sPredictive >= 0.66 && sStability < 0.4
      ? "High"
      : sPredictive >= 0.33 && sStability < 0.4
        ? "Medium"
        : "Low";

    verdicts.push({
      factorKey: definition.factorKey,
      label: definition.label,
      subScores,
      finalScore,
      grade: gradeFromScore(finalScore),
      overfittingRisk,
      definition: `综合分 = ${Math.round(weights.predictivePower * 100)}%·预测力 + ${Math.round(weights.significance * 100)}%·显著性 + ${Math.round(weights.structure * 100)}%·结构 + ${Math.round(weights.stability * 100)}%·稳定性 + ${Math.round(weights.independence * 100)}%·独立性 + ${Math.round(weights.neutralization * 100)}%·中性化 + ${Math.round(weights.decay * 100)}%·衰减。`,
    });
  }
  return verdicts;
}

export type StrategyOverfittingRisk = {
  /** 0~100，越高过拟合风险越大。 */
  score: number;
  label: OverfittingRiskLabel;
  definition: string;
};

/**
 * 策略过拟合风险评分：综合 DSR（多重检验校正）、PSR（夏普显著性）、
 * 蒙特卡洛破产概率，以及样本外相对样本内夏普的衰减。
 * 阈值可配置；score 越高风险越大。
 */
export function buildStrategyOverfittingRiskScore(
  overfittingGuard: OverfittingGuardReport,
  walkForwardOosSharpe: number | null,
  fullCycleSharpe: number | null,
): StrategyOverfittingRisk {
  let score = 0;
  const { deflatedSharpe, psr, bootstrap } = overfittingGuard;

  if (deflatedSharpe !== null) score += (1 - deflatedSharpe) * 40;
  if (psr !== null) score += (1 - psr) * 20;
  if (bootstrap?.ruinProbability !== null && bootstrap?.ruinProbability !== undefined) score += bootstrap.ruinProbability * 20;
  if (walkForwardOosSharpe !== null && fullCycleSharpe !== null && fullCycleSharpe > 0) {
    const decay = (fullCycleSharpe - walkForwardOosSharpe) / fullCycleSharpe;
    score += Math.max(0, decay) * 20;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const label: OverfittingRiskLabel = score < 20 ? "Low" : score < 40 ? "Medium" : "High";
  return {
    score,
    label,
    definition: `过拟合风险 = (1−DSR)×40 + (1−PSR)×20 + 破产概率×20 + 样本外相对样本内夏普衰减×20（取正）。越高代表越依赖历史参数优化，样本外泛化越存疑。`,
  };
}

export type StrategyQualityScore = {
  /** 0~100。 */
  score: number;
  label: FactorGrade;
  definition: string;
};

/**
 * 策略质量评分：综合风险调整后收益（全周期夏普）与样本外泛化（WFA 夏普、DSR、PSR）。
 * 权重可配置；样本外项占主导，避免"只看样本内漂亮"。
 */
export function buildStrategyQualityScore(
  fullCycleSharpe: number | null,
  walkForwardOosSharpe: number | null,
  overfittingGuard: OverfittingGuardReport,
): StrategyQualityScore {
  const wIs = 0.3;
  const wOos = 0.4;
  const wDsr = 0.2;
  const wPsr = 0.1;

  const scoreIs = fullCycleSharpe === null ? 0 : clamp01(Math.max(0, fullCycleSharpe) / 1.5);
  const scoreOos = walkForwardOosSharpe === null ? 0 : clamp01(Math.max(0, walkForwardOosSharpe) / 1.5);
  const scoreDsr = overfittingGuard.deflatedSharpe ?? 0;
  const scorePsr = overfittingGuard.psr ?? 0;

  const raw = scoreIs * wIs + scoreOos * wOos + scoreDsr * wDsr + scorePsr * wPsr;
  const score = Math.round(clamp01(raw) * 100);
  return {
    score,
    label: gradeFromScore(score),
    definition: `策略质量 = ${wIs * 100}%·样本内夏普(归一化) + ${wOos * 100}%·样本外WFA夏普(归一化) + ${wDsr * 100}%·DSR + ${wPsr * 100}%·PSR。样本外与过拟合校正项合计 ${(wOos + wDsr + wPsr) * 100}%，主导评分。`,
  };
}

export type FinalVerdict = {
  factorVerdicts: FactorVerdict[];
  overfittingRisk: StrategyOverfittingRisk;
  strategyQuality: StrategyQualityScore;
  /** 有效因子概览：Strong/Medium/Weak/Invalid 各有多少。 */
  gradeSummary: Record<FactorGrade, number>;
  definition: string;
};

/**
 * 汇总最终结论：逐因子评分 + 策略过拟合风险 + 策略质量。
 */
export function buildFinalVerdict(
  factorEvaluation: FactorEffectivenessReport,
  factorCombination: FactorNeutralizationReport,
  overfittingGuard: OverfittingGuardReport,
  walkForwardOosSharpe: number | null,
  fullCycleSharpe: number | null,
): FinalVerdict {
  const factorVerdicts = buildFactorVerdicts(factorEvaluation, factorCombination);
  const overfittingRisk = buildStrategyOverfittingRiskScore(overfittingGuard, walkForwardOosSharpe, fullCycleSharpe);
  const strategyQuality = buildStrategyQualityScore(fullCycleSharpe, walkForwardOosSharpe, overfittingGuard);
  const gradeSummary: Record<FactorGrade, number> = { Strong: 0, Medium: 0, Weak: 0, Invalid: 0 };
  for (const verdict of factorVerdicts) gradeSummary[verdict.grade] += 1;
  return {
    factorVerdicts,
    overfittingRisk,
    strategyQuality,
    gradeSummary,
    definition: `最终结论：逐因子综合分与评级 + 策略过拟合风险分 + 策略质量分。评级与风险分仅作诊断参考，不参与选股决策。`,
  };
}
