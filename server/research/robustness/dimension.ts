/**
 * C-18.1 泛化扩展（ROBUSTNESS-CROSS-STAGE-001 结论 B 的**最小适配** · 首个消费者 = EXP-002）。
 *
 * ## 为什么在这个文件里
 *
 * `ROBUSTNESS-CROSS-STAGE-001`（审计）实测结论：
 *   - C-18.1 的**方法**（Baseline → 改变合理条件 → **重新计算** → 比较 → 判稳定性）跨阶段通用；
 *   - 但它的**词表**是策略的 —— 轴封闭为 4 个策略执行轴（`types.ts:66`）、指标恰 3 个交易标量
 *     （`types.ts:85-92`）、容差绑收益 / 回撤（`:149-160`）、身份字段是 `strategyId@strategyVersion`
 *     （`:268-269`）、且**强制单轴**（`evaluate.ts:174-178`）。
 *
 * ⇒ 研究阶段（EXP-002）需要的是「同一方法的**通用词表**」，不是「第二套引擎」。
 *   因此本文件与 `comparison.ts` / `multiDimension.ts` 一起，把 C-18.1 里
 *   **与策略无关的那半**（主体身份 / 不透明维度 / 指标集合 / 样本账 / 容差判定 / 指纹）
 *   从策略词表里解耦出来，放在**同一个模块**（`server/research/robustness/**`）里。
 *
 * ## 刻意的边界（规格 §2 / §17 明禁）
 *
 *   - **不预埋任何研究业务语义**：本文件与同族文件（`comparison.ts` / `multiDimension.ts`）的
 *     **代码**里**不得**出现 `T+1` / `nonBreakOpen` / `first-board` / `medianCloseReturn`
 *     这类研究侧标识符。闸门 =
 *     `tests/server/research/robustness/multiDimension.test.ts` 的
 *     「公共机制 · 12. 核心不含研究侧业务语义」——它**先剔除注释再判**（因为本段禁止说明本身
 *     就要写出这些词），并额外证明「剔除注释」这一步**有作用**，否则闸门会空转通过；
 *   - **不改 C-18.1 的既有形态**：`RobustnessAxis` 四轴、`RobustnessMetricsView` 三标量、
 *     `RobustnessRun` 单轴结论**一个字不改**（既有测试即等价性判据）；
 *   - **不新建 RB* 表 / 不新建 migration**：本层是纯计算，研究侧结果的持久化仍走
 *     `research_experiment_run` + 对象存储（规格 §1.2）。
 *
 * ## 与 C-18.1 的口径差异（有意为之，逐条登记）
 *
 * | 项 | C-18.1 | 本泛化层 | 理由 |
 * | --- | --- | --- | --- |
 * | 轴 | 4 个字面量（TS 判别收窄） | **不透明维度 id**（`string` + 唯一性校验） | 研究维度不可穷举；收窄由「维度声明表」承担 |
 * | 指标 | 恰 3 个标量 | **声明式指标词表**（`metricNames`）+ 值 / 不可用两态 | 研究统计量不可穷举；「算不出来」必须可表达且不得伪造 0 |
 * | 容差 | 固定 2 个阈值字段 | **按指标声明**（`MetricComparisonSpec`） | 不同指标的量纲与容差不同 |
 * | 身份 | `strategyId@strategyVersion` | `subjectKind + subjectId + subjectVersion (+runId)` | 两阶段本就是**同一种方法、不同被验证对象** |
 * | 运行形态 | 一次运行 = 一个轴 | 一次运行 = **一个 Baseline + N 维度 × M 变体** | 研究侧需要「同一基准下的多维矩阵」（多个独立 Run 拼接会丢统一基准） |
 *
 * ## 铁律
 *
 * 全部字段 readonly；数值有限（NaN / ±Infinity 拒绝）；可 JSON 序列化；
 * 失败响亮（退化输入结构化抛错，绝不 clamp / 绝不默认 0）；无 IO / `Date.now` / `Math.random`。
 */

