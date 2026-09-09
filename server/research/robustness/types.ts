/**
 * STEP 18 / C-18.1 — 鲁棒性测试（研究链路扰动重估）：类型契约。
 *
 * 背景与定位（ROADMAP §20；C-18.1 首批 = Cost Stress / Slippage Stress /
 * Parameter Perturbation / Execution Perturbation）：
 *   - §0 纪律：回测可信必须考虑成本/滑点敏感性——「单一成本假设下的好回测不足信」。
 *     本目录对**一条已评估的策略结果**做扰动重估：在基线配置上逐轴扰动
 *     （成本声明分量 / 滑点 / 策略参数 / 执行约束），回答「策略是否依赖某一
 *     成本假设 / 参数取值 / 执行配置」。
 *   - 扰动器（costStress.ts / parameterPerturbation.ts / executionPerturbation.ts）
 *     产出 PerturbationItem（轴 + 扰动后配置 + 稳定 code / 中文 label + 基准标记），
 *     首条恒为 isBaseline=true 的基准条目（×1 自身，供漂移对照）；
 *   - 重估编排器（evaluate.ts runRobustnessStress）：对扰动清单逐条注入式重估
 *     （evaluator 回调由调用方提供，本模块不执行 IO / 回测），产出
 *     RobustnessRun.samples（含基准）+ conclusion；
 *   - 漂移判定（drift.ts）：相对基准的收益漂移（绝对差值）/ 回撤恶化超阈值 →
 *     标记 sensitive；逐样本 verdict = baseline | stable | sensitive | failed。
 *
 * 轴语义（单一扰动 = 只改一轴，保证归因干净）：
 *   - cost      成本压力：佣金/印花税/过户费/市场冲击强度（倍率式），不含滑点；
 *   - slippage  滑点轴专项（= cost 的子集，独立轴便于与其它轴组合/归因）；
 *   - parameter 策略参数局部邻域（±%/±档，见 parameterPerturbation.ts）；
 *   - execution 成交假设扰动（成交时机/部分成交档/并发持仓，见 executionPerturbation.ts）。
 *
 * 范围与克制（哲学对齐 C-17.1 SearchRun / experimentLineage）：
 *   - 不做 Monte Carlo / Bootstrap / Trade Order Randomization（C-18.2 专属）：
 *     扩展槽 = 后续扩展 RobustnessAxis 联合（如 "monteCarlo" | "bootstrap" |
 *     "orderRandomization"）即可复用 Run / 结论形态，本任务**不预埋空轴**；
 *   - 不做 regime 扰动（C-22.1）；不跑真实回测；不重写 C-14.2/C-14.3/C-16.x
 *     （import 只读复用其类型与校验；成本/执行扰动产物必须通过既有 validate，
 *     由生成器逐条断言并在超限时结构化跳过）；
 *   - 确定性纪律：createdAt / robustnessRunId 一律**由调用方注入**，本模块任何
 *     函数不触 Date.now / Math.random / IO（严格于 C-17.1 的「时间戳注入」哲学）。
 *
 * 铁律：全部字段 readonly；数值有限（NaN/±Infinity 拒绝）；可 JSON 序列化；
 * 失败响亮（退化输入结构化处理）；指纹 = canonical SHA-256（见 serialize.ts）。
 */

import type { ExecutionModelId } from "../../backtest/types";
import type { CostModelDeclaration } from "../costModel/types";
import type { ExecutionConstraintDeclaration } from "../executionConstraints/types";
import type { ResearchParameterSet } from "../types";

// ---------------------------------------------------------------------------
// 记录身份常量
// ---------------------------------------------------------------------------

/** 记录种类标签（供序列化 / 反序列化判别，防止类型混淆）。 */
export const ROBUSTNESS_RUN_RECORD_KIND = "ROBUSTNESS_RUN" as const;

/** 记录 schema 版本：字段语义变更必须递增，禁止原地改写既有含义。 */
export const ROBUSTNESS_RUN_RECORD_VERSION = 1 as const;

/** RobustnessRun ID 前缀（`ROBUST-YYYYMMDD-XXXXXXXX`，风格对齐 C-17.1 SEARCH）。 */
export const ROBUSTNESS_RUN_ID_PREFIX = "ROBUST" as const;

// ---------------------------------------------------------------------------
// 扰动轴与配置映射
// ---------------------------------------------------------------------------

/**
 * 扰动轴（当前 C-18.1 四轴）。
 * 扩展槽：C-18.2（MC / Bootstrap / Trade Order Randomization）可在未来扩展此联合，
 * 并在 AxisConfigMap 补对应配置形态——本任务不预埋，避免为不存在的需求设空壳。
 */
