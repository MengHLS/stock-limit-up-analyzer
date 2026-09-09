/**
 * STEP 17 / C-17.2 — Rolling Optimization：跨窗参数一致性判定（显式非 argmax）。
 *
 * 目标（ROADMAP §19）：不是「挑每个窗的历史最优参数再比较其取值是否集中」，而是找
 * 「在多个时间窗上都表现良好且稳定的参数区域」。因此本模块：
 *
 *   - 逐窗先把每个参数集按区域口径分类（与 C-17.1 analyzeCandidateRegion 同一阈值语义）：
 *       qualified    = returnOk && ddOk（returnOk = totalReturnPct >= minReturnPct；
 *                      ddOk = maxDrawdownPct <= maxDrawdownPct）；
 *       bad point    = !ddOk（回撤超阈值，**无论收益多高**）；
 *       low return   = !returnOk && ddOk；
 *       failed       = 该窗评估失败 / 指标非法。
 *   - 跨窗聚合每个参数集（同一 canonical parameterSet 在各窗的取值轨迹）：
 *       consistent = 在「它被评估的每一个窗口」里都 qualified（成功 且 收益达标 且 回撤
 *       达标），且被评估窗口数 >= minEvaluatedWindows。这是合格区的**交集语义**——
 *       「参数 A 跨窗稳好、参数 B 单窗好他窗差」场景下 A consistent、B 不是；
 *   - 只做描述性聚合（均值/中位数/最差，非单点极值），不选 Top1、不推广生产。
 *
 * 设计决策：
 *   - 一致性分母 = 该参数集实际被评估的窗口数（random 逐窗采样可能只覆盖部分参数；
 *     未采样窗口不参与判定，以 evaluatedWindowCount 与 windowCount 的差异对审计可见）；
 *   - 统计单源：qualified 样本的 totalReturnPct / maxDrawdownPct 在分类扫描时一次性
 *     采集进 per-key 数组，均值/中位数只在这些数组上计算，杜绝多路定义漂移；
 *   - 明细 rows 按 parameterSetKey 字典序输出（确定性，不依赖对象键插入顺序）。
 *
 * 铁律：纯函数、确定性、无 IO / Date.now / Math.random；禁止 NaN / Infinity（成功样本
 * 指标非法属契约破坏，直接抛错）；失败响亮。
 */

import type { ResolvedRegionAnalysisConfig } from "../parameterSearch";
import type { ResearchValidationIssue } from "../experimentValidation";
import type { ResearchParameterSet } from "../types";
import {
  DEFAULT_ROLLING_STABILITY_CONFIG,
  type ResolvedRollingStabilityConfig,
  type RollingConsistencyParameterStat,
  type RollingConsistencyReport,
  type RollingConsistencyVerdict,
  type RollingStabilityConfig,
  type RollingWindowObservation,
} from "./types";

// ---------------------------------------------------------------------------
// 确定性统计原语
// ---------------------------------------------------------------------------