import {
  ResearchValidationError,
  type ResearchValidationIssue,
} from "../experimentValidation";

// ---------------------------------------------------------------------------
// 一、被验证对象身份（规格 §5：保留策略语义向后兼容）
// ---------------------------------------------------------------------------

/** 被验证对象的种类。 */
export const ROBUSTNESS_SUBJECT_KINDS = ["strategy", "experiment"] as const;
export type RobustnessSubjectKind = (typeof ROBUSTNESS_SUBJECT_KINDS)[number];

/**
 * 被验证对象的身份（**泛化后的唯一身份表达**）。
 *
 * 🔴 向后兼容的方式是**适配器**而不是「在旧字段上加可选新字段」：
 *    `subjectFromStrategy(legacy)` 是 `strategyId@strategyVersion` → 本结构的**唯一**映射点；
 *    `RobustnessRequest` / `RobustnessRun` 保持原样（现有策略侧调用与测试**零改动**）。
 */
export interface RobustnessSubject {
  readonly subjectKind: RobustnessSubjectKind;
  /** 对象 id：策略 = `strategyId`；实验 = `experimentCode`（如 `group/key`）。 */
  readonly subjectId: string;
  /** 对象版本：策略 = `strategyVersion`；实验 = `COMPUTATION_VERSION`。 */
  readonly subjectVersion: string;
  /**
   * 对象所在 Run 的 id（仅实验语境有意义）。
   *
   * ⚠️ **执行期可以是 null**：实验的 `run()` 由 Runner 在**持久化之前**调用，
   *    此刻 runId 尚未生成 —— 实验无法谎报它，因此这里如实允许 null，
   *    而不是让实验去编一个看起来合法的 id。
   */
  readonly subjectRunId: string | null;
}

/** 策略侧适配器（旧身份 → 泛化身份；唯一映射点）。 */
export function subjectFromStrategy(input: {
  readonly strategyId: string;
  readonly strategyVersion: string;
}): RobustnessSubject {
  return {
    subjectKind: "strategy",
    subjectId: input.strategyId,
    subjectVersion: input.strategyVersion,
    subjectRunId: null,
  };
}

/** 实验侧适配器（研究实验身份 → 泛化身份；唯一映射点）。 */
export function subjectFromExperiment(input: {
  readonly experimentCode: string;
  readonly experimentVersion: string;
  readonly runId?: string | null;
}): RobustnessSubject {
  return {
    subjectKind: "experiment",
    subjectId: input.experimentCode,
    subjectVersion: input.experimentVersion,
    subjectRunId: input.runId ?? null,
  };
}

// ---------------------------------------------------------------------------
// 二、不透明维度（规格 §2.1：Dimension 从策略轴语义解耦）
// ---------------------------------------------------------------------------

/** 一个维度（如「观察日」「未来评价窗口」「样本条件」；**不含任何具体研究语义**）。 */
export interface RobustnessDimension {
  /** 维度 id（机器可读、稳定、非空；同一运行内唯一）。 */
  readonly id: string;
  /** 人读标签（进记录与页面）。 */
  readonly label: string;
  readonly description?: string;
  /** 该维度的取值语义（人读；如「相对日」）—— 仅描述，**不参与计算**。 */
  readonly valueUnit?: string;
}

/**
 * 一个变体条目（**不透明**：配置只要求「JSON 可序列化」，本层不解释其含义）。
 *
 * 🔴 `isBaseline` 的约定与 C-18.1 完全一致（复用同一纪律，不是新发明）：
 *    变体清单**索引 0 必须是 isBaseline=true 的基准条目**，且**恰一条** ——
 *    漂移必须有唯一锚点；「每个变体各自找一个基准」会让矩阵失去可比性。
 */