export type RobustnessAxis = "cost" | "slippage" | "parameter" | "execution";

/** 各轴的「扰动对象」配置形态（轴 → 扰动后配置类型）。 */
export interface RobustnessAxisConfigMap {
  readonly cost: CostModelDeclaration;
  readonly slippage: CostModelDeclaration;
  readonly parameter: ResearchParameterSet;
  readonly execution: ExecutionConstraintDeclaration;
}

// ---------------------------------------------------------------------------
// 绩效视图（evaluator 返回的最小契约；风格对齐 C-17.1 ParameterSearchMetricsView）
// ---------------------------------------------------------------------------

/**
 * 单次评估的绩效标量视图（漂移判定实际消费的最小集合）。
 * 与研究链路评估器（C-16.1 evaluatePerformance → PerformanceEvaluationRun）的桥接
 * 见 drift.ts 的 toRobustnessMetricsView（import 只读，不重写 C-16.1 口径）。
 */
export interface RobustnessMetricsView {
  /** 总收益率（%），可为负；必须有限。 */
  readonly totalReturnPct: number;
  /** 最大回撤深度（%，>= 0）；必须有限。 */
  readonly maxDrawdownPct: number;
  /** 成交笔数；未知为 null；提供时必须为 >= 0 整数。 */
  readonly tradeCount: number | null;
}

/** 单次评估产物（成功携带标量；失败携带结构化错误）。 */
export type RobustnessSampleOutcome =
  | { readonly status: "succeeded"; readonly metrics: RobustnessMetricsView }
  | { readonly status: "failed"; readonly error: string };

/**
 * 注入式评估器：扰动条目 → 评估产物。
 * 编排器保持纯函数，不执行 IO / 回测；真实映射（扰动后配置 → 回测 → 绩效）
 * 由调用方闭包实现（哲学对齐 C-17.1 runParameterSearch 的 evaluator 注入）。
 */
export type RobustnessEvaluator = (item: PerturbationItem) => RobustnessSampleOutcome;

// ---------------------------------------------------------------------------
// 扰动条目（PerturbationItem）
// ---------------------------------------------------------------------------

/**
 * 被生成器跳过的扰动变体（生成器不产出非法/退化条目，而是结构化记录原因；
 * 绝不静默 clamp 到合法域——clamp 会伪造「×N 压力」实际只到合法边界）。
 */
export interface PerturbationSkip {
  /** 本应生成的稳定 code。 */
  readonly code: string;
  /** 本应生成的中文标签。 */
  readonly label: string;
  /** 跳过原因（人类可读；如「佣金 ×100 超出 C-14.2 校验上界」）。 */
  readonly reason: string;
}

/** 扰动条目公共字段（不含 axis：轴由各判别分支固定为字面量，保证 TS 收窄）。 */
export interface PerturbationItemFields {
  /** 稳定程序化 code（如 SLIPPAGE_X5 / PARAM_SCORE_PCT_M20 / EXEC_MODEL_NEXT_CLOSE）。 */
  readonly code: string;
  /** 中文标签（审计用途，不参与计算）。 */
  readonly label: string;
  /** 是否 = 基准自身（×1 / 原配置）。每个扰动集恰一条且为索引 0。 */
  readonly isBaseline: boolean;
}

/**
 * 单条扰动条目 = 轴判别（字面量）+ 扰动后配置（readonly、可 JSON 序列化）。
 * axis="slippage" 与 axis="cost" 共用 CostModelDeclaration 形态（滑点是成本子集轴，
 * 扰动后声明仍需通过 C-14.2 validateCostModelDeclaration——生成器逐条断言）。
 */
export type PerturbationItem =
  | (PerturbationItemFields & { readonly axis: "cost"; readonly config: CostModelDeclaration })
  | (PerturbationItemFields & { readonly axis: "slippage"; readonly config: CostModelDeclaration })
  | (PerturbationItemFields & { readonly axis: "parameter"; readonly config: ResearchParameterSet })
  | (PerturbationItemFields & { readonly axis: "execution"; readonly config: ExecutionConstraintDeclaration });

// ---------------------------------------------------------------------------
// 漂移阈值（口径见 drift.ts）
// ---------------------------------------------------------------------------

/** 漂移判定阈值（部分字段可缺省，由 resolveRobustnessThresholds 补齐）。 */
export interface RobustnessThresholds {
  /**
   * 收益漂移阈值（百分点，绝对）：|totalReturnPct_扰动 − totalReturnPct_基准| > 该值
   * → RETURN_DRIFT 敏感。缺省 5。
   */
  readonly returnDriftThresholdPct?: number;
  /**
   * 回撤恶化阈值（百分点，绝对）：maxDrawdownPct_扰动 − maxDrawdownPct_基准 > 该值
   * → DRAWDOWN_WORSENING 敏感（仅恶化方向计敏感；回撤改善不判敏感）。缺省 3。
   */
  readonly drawdownWorseningThresholdPct?: number;
}