/** 参数集 canonical 键（键排序 + JSON 值），用于去重与确定性排序。 */
export function rollingParameterSetKey(set: ResearchParameterSet): string {
  return Object.keys(set)
    .sort()
    .map((key) => `${JSON.stringify(key)}=${JSON.stringify(set[key])}`)
    .join("|");
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

// ---------------------------------------------------------------------------
// 配置解析
// ---------------------------------------------------------------------------

/** 解析跨窗一致性口径：缺省补齐 + 形态校验。issues 为空即合法。 */
export function resolveRollingStabilityConfig(
  config: RollingStabilityConfig | undefined,
): { readonly config: ResolvedRollingStabilityConfig; readonly issues: ResearchValidationIssue[] } {
  const issues: ResearchValidationIssue[] = [];
  const issue = (code: string, path: string, message: string): void => {
    issues.push({ code, path, message });
  };
  if (config !== undefined && (config === null || typeof config !== "object" || Array.isArray(config))) {
    issues.push({ code: "ROLLING_STABILITY_CONFIG_INVALID", path: "stability", message: "stability 必须是对象" });
    return { config: { ...DEFAULT_ROLLING_STABILITY_CONFIG }, issues };
  }
  const minEvaluatedWindows = config?.minEvaluatedWindows ?? DEFAULT_ROLLING_STABILITY_CONFIG.minEvaluatedWindows;
  const maxCandidates = config?.maxCandidates ?? DEFAULT_ROLLING_STABILITY_CONFIG.maxCandidates;
  if (!Number.isInteger(minEvaluatedWindows) || minEvaluatedWindows < 1) {
    issue("ROLLING_STABILITY_MIN_WINDOWS_INVALID", "stability.minEvaluatedWindows", "minEvaluatedWindows 必须是 >= 1 的整数");
  }
  if (maxCandidates !== null && (!Number.isInteger(maxCandidates) || maxCandidates < 1)) {
    issue("ROLLING_STABILITY_MAX_CANDIDATES_INVALID", "stability.maxCandidates", "maxCandidates 必须为 null 或 >= 1 的整数");
  }
  return { config: { minEvaluatedWindows, maxCandidates }, issues };
}

// ---------------------------------------------------------------------------
// 主分析
// ---------------------------------------------------------------------------

/** 单个参数集在某窗的分类状态。 */
type WindowState = "qualified" | "bad-drawdown" | "low-return" | "failed";

/**
 * 对逐窗搜索结果做跨窗一致性判定。
 *
 * 输入约束（契约破坏直接抛错）：observations 非空；windowId 非空且唯一；windowIndex
 * 为非负整数且唯一。窗口顺序按 windowIndex 升序归一，不信任入参顺序。
 */
export function analyzeRollingConsistency(
  observations: readonly RollingWindowObservation[],
  analysisConfig: ResolvedRegionAnalysisConfig,
  config: ResolvedRollingStabilityConfig,
): RollingConsistencyReport {
  if (!Array.isArray(observations) || observations.length === 0) {
    throw new Error("analyzeRollingConsistency: 观察窗口列表为空（契约破坏：run 保证 >= 1 窗）");
  }
  const seenIds = new Set<string>();
  const seenIndexes = new Set<number>();
  for (let index = 0; index < observations.length; index++) {
    const obs = observations[index]!;
    if (typeof obs.windowId !== "string" || obs.windowId.trim() === "") {
      throw new Error(`analyzeRollingConsistency: observations[${index}] 缺 windowId（契约破坏）`);
    }
    if (!Number.isInteger(obs.windowIndex) || obs.windowIndex < 0) {
      throw new Error(`analyzeRollingConsistency: observations[${index}] windowIndex 非法（契约破坏）`);
    }
    if (seenIds.has(obs.windowId)) {
      throw new Error(`analyzeRollingConsistency: windowId=${obs.windowId} 重复（契约破坏）`);
    }
    if (seenIndexes.has(obs.windowIndex)) {
      throw new Error(`analyzeRollingConsistency: windowIndex=${obs.windowIndex} 重复（契约破坏）`);
    }
    seenIds.add(obs.windowId);
    seenIndexes.add(obs.windowIndex);
  }
  const sortedObs = [...observations].sort((a, b) => a.windowIndex - b.windowIndex);
  const windowOrder = sortedObs.map((obs) => obs.windowId);

  // 单遍分类扫描：per-key 状态 + qualified 样本指标 + 参数集登记。
  const statesByKey = new Map<string, Map<string, WindowState>>();
  const qualifiedReturnsByKey = new Map<string, number[]>();
  const qualifiedDrawdownsByKey = new Map<string, number[]>();
  const parameterSetByKey = new Map<string, ResearchParameterSet>();

  for (const obs of sortedObs) {
    for (const sample of obs.evaluatedSamples) {
      const key = rollingParameterSetKey(sample.parameterSet);
      if (!parameterSetByKey.has(key)) parameterSetByKey.set(key, sample.parameterSet);
      let perKey = statesByKey.get(key);
      if (perKey === undefined) {
        perKey = new Map();
        statesByKey.set(key, perKey);
      }
      let state: WindowState;
      if (sample.status === "failed") {
        state = "failed";
      } else {
        if (sample.totalReturnPct === null || sample.maxDrawdownPct === null) {
          throw new Error(`analyzeRollingConsistency: succeeded 样本缺绩效标量（window=${obs.windowId}，契约破坏）`);
        }
        const returnOk = sample.totalReturnPct >= analysisConfig.minReturnPct;
        const drawdownOk = sample.maxDrawdownPct <= analysisConfig.maxDrawdownPct;
        if (returnOk && drawdownOk) {
          state = "qualified";
          const returns = qualifiedReturnsByKey.get(key) ?? [];
          returns.push(sample.totalReturnPct);
          qualifiedReturnsByKey.set(key, returns);
          const drawdowns = qualifiedDrawdownsByKey.get(key) ?? [];
          drawdowns.push(sample.maxDrawdownPct);
          qualifiedDrawdownsByKey.set(key, drawdowns);
        } else if (drawdownOk) {
          state = "low-return";
        } else {
          state = "bad-drawdown";
        }
      }
      perKey.set(obs.windowId, state);
    }
  }

  // 逐参数集聚合。
  const parameterStats: RollingConsistencyParameterStat[] = [];
  for (const key of Array.from(statesByKey.keys()).sort((a, b) => a.localeCompare(b))) {
    const states = statesByKey.get(key)!;
    const parameterSet = parameterSetByKey.get(key)!;
    let evaluated = 0;
    let succeeded = 0;
    let qualified = 0;
    let bad = 0;
    let low = 0;
    let failed = 0;
    for (const windowId of windowOrder) {
      const state = states.get(windowId);
      if (state === undefined) continue; // 该窗未采样该参数
      evaluated += 1;
      if (state === "qualified") {
        succeeded += 1;
        qualified += 1;
      } else if (state === "bad-drawdown") {
        succeeded += 1;
        bad += 1;
      } else if (state === "low-return") {
        succeeded += 1;
        low += 1;
      } else {
        failed += 1;
      }
    }
    const qualifiedWindowIds = windowOrder.filter((windowId) => states.get(windowId) === "qualified");
    const qualifiedWindowRatePct = evaluated === 0 ? null : (qualified / evaluated) * 100;
    const consistent =
      evaluated >= config.minEvaluatedWindows
      && qualified === succeeded && succeeded === evaluated;
    const returns = qualifiedReturnsByKey.get(key) ?? [];
    const drawdowns = qualifiedDrawdownsByKey.get(key) ?? [];
    parameterStats.push({
      parameterSetKey: key,
      parameterSet,
      evaluatedWindowCount: evaluated,
      succeededWindowCount: succeeded,
      qualifiedWindowCount: qualified,
      qualifiedWindowIds,
      badDrawdownWindowCount: bad,
      lowReturnWindowCount: low,
      failedWindowCount: failed,
      qualifiedWindowRatePct,
      consistent,
      meanTotalReturnPct: returns.length === 0 ? null : mean(returns),
      medianTotalReturnPct: returns.length === 0 ? null : median(returns),
      meanMaxDrawdownPct: drawdowns.length === 0 ? null : mean(drawdowns),
      maxMaxDrawdownPct: drawdowns.length === 0 ? null : Math.max(...drawdowns),
    });
  }

  // 明细只保留「至少在一个窗合格」的参数集（其余可在逐窗 SearchRun.evaluatedSamples 查证）。
  const reported = parameterStats
    .filter((stat) => stat.qualifiedWindowCount > 0)
    .sort((a, b) => a.parameterSetKey.localeCompare(b.parameterSetKey));
  const everQualifiedParameterCount = reported.length;
  const consistentStats = parameterStats
    .filter((stat) => stat.consistent)
    .sort((a, b) => {
      const aMed = a.medianTotalReturnPct ?? 0;
      const bMed = b.medianTotalReturnPct ?? 0;
      if (aMed !== bMed) return bMed - aMed;
      return a.parameterSetKey.localeCompare(b.parameterSetKey);
    });

  let verdict: RollingConsistencyVerdict;
  if (everQualifiedParameterCount === 0) {
    verdict = "no-qualified-parameters";
  } else if (consistentStats.length > 0) {
    verdict = "stable-across-windows";
  } else {
    verdict = "no-consistent-parameters";
  }

  const aggregate =
    consistentStats.length === 0
      ? null
      : {
          count: consistentStats.length,
          meanTotalReturnPct: mean(consistentStats.map((s) => s.meanTotalReturnPct ?? 0)),
          medianTotalReturnPct: median(consistentStats.map((s) => s.medianTotalReturnPct ?? 0)),
          meanMaxDrawdownPct: mean(consistentStats.map((s) => s.meanMaxDrawdownPct ?? 0)),
          maxMaxDrawdownPct: Math.max(...consistentStats.map((s) => s.maxMaxDrawdownPct ?? 0)),
        };

  return {
    verdict,
    windowCount: windowOrder.length,
    uniqueParameterCount: parameterStats.length,
    everQualifiedParameterCount,
    consistentParameterCount: consistentStats.length,
    parameters: reported,
    aggregate,
  };
}