export interface RobustnessVariantItem {
  /** 所属维度 id（必须 ∈ 本次运行的维度声明表；基准条目的 `dimensionId` 为 `null`）。 */
  readonly dimensionId: string | null;
  /** 稳定程序化 code（如 `OBSERVATION_DAY_T3`）。 */
  readonly code: string;
  /** 人读标签（审计用途，不参与计算）。 */
  readonly label: string;
  /** 是否 = 基准自身。清单内恰一条且位于索引 0。 */
  readonly isBaseline: boolean;
  /** 变体配置（**不透明**：本层只要求 JSON 可序列化，不解释语义）。 */
  readonly config: Readonly<Record<string, unknown>>;
}

/** 配置值非法时的结构化原因（供两种错误词表复用同一遍遍历）。 */
export type SerializableConfigProblemKind = "NOT_OBJECT" | "NON_FINITE" | "UNSUPPORTED_TYPE";

export interface SerializableConfigProblem {
  readonly kind: SerializableConfigProblemKind;
  /** 出问题的键（`NOT_OBJECT` 时为 null）。 */
  readonly key: string | null;
  /** `UNSUPPORTED_TYPE` 时的实际类型名。 */
  readonly valueType?: string;
  /** `NON_FINITE` 时的字面量（人读）。 */
  readonly literal?: string;
}

/**
 * 配置可序列化性检查（**唯一实现**）。
 *
 * 允许的值类型与 C-18.1 的 `assertSerializableParameterSet` 完全一致：
 * `number`（必须有限）| `string` | `boolean` | `null`；对象嵌套 / 数组**不受支持**
 * （嵌套会让「配置指纹」与「比较口径」都失去边界）。
 *
 * 为什么抽成「返回问题」而不是「直接抛」：C-18.1 与本泛化层的**错误码词表不同**
 * （`RB18_PARAM_CONFIG_*` vs `RB18X_VARIANT_CONFIG_*`），但**遍历逻辑只有一份** ——
 * 各侧只做「问题 → 自己的 code / message」投影，而不是各写一遍遍历。
 */
export function findSerializableConfigProblem(value: unknown): SerializableConfigProblem | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { kind: "NOT_OBJECT", key: null };
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry === null) continue;
    if (typeof entry === "boolean" || typeof entry === "string") continue;
    if (typeof entry === "number") {
      if (!Number.isFinite(entry)) {
        return { kind: "NON_FINITE", key, literal: String(entry) };
      }
      continue;
    }
    return { kind: "UNSUPPORTED_TYPE", key, valueType: typeof entry };
  }
  return null;
}

/** 断言变体配置可序列化（泛化侧错误词表 `RB18X_VARIANT_CONFIG_*`）。 */
export function assertSerializableVariantConfig(
  config: unknown,
  path: string,
  variantCode: string
): asserts config is Record<string, unknown> {
  const problem = findSerializableConfigProblem(config);
  if (problem === null) return;
  if (problem.kind === "NOT_OBJECT") {
    throw new ResearchValidationError([
      {
        code: "RB18X_VARIANT_CONFIG_INVALID",
        path,
        message: `变体 ${variantCode} 的配置必须是对象（可 JSON 序列化）`,
      },
    ]);
  }
  if (problem.kind === "NON_FINITE") {
    throw new ResearchValidationError([
      {
        code: "RB18X_VARIANT_CONFIG_NON_FINITE",
        path: `${path}.${problem.key ?? ""}`,
        message:
          `变体 ${variantCode} 的配置 ${problem.key} 含非有限数字 ${problem.literal}` +
          "（禁止 NaN / Infinity）",
      },
    ]);
  }
  throw new ResearchValidationError([
    {
      code: "RB18X_VARIANT_CONFIG_TYPE_INVALID",
      path: `${path}.${problem.key ?? ""}`,
      message:
        `变体 ${variantCode} 的配置 ${problem.key} 的类型不受支持（${problem.valueType}）；` +
        "仅 number | string | boolean | null",
    },
  ]);
}

// ---------------------------------------------------------------------------
// 三、指标集合（规格 §3：可扩展的有限数值指标集合 + 「不可用」两态）
// ---------------------------------------------------------------------------