/** 解析后的漂移阈值（全字段有限、自描述；进入 RobustnessRun）。 */
export interface ResolvedRobustnessThresholds {
  readonly returnDriftThresholdPct: number;
  readonly drawdownWorseningThresholdPct: number;
}

// ---------------------------------------------------------------------------
// 漂移 / 样本判定
// ---------------------------------------------------------------------------

/** 敏感触发标签（程序化；非自由文本）。 */
export type RobustnessSensitivityFlag = "RETURN_DRIFT" | "DRAWDOWN_WORSENING";

/** 单条扰动的漂移分解（相对基准；仅非基准且成功样本有值）。 */
export interface PerturbationDrift {
  /** 收益漂移（百分点）= 扰动 totalReturnPct − 基准 totalReturnPct。 */
  readonly returnDriftPct: number;
  /** 回撤变化（百分点）= 扰动 maxDrawdownPct − 基准 maxDrawdownPct；>0 = 恶化。 */
  readonly drawdownChangePct: number;
  /** 回撤恶化量（百分点）= max(0, drawdownChangePct)。 */
  readonly drawdownWorseningPct: number;
  /** 命中阈值触发的敏感标签（空 = 无敏感）。 */
  readonly flags: readonly RobustnessSensitivityFlag[];
}

/** 单样本判定。 */
export type RobustnessSampleVerdict = "baseline" | "stable" | "sensitive" | "failed";

/** 逐扰动评估样本（进入 RobustnessRun.samples；索引 0 = 基准条目）。 */
export interface RobustnessSample {
  readonly perturbation: PerturbationItem;
  readonly status: "succeeded" | "failed";
  /** status=succeeded 时数值有限；failed 时为 null。 */
  readonly metrics: RobustnessMetricsView | null;
  /** status=failed 时的结构化错误；succeeded 时为 null。 */
  readonly error: string | null;
  /** 判定：基准=baseline；失败=failed；成功扰动按漂移=stable/sensitive。 */
  readonly verdict: RobustnessSampleVerdict;
  /** 非基准成功样本的漂移分解；基准/failed 为 null。 */
  readonly drift: PerturbationDrift | null;
  /** 扰动后配置内容指纹（canonical SHA-256；见 serialize.ts）。 */
  readonly configFingerprint: string;
}

// ---------------------------------------------------------------------------
// 轴级结论
// ---------------------------------------------------------------------------

/**
 * 轴级敏感性结论（verdict）：
 *   - "sensitive"    至少一条非基准扰动命中漂移阈值（标记敏感）；
 *   - "stable"       存在非基准扰动且全部稳定（未触发任何阈值）；
 *   - "insufficient" 非基准扰动全部评估失败（无绩效可判）；
 *   - "no-variants"  扰动清单只有基准条目（无可判扰动）；
 *   - "no-conclusion" 基准条目评估失败（漂移无锚点）；编排器在此情形会直接结构化抛错，
 *                     本值保留给直接调用 assess 的场景（防御性）。
 */
export type AxisSensitivityVerdict =
  | "sensitive"
  | "stable"
  | "insufficient"
  | "no-variants"
  | "no-conclusion";

/** 单轴鲁棒性结论（= RobustnessRun.conclusion；归因按轴输出）。 */
export interface RobustnessAxisConclusion {
  /** 本次运行的扰动轴。 */
  readonly axis: RobustnessAxis;
  /** 扰动清单总数（含基准）。 */
  readonly sampleCount: number;
  /** 基准条目是否评估成功。 */
  readonly baselineSucceeded: boolean;
  /** 成功评估的非基准扰动数。 */
  readonly succeededCount: number;
  /** 评估失败的非基准扰动数。 */
  readonly failedCount: number;
  /** 命中阈值（敏感）的非基准扰动数。 */
  readonly sensitiveCount: number;
  /** 稳定的非基准扰动数。 */
  readonly stableCount: number;
  /** 敏感扰动 code 清单（按 samples 顺序，含 label 便于审计）。 */
  readonly sensitiveEntries: readonly { readonly code: string; readonly label: string }[];
  readonly verdict: AxisSensitivityVerdict;
}

// ---------------------------------------------------------------------------
// RobustnessRun（一次鲁棒性测试的完整实验记录）
// ---------------------------------------------------------------------------