/** 指标名形态：机器可读、稳定、无空白（禁止 `"a b"` / 空串这类会在页面与 CSV 里散架的名字）。 */
export const ROBUSTNESS_METRIC_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]*$/;

/** 指标取值（**只有有限数字**；「算不出来」不得进这里）。 */
export type RobustnessMetricMap = Readonly<Record<string, number>>;

/**
 * 不可用指标 → 原因（**不得用 0 / null 兜底**）。
 *
 * 规格 §10：某个指标在某个变体不适用 ⇒ `null + reason`，**不得伪造 0**。
 * 这里把「不可用」做成**独立的一等状态**：一个指标要么出现在 `metrics`（有值），
 * 要么出现在 `unavailable`（有原因），**不允许两边都缺、也不允许两边都有**。
 */
export type RobustnessUnavailableMap = Readonly<Record<string, string>>;

/** 指标值两态快照（`metrics` ∪ `unavailable` 必须恰好覆盖声明的指标词表）。 */
export interface RobustnessMetricSnapshot {
  readonly metrics: RobustnessMetricMap;
  readonly unavailable: RobustnessUnavailableMap;
}

/** 校验指标名（词表与快照共用）。 */
export function assertValidMetricName(name: unknown, path: string): asserts name is string {
  if (typeof name !== "string" || name.trim() === "") {
    throw new ResearchValidationError([
      { code: "RB18X_METRIC_NAME_INVALID", path, message: "指标名必须是非空字符串" },
    ]);
  }
  if (!ROBUSTNESS_METRIC_NAME_PATTERN.test(name)) {
    throw new ResearchValidationError([
      {
        code: "RB18X_METRIC_NAME_UNSTABLE",
        path,
        message:
          `指标名 "${name}" 不合法：必须匹配 ${String(ROBUSTNESS_METRIC_NAME_PATTERN)}` +
          "（指标名会被写入 CSV / 表格列与比较声明，含空白或特殊字符会让下游失配）",
      },
    ]);
  }
}

/**
 * 校验指标快照与**声明的指标词表**一致。
 *
 * 三条硬规则（规格 §3 的第 3 / 4 / 5 条）：
 *   1. `metrics` 的值必须有限（非有限值必须走 `unavailable` 结构化处理）；
 *   2. 声明词表里的每个指标**恰好**出现在 `metrics` 或 `unavailable` 之一（缺一个即抛 ——
 *      「静默少一个指标」正是研究结论最危险的失真形态）；
 *   3. 不得出现词表之外的指标（比较声明会在它上面失配）。
 */
export function assertMetricSnapshotMatchesVocabulary(
  snapshot: RobustnessMetricSnapshot,
  metricNames: readonly string[],
  path: string
): void {
  const declared = new Set<string>();
  metricNames.forEach((name, index) => {
    assertValidMetricName(name, `${path}.metricNames[${index}]`);
    if (declared.has(name)) {
      throw new ResearchValidationError([
        {
          code: "RB18X_METRIC_NAME_DUPLICATE",
          path: `${path}.metricNames[${index}]`,
          message: `指标名 "${name}" 重复声明`,
        },
      ]);
    }
    declared.add(name);
  });
  if (declared.size === 0) {
    throw new ResearchValidationError([
      { code: "RB18X_METRIC_VOCABULARY_EMPTY", path: `${path}.metricNames`, message: "指标词表不能为空" },
    ]);
  }

  const metrics = snapshot.metrics ?? {};
  const unavailable = snapshot.unavailable ?? {};
  const problems: ResearchValidationIssue[] = [];
  for (const [name, value] of Object.entries(metrics)) {
    if (!declared.has(name)) {
      problems.push({
        code: "RB18X_METRIC_NOT_DECLARED",
        path: `${path}.metrics.${name}`,
        message: `指标 "${name}" 未在指标词表里声明（比较声明会在它上面失配）`,
      });
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      problems.push({
        code: "RB18X_METRIC_NON_FINITE",
        path: `${path}.metrics.${name}`,
        message:
          `指标 "${name}" = ${String(value)} 非有限数字；` +
          "「算不出来」必须走 unavailable（带原因），不得用 NaN / Infinity / 0 兜底",
      });
    }
    if (Object.prototype.hasOwnProperty.call(unavailable, name)) {
      problems.push({
        code: "RB18X_METRIC_STATE_AMBIGUOUS",
        path: `${path}`,
        message: `指标 "${name}" 同时出现在 metrics 与 unavailable（必须恰好占一个）`,
      });
    }
  }
  for (const [name, reason] of Object.entries(unavailable)) {
    if (!declared.has(name)) {
      problems.push({
        code: "RB18X_METRIC_NOT_DECLARED",
        path: `${path}.unavailable.${name}`,
        message: `不可用指标 "${name}" 未在指标词表里声明`,
      });
      continue;
    }
    if (typeof reason !== "string" || reason.trim() === "") {
      problems.push({
        code: "RB18X_METRIC_UNAVAILABLE_REASON_MISSING",
        path: `${path}.unavailable.${name}`,
        message: `不可用指标 "${name}" 必须给出非空原因（否则「为什么没有值」无从诊断）`,
      });
    }
  }
  for (const name of declared) {
    const hasValue = Object.prototype.hasOwnProperty.call(metrics, name);
    const hasReason = Object.prototype.hasOwnProperty.call(unavailable, name);
    if (!hasValue && !hasReason) {
      problems.push({
        code: "RB18X_METRIC_MISSING",
        path: `${path}`,
        message: `声明的指标 "${name}" 既没有值也没有不可用原因（不允许静默缺失）`,
      });
    }
  }
  if (problems.length > 0) throw new ResearchValidationError(problems);
}

// ---------------------------------------------------------------------------
// 四、样本账（规格 §13：本泛化层相比 C-18.1 必须加强的部分）
// ---------------------------------------------------------------------------

/**
 * 逐变体样本账（单位 = 一个样本；与 C-18.1 的「绩效标量」并列，不是替代）。
 *
 * ## 守恒式（**两条，都强制平**）
 *
 * ```text
 * candidateCount = eligibleCount + missingCount + invalidCount    // 资格层
 * eligibleCount  = validCount + excludedCount                     // 条件层
 * ⇒ candidateCount = validCount + excludedCount + missingCount + invalidCount   // §13 的式子
 * ```
 *
 * ## 与 EXP-001 口径的差异（**有意**，必须如实记录）
 *
 * EXP-001 的逐视界账里 `missingCount` 与 `invalidCount` **可重叠**（一个事件可能既缺又坏），
 * 因此三者之和未必等于 eligible —— 那是「诊断用重叠计数」。
 * 本层要求的是**互斥划分**（同一事件按优先级恰好归一类），因此 §13 的等式**严格成立**：
 *
 * ```text
 * 归入优先级：missing（所需窗口有整行缺失）
 *           → invalid（所需窗口有行但 OHLC / 行身份非法）
 *           → excluded（行情前提成立但不满足该变体的样本条件）
 *           → valid（前提与条件皆成立，指标可计算）
 * ```
 *
 * 两种口径各有用途，**不得混用**：本层给的是「可加划分」，用于矩阵里逐变体的可比性；
 * EXP-001 那份是「数据质量诊断」，两者在页面与报告里分别呈现。
 */
export interface RobustnessSampleAccounting {
  readonly candidateCount: number;
  readonly eligibleCount: number;
  readonly validCount: number;
  readonly excludedCount: number;
  readonly missingCount: number;
  readonly invalidCount: number;
  /** 剔除原因 → 条数（唯一诊断线索，**禁丢**）。 */
  readonly excludedByReason: Readonly<Record<string, number>>;
  /** 本变体实际生效的账目公式（人读；口径换了必须跟着换）。 */
  readonly accountingFormula: string;
}