/**
 * 一次鲁棒性测试的完整记录（不可变、可 JSON 序列化、带 fingerprint）。
 *
 * 内容（ROADMAP §20「记录完整实验信息」）：
 *   - 身份：robustnessRunId / strategyId@strategyVersion / axis；
 *   - 口径：thresholds（解析后自描述）；
 *   - 结果：samples（索引 0 = 基准条目，逐扰动绩效 + 判定 + 扰动后配置指纹）/
 *     conclusion（轴级敏感结论）；
 *   - 元数据：createdAt（调用方注入，非复现输入）+ fingerprint。
 *
 * 哲学对齐：experimentLineage（谱系可追溯）/ C-17.1 SearchRun（实验记录含全部
 * 扰动清单与指纹）。C-18.2 在此形态上扩展轴即可，不破坏既有记录语义。
 */
export interface RobustnessRun {
  readonly recordKind: typeof ROBUSTNESS_RUN_RECORD_KIND;
  readonly recordVersion: typeof ROBUSTNESS_RUN_RECORD_VERSION;
  readonly robustnessRunId: string;
  readonly strategyId: string;
  readonly strategyVersion: string;
  /** 本次运行覆盖的扰动轴（= 全部条目 axis；编排器强制单轴，保证归因干净）。 */
  readonly axis: RobustnessAxis;
  /** 漂移判定口径（解析后）。 */
  readonly thresholds: ResolvedRobustnessThresholds;
  /** 扰动清单 + 逐扰动绩效（索引 0 = 基准条目；基准评估失败 → 编排器抛错）。 */
  readonly samples: readonly RobustnessSample[];
  /** 轴级敏感性结论。 */
  readonly conclusion: RobustnessAxisConclusion;
  /** 运行记录创建时间（ISO-8601 UTC；由调用方注入，非复现输入）。 */
  readonly createdAt: string;
  /** 内容指纹（sha256 十六进制）：除本字段外全部字段的 canonical JSON 摘要。 */
  readonly fingerprint: string;
}

// ---------------------------------------------------------------------------
// 运行请求（runRobustnessStress 输入）
// ---------------------------------------------------------------------------

/**
 * 一次鲁棒性测试请求。
 *
 * 契约：
 *   - perturbations 由扰动器产出：**索引 0 必须为 isBaseline=true 的基准条目**，
 *     且全部条目同轴（混轴 → RB18_AXIS_MIXED 抛错，归因需单轴运行）；
 *   - evaluator 为注入式（接收扰动条目 → 绩效标量或结构化失败）；
 *   - robustnessRunId / createdAt 必填且由调用方注入（本模块禁止 Date.now）。
 */
export interface RobustnessRequest {
  readonly strategyId: string;
  readonly strategyVersion: string;
  /** 扰动清单（扰动器输出；索引 0 = 基准条目）。 */
  readonly perturbations: readonly PerturbationItem[];
  /** 漂移判定口径（缺省 = DEFAULT_ROBUSTNESS_THRESHOLDS）。 */
  readonly thresholds?: RobustnessThresholds;
  /** 注入式评估器（本模块不执行 IO / 回测）。 */
  readonly evaluator: RobustnessEvaluator;
  /** RobustnessRun ID（调用方注入，保证确定性）。 */
  readonly robustnessRunId: string;
  /** 创建时间（ISO-8601 UTC；调用方注入，非复现输入）。 */
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// 缺省口径常量
// ---------------------------------------------------------------------------

/** 收益漂移阈值缺省（百分点）。 */
export const DEFAULT_RETURN_DRIFT_THRESHOLD_PCT = 5;

/** 回撤恶化阈值缺省（百分点）。 */
export const DEFAULT_DRAWDOWN_WORSENING_THRESHOLD_PCT = 3;

/** 解析后漂移阈值缺省（与 RobustnessThresholds 缺省一致；冻结）。 */
export const DEFAULT_ROBUSTNESS_THRESHOLDS: Readonly<ResolvedRobustnessThresholds> =
  Object.freeze({
    returnDriftThresholdPct: DEFAULT_RETURN_DRIFT_THRESHOLD_PCT,
    drawdownWorseningThresholdPct: DEFAULT_DRAWDOWN_WORSENING_THRESHOLD_PCT,
  });

/**
 * 成交时机可扰动值域（默认：C-14.1 链**可执行**三枚举，映射见 map.ts）。
 * 刻意**不含** LIMIT_PRICE：C-14.1 plan/engine 只发市价单，LIMIT_PRICE 映射即
 * blocker（map.ts），把「声明但不可执行」的时机当作扰动假设即伪造可执行性。
 */
export const DEFAULT_EXECUTION_MODELS: readonly ExecutionModelId[] = Object.freeze([
  "NEXT_OPEN",
  "NEXT_CLOSE",
  "VWAP_PROXY",
]);