/** 本层默认的账目公式文本（唯一来源；记录进每个样本账，便于跨版本比对）。 */
export const ROBUSTNESS_SAMPLE_ACCOUNTING_FORMULA =
  "candidate = valid + excluded + missing + invalid；eligible = valid + excluded；" +
  "归入优先级 missing > invalid > excluded > valid（互斥划分，可加）";

function assertNonNegativeInteger(value: unknown, path: string, problems: ResearchValidationIssue[]): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    problems.push({
      code: "RB18X_SAMPLE_ACCOUNTING_COUNT_INVALID",
      path,
      message: "样本账计数必须是非负整数",
    });
  }
}

/**
 * 校验样本账守恒（**结构级闸门**，不是注释）。
 *
 * 校验点：计数非负整数 → 资格层守恒 → 条件层守恒 → §13 等式 → 原因合计 → 单调性。
 */
export function assertSampleAccountingBalanced(
  accounting: RobustnessSampleAccounting,
  path: string
): void {
  const problems: ResearchValidationIssue[] = [];
  for (const field of [
    "candidateCount",
    "eligibleCount",
    "validCount",
    "excludedCount",
    "missingCount",
    "invalidCount",
  ] as const) {
    assertNonNegativeInteger(accounting[field], `${path}.${field}`, problems);
  }
  if (accounting.eligibleCount + accounting.missingCount + accounting.invalidCount !== accounting.candidateCount) {
    problems.push({
      code: "RB18X_SAMPLE_ACCOUNTING_ELIGIBILITY_IMBALANCE",
      path,
      message:
        `样本账不平（资格层）：eligible(${accounting.eligibleCount}) + missing(${accounting.missingCount}) + ` +
        `invalid(${accounting.invalidCount}) ≠ candidate(${accounting.candidateCount})`,
    });
  }
  if (accounting.validCount + accounting.excludedCount !== accounting.eligibleCount) {
    problems.push({
      code: "RB18X_SAMPLE_ACCOUNTING_CONDITION_IMBALANCE",
      path,
      message:
        `样本账不平（条件层）：valid(${accounting.validCount}) + excluded(${accounting.excludedCount}) ≠ ` +
        `eligible(${accounting.eligibleCount})`,
    });
  }
  if (accounting.validCount > accounting.candidateCount) {
    problems.push({
      code: "RB18X_SAMPLE_ACCOUNTING_MONOTONICITY",
      path,
      message: `valid(${accounting.validCount}) 不得大于 candidate(${accounting.candidateCount})`,
    });
  }
  const reasonSum = Object.values(accounting.excludedByReason ?? {}).reduce((a, b) => a + b, 0);
  if (reasonSum !== accounting.excludedCount) {
    problems.push({
      code: "RB18X_SAMPLE_ACCOUNTING_REASON_SUM_MISMATCH",
      path,
      message:
        `剔除原因合计 ${reasonSum} ≠ excludedCount ${accounting.excludedCount}` +
        "（剔除原因必须逐项如实，否则「为什么样本变少」无从诊断）",
    });
  }
  for (const [reason, count] of Object.entries(accounting.excludedByReason ?? {})) {
    if (reason.trim() === "") {
      problems.push({
        code: "RB18X_SAMPLE_ACCOUNTING_REASON_EMPTY",
        path: `${path}.excludedByReason`,
        message: "剔除原因码不得为空串",
      });
    }
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
      problems.push({
        code: "RB18X_SAMPLE_ACCOUNTING_REASON_COUNT_INVALID",
        path: `${path}.excludedByReason.${reason}`,
        message: "剔除原因计数必须是非负整数",
      });
    }
  }
  if (typeof accounting.accountingFormula !== "string" || accounting.accountingFormula.trim() === "") {
    problems.push({
      code: "RB18X_SAMPLE_ACCOUNTING_FORMULA_MISSING",
      path: `${path}.accountingFormula`,
      message: "必须记录本变体实际生效的账目公式（口径换了不写 = 事后无法解释）",
    });
  }
  if (problems.length > 0) throw new ResearchValidationError(problems);
}
